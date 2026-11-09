// 1-on-1 face-off: a defender squares up to the ball carrier near goal. While it
// lasts the attacker picks a move with the stick (sideways = across his way to
// goal): hold a side = break that way, flick one way then quickly the other = feint. stepFeint() resolves it against how the
// defender is moving (followed / waited / read).
import { C } from './constants.js';
import { goalX } from './geometry.js';
import { stepFeint } from './actions.js';

const unit = (x, z) => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };

/** Way to goal for the carrier `p`. */
const toGoal = (p) => unit(goalX(p.team) - p.x, -p.z);

/** Runs before the human/AI ticks: sets or clears s.face. */
export function faceTick(s, inputs) {
  const prev = s.face;
  s.face = null;
  const b = s.ball;
  if (s.phase !== 'play' || s.penalty || s.duel || b.holder === null) return;
  const h = s.players[b.holder];
  if (h.role !== 'field' || h.jump > 0 || s.shootCharge[h.team] > 0) return;
  if (Math.hypot(goalX(h.team) - h.x, h.z) > C.FACE_RANGE) return;
  const [ax, az] = toGoal(h);
  let best = null, bestD = Infinity;
  for (const q of s.players) {
    if (q.team === h.team || q.role !== 'field' || q.stun > 0) continue;
    const dx = q.x - h.x, dz = q.z - h.z, d = Math.hypot(dx, dz);
    const kept = prev && prev.att === h.id && prev.def === q.id;
    if (d > (kept ? C.FACE_EXIT : C.FACE_R) || d < 1e-6) continue;
    if ((dx * ax + dz * az) / d < (kept ? 0.2 : 0.5)) continue; // must stand in the way
    if (d < bestD) { bestD = d; best = q; }
  }
  if (!best) return;
  const humanAtt = inputs[h.team] != null, humanDef = inputs[best.team] != null;
  if (!humanAtt && !humanDef) return;
  if (humanDef) s.controlled[best.team] = best.id;
  const same = prev && prev.att === h.id && prev.def === best.id;
  s.face = { team: h.team, att: h.id, def: best.id };
  if (!same) s.faceMove = [null, null];
}

/** The attacker's stick split into his own frame: lat > 0 = right of his way to goal. */
export function faceStick(s, me, inp) {
  const f = s.face;
  if (!f || me.id !== f.att) return null;
  const [fx, fz] = toGoal(s.players[f.att]);
  const mag = Math.hypot(inp.mx, inp.mz);
  const lat = mag > 0.3 ? (inp.mx * -fz + inp.mz * fx) / Math.max(1, mag) : 0;
  return { lat, fx, fz };
}

/**
 * Attacker's move choice. Call each tick with the face stick of the human carrier.
 * Returns true if a move (break or feint) was made this tick.
 */
export function faceMoves(s, t, me, st, dt) {
  s.faceMove ??= [null, null];
  const m = s.faceMove[t];
  const side = Math.abs(st.lat) > 0.6 ? Math.sign(st.lat) : 0;
  const go = (dir, feint) => {
    // break diagonally forward to that side
    const lx = -st.fz * dir, lz = st.fx * dir;
    s.faceMove[t] = { done: true };
    stepFeint(s, me.id, st.fx * 0.6 + lx, st.fz * 0.6 + lz);
    if (feint) s.events.push('face-feint');
    return true;
  };
  // only a flick counts (neutral → a side quickly): plain steering past a defender doesn't
  if (m?.done) { if (!side) s.faceMove[t] = null; return false; }
  if (!m) { if (side && (s.latLow?.[t] ?? 9) <= C.FACE_FLICK) s.faceMove[t] = { side, t: 0 }; return false; }
  m.t += dt;
  if (side === -m.side && m.t < C.FACE_FEINT_WINDOW) return go(side, true); // quick reversal: feint
  if (side === m.side && m.t >= C.FACE_BREAK_HOLD) return go(side, false);   // held: break that way
  if (!side) s.faceMove[t] = null;                                          // let go: nothing
  return false;
}

/**
 * Every tick for the ball carrier: how long the stick has been off the sideways
 * neutral (lat = across the way to goal). A move needs a quick neutral → side flick.
 */
export function trackLat(s, t, me, inp, dt) {
  s.latLow ??= [9, 9];
  const [fx, fz] = toGoal(me);
  const mag = Math.hypot(inp.mx, inp.mz);
  const lat = mag > 0.3 ? (inp.mx * -fz + inp.mz * fx) / Math.max(1, mag) : 0;
  s.latLow[t] = Math.abs(lat) < 0.3 ? 0 : s.latLow[t] + dt;
}
