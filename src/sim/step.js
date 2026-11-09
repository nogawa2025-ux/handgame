import { C } from './constants.js';
import { checkGoal, checkOut, inGoalArea, clampOutOfGoalArea, goalX } from './geometry.js';
import { resetForThrowOff, giveBall, gkId, attackDir } from './state.js';
import { movePlayer, pickPassTarget, pickLongTarget, throwBall, shoot, tryCatch, trySteal, nearestToBall, shotFeint, stepFeint, substitute, tryBlock, bestPassTarget, stealChance, fromBehind, roll } from './actions.js';
import { aiTick } from './ai.js';
import { duelTick, stickAim } from './duel.js';

/** Team currently "in possession" (holder's team, or last touch while loose). */
export const possessionTeam = (s) => (s.ball.holder !== null ? s.players[s.ball.holder].team : s.ball.lastTeam);

/**
 * Advance the match by dt. inputs[t] == null → team t is CPU-controlled.
 */
export function step(s, inputs, dt) {
  s.events = [];
  s.prevShootHeld ??= [false, false];
  s.stealBonus ??= [0, 0];
  s.feintHold ??= [false, false];
  s.lastStick ??= [null, null];
  s.subCd ??= [0, 0];
  s.attack ??= { team: null, time: 0, warned: false };
  if (s.phase === 'ended') return;
  for (const bench of s.bench ?? []) for (const b of bench) b.stamina = Math.min(1, b.stamina + C.STAMINA_BENCH * dt);

  if (s.phase === 'countdown' || s.phase === 'restart' || s.phase === 'goal') {
    s.phaseTimer -= dt;
    if (s.phase === 'goal') ballPhysics(s, dt, false);
    for (const p of s.players) { p.vx *= 0.9; p.vz *= 0.9; land(p, dt); animate(p, dt); }
    if (s.phaseTimer <= 0) {
      if (s.phase === 'goal') {
        resetForThrowOff(s, s.concede);
        s.phase = 'restart'; s.phaseTimer = C.RESTART_PAUSE;
      } else {
        s.phase = 'play';
        s.events.push('whistle');
      }
    }
    return;
  }

  // ---- play ----
  for (const t of [0, 1]) {
    s.subCd[t] = Math.max(0, s.subCd[t] - dt);
    if (inputs[t] != null) { if (inputs[t].sub) substitute(s, t); }
    else if (s.subCd[t] <= 0 && s.players.some((p) => p.team === t && p.role === 'field' && p.id !== s.ball.holder && p.stamina < C.CPU_SUB_BELOW)) {
      if (substitute(s, t, 0.35)) s.subCd[t] = C.CPU_SUB_COOLDOWN;
    }
  }
  const prevTeam = possessionTeam(s);
  sevenMeterTick(s, inputs, dt);
  for (const t of [0, 1]) humanTick(s, t, inputs[t], dt);
  for (const t of [0, 1]) aiTick(s, t, dt, inputs[t] == null);
  duelTick(s, inputs, dt);
  if (bodyContact(s, dt)) return;
  for (const p of s.players) {
    p.stealCd = Math.max(0, p.stealCd - dt);
    p.stun = Math.max(0, (p.stun ?? 0) - dt);
    p.fooledCd = Math.max(0, (p.fooledCd ?? 0) - dt);
    p.offBalance = Math.max(0, (p.offBalance ?? 0) - dt);
    land(p, dt);
    animate(p, dt);
  }

  const b = s.ball;
  if (b.holder !== null) {
    const h = s.players[b.holder];
    b.holdTime += dt;
    b.x = h.x + Math.cos(h.facing) * 0.35;
    b.z = h.z + Math.sin(h.facing) * 0.35;
    b.y = b.holdTime > C.HOLD_LIMIT && h.role === 'field' ? 0.3 + Math.abs(Math.sin(b.holdTime * 9)) * 0.7 : 1;
    b.vx = h.vx; b.vz = h.vz; b.vy = 0;
  } else {
    if (ballPhysics(s, dt, true)) return;
    expirePass(b, dt);
    tryCatch(s);
    keeperPickup(s, dt);
  }

  // auto-switch the human defender when possession changes
  const nowTeam = possessionTeam(s);
  if (nowTeam !== prevTeam) {
    const def = 1 - nowTeam;
    if (inputs[def] != null) s.controlled[def] = nearestToBall(s, def);
  }
  syncControlled(s, inputs);
  if (passivePlay(s, dt)) return;

  s.time -= dt;
  if (s.time <= 0) endOfTime(s);
}

/**
 * Passive play: an attack that goes on too long without a shot gets a warning,
 * then the ball goes to the other side. Returns true if play was stopped.
 */
export function passivePlay(s, dt) {
  const a = s.attack;
  const team = possessionTeam(s);
  if (team !== a.team || s.events.includes('shot')) {
    if (team !== a.team) a.build = C.BUILD_UP_MIN + C.BUILD_UP_RAND * roll(s, 3);
    a.team = team; a.time = 0; a.warned = false; return false;
  }
  a.time += dt;
  if (!a.warned && a.time >= C.PASSIVE_WARN) { a.warned = true; s.events.push('passive-warn:' + team); }
  if (a.time < C.PASSIVE_LIMIT) return false;
  // free throw for the defenders where the ball is
  const b = s.ball;
  const other = 1 - team;
  s.events.push('passive:' + team);
  const id = nearestToBall(s, other);
  const p = s.players[id];
  p.x = Math.max(-19.5, Math.min(19.5, b.x)); p.z = Math.max(-9.7, Math.min(9.7, b.z));
  clampOutOfGoalArea(p);
  p.vx = p.vz = 0;
  giveBall(s, id);
  a.team = other; a.time = 0; a.warned = false;
  setRestart(s);
  return true;
}

/** A pass that missed (too old or rolled to a crawl) becomes a plain loose ball. */
export function expirePass(b, dt) {
  if (b.holder !== null || b.passTarget === null) return;
  b.flightAge = (b.flightAge ?? 0) + dt;
  if (b.flightAge > 1.5 || Math.hypot(b.vx, b.vz) < 3) b.passTarget = null;
}

function humanTick(s, t, inp, dt) {
  if (inp == null) return;
  const b = s.ball;
  // facing a shot: the stick drives the keeper (duelTick), field players are left to the AI
  if (s.duel && s.duel.team !== t) { s.prevShootHeld[t] = !!inp.shootHeld; return; }
  const attacking = possessionTeam(s) === t;
  if (!attacking && inp.pass) s.controlled[t] = nearestToBall(s, t);
  if (inp.easy && !attacking) autoSwitch(s, t);
  const me = s.players[s.controlled[t]];
  const holding = b.holder === me.id;
  // a shot feint keeps the shoot button 'spent' until it is released
  if (s.feintHold[t]) {
    if (!inp.shootHeld || inp.shootRelease) s.feintHold[t] = false;
    inp = { ...inp, shootHeld: false, shootRelease: false };
  }
  // step feint: a quick reversal of a strong stick direction while holding the ball
  const mag = Math.hypot(inp.mx, inp.mz);
  const prev = s.lastStick[t];
  if (prev) prev.age += dt;
  if (mag > 0.6) {
    const nx = inp.mx / mag, nz = inp.mz / mag;
    if (holding && me.role === 'field' && !inp.shootHeld && !s.penalty && prev && prev.age < C.STEP_WINDOW && nx * prev.x + nz * prev.z < -0.5) {
      stepFeint(s, me.id, nx, nz);
    }
    s.lastStick[t] = { x: nx, z: nz, age: 0 };
  }
  const sevenThrower = s.penalty && holding;
  if (sevenThrower) inp = { ...inp, pass: false, long: false, dash: false };
  // winding up a shot in range: the stick aims at the goal instead of moving the player
  const aiming = holding && s.shootCharge[t] > 0 && s.duel?.shooter === me.id;
  if (me.stun > 0 || sevenThrower || aiming) movePlayer(me, 0, 0, false, false, dt);
  else movePlayer(me, inp.mx, inp.mz, inp.dash, holding && b.holdTime > C.HOLD_LIMIT, dt);

  if (b.holder !== null && b.holder === gkId(t)) {
    // own keeper holding the ball: pass buttons make the keeper throw
    if (inp.pass || inp.long) {
      const target = inp.long
        ? pickLongTarget(s, b.holder)
        : pickPassTarget(s, b.holder, inp.mx, inp.mz) ?? pickLongTarget(s, b.holder);
      if (target !== null) throwBall(s, b.holder, target, inp.long ? C.LONG_PASS_SPEED : C.PASS_SPEED);
    }
  } else if (holding) {
    if (inp.pass && inp.shootHeld && s.shootCharge[t] > 0) {
      shotFeint(s, me.id, stickAim(t, inp).z || 1, s.shootCharge[t]);
      s.shootCharge[t] = 0;
      s.feintHold[t] = true;
    } else if (inp.pass) {
      // easy: the stick picks the receiver only when pushed firmly; otherwise the best option
      const firm = Math.hypot(inp.mx, inp.mz) > 0.5;
      const target = inp.easy
        ? (firm ? pickPassTarget(s, me.id, inp.mx, inp.mz) : null) ?? bestPassTarget(s, me.id)
        : pickPassTarget(s, me.id, inp.mx, inp.mz);
      if (target !== null) throwBall(s, me.id, target, C.PASS_SPEED);
    } else if (inp.long) {
      const target = pickLongTarget(s, me.id);
      if (target !== null) throwBall(s, me.id, target, C.LONG_PASS_SPEED);
    } else if (inp.shootHeld) {
      s.shootCharge[t] = Math.min(1, s.shootCharge[t] + dt / C.SHOT_CHARGE_TIME);
    }
    if (inp.shootRelease && b.holder === me.id) {
      const aim = stickAim(t, inp);
      if (inp.easy && Math.hypot(inp.sx ?? 0, inp.sy ?? 0) < 0.2) {
        // easy, no aim given: go away from where the keeper leans (which may be a bluff)
        const gk = s.players[gkId(1 - t)];
        const side = -Math.sign((gk.leanZ ?? 0) || gk.z || (me.z >= 0 ? 1 : -1));
        shoot(s, me.id, side * 0.8, Math.max(C.EASY_MIN_CHARGE, s.shootCharge[t]), roll(s, me.id) < 0.5 ? -0.6 : 0.6);
      } else shoot(s, me.id, aim.z, inp.easy ? Math.max(C.EASY_MIN_CHARGE, s.shootCharge[t]) : s.shootCharge[t], aim.h);
      s.shootCharge[t] = 0;
    }
  } else {
    s.shootCharge[t] = 0;
    const pressed = (inp.shootHeld || inp.shootRelease) && !s.prevShootHeld[t];
    if (!attacking && pressed) trySteal(s, me.id, s.stealBonus[t]);
    else if (!attacking && inp.easy) autoCut(s, t, me, inp);
  }
  s.prevShootHeld[t] = !!inp.shootHeld;
}

/**
 * 7m throw in progress: the thrower stays put and may only shoot; everyone else
 * waits behind the 9m line until the ball is thrown (or the time limit forces the shot).
 */
function sevenMeterTick(s, inputs, dt) {
  const pen = s.penalty;
  if (!pen) return;
  const b = s.ball;
  if (b.holder === null || s.players[b.holder].team !== pen.team) { s.penalty = null; return; }
  pen.time += dt;
  for (const p of s.players) if (p.id !== b.holder && p.role === 'field') { p.stun = Math.max(p.stun, dt * 2); p.vx = p.vz = 0; }
  const sh = s.players[b.holder];
  sh.vx = sh.vz = 0;
  if (pen.time > C.SEVEN_LIMIT) {
    const inp = inputs[pen.team];
    const aim = stickAim(pen.team, inp);
    shoot(s, sh.id, aim.z, Math.max(0.6, s.shootCharge[pen.team]), aim.h);
    s.shootCharge[pen.team] = 0;
  }
}

/**
 * 1-on-1 contact: a defender squarely in front of the carrier stops them (you can't
 * run through a set defender). Held up for too long → whistle, free throw.
 * Returns true if play was stopped.
 */
function bodyContact(s, dt) {
  const b = s.ball;
  if (b.holder === null || s.penalty) return false;
  const h = s.players[b.holder];
  if (h.role !== 'field' || h.jump > 0) { h.contact = 0; return false; }
  const ax = goalX(h.team) - h.x, az = -h.z, al = Math.hypot(ax, az) || 1;
  let blocked = false;
  for (const q of s.players) {
    if (q.team === h.team || q.role !== 'field' || q.stun > 0) continue;
    const dx = q.x - h.x, dz = q.z - h.z, d = Math.hypot(dx, dz);
    if (d >= C.CONTACT_R || d < 1e-6) continue;
    if ((dx * ax + dz * az) / (d * al) < 0.3) continue; // not between the carrier and the goal
    blocked = true;
    const nx = dx / d, nz = dz / d;
    h.x = q.x - nx * C.CONTACT_R; h.z = q.z - nz * C.CONTACT_R;
    const into = h.vx * nx + h.vz * nz;
    if (into > 0) { h.vx -= into * nx; h.vz -= into * nz; }
    h.vx *= 0.6; h.vz *= 0.6;
  }
  h.contact = blocked ? (h.contact ?? 0) + dt : Math.max(0, (h.contact ?? 0) - dt * 2);
  if (h.contact >= C.FREE_THROW_AFTER && !(s.shootCharge[h.team] > 0)) { freeThrow(s, h); return true; }
  return false;
}

/** Free throw for the stopped attacker: from outside the 9m line, defenders 3m away. */
function freeThrow(s, h) {
  h.contact = 0;
  const gx = goalX(h.team), R = C.FREE_THROW_R + 0.3;
  if (Math.hypot(gx - h.x, h.z) < R) {
    const a = Math.atan2(h.z, h.x - gx);
    h.x = gx + Math.cos(a) * R; h.z = Math.max(-9.7, Math.min(9.7, Math.sin(a) * R));
  }
  h.vx = h.vz = 0;
  for (const q of s.players) {
    if (q.team === h.team || q.role !== 'field') continue;
    const dx = q.x - h.x, dz = q.z - h.z, d = Math.hypot(dx, dz) || 1;
    if (d < 3) { q.x = h.x + (dx / d) * 3; q.z = Math.max(-9.7, Math.min(9.7, h.z + (dz / d) * 3)); clampOutOfGoalArea(q); }
    q.vx = q.vz = 0;
  }
  giveBall(s, h.id);
  s.events.push('freethrow:' + h.team);
  setRestart(s);
}

/** Easy defence: keep control on the defender nearest the ball (with a little hysteresis). */
function autoSwitch(s, t) {
  const cur = s.players[s.controlled[t]];
  const id = nearestToBall(s, t);
  if (id === cur.id) return;
  const n = s.players[id], b = s.ball;
  if (Math.hypot(cur.x - b.x, cur.z - b.z) - Math.hypot(n.x - b.x, n.z - b.z) > C.EASY_SWITCH_MARGIN) s.controlled[t] = id;
}

/** Easy defence: running at the ball carrier from the front makes a cut attempt by itself. */
function autoCut(s, t, me, inp) {
  const b = s.ball;
  if (b.holder === null || me.stealCd > 0 || me.stun > 0) return;
  const h = s.players[b.holder];
  if (h.team === t) return;
  const dx = h.x - me.x, dz = h.z - me.z, l = Math.hypot(dx, dz), m = Math.hypot(inp.mx, inp.mz);
  if (m < 0.3 || (inp.mx * dx + inp.mz * dz) / (m * l || 1) < 0.5) return;
  if (fromBehind(me, h)) return; // never hack from behind (that would give away a 7m throw)
  if (stealChance(s, me, h, s.stealBonus[t]) > 0) trySteal(s, me.id, s.stealBonus[t]);
}

/** Keep each controlled player sensible: ball holder on attack, receiver of a pass. */
function syncControlled(s, inputs) {
  const b = s.ball;
  for (const t of [0, 1]) {
    const h = b.holder !== null ? s.players[b.holder] : null;
    if (inputs[t] == null) {
      s.controlled[t] = h && h.team === t && h.role === 'field' ? h.id : nearestToBall(s, t);
      continue;
    }
    if (h) {
      if (h.team === t && h.role === 'field') s.controlled[t] = h.id;
    } else if (b.passTarget !== null) {
      const r = s.players[b.passTarget];
      if (r.team === t && r.role === 'field') s.controlled[t] = r.id;
    }
    if (s.players[s.controlled[t]].role === 'gk') s.controlled[t] = nearestToBall(s, t);
  }
}

/** Returns true if the tick ended in a goal/out restart. */
function ballPhysics(s, dt, rules) {
  const b = s.ball;
  if (b.holder !== null) return false;
  b.throwTimer = Math.max(0, (b.throwTimer ?? 0) - dt);
  if (b.shot) b.shotAge = (b.shotAge ?? 0) + dt;
  b.vy -= C.GRAVITY * dt;
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  if (rules) tryBlock(s);
  if (b.y < 0.11) {
    b.y = 0.11;
    b.vy = Math.abs(b.vy) > 1.5 ? -b.vy * 0.55 : 0;
    const f = Math.max(0, 1 - 1.2 * dt);
    b.vx *= f; b.vz *= f;
  }
  if (b.shot && Math.hypot(b.vx, b.vz) < 4) b.shot = false; // a shot stays a shot until it dies
  if (!rules) {
    // during the goal celebration keep the ball in the net
    if (Math.abs(b.x) > 21) { b.x = Math.sign(b.x) * 21; b.vx = 0; }
    return false;
  }
  const scorer = checkGoal(b);
  if (scorer !== null) {
    s.score[scorer]++;
    s.events.push('goal:' + scorer);
    if (s.overtime) { s.phase = 'ended'; s.winner = scorer; s.events.push('end'); return true; }
    s.phase = 'goal'; s.phaseTimer = C.GOAL_PAUSE; s.concede = 1 - scorer;
    return true;
  }
  const out = checkOut(b);
  if (out) { restartAfterOut(s, out); return true; }
  return false;
}

function restartAfterOut(s, out) {
  const b = s.ball;
  const team = 1 - b.lastTeam;
  s.events.push('whistle');
  let spot = out;
  if (out.type === 'goalline') {
    const side = Math.sign(out.x);
    const defending = side === 1 ? 1 : 0; // team that defends this end
    if (b.lastTeam !== defending) { giveBall(s, gkId(defending)); s.gkTimer[defending] = 0; setRestart(s); return; }
    spot = { x: side * 19, z: (Math.sign(out.z) || 1) * 9.5 };
  }
  const id = nearestToBall(s, team);
  const p = s.players[id];
  p.x = Math.max(-19.5, Math.min(19.5, spot.x));
  p.z = Math.max(-9.7, Math.min(9.7, spot.z));
  p.vx = p.vz = 0;
  p.facing = Math.atan2(-Math.sign(p.z), 0);
  giveBall(s, id);
  setRestart(s);
}

function setRestart(s) {
  s.phase = 'restart'; s.phaseTimer = C.RESTART_PAUSE; s.shootCharge = [0, 0];
}

function keeperPickup(s, dt) {
  const b = s.ball;
  if (b.holder !== null) return;
  const speed = Math.hypot(b.vx, b.vz);
  for (const t of [0, 1]) {
    const ownSide = -attackDir(t);
    if (!inGoalArea(b.x, b.z, ownSide) || b.y > 2 || speed > 4) continue;
    const gk = s.players[gkId(t)];
    const d = Math.hypot(gk.x - b.x, gk.z - b.z);
    if (d < 1.0) { giveBall(s, gk.id); s.gkTimer[t] = 0; return; }
    movePlayer(gk, (b.x - gk.x) / d, (b.z - gk.z) / d, false, false, dt, C.GK_SPEED);
  }
}

function endOfTime(s) {
  s.time = 0;
  if (!s.overtime && s.score[0] === s.score[1]) {
    s.overtime = true; s.time = C.OVERTIME;
    s.events.push('overtime');
    resetForThrowOff(s, 0);
    setRestart(s);
    return;
  }
  s.phase = 'ended';
  s.winner = s.score[0] > s.score[1] ? 0 : s.score[1] > s.score[0] ? 1 : 'draw';
  s.events.push('end');
}

/** Count down a jump; on landing, step back out of the goal area. */
function land(p, dt) {
  if (!(p.jump > 0)) return;
  p.jump = Math.max(0, p.jump - dt);
  if (p.jump === 0 && p.role === 'field') { clampOutOfGoalArea(p); p.vx *= 0.3; p.vz *= 0.3; }
}

function animate(p, dt) {
  if (p.animTimer > 0) { p.animTimer -= dt; return; }
  p.anim = Math.hypot(p.vx, p.vz) > 0.6 ? 'run' : 'idle';
}
