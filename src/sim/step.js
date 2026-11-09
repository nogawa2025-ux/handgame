import { C } from './constants.js';
import { checkGoal, checkOut, inGoalArea, clampOutOfGoalArea } from './geometry.js';
import { resetForThrowOff, giveBall, gkId, attackDir } from './state.js';
import { movePlayer, pickPassTarget, pickLongTarget, throwBall, shoot, tryCatch, trySteal, nearestToBall, shotFeint, stepFeint, substitute, tryBlock, bestPassTarget, stealChance } from './actions.js';
import { aiTick } from './ai.js';

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
    for (const p of s.players) { p.vx *= 0.9; p.vz *= 0.9; animate(p, dt); }
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
  for (const t of [0, 1]) humanTick(s, t, inputs[t], dt);
  for (const t of [0, 1]) aiTick(s, t, dt, inputs[t] == null);
  for (const p of s.players) {
    p.stealCd = Math.max(0, p.stealCd - dt);
    p.stun = Math.max(0, (p.stun ?? 0) - dt);
    p.fooledCd = Math.max(0, (p.fooledCd ?? 0) - dt);
    p.offBalance = Math.max(0, (p.offBalance ?? 0) - dt);
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
  if (team !== a.team || s.events.includes('shot')) { a.team = team; a.time = 0; a.warned = false; return false; }
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
    if (holding && me.role === 'field' && !inp.shootHeld && prev && prev.age < C.STEP_WINDOW && nx * prev.x + nz * prev.z < -0.5) {
      stepFeint(s, me.id, nx, nz);
    }
    s.lastStick[t] = { x: nx, z: nz, age: 0 };
  }
  if (me.stun > 0) movePlayer(me, 0, 0, false, false, dt);
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
      shotFeint(s, me.id, inp.mz, s.shootCharge[t]);
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
      if (inp.easy) {
        // easy: a tap is already a decent shot, aimed at the corner away from the keeper
        const gk = s.players[gkId(1 - t)];
        const aim = Math.abs(gk.z - me.z * 0.1) < 0.05 ? (me.z >= 0 ? -1 : 1) : gk.z > me.z * 0.1 ? -1 : 1;
        shoot(s, me.id, aim * 0.95, Math.max(C.EASY_MIN_CHARGE, s.shootCharge[t]));
      } else shoot(s, me.id, inp.mz, s.shootCharge[t]);
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

function animate(p, dt) {
  if (p.animTimer > 0) { p.animTimer -= dt; return; }
  p.anim = Math.hypot(p.vx, p.vz) > 0.6 ? 'run' : 'idle';
}
