import test from 'node:test';
import assert from 'node:assert/strict';
import { C } from '../src/sim/constants.js';
import { createMatchState, giveBall } from '../src/sim/state.js';
import { step } from '../src/sim/step.js';
import { trySteal, stealChance, shoot } from '../src/sim/actions.js';
import { idle, DT, scatter } from './helpers.js';

function duel(dx, holderFacing) {
  const s = createMatchState(); scatter(s); s.phase = 'play';
  Object.assign(s.players[1], { x: 0, z: 0, facing: holderFacing });
  giveBall(s, 1);
  Object.assign(s.players[8], { x: dx, z: 0, facing: dx > 0 ? Math.PI : 0, stealCd: 0, stun: 0 });
  return s;
}

test('a cut is a chance, not a sure thing; dribbling and reaching from behind change it', () => {
  const front = duel(1.0, 0); // holder faces the defender
  assert.equal(stealChance(front, front.players[8], front.players[1]), C.STEAL_CHANCE);
  const back = duel(-1.0, 0); // defender behind the holder
  assert.equal(stealChance(back, back.players[8], back.players[1]), C.STEAL_CHANCE_BEHIND);
  front.ball.holdTime = C.HOLD_LIMIT + 0.1;
  assert.equal(stealChance(front, front.players[8], front.players[1]), C.STEAL_CHANCE_DRIBBLE);
  assert.ok(C.STEAL_CHANCE < 0.5 && C.STEAL_CHANCE_DRIBBLE > C.STEAL_CHANCE);
});

test('a missed cut leaves the defender off balance and on cooldown', () => {
  const s = duel(1.0, 0);
  assert.equal(trySteal(s, 8, 0, 0.99), false);
  assert.ok(s.players[8].stun > 0, 'stunned after a miss');
  assert.ok(s.players[8].stealCd > 0);
  assert.equal(s.ball.holder, 1);
});

test('a defender standing in the shot path can block it', () => {
  let blocked = 0;
  for (let k = 0; k < 20; k++) {
    const s = createMatchState(); scatter(s); s.phase = 'play';
    s.time = 200 + k * 0.37;
    Object.assign(s.players[1], { x: 10, z: 0, facing: 0 });
    giveBall(s, 1);
    Object.assign(s.players[8], { x: 11.3, z: 0.05, stun: 0 });
    shoot(s, 1, 1, 1);
    let hit = false;
    for (let i = 0; i < 20; i++) { step(s, [idle(), idle()], DT); hit ||= s.events.includes('block'); }
    if (hit) blocked++;
  }
  assert.ok(blocked >= 6 && blocked <= 18, `blocked ${blocked}/20`);
});

test('passive play: a warning, then the ball goes to the other team', () => {
  const s = createMatchState(); s.phase = 'play';
  const evs = [];
  for (let i = 0; i < (C.PASSIVE_LIMIT + 1) * 60; i++) {
    s.ball.holdTime = 0; // keep it a plain hold, no dribble steals
    step(s, [idle(), { ...idle() }], DT);
    evs.push(...s.events);
    if (s.events.some((e) => e.startsWith('passive:'))) break;
  }
  assert.ok(evs.includes('passive-warn:0'), 'warned');
  assert.ok(evs.includes('passive:0'), 'called');
  assert.equal(s.players[s.ball.holder].team, 1);
  assert.equal(s.phase, 'restart');
});

test('a shot resets the passive clock', () => {
  const s = createMatchState(); s.phase = 'play';
  for (let i = 0; i < 16 * 60; i++) { s.ball.holdTime = 0; step(s, [idle(), idle()], DT); }
  assert.ok(s.attack.warned);
  step(s, [{ ...idle(), shootRelease: true }, idle()], DT);
  assert.equal(s.attack.time, 0);
  assert.equal(s.attack.warned, false);
});

test('CPU substitutions are rationed', () => {
  const s = createMatchState(); s.phase = 'play';
  let subs = 0;
  for (let i = 0; i < 60 * 60; i++) {
    for (const p of s.players) if (p.role === 'field') p.stamina = Math.min(p.stamina, 0.2);
    step(s, [null, null], DT);
    subs += s.events.filter((e) => e.startsWith('sub:')).length;
    if (s.phase === 'ended') break;
  }
  assert.ok(subs <= 2 * Math.ceil(60 / C.CPU_SUB_COOLDOWN) + 2, `subs ${subs}`);
});

test('easy: a quick tap shoots hard at the corner away from the keeper', () => {
  const s = createMatchState(); scatter(s); s.phase = 'play';
  Object.assign(s.players[1], { x: 10, z: 0, facing: 0 }); giveBall(s, 1); s.controlled[0] = 1;
  s.players[7].z = 0.6; // keeper cheating to the +z side
  step(s, [{ ...idle(), easy: true, shootHeld: true }, idle()], DT);
  step(s, [{ ...idle(), easy: true, shootRelease: true }, idle()], DT);
  assert.ok(s.ball.shot);
  assert.ok(s.ball.vz < 0, 'aimed at the -z corner');
  assert.ok(Math.hypot(s.ball.vx, s.ball.vz) > C.SHOT_MIN + (C.SHOT_MAX - C.SHOT_MIN) * 0.6, 'hard shot');
});

test('easy: pass with the stick neutral still finds a teammate', () => {
  const s = createMatchState(); s.phase = 'play'; // throw-off: everyone behind the holder
  step(s, [{ ...idle(), pass: true }, idle()], DT);
  assert.notEqual(s.ball.holder, null, 'expert pass forward with nobody there does nothing');
  step(s, [{ ...idle(), easy: true, pass: true }, idle()], DT);
  assert.equal(s.ball.holder, null);
  assert.ok(s.ball.passTarget !== null && s.players[s.ball.passTarget].team === 0);
});

test('easy: defence switches to the nearest player and cuts when running at the carrier', () => {
  const s = createMatchState(); scatter(s); s.phase = 'play';
  Object.assign(s.players[8], { x: 0, z: 0, facing: Math.PI }); giveBall(s, 8);
  Object.assign(s.players[2], { x: -1.0, z: 0, facing: 0, stealCd: 0, stun: 0 });
  s.controlled[0] = 5; // far away
  let tries = 0;
  for (let i = 0; i < 3; i++) {
    step(s, [{ ...idle(), easy: true, mx: 1 }, null], DT);
    if (s.players[2].stealCd > 0) tries++;
  }
  assert.equal(s.controlled[0] === 2 || s.ball.holder === 2, true, 'switched to the nearest defender');
  assert.ok(tries > 0 || s.ball.holder === 2, 'a cut was attempted');
});

test('close-range shots are jump shots: the shooter takes off and may fly over the 6m line', () => {
  const s = createMatchState(); scatter(s); s.phase = 'play';
  Object.assign(s.players[1], { x: 13.5, z: 0, facing: 0, vx: 5, vz: 0 }); giveBall(s, 1); s.controlled[0] = 1;
  shoot(s, 1, 1, 1);
  assert.ok(s.players[1].jump > 0, 'airborne');
  assert.ok(s.ball.y > 1.5, 'released high');
  let maxX = 0;
  for (let i = 0; i < 40; i++) { step(s, [idle(), idle()], DT); maxX = Math.max(maxX, s.players[1].x); }
  assert.ok(maxX > 14, 'flew over the line');
  assert.equal(s.players[1].jump, 0, 'landed');
  assert.ok(Math.hypot(20 - s.players[1].x, s.players[1].z) >= C.GOAL_AREA_R - 1e-6, 'left the goal area after landing');
});

test('a cut from behind on a shooter inside 9m gives a 7m throw', () => {
  const s = createMatchState(); scatter(s); s.phase = 'play';
  Object.assign(s.players[1], { x: 12.5, z: 0, facing: 0 }); giveBall(s, 1);
  Object.assign(s.players[8], { x: 11.6, z: 0, facing: 0, stealCd: 0, stun: 0 }); // behind the shooter
  assert.equal(trySteal(s, 8, 0, 0), false);
  assert.ok(s.events.includes('seven:0'));
  assert.equal(s.ball.holder, 1);
  assert.equal(s.players[1].x, 13);
  for (const p of s.players) if (p.role === 'field' && p.id !== 1) assert.ok(Math.hypot(20 - p.x, p.z) >= 9.7, `#${p.id} behind 9m`);
});

test('7m throw: the thrower cannot walk in and must shoot within the limit', () => {
  const s = createMatchState(); scatter(s); s.phase = 'play';
  Object.assign(s.players[1], { x: 12.5, z: 0, facing: 0 }); giveBall(s, 1); s.controlled[0] = 1;
  Object.assign(s.players[8], { x: 11.6, z: 0, facing: 0, stealCd: 0, stun: 0 });
  trySteal(s, 8, 0, 0);
  let shot = false;
  for (let i = 0; i < 60 * (C.SEVEN_LIMIT + 3) && !shot; i++) {
    step(s, [{ ...idle(), mx: 1 }, idle()], DT);
    shot = s.events.includes('shot');
    if (!shot && s.phase === 'play') assert.ok(Math.abs(s.players[1].x - 13) < 0.01, 'thrower stays on the 7m line');
  }
  assert.ok(shot, 'forced shot');
  assert.equal(s.penalty, null);
});

test('CPU builds up: several passes before the first shot when the defence is set', () => {
  let passes = 0, n = 0;
  for (const t0 of [300, 299.3, 298.6]) {
    const s = createMatchState(); s.time = t0;
    let p = 0;
    for (let i = 0; i < 60 * 60 && s.phase !== 'ended'; i++) {
      step(s, [null, null], DT);
      if (s.events.includes('pass')) p++;
      if (s.events.includes('shot')) { passes += p; n++; p = 0; }
      if (s.events.some((e) => e === 'steal' || e === 'intercept' || e.startsWith('goal'))) p = 0;
    }
  }
  assert.ok(passes / n >= 3, `passes before a shot ${passes / n}`);
});

test('easy defence never cuts from behind (no free 7m throws)', () => {
  const s = createMatchState(); scatter(s); s.phase = 'play';
  Object.assign(s.players[8], { x: -12.5, z: 0, facing: Math.PI }); giveBall(s, 8);
  Object.assign(s.players[2], { x: -11.6, z: 0, facing: Math.PI, stealCd: 0, stun: 0 });
  s.controlled[0] = 2;
  for (let i = 0; i < 5; i++) step(s, [{ ...idle(), easy: true, mx: -1 }, null], DT);
  assert.ok(!s.events.includes('seven:1') && s.penalty == null);
});
