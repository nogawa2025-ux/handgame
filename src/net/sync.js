// Host/guest protocol: host simulates and streams snapshots; guest interpolates
// and predicts its own controlled player.
import { C } from '../sim/constants.js';
import { createMatchState } from '../sim/state.js';
import { movePlayer } from '../sim/actions.js';

const ANIMS = ['idle', 'run', 'pass', 'shoot'];
const PHASES = ['countdown', 'play', 'goal', 'restart', 'ended'];
const r2 = (v) => Math.round(v * 100) / 100;
const now = () => performance.now() / 1000;

export function encodeSnapshot(s) {
  const p = [];
  for (const q of s.players) p.push(r2(q.x), r2(q.z), r2(q.vx), r2(q.vz), r2(q.facing), ANIMS.indexOf(q.anim), r2(q.animTimer));
  const b = s.ball;
  return {
    p,
    b: [r2(b.x), r2(b.y), r2(b.z), r2(b.vx), r2(b.vy), r2(b.vz), b.holder ?? -1, r2(b.holdTime), b.lastTeam, b.passTarget ?? -1],
    t: r2(s.time), ph: PHASES.indexOf(s.phase), pt: r2(s.phaseTimer), sc: s.score.slice(), c: s.controlled.slice(),
    ch: s.shootCharge.map(r2), ot: s.overtime ? 1 : 0, w: s.winner,
  };
}

export function decodeSnapshot(o, into = createMatchState()) {
  into.players.forEach((q, i) => {
    const k = i * 7;
    q.x = o.p[k]; q.z = o.p[k + 1]; q.vx = o.p[k + 2]; q.vz = o.p[k + 3]; q.facing = o.p[k + 4];
    q.anim = ANIMS[o.p[k + 5]] ?? 'idle'; q.animTimer = o.p[k + 6];
  });
  const b = into.ball;
  [b.x, b.y, b.z, b.vx, b.vy, b.vz] = o.b;
  b.holder = o.b[6] === -1 ? null : o.b[6];
  b.holdTime = o.b[7]; b.lastTeam = o.b[8]; b.passTarget = o.b[9] === -1 ? null : o.b[9];
  into.time = o.t; into.phase = PHASES[o.ph]; into.phaseTimer = o.pt;
  into.score = o.sc.slice(); into.controlled = o.c.slice(); into.shootCharge = o.ch.slice();
  into.overtime = !!o.ot; into.winner = o.w;
  return into;
}

const lerp = (a, b, k) => a + (b - a) * k;
const lerpAngle = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

/** Interpolation buffer: renders `delay` seconds in the past. */
export class SnapshotBuffer {
  constructor(delay = 0.1) { this.delay = delay; this.items = []; this.out = createMatchState(); }
  push(state, time) {
    this.items.push({ state, time });
    if (this.items.length > 30) this.items.shift();
  }
  get latest() { return this.items[this.items.length - 1]?.state ?? null; }
  sample(time) {
    const t = time - this.delay;
    const it = this.items;
    if (!it.length) return this.out;
    // always write into `out` so callers may mutate the result freely
    let a = it[0], b = it[it.length - 1];
    let k = 0;
    if (t >= b.time) a = b;
    else if (t <= a.time) b = a;
    else {
      for (let i = it.length - 1; i > 0; i--) {
        if (it[i - 1].time <= t) { a = it[i - 1]; b = it[i]; break; }
      }
      k = (t - a.time) / Math.max(1e-6, b.time - a.time);
    }
    const o = this.out, A = a.state, B = b.state;
    Object.assign(o, B, { players: o.players, ball: o.ball });
    o.players.forEach((q, i) => {
      const pa = A.players[i], pb = B.players[i];
      Object.assign(q, pb);
      q.x = lerp(pa.x, pb.x, k); q.z = lerp(pa.z, pb.z, k);
      q.facing = lerpAngle(pa.facing, pb.facing, k);
    });
    Object.assign(o.ball, B.ball);
    // don't interpolate across a change of holder (teleport-like jumps look worse)
    if (A.ball.holder === B.ball.holder) {
      o.ball.x = lerp(A.ball.x, B.ball.x, k); o.ball.y = lerp(A.ball.y, B.ball.y, k); o.ball.z = lerp(A.ball.z, B.ball.z, k);
    }
    return o;
  }
}

/**
 * Guest-side prediction of the locally controlled player.
 * Returns the state with that player (and a held ball) moved to the predicted spot.
 */
export class Predictor {
  constructor() { this.p = null; this.id = -1; }
  apply(state, latest, team, input, dt) {
    const id = state.controlled[team];
    const auth = latest?.players[id];
    if (!auth || state.phase !== 'play') { this.p = null; return state; }
    if (id !== this.id || !this.p) {
      this.id = id;
      this.p = { ...auth };
    }
    const p = this.p;
    const holding = latest.ball.holder === id;
    movePlayer(p, input.mx, input.mz, input.dash, holding && latest.ball.holdTime > C.HOLD_LIMIT, dt);
    const err = Math.hypot(auth.x - p.x, auth.z - p.z);
    if (err > 2.5) { p.x = auth.x; p.z = auth.z; }
    else if (err > 0.8) { const k = Math.min(1, dt / 0.15) * 0.5; p.x += (auth.x - p.x) * k; p.z += (auth.z - p.z) * k; }
    const q = state.players[id];
    q.x = p.x; q.z = p.z; q.vx = p.vx; q.vz = p.vz; q.facing = p.facing;
    if (state.ball.holder === id) {
      state.ball.x = p.x + Math.cos(p.facing) * 0.35;
      state.ball.z = p.z + Math.sin(p.facing) * 0.35;
    }
    return state;
  }
}

export function createHostSync(conn) {
  const offs = [];
  let inputFn = null, acc = 0, events = [], seq = 0, lastInputSeq = 0;
  offs.push(conn.on('input', (m) => { if (m.seq > lastInputSeq) { lastInputSeq = m.seq; inputFn?.(m.i); } }));
  return {
    onInput(fn) { inputFn = fn; },
    tick(state, evs, dt) {
      events.push(...evs);
      acc += dt;
      const ended = state.phase === 'ended';
      if (acc >= 1 / C.SNAPSHOT_HZ || ended || evs.length) {
        acc = 0;
        conn.send({ t: 'snap', seq: ++seq, s: encodeSnapshot(state), ev: events });
        events = [];
      }
    },
    stop() { offs.forEach((f) => f()); },
  };
}

export function createGuestSync(conn, initial, team = 1) {
  const buf = new SnapshotBuffer(0.1);
  const pred = new Predictor();
  let events = [], seq = 0, lastSnap = 0;
  let latest = initial;
  let pending = { pass: false, long: false, shootRelease: false };
  const offs = [conn.on('snap', (m) => {
    if (m.seq <= lastSnap) return;
    lastSnap = m.seq;
    latest = decodeSnapshot(m.s);
    buf.push(latest, now());
    events.push(...m.ev);
  })];
  let sendAcc = 0;
  return {
    sendInput(inp) {
      pending.pass ||= inp.pass; pending.long ||= inp.long; pending.shootRelease ||= inp.shootRelease;
      conn.send({ t: 'input', seq: ++seq, i: { ...inp, ...pending } });
      pending = { pass: false, long: false, shootRelease: false };
      sendAcc = 0;
    },
    update(dt, inp) {
      // the final whistle must never be hidden by the interpolation delay
      if (latest.phase === 'ended' || !buf.items.length) return latest;
      return pred.apply(buf.sample(now()), buf.latest, team, inp, dt);
    },
    takeEvents() { const e = events; events = []; return e; },
    stop() { offs.forEach((f) => f()); },
  };
}
