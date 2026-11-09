import { C } from './constants.js';
import { clampOutOfGoalArea, goalX } from './geometry.js';
import { giveBall, teamIds } from './state.js';

const ACCEL = 10; // 1/s, velocity smoothing rate

export function movePlayer(p, dirX, dirZ, dash, dribbling, dt, maxSpeed = C.RUN) {
  let len = Math.hypot(dirX, dirZ);
  if (len > 1) { dirX /= len; dirZ /= len; len = 1; }
  const st = p.stamina ?? 1;
  const dashing = dash && st > C.STAMINA_MIN_DASH && len > 0.1;
  let speed = (dashing ? C.DASH : maxSpeed) * (1 - C.TIRED_SLOWDOWN * (1 - st));
  if (dribbling) speed *= C.DRIBBLE_MULT;
  const cur = Math.hypot(p.vx, p.vz);
  if (cur < 1.5 && len < 0.1) p.stamina = Math.min(1, st + C.STAMINA_REST * dt);
  else {
    const r = cur / C.RUN;
    p.stamina = Math.max(0, st - (C.STAMINA_BASE + C.STAMINA_RUN * r * r + (dashing ? C.STAMINA_DASH : 0)) * dt);
  }
  const k = Math.min(1, ACCEL * dt);
  p.vx += (dirX * speed - p.vx) * k;
  p.vz += (dirZ * speed - p.vz) * k;
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  if (len > 0.1) p.facing = Math.atan2(dirZ, dirX);
  if (p.role === 'field') clampOutOfGoalArea(p);
  p.x = Math.max(-C.COURT_HALF_X + 0.3, Math.min(C.COURT_HALF_X - 0.3, p.x));
  p.z = Math.max(-C.COURT_HALF_Z + 0.3, Math.min(C.COURT_HALF_Z - 0.3, p.z));
}

function angleBetween(ax, az, bx, bz) {
  const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
  if (la < 1e-6 || lb < 1e-6) return Math.PI;
  return Math.acos(Math.max(-1, Math.min(1, (ax * bx + az * bz) / (la * lb))));
}

export function pickPassTarget(s, fromId, dirX, dirZ) {
  const from = s.players[fromId];
  if (Math.hypot(dirX, dirZ) < 0.15) { dirX = Math.cos(from.facing); dirZ = Math.sin(from.facing); }
  let best = null, bestScore = Infinity;
  for (const id of teamIds(from.team)) {
    if (id === fromId) continue;
    const t = s.players[id];
    const dx = t.x - from.x, dz = t.z - from.z;
    const ang = angleBetween(dirX, dirZ, dx, dz);
    if (ang > Math.PI / 3) continue;
    const score = ang + 0.02 * Math.hypot(dx, dz);
    if (score < bestScore) { bestScore = score; best = id; }
  }
  return best;
}

export function pickLongTarget(s, fromId) {
  const from = s.players[fromId];
  const d = from.team === 0 ? 1 : -1;
  let best = null, bestX = -Infinity;
  for (const id of teamIds(from.team)) {
    const t = s.players[id];
    if (id === fromId || t.role === 'gk') continue;
    if (t.x * d > bestX) { bestX = t.x * d; best = id; }
  }
  return best;
}

function launch(s, from, tx, tz, ty, speed) {
  const b = s.ball;
  b.holder = null; b.holdTime = 0; b.lastTeam = from.team;
  b.thrower = from.id; b.throwTimer = 0.25; b.flightAge = 0;
  b.x = from.x + Math.cos(from.facing) * 0.4; b.z = from.z + Math.sin(from.facing) * 0.4; b.y = 1.1;
  const dx = tx - b.x, dz = tz - b.z;
  const dist = Math.max(0.1, Math.hypot(dx, dz));
  const t = dist / speed;
  b.vx = (dx / dist) * speed; b.vz = (dz / dist) * speed;
  b.vy = (ty - b.y) / t + 0.5 * C.GRAVITY * t;
}

export function throwBall(s, fromId, toId, speed) {
  const from = s.players[fromId], to = s.players[toId];
  const est = Math.hypot(to.x - from.x, to.z - from.z) / speed;
  const tx = to.x + to.vx * est, tz = to.z + to.vz * est;
  from.facing = Math.atan2(tz - from.z, tx - from.x);
  launch(s, from, tx, tz, 1.1, speed);
  s.ball.passTarget = toId; s.ball.shot = false; s.ball.shotTeam = null;
  from.anim = 'pass'; from.animTimer = 0.3;
  s.events.push('pass');
}

export function shoot(s, fromId, aimZ, charge) {
  const from = s.players[fromId];
  const gx = goalX(from.team) + (from.team === 0 ? 0.6 : -0.6); // aim slightly behind the line
  const tz = Math.max(-1, Math.min(1, aimZ)) * C.GOAL_HALF_W * 0.9;
  const tired = 0.85 + 0.15 * (from.stamina ?? 1);
  const speed = (C.SHOT_MIN + (C.SHOT_MAX - C.SHOT_MIN) * Math.max(0, Math.min(1, charge))) * tired;
  from.facing = Math.atan2(tz - from.z, gx - from.x);
  launch(s, from, gx, tz, 0.9 + 0.6 * Math.abs(aimZ), speed);
  const b = s.ball;
  b.passTarget = null; b.shot = true; b.shotTeam = from.team; b.shotAge = 0; b.blockChecked = [];
  // a keeper already leaning the wrong way stays committed for this shot
  const gk = s.players[from.team === 0 ? 7 : 0];
  b.gkLean = gk.offBalance > 0 ? Math.sign(gk.lean) : 0;
  from.anim = 'shoot'; from.animTimer = 0.4;
  s.events.push('shot');
}

export function tryCatch(s) {
  const b = s.ball;
  if (b.holder !== null || b.y > 2.1) return;
  let best = null, bestD = Infinity;
  for (const p of s.players) {
    if (p.id === b.thrower && b.throwTimer > 0) continue;
    if (p.role === 'gk') continue; // keepers catch via save logic / area pickup
    if (p.stun > 0) continue;       // wrong-footed players can't react to the ball
    if (b.shot) continue; // a shot can't be caught cleanly: defenders block it (tryBlock), keepers save it
    const d = Math.hypot(p.x - b.x, p.z - b.z);
    const r = p.id === b.passTarget ? C.CATCH_R * 1.4 : C.CATCH_R;
    if (d < r && d < bestD) { bestD = d; best = p.id; }
  }
  if (best !== null) {
    const intercepted = s.players[best].team !== b.lastTeam;
    giveBall(s, best);
    if (intercepted) s.events.push('intercept');
  }
}

/** Deterministic pseudo-random number in [0,1) from the match clock and a salt. */
export function roll(s, salt) {
  return Math.abs(Math.sin(s.time * 12.9898 + salt * 78.233) * 43758.5453) % 1;
}

/** Chance that a cut attempt by `st` on holder `h` wins the ball (0 if out of reach). */
export function stealChance(s, st, h, bonus = 0) {
  const b = s.ball;
  const dx = h.x - st.x, dz = h.z - st.z;
  const dribbling = b.holdTime > C.HOLD_LIMIT;
  const range = (dribbling ? C.STEAL_RANGE_DRIBBLE : C.STEAL_RANGE) + bonus;
  if (Math.hypot(dx, dz) > range) return 0;
  if (angleBetween(Math.cos(st.facing), Math.sin(st.facing), dx, dz) > (70 * Math.PI) / 180) return 0;
  if (dribbling) return C.STEAL_CHANCE_DRIBBLE;
  // where is the defender relative to where the holder faces?
  const behind = angleBetween(Math.cos(h.facing), Math.sin(h.facing), -dx, -dz) > (120 * Math.PI) / 180;
  return behind ? C.STEAL_CHANCE_BEHIND : C.STEAL_CHANCE;
}

/** A cut attempt. A miss costs a cooldown and leaves the defender briefly wrong-footed. */
export function trySteal(s, stealerId, bonus = 0, r = roll(s, stealerId + 31)) {
  const b = s.ball, st = s.players[stealerId];
  if (b.holder === null || st.stealCd > 0 || st.stun > 0) return false;
  const h = s.players[b.holder];
  if (h.team === st.team || h.role !== 'field') return false;
  const chance = stealChance(s, st, h, bonus);
  st.stealCd = C.STEAL_COOLDOWN;
  if (chance > 0 && r < chance) { giveBall(s, stealerId); s.events.push('steal'); return true; }
  if (chance > 0) { st.stun = C.STEAL_MISS_STUN; st.vx *= 0.3; st.vz *= 0.3; }
  return false;
}

/** A shot in its early flight can be blocked by a defender standing in its path. */
export function tryBlock(s) {
  const b = s.ball;
  if (!b.shot || b.shotAge > C.BLOCK_WINDOW || b.y > C.BLOCK_H || !b.blockChecked) return false;
  for (const q of s.players) {
    if (q.team === b.shotTeam || q.role !== 'field' || q.stun > 0 || b.blockChecked.includes(q.id)) continue;
    if (Math.hypot(q.x - b.x, q.z - b.z) > C.BLOCK_R) continue;
    b.blockChecked.push(q.id); // one chance per defender per shot
    if (roll(s, q.id + 57) >= C.BLOCK_CHANCE) continue;
    const sp = Math.hypot(b.vx, b.vz);
    b.vx = -b.vx * 0.12; b.vz = (roll(s, q.id + 91) < 0.5 ? -1 : 1) * (0.2 + 0.2 * roll(s, q.id + 13)) * sp; b.vy = 1.5;
    b.shot = false; b.shotTeam = null; b.passTarget = null; b.lastTeam = q.team; b.thrower = q.id; b.throwTimer = 0.2;
    q.anim = 'shoot'; q.animTimer = 0.3;
    s.events.push('block');
    return true;
  }
  return false;
}

export function nearestToBall(s, team) {
  let best = null, bestD = Infinity;
  for (const id of teamIds(team)) {
    const p = s.players[id];
    if (p.role === 'gk') continue;
    const d = Math.hypot(p.x - s.ball.x, p.z - s.ball.z);
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}

/** Opponent field players that bite on a feint by `p`: close, not just fooled. */
function fool(s, p) {
  let n = 0;
  for (const q of s.players) {
    if (q.team === p.team || q.role !== 'field' || q.fooledCd > 0) continue;
    if (Math.hypot(q.x - p.x, q.z - p.z) > C.FEINT_RANGE) continue;
    q.stun = C.FEINT_STUN; q.fooledCd = C.FEINT_IMMUNE; q.vx *= 0.3; q.vz *= 0.3;
    n++;
  }
  return n;
}

/** Shot feint: cancel a wind-up. Fools defenders/keeper only if the wind-up was believable. */
export function shotFeint(s, id, aimZ, charge) {
  const p = s.players[id];
  s.events.push('feint');
  p.anim = 'shoot'; p.animTimer = 0.2;
  if (charge < C.FEINT_MIN_CHARGE) return;
  fool(s, p);
  const gk = s.players[p.team === 0 ? 7 : 0];
  if (Math.hypot(goalX(p.team) - p.x, p.z) <= C.GK_FEINT_RANGE) {
    gk.offBalance = C.GK_OFF_BALANCE;
    gk.lean = (aimZ >= 0 ? 1 : -1) * 0.9;
  }
}

/** Step feint: sharp change of direction with a burst; wrong-foots a close marker. */
export function stepFeint(s, id, dx, dz) {
  const p = s.players[id];
  const l = Math.hypot(dx, dz) || 1;
  const v = C.DASH * C.STEP_BOOST;
  p.vx = (dx / l) * v; p.vz = (dz / l) * v;
  p.facing = Math.atan2(dz, dx);
  fool(s, p);
  s.events.push('feint');
}


/**
 * Flying substitution: the most tired on-court field player (never the ball holder)
 * swaps with the freshest bench player. Returns true if a swap happened.
 */
export function substitute(s, team, minGain = 0.05) {
  const bench = s.bench[team];
  let out = null;
  for (const p of s.players) {
    if (p.team !== team || p.role !== 'field' || p.id === s.ball.holder) continue;
    if (!out || p.stamina < out.stamina) out = p;
  }
  let inn = null;
  for (const b of bench) if (!inn || b.stamina > inn.stamina) inn = b;
  if (!out || !inn || inn.stamina < out.stamina + minGain) return false;
  const outNum = out.num, outSt = out.stamina;
  out.num = inn.num; out.stamina = inn.stamina;
  inn.num = outNum; inn.stamina = outSt;
  out.stun = 0;
  s.events.push('sub:' + team + ':' + outNum + ':' + out.num);
  return true;
}
