import { createMatchState } from './sim/state.js';
import { step, possessionTeam } from './sim/step.js';
import { createScene } from './render/scene.js';
import { loadPlayers } from './render/players.js';
import { createCamera } from './render/camera.js';
import { createHud, confetti } from './render/hud.js';
import { createControls } from './input/controls.js';
import { PendingInput } from './input/pending.js';
import { isValidCode } from './net/peer.js';
import * as screens from './ui/screens.js';
import * as net from './net/session.js';

const DT = 1 / 60;
const $ = (id) => document.getElementById(id);

const canvas = $('game');
const { renderer, scene, resize } = createScene(canvas);
const cam = createCamera();
const hud = createHud();
const controls = createControls($('controls'));
let views = null;

const view = createMatchState(); // state shown when idle (title backdrop)
let match = null; // active match runner

function onResize() { resize(cam.camera); }
addEventListener('resize', onResize);
onResize();

const neutral = () => ({ mx: 0, mz: 0, dash: false, pass: false, long: false, shootHeld: false, shootRelease: false });

/** Merge edge events so none are lost when several inputs collapse into one tick. */
export function mergeInput(a, b) {
  return {
    mx: b.mx, mz: b.mz, dash: b.dash, shootHeld: b.shootHeld,
    pass: a.pass || b.pass, long: a.long || b.long, shootRelease: a.shootRelease || b.shootRelease,
  };
}

/**
 * Runs one match. role: 'cpu' | 'host' | 'guest'.
 * Host and CPU simulate locally; guest renders snapshots from the host.
 */
function runMatch({ role, conn = null, localTeam = 0, onEnd }) {
  const state = createMatchState();
  const mirror = localTeam === 1;
  controls.setMirror(mirror);
  controls.releaseAll();
  hud.show(true);
  $('controls').classList.remove('hidden');
  let acc = 0;
  let remoteInput = neutral();
  const localQ = new PendingInput(); // keeps taps from frames that ran no sim step
  let ended = false;
  let display = state;
  let lastPhase = state.phase;
  const guestSync = role === 'guest' ? net.createGuestSync(conn, state) : null;
  const hostSync = role === 'host' ? net.createHostSync(conn) : null;
  if (hostSync) {
    hostSync.onInput((inp) => { remoteInput = mergeInput(remoteInput, inp); });
    state.stealBonus = [0, 0.3]; // compensate the guest's latency a little
  }

  const handleEvents = (events) => {
    for (const e of events) {
      if (e.startsWith('goal:')) {
        const scorer = Number(e.slice(5));
        hud.flash('ゴール！', scorer === localTeam);
        navigator.vibrate?.(scorer === localTeam ? [40, 40, 80] : 30);
      } else if (e === 'save') hud.flash('セーブ！', false, 0.9);
      else if (e === 'steal' || e === 'intercept') { /* subtle: no banner */ }
      else if (e === 'overtime') hud.flash('延長戦！', true, 2);
    }
  };

  const finish = (winner) => {
    if (ended) return;
    ended = true;
    $('controls').classList.add('hidden');
    controls.releaseAll();
    if (winner === localTeam) confetti();
    onEnd(winner, display.score.slice());
  };

  return {
    frame(dt) {
      if (ended) return display;
      const local = controls.read();
      localQ.add(local);
      if (role === 'guest') {
        guestSync.sendInput(local);
        display = guestSync.update(dt, local);
        handleEvents(guestSync.takeEvents());
        if (display.phase === 'ended') finish(display.winner);
      } else {
        acc += Math.min(dt, 0.1);
        let first = true, taken = null;
        const evs = [];
        while (acc >= DT) {
          const li = first ? (taken = localQ.take()) : { ...taken, pass: false, long: false, shootRelease: false };
          const ri = role === 'host' ? (first ? remoteInput : { ...remoteInput, pass: false, long: false, shootRelease: false }) : null;
          step(state, localTeam === 0 ? [li, ri] : [ri, li], DT);
          evs.push(...state.events);
          first = false;
          acc -= DT;
        }
        if (!first && role === 'host') remoteInput = { ...remoteInput, pass: false, long: false, shootRelease: false };
        if (hostSync) hostSync.tick(state, evs, dt);
        handleEvents(evs);
        display = state;
        if (state.phase === 'ended') finish(state.winner);
      }
      lastPhase = display.phase;
      const attacking = possessionTeam(display) === localTeam;
      controls.setMode(attacking ? 'attack' : 'defense');
      hud.update(display, localTeam, dt);
      return display;
    },
    mirror,
    localTeam,
    get state() { return display; },
    stop() { ended = true; hostSync?.stop(); guestSync?.stop(); $('controls').classList.add('hidden'); hud.show(false); },
  };
}

// ---------- app flow ----------
const app = {
  startCpu() {
    screens.clear();
    match = runMatch({
      role: 'cpu', localTeam: 0,
      onEnd: (winner, score) => {
        screens.result(winner, 0, score, {
          rematchLabel: 'もう一度',
          onRematch: () => app.startCpu(),
          onTitle: () => app.title(),
        });
      },
    });
    screens.countdown(3);
  },
  async create() {
    screens.lobbyWaiting();
    try {
      const room = await net.createRoom();
      const url = `${location.origin}${location.pathname}?room=${room.code}`;
      screens.lobby(room.code, url, () => { room.cancel(); app.title(); });
      const conn = await room.waitForGuest();
      app.online(conn, true);
    } catch (e) {
      if (e?.message !== 'CANCELLED') screens.error(net.errorText(e), () => app.title());
    }
  },
  async join(code) {
    screens.connecting(code);
    try {
      const conn = await net.joinRoom(code);
      history.replaceState(null, '', location.pathname);
      app.online(conn, false);
    } catch (e) {
      // keep ?room= in the URL so reloading retries when the host was not ready yet
      screens.error(net.errorText(e), () => { history.replaceState(null, '', location.pathname); app.title(); });
    }
  },
  /** isHost: whether this side simulates. Roles swap on every rematch. */
  online(conn, isHost) {
    screens.clear();
    // leaving the app mid-match (screen lock, app switch) ends the online match for both
    const onHide = () => { if (document.hidden && !conn.closed) conn.drop(); };
    document.removeEventListener('visibilitychange', app._onHide ?? onHide);
    app._onHide = onHide;
    document.addEventListener('visibilitychange', onHide);
    conn.onClose(() => {
      match?.stop(); match = null;
      screens.error('相手との接続が切れました', () => app.title());
    });
    const localTeam = isHost ? 0 : 1;
    match = runMatch({
      role: isHost ? 'host' : 'guest', conn, localTeam,
      onEnd: (winner, score) => {
        screens.result(winner, localTeam, score, {
          rematchLabel: 'もう一度',
          onRematch: () => {
            net.requestRematch(conn).then(() => { match?.stop(); app.online(conn, !isHost); });
          },
          onTitle: () => { conn.close(); match?.stop(); match = null; app.title(); },
        });
      },
    });
    screens.countdown(3);
  },
  title() {
    match?.stop(); match = null;
    hud.show(false);
    screens.title({
      onCreate: () => app.create(),
      onJoin: () => screens.join((code) => (isValidCode(code) ? app.join(code) : screens.error('部屋が見つかりません。コードを確かめてください', () => app.title())), () => app.title()),
      onCpu: () => app.startCpu(),
    });
  },
};

// ---------- render loop ----------
let last = performance.now();
let idleT = 0;
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  let shown = view, mirror = false, localTeam = 0;
  if (match) {
    shown = match.frame(dt);
    mirror = match.mirror; localTeam = match.localTeam;
  } else {
    // gentle attract mode behind the title screen
    idleT += dt;
    step(view, [null, null], dt);
    if (view.phase === 'ended') Object.assign(view, createMatchState());
  }
  if (views) views.update(shown, dt, localTeam);
  cam.follow(shown, dt, mirror);
  renderer.render(scene, cam.camera);
  requestAnimationFrame(loop);
}

// test hook: ?debug exposes manual frame stepping (rAF pauses in hidden tabs)
if (new URLSearchParams(location.search).has('debug')) {
  window.__hb = { frames(n, dt = 1 / 60) { for (let i = 0; i < n; i++) { last -= dt * 1000; loop(performance.now()); } }, get match() { return match; }, app };
}

async function boot() {
  $('loading').classList.remove('hidden');
  views = await loadPlayers(scene, view.players);
  $('loading').classList.add('hidden');
  const code = new URLSearchParams(location.search).get('room');
  if (code && isValidCode(code.toUpperCase())) app.join(code.toUpperCase());
  else app.title();
  requestAnimationFrame(loop);
}

// one-time: go fullscreen / lock landscape on first tap where supported
addEventListener('touchend', function once() {
  removeEventListener('touchend', once);
  const el = document.documentElement;
  if (el.requestFullscreen && !document.fullscreenElement) {
    el.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
  }
}, { passive: true });

boot();
