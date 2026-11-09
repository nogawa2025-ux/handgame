import { C } from './constants.js';
import { attackDir, teamIds, gkId, giveBall } from './state.js';
import { inGoalArea } from './geometry.js';
import { keeperReaches } from './duel.js';
import { movePlayer, pickLongTarget, throwBall, shoot, trySteal, nearestToBall, stepFeint, shotFeint, roll, bestPassTarget } from './actions.js';

// Attack spots in attack space (+x toward the goal being attacked, goal at x=20).
const ATTACK_SPOTS = [[13.5, -8.3], [13.5, 8.3], [10.5, -4.8], [10.5, 4.8], [9.5, 0], [13.2, 0]];
// Defensive zone (6-0) lateral offsets along the arc around the own goal.
const ZONE_Z = [-7.2, -4.4, -1.5, 1.5, 4.4, 7.2];
const ZONE_R = 6.7;

const possession = (s) => (s.ball.holder !== null ? s.players[s.ball.holder].team : s.ball.lastTeam);

function moveTo(p, tx, tz, dt, dash = false, mult = 1) {
  if (p.stun > 0) { movePlayer(p, 0, 0, false, false, dt, C.AI_RUN); return; }
  const dx = tx - p.x, dz = tz - p.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.25) { movePlayer(p, 0, 0, false, false, dt, C.AI_RUN); return; }
  const k = Math.min(1, d / 1.5) * mult;
  movePlayer(p, (dx / d) * k, (dz / d) * k, dash && d > 5 && p.stamina > 0.3, false, dt, C.AI_RUN);
}

/** Zone spot i for a team defending its own goal; shifted toward the ball. */
function zoneSpot(s, team, i) {
  const own = -attackDir(team) * C.COURT_HALF_X;
  const z = Math.max(-ZONE_R + 0.2, Math.min(ZONE_R - 0.2, ZONE_Z[i] * 0.95 + s.ball.z * 0.3));
  const x = own - Math.sign(own) * Math.sqrt(Math.max(0, ZONE_R * ZONE_R - z * z));
  return [x, z];
}


/** CPU ball carrier decisions. */
function carrier(s, p, dt) {
  const d = attackDir(p.team);
  const b = s.ball;
  const gx = d * C.COURT_HALF_X;
  const distGoal = Math.hypot(gx - p.x, p.z);
  // nearest opponent in front
  let threat = Infinity;
  for (const q of s.players) {
    if (q.team === p.team || q.role === 'gk') continue;
    const dx = (q.x - p.x) * d;
    if (dx > -0.5) threat = Math.min(threat, Math.hypot(q.x - p.x, q.z - p.z));
  }
  // only shoot through an open lane (a defender in the line would block it)
  const laneOpen = s.players.every((q) => {
    if (q.team === p.team || q.role !== 'field' || q.stun > 0) return true;
    const ax = gx - p.x, az = -p.z, l2 = ax * ax + az * az;
    const u = ((q.x - p.x) * ax + (q.z - p.z) * az) / l2;
    if (u <= 0 || u >= 1) return true;
    return Math.hypot(p.x + ax * u - q.x, p.z + az * u - q.z) > 0.9;
  });
  const hurry = s.attack?.warned && s.attack.team === p.team;
  // winding up: stand, then release at the side the keeper isn't leaning to (mostly)
  if (p.windup > 0) {
    p.windup += dt;
    const len = C.CPU_WINDUP + 0.25 * roll(s, p.id + 3);
    s.shootCharge[p.team] = Math.min(1, p.windup / len);
    // the run-up continues during the wind-up (into the jump)
    moveTo(p, gx - d * 7, p.z * 0.8, dt, false, 0.7);
    // sometimes sell the shot first
    if (!p.shotFeinted && p.windup > len * 0.6 && roll(s, p.id + 17) < 0.15) {
      shotFeint(s, p.id, -1, 0.6); p.shotFeinted = true; p.windup = 0; s.shootCharge[p.team] = 0; return;
    }
    if (p.windup >= len) {
      const gk = s.players[gkId(1 - p.team)];
      const r = roll(s, p.id + 5), r2 = roll(s, p.id + 9);
      const lz = gk.leanZ ?? 0;
      const side = Math.abs(lz) > 0.2 && r < C.CPU_READ ? -Math.sign(lz) : (r2 < 0.5 ? -1 : 1);
      shoot(s, p.id, side * (0.6 + 0.4 * r2), 0.85 + 0.15 * r, r < 0.5 ? -0.7 + 0.4 * r2 : 0.4 + 0.5 * r2);
    }
    return;
  }
  // 7m throw: settle, then wind up
  if (s.penalty && s.penalty.team === p.team) {
    if (s.penalty.time > 0.8) p.windup = 1e-3;
    return;
  }
  // real handball: pass it around the 9m line first, unless the defence isn't set (fast break)
  const a = s.attack;
  const attackTime = a && a.team === p.team ? a.time : 0;
  let defendersBack = 0;
  for (const q of s.players) if (q.team !== p.team && q.role === 'field' && (q.x - p.x) * d > 0) defendersBack++;
  const ready = defendersBack <= 2 || attackTime > (a?.build ?? C.BUILD_UP_MIN) || hurry;
  const wideOpen = laneOpen && threat > 2.6;
  if ((distGoal < 9.6 && b.holdTime > 0.35 && ((ready && (laneOpen || b.holdTime > 2.2)) || (wideOpen && b.holdTime > 0.6)))
    || (hurry && distGoal < 12 && b.holdTime > 0.2)) {
    p.windup = 1e-3; // start the wind-up (the keeper gets to read it)
    return;
  }
  // 1-on-1 against a marker in front: show one way, then break the other (or just go)
  if (!p.feinted && b.holdTime > 0.25) {
    const m = s.players.find((q) => q.team !== p.team && q.role === 'field' && q.stun <= 0 && (q.x - p.x) * d > 0 && Math.hypot(q.x - p.x, q.z - p.z) < 2.2);
    if (m || p.oo) {
      const roomL = C.COURT_HALF_Z - 1 - p.z, roomR = C.COURT_HALF_Z - 1 + p.z;
      p.oo ??= { t: 0, side: roll(s, p.id + 41) < 0.5 ? -1 : 1, fake: roll(s, p.id + 43) < 0.7 };
      if (p.oo.side > 0 && roomL < 1) p.oo.side = -1; else if (p.oo.side < 0 && roomR < 1) p.oo.side = 1;
      p.oo.t += dt;
      if (p.oo.t < 0.35) {
        // the set-up: drift toward the fake side (a mirroring marker follows)
        movePlayer(p, d * 0.3, p.oo.side * (p.oo.fake ? 1 : -1), true, false, dt, C.AI_RUN);
        return;
      }
      const go = p.oo.fake ? -p.oo.side : p.oo.side;
      if (p.oo.fake) stepFeint(s, p.id, d * 0.45, go);
      else movePlayer(p, d * 0.45, go, true, false, dt, C.AI_RUN);
      p.feinted = true; p.oo = null;
      return;
    }
  }
  // held up by a defender: move the ball on
  // (decided once per hold-up: sometimes it keeps driving and takes the free throw)
  if (!(p.contact > 0)) p.heldPass = null;
  else if (p.heldPass == null) p.heldPass = roll(s, 41 + p.id) < 0.55;
  if (p.heldPass && p.contact > 0.35 && b.holdTime > 0.4) {
    const best = bestPassTarget(s, p.id);
    if (best !== null) { throwBall(s, p.id, best, C.PASS_SPEED); return; }
  }
  if ((threat < 1.7 && b.holdTime > 0.5) || b.holdTime > (ready ? 2.6 : 1.1)) {
    const best = bestPassTarget(s, p.id);
    if (best !== null) { throwBall(s, p.id, best, C.PASS_SPEED); return; }
  }
  if (!ready) {
    // circulate: hold position just outside the 9m line, facing the goal
    moveTo(p, gx - d * Math.max(10, Math.min(13, Math.abs(gx - p.x))), p.z, dt, s.ball.x * d < 0, 0.6);
    return;
  }
  // cut in toward a shooting spot, drifting toward the middle
  const tz = p.z * 0.6;
  moveTo(p, gx - d * 8.3, tz, dt, true);
}

function keeper(s, team, dt, cpu) {
  const gk = s.players[gkId(team)];
  const b = s.ball;
  const own = -attackDir(team) * C.COURT_HALF_X;
  if (b.holder === gk.id) {
    s.gkTimer[team] += dt;
    if (s.gkTimer[team] > (cpu ? 1 : 2.5)) {
      const target = pickLongTarget(s, gk.id);
      if (target !== null) throwBall(s, gk.id, target, C.PASS_SPEED + 2);
    }
    movePlayer(gk, 0, 0, false, false, dt, C.GK_SPEED);
    return;
  }
  // a slow loose ball in our own area: step.keeperPickup walks the keeper to it
  if (b.holder === null && !b.shot && b.y < 2 && Math.hypot(b.vx, b.vz) <= 4 && inGoalArea(b.x, b.z, Math.sign(own))) return;
  const incoming = b.holder === null && b.shot && b.shotTeam !== team;
  if (incoming) {
    // save check when the ball reaches the keeper's plane
    if ((b.x - gk.x) * Math.sign(own) >= 0 && Math.abs(b.x - gk.x) < 0.6 && b.y < 2.4) {
      // the keeper's read (lean) decides which part of the goal it covers
      if (keeperReaches(gk, b)) {
        giveBall(s, gk.id);
        s.gkTimer[team] = 0;
        s.events.push('save');
        gk.anim = 'shoot'; gk.animTimer = 0.4;
        return;
      }
    }
    // the dive is modelled by `reach`; the body holds its position during the shot
    gk.vx = gk.vz = 0;
    if (Math.sign(b.x - own) !== Math.sign(gk.x - own) || Math.abs(b.x) > C.COURT_HALF_X) b.shot = false;
    return;
  }
  // stand on the ball–goal line, 1m off the goal line
  const tx = own - Math.sign(own) * 1.0;
  const dx = b.x - own, dz = b.z;
  let tz = Math.max(-C.GOAL_HALF_W * 0.8, Math.min(C.GOAL_HALF_W * 0.8, Math.abs(dx) > 0.1 ? (dz * 1.0) / Math.abs(dx) : 0));
  const ddx = tx - gk.x, ddz = tz - gk.z;
  const d = Math.hypot(ddx, ddz);
  if (d < 0.05) movePlayer(gk, 0, 0, false, false, dt, C.GK_SPEED);
  else movePlayer(gk, ddx / d * Math.min(1, d * 3), ddz / d * Math.min(1, d * 3), false, false, dt, C.GK_SPEED);
  gk.facing = attackDir(team) === 1 ? 0 : Math.PI;
}

/**
 * Drives every player of `team` except the human-controlled one
 * (or all of them when cpuControlsAll).
 */
export function aiTick(s, team, dt, cpuControlsAll) {
  if (s.phase !== 'play') return;
  keeper(s, team, dt, cpuControlsAll);
  const b = s.ball;
  const d = attackDir(team);
  const attacking = possession(s) === team;
  const ids = teamIds(team).slice(1);
  // while our keeper faces a shot the human steers the keeper, so the AI runs the field
  const human = cpuControlsAll || (s.duel && s.duel.team !== team) ? null : s.controlled[team];
  const loose = b.holder === null && b.passTarget === null && !b.shot;
  const chaser = loose ? nearestToBall(s, team) : null;
  // presser: nearest non-human defender when the holder is near our goal
  let presser = null;
  if (!attacking && b.holder !== null) {
    const ownX = -d * C.COURT_HALF_X;
    const near = Math.abs(b.x - ownX) < 11;
    if (near) {
      let best = Infinity;
      for (const id of ids) {
        if (id === human) continue;
        const p = s.players[id];
        const dd = Math.hypot(p.x - b.x, p.z - b.z);
        if (dd < best) { best = dd; presser = id; }
      }
    }
  }

  ids.forEach((id, i) => {
    if (id === human) return;
    const p = s.players[id];
    if (b.holder === id) { carrier(s, p, dt); return; }
    if (b.passTarget === id && b.holder === null) {
      // keep running on the line the passer led us on
      const v = Math.hypot(p.vx, p.vz);
      movePlayer(p, v > 0.3 ? p.vx / v : 0, v > 0.3 ? p.vz / v : 0, false, false, dt, C.AI_RUN);
      return;
    }
    if (id === chaser) { moveTo(p, b.x, b.z, dt, true); return; }
    if (attacking) {
      const [ax, az] = ATTACK_SPOTS[i];
      const tz = az + b.z * 0.15 + Math.sin(s.time * 0.9 + i * 1.7) * 0.9;
      const behindBall = (b.x * d) < 0; // ball in own half → fast break, sprint
      moveTo(p, ax * d, tz, dt, behindBall && i < 2);
      return;
    }
    if (id === presser) {
      const h = s.players[b.holder];
      const ownX = -d * C.COURT_HALF_X;
      const ux = ownX - h.x, uz = -h.z;
      const ul = Math.hypot(ux, uz) || 1;
      // step out and close the shooter down; sprint if far off
      const far = Math.hypot(h.x - p.x, h.z - p.z) > 2;
      // 1-on-1 style for this carrier: mirror (follows every move), wait (holds ground) or anticipate
      if (!p.dplan || p.dplan.h !== h.id) {
        const r = roll(s, p.id + 47);
        p.dplan = { h: h.id, kind: r < 0.5 ? 'mirror' : r < 0.75 ? 'wait' : 'read' };
      }
      let tx = h.x + (ux / ul) * 0.9, tz = h.z + (uz / ul) * 0.9;
      if (p.dplan.kind === 'read') {
        // step toward where a fake would break: against the carrier's current drift
        const lx = -uz / ul, lz = ux / ul, hv = h.vx * lx + h.vz * lz;
        if (Math.abs(hv) > 1) { tx -= lx * Math.sign(hv) * 1.0; tz -= lz * Math.sign(hv) * 1.0; }
      }
      if (far && p.stun <= 0) { const ex = tx - p.x, ez = tz - p.z, l = Math.hypot(ex, ez); movePlayer(p, ex / l, ez / l, p.stamina > 0.2, false, dt, C.RUN); }
      else moveTo(p, tx, tz, dt, false, p.dplan.kind === 'wait' ? 0.4 : 1);
      p.facing = Math.atan2(h.z - p.z, h.x - p.x);
      // arms up in the lane against a wind-up; otherwise poke at the ball now and then
      if (s.shootCharge[h.team] <= 0 && b.holdTime > 0.6 && !(h.contact > 0.1)) trySteal(s, id);
      return;
    }
    const [zx, zz] = zoneSpot(s, team, i);
    moveTo(p, zx, zz, dt, true);
  });
}
