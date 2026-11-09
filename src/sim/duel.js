// The shooter–keeper duel: wind-up detection, the keeper's read (a visible lean
// that can be a bluff), human keeper control and defenders raising their arms.
import { C } from './constants.js';
import { attackDir, gkId } from './state.js';
import { goalX } from './geometry.js';
import { roll } from './actions.js';

const clamp = (v, a = -1, b = 1) => Math.max(a, Math.min(b, v ?? 0));

/** Field player of `team` currently winding up a shot close enough for a duel, or null. */
function windingUp(s, team) {
  const b = s.ball;
  if (b.holder === null) return null;
  const p = s.players[b.holder];
  if (p.team !== team || p.role !== 'field' || !(s.shootCharge[team] > 0)) return null;
  return Math.hypot(goalX(team) - p.x, p.z) <= C.DUEL_RANGE ? p : null;
}

/** Point (in goal z / height units of -1..1) a shooter's raw stick aims at. */
export function stickAim(team, inp) {
  return { z: clamp(inp?.sx) * attackDir(team), h: clamp(-(inp?.sy ?? 0)) };
}

/**
 * Runs once per tick after the AI: sets s.duel, moves each keeper's lean toward
 * its read (human stick, or the CPU's plan), and raises defenders' arms.
 */
export function duelTick(s, inputs, dt) {
  s.duel = null;
  for (const t of [0, 1]) {
    const p = windingUp(s, t);
    if (p) s.duel = { team: t, shooter: p.id };
  }
  const b = s.ball;
  const shotNow = s.events.includes('shot');
  for (const d of [0, 1]) {
    const gk = s.players[gkId(d)];
    gk.leanZ ??= 0; gk.leanH ??= 0; gk.aimZ ??= 0; gk.aimH ??= 0;
    const human = inputs[d] != null;
    const facing = s.duel && s.duel.team !== d;
    const incoming = b.shot && b.shotTeam !== d && b.holder === null;
    if (facing) {
      if (human) {
        // keeper view: stick left/right = which side to cover, up/down = high/low
        gk.aimZ = clamp(inputs[d].sx) * attackDir(d);
        gk.aimH = clamp(-(inputs[d].sy ?? 0));
      } else {
        const sh = s.players[s.duel.shooter];
        if (!gk.plan) {
          // lean toward the near post a bit more often; sometimes it's a bluff
          const near = Math.sign(sh.z) || 1;
          const r = roll(s, 11 + d);
          gk.plan = { g: r < 0.6 ? near : -near, bluff: roll(s, 23 + d) < C.GK_BLUFF, h: roll(s, 37 + d) < 0.5 ? -0.7 : 0.6 };
        }
        gk.aimZ = gk.plan.g * C.GK_SHOW; gk.aimH = gk.plan.h * 0.5;
      }
    } else if (incoming && shotNow && !human && gk.plan) {
      // release: the CPU keeper commits (or goes the other way if the lean was a bluff)
      gk.aimZ = gk.plan.bluff ? -gk.plan.g : gk.plan.g;
      gk.aimH = gk.plan.h;
      gk.plan = null;
    } else if (!incoming) {
      gk.plan = null;
      gk.aimZ = 0; gk.aimH = 0;
    }
    // a CPU keeper sold a shot feint commits to the faked side
    if (!human && gk.offBalance > 0) gk.aimZ = Math.sign(gk.lean) || gk.aimZ;
    const step = C.GK_LEAN_RATE * dt;
    gk.leanZ += clamp(gk.aimZ - gk.leanZ, -step, step);
    gk.leanH += clamp(gk.aimH - gk.leanH, -step, step);
  }
  // defenders in front of a shooter put their arms up
  const sh = s.duel ? s.players[s.duel.shooter] : null;
  for (const p of s.players) {
    if (p.role !== 'field') continue;
    p.armsUp = false;
    if (!sh || p.team === sh.team || p.stun > 0) continue;
    const dx = (p.x - sh.x) * attackDir(sh.team);
    p.armsUp = dx > 0 && Math.hypot(p.x - sh.x, p.z - sh.z) < C.ARMS_UP_R;
  }
}

/** Keeper save test at its plane: true if the ball is within the keeper's reach. */
export function keeperReaches(gk, b) {
  // straight at the body: always stopped
  if (Math.abs(b.z - gk.z) < C.GK_BODY && b.y < 1.9) return true;
  const shuffle = Math.max(0, b.shotAge - 0.7) * C.GK_SPEED;
  let reach = Math.min(C.GK_REACH, 0.55 + Math.max(0, b.shotAge - C.GK_REACT) * C.GK_DIVE) + shuffle;
  const lz = gk.leanZ ?? 0, lh = gk.leanH ?? 0;
  // committed one way: the other side is almost out of reach
  if (Math.abs(lz) > 0.4 && Math.sign(b.z - gk.z) === -Math.sign(lz) && Math.abs(b.z - gk.z) > 0.3) reach *= C.GK_WRONG;
  const cz = gk.z + lz * C.GK_LEAN_REACH;
  const cy = C.SHOT_Y_MID + lh * C.GK_LEAN_H;
  return Math.hypot(b.z - cz, (b.y - cy) * 0.6) <= reach;
}
