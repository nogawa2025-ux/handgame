// PeerJS room create/join wrapper.
import { ICE_SERVERS } from './ice.js';

const PEERJS_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/+esm';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PREFIX = 'hbx-';
const JOIN_TIMEOUT = 10000;

async function defaultPeer() {
  const mod = await import(PEERJS_URL);
  return mod.Peer ?? mod.default;
}

export function randomCode() {
  let s = '';
  const r = crypto.getRandomValues(new Uint8Array(5));
  for (const n of r) s += ALPHABET[n % ALPHABET.length];
  return s;
}

const peerOptions = () => ({ config: { iceServers: ICE_SERVERS }, debug: 0 });

/**
 * Wrap a PeerJS DataConnection: typed message listeners, heartbeat, single close.
 */
export function wrapConn(dc, peer, { heartbeat = true } = {}) {
  const listeners = new Map(); // type → Set<fn>
  let closeFn = null, closed = false, lastMsg = Date.now(), hb = null;
  const rematch = { mine: false, theirs: false, resolve: null };

  const fireClose = () => {
    if (closed) return;
    closed = true;
    clearInterval(hb);
    try { dc.close(); } catch {}
    try { peer.destroy(); } catch {}
    closeFn?.();
  };
  const checkRematch = () => {
    if (rematch.mine && rematch.theirs && rematch.resolve) {
      const r = rematch.resolve;
      rematch.mine = rematch.theirs = false; rematch.resolve = null;
      r();
    }
  };

  dc.on('data', (msg) => {
    lastMsg = Date.now();
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'rematch') { rematch.theirs = true; checkRematch(); return; }
    if (msg.t === 'bye') { fireClose(); return; }
    const set = listeners.get(msg.t);
    if (set) for (const fn of [...set]) fn(msg);
  });
  dc.on('close', fireClose);
  dc.on('error', fireClose);
  dc.on('iceStateChanged', (st) => { if (st === 'failed' || st === 'closed') fireClose(); });
  peer.on?.('disconnected', () => { /* signalling lost; data channel may still work */ });

  if (heartbeat) {
    hb = setInterval(() => {
      if (Date.now() - lastMsg > 5000) { fireClose(); return; }
      try { dc.send({ t: 'ping' }); } catch { fireClose(); }
    }, 1000);
  }

  return {
    send(msg) { if (!closed) { try { dc.send(msg); } catch { fireClose(); } } },
    on(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
      return () => listeners.get(type)?.delete(fn);
    },
    onClose(fn) { closeFn = fn; },
    close() {
      if (closed) return;
      try { dc.send({ t: 'bye' }); } catch {}
      closeFn = null;
      setTimeout(fireClose, 100);
    },
    /** Resolves once both sides asked for a rematch. */
    requestRematch() {
      return new Promise((resolve) => {
        rematch.mine = true; rematch.resolve = resolve;
        try { dc.send({ t: 'rematch' }); } catch {}
        checkRematch();
      });
    },
    get closed() { return closed; },
  };
}

export async function createRoom(PeerCtor) {
  PeerCtor ??= await defaultPeer();
  let peer, code;
  for (let attempt = 0; attempt < 5; attempt++) {
    code = randomCode();
    peer = new PeerCtor(PREFIX + code, peerOptions());
    const ok = await new Promise((resolve, reject) => {
      peer.on('open', () => resolve(true));
      peer.on('error', (e) => {
        if (e?.type === 'unavailable-id') resolve(false);
        else reject(netError(e));
      });
    });
    if (ok) break;
    peer.destroy();
    peer = null;
  }
  if (!peer) throw new Error('SERVER');
  let cancel;
  const waiting = new Promise((resolve, reject) => {
    cancel = () => { reject(new Error('CANCELLED')); peer.destroy(); };
    peer.on('connection', (dc) => {
      if (peer._taken) { dc.close(); return; }
      dc.on('open', () => {
        if (peer._taken) { dc.close(); return; }
        peer._taken = true;
        resolve(wrapConn(dc, peer));
      });
    });
    peer.on('error', (e) => { if (!peer._taken) reject(netError(e)); });
  });
  waiting.catch(() => {});
  return { code, waitForGuest: () => waiting, cancel };
}

export async function joinRoom(code, PeerCtor) {
  PeerCtor ??= await defaultPeer();
  const peer = new PeerCtor(undefined, peerOptions());
  return new Promise((resolve, reject) => {
    let done = false;
    const fail = (err) => { if (done) return; done = true; clearTimeout(timer); try { peer.destroy(); } catch {} reject(err); };
    const timer = setTimeout(() => fail(new Error('CONNECT_FAILED')), JOIN_TIMEOUT);
    peer.on('error', (e) => fail(netError(e)));
    peer.on('open', () => {
      const dc = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
      dc.on?.('open', () => {
        if (done) return;
        done = true; clearTimeout(timer);
        resolve(wrapConn(dc, peer));
      });
      dc.on?.('error', () => fail(new Error('CONNECT_FAILED')));
    });
  });
}

function netError(e) {
  if (e?.type === 'peer-unavailable') return new Error('NOT_FOUND');
  if (['network', 'server-error', 'socket-error', 'socket-closed', 'browser-incompatible'].includes(e?.type)) return new Error('SERVER');
  return new Error('CONNECT_FAILED');
}

export function errorText(e) {
  switch (e?.message) {
    case 'NOT_FOUND': return '部屋が見つかりません。コードを確かめてください';
    case 'SERVER': return 'サーバーに接続できませんでした。電波の良い場所でやり直してください';
    case 'CONNECT_FAILED': return '接続できませんでした。Wi-Fiで試すか、しばらくしてからやり直してください';
    default: return 'エラーが発生しました。やり直してください';
  }
}
