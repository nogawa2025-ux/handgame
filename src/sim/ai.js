import { C } from './constants.js';
import { attackDir, teamIds, gkId, giveBall } from './state.js';
import { inGoalArea } from './geometry.js';
import { movePlayer, pickLongTarget, throwBall, shoot, trySteal, nearestToBall, stepFeint } from './actions.js';

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

function openness(s, p) {
  let m = Infinity;
  for (const q of s.players) if (q.team !== p.team) m = Math.min(m, Math.hypot(q.x - p.x, q.z - p.z));
  return m;
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
  if (distGoal < 9.6 && b.holdTime > 0.35 && (laneOpen || b.holdTime > 2.2)) {
    const gk = s.players[gkId(1 - p.team)];
    const aim = gk.z > 0 ? -1 : gk.z < 0 ? 1 : (p.z >= 0 ? -1 : 1);
    // vary placement and power like a real shooter (deterministic, from the clock)
    const r = Math.abs(Math.sin(s.time * 12.9898 + p.id * 78.233) * 43758.5453) % 1;
    shoot(s, p.id, aim * (0.8 + 0.2 * r), 0.65 + 0.35 * ((r * 7.31) % 1));
    return;
  }
  // under pressure from a marker who hasn't been fooled yet: try a step feint first
  if (threat < 1.7 && b.holdTime > 0.3 && b.holdTime < 1.6 && !p.feinted) {
    const m = s.players.find((q) => q.team !== p.team && q.role === 'field' && q.fooledCd <= 0 && Math.hypot(q.x - p.x, q.z - p.z) < 1.7);
    if (m) {
      const side = (p.z - m.z) >= 0 ? 1 : -1;
      stepFeint(s, p.id, d * 0.4, side * Math.min(1, (C.COURT_HALF_Z - Math.abs(p.z)) / 2));
      p.feinted = true;
      return;
    }
  }
  if ((threat < 1.7 && b.holdTime > 0.5) || b.holdTime > 2.6) {
    let best = null, bestScore = -Infinity;
    for (const id of teamIds(p.team)) {
      const t = s.players[id];
      if (id === p.id || t.role === 'gk') continue;
      const score = openness(s, t) + 0.25 * (t.x * d) - 0.05 * Math.hypot(t.x - p.x, t.z - p.z);
      if (score > bestScore) { bestScore = score; best = id; }
    }
    if (best !== null) { throwBall(s, p.id, best, C.PASS_SPEED); return; }
  }
  // drive toward a shooting spot, drifting away from the nearest defender
  const tz = p.z * 0.6;
  moveTo(p, gx - d * 8.8, tz, dt, s.ball.x * d < 0);
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
      // a keeper wrong-footed by a shot feint can barely reach the other side
      const wrongSide = gk.offBalance > 0 && Math.sign(b.z - gk.z) !== Math.sign(gk.lean);
      const cap = wrongSide ? 0.45 : C.GK_REACH;
      const reach = Math.min(cap, 0.5 + Math.max(0, b.shotAge - C.GK_REACT) * C.GK_DIVE);
      if (Math.abs(b.z - gk.z) <= reach) {
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
  if (gk.offBalance > 0) tz = Math.max(-C.GOAL_HALF_W, Math.min(C.GOAL_HALF_W, tz + gk.lean));
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
  const human = cpuControlsAll ? null : s.controlled[team];
  const loose = b.holder === null && b.passTarget === null && !b.shot;
  const chaser = loose ? nearestToBall(s, team) : null;
  // presser: nearest non-human defender when the holder is near our goal
  let presser = null;
  if (!attacking && b.holder !== null) {
    const ownX = -d * C.COURT_HALF_X;
    const near = Math.abs(b.x - ownX) < (cpuControlsAll ? 11 : 9.5);
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
      const tz = az + b.z * 0.15;
      const behindBall = (b.x * d) < 0; // ball in own half → fast break, sprint
      moveTo(p, ax * d, tz, dt, behindBall && i < 2);
      return;
    }
    if (id === presser) {
      const h = s.players[b.holder];
      const ownX = -d * C.COURT_HALF_X;
      const ux = ownX - h.x, uz = -h.z;
      const ul = Math.hypot(ux, uz) || 1;
      moveTo(p, h.x + (ux / ul) * 0.9, h.z + (uz / ul) * 0.9, dt, false, 0.95);
      p.facing = Math.atan2(h.z - p.z, h.x - p.x);
      if (b.holdTime > 1.0) trySteal(s, id, -0.2);
      return;
    }
    const [zx, zz] = zoneSpot(s, team, i);
    moveTo(p, zx, zz, dt, true);
  });
}
