import test from 'node:test';
import assert from 'node:assert/strict';
import { C } from '../src/sim/constants.js';
import { createMatchState, giveBall } from '../src/sim/state.js';
import { step } from '../src/sim/step.js';
import { idle, DT, scatter } from './helpers.js';

/** Our #1 on the ball at x=11 facing goal (+x); their #8 2.2m in front. */
function setup() {
  const s = createMatchState(); scatter(s); s.phase = 'play';
  Object.assign(s.players[1], { x: 11, z: 0, facing: 0 }); giveBall(s, 1); s.controlled[0] = 1;
  Object.assign(s.players[8], { x: 13.2, z: 0, facing: Math.PI, stun: 0, fooledCd: 0 });
  return s;
}
const run = (s, n, inp0, inp1 = null) => { const ev = []; for (let i = 0; i < n; i++) { step(s, [typeof inp0 === 'function' ? inp0(i) : inp0, inp1], DT); ev.push(...s.events); } return ev; };

test('face-off starts when a defender squares up in front, and ends when he is gone', () => {
  const s = setup();
  run(s, 1, idle());
  assert.deepEqual(s.face && [s.face.team, s.face.att, s.face.def], [0, 1, 8]);
  Object.assign(s.players[8], { x: 0, z: 9 });
  run(s, 1, idle());
  assert.equal(s.face, null);
});

test('no face-off far from goal or without a human involved', () => {
  const s = setup();
  Object.assign(s.players[1], { x: 2 }); Object.assign(s.players[8], { x: 4.2 });
  run(s, 1, idle());
  assert.equal(s.face, null, 'too far from goal');
  const c = setup();
  step(c, [null, null], DT);
  assert.equal(c.face, null, 'CPU vs CPU');
});

test('holding the stick to one side breaks that way; a mirroring defender reads it', () => {
  const s = setup();
  run(s, 1, idle());
  // the defender is already moving to the break side (+z)
  const ev = run(s, 20, (i) => ({ ...idle(), mz: 1 }), { ...idle(), mx: 0, mz: 0 });
  assert.ok(ev.includes('feint'), 'a break happened');
  const r = setup(); run(r, 1, idle());
  r.players[8].vz = 3; // mirroring: moving with the attacker
  const ev2 = [];
  for (let i = 0; i < 20; i++) { r.players[8].vz = 3; r.players[8].vx = 0; step(r, [{ ...idle(), mz: 1 }, { ...idle() }], DT); ev2.push(...r.events); }
  assert.ok(ev2.includes('read'), 'read: ' + ev2.join(','));
});

test('a quick flick one way then the other is a feint: the defender who followed is beaten', () => {
  const s = setup(); run(s, 1, idle());
  const ev = [];
  for (let i = 0; i < 24; i++) {
    const mz = i < 6 ? -1 : 1; // one side for 0.1s, then the other
    if (i < 6) { s.players[8].vz = -3; s.players[8].vx = 0; } // defender bites on the first move
    step(s, [{ ...idle(), mz }, { ...idle() }], DT); ev.push(...s.events);
  }
  assert.equal(ev.filter((e) => e === 'feint').length, 1, 'exactly one move: ' + ev.join(','));
  assert.ok(ev.includes('beat'), 'beat: ' + ev.join(','));
});

test('a human defender in a face-off is put on the attacker', () => {
  const s = setup();
  s.controlled[1] = 10;
  step(s, [null, { ...idle() }], DT);
  assert.equal(s.controlled[1], 8, 'control goes to the marker');
});

test('wing shot: a dive into the goal area, released closer to goal', () => {
  const s = createMatchState(); scatter(s); s.phase = 'play';
  const p = s.players[1];
  Object.assign(p, { x: 15.5, z: 7, facing: 0, vx: 2, vz: -1 }); giveBall(s, 1); s.controlled[0] = 1;
  s.shootCharge[0] = 0.6;
  step(s, [{ ...idle(), shootHeld: false, shootRelease: true }, null], DT);
  assert.ok(s.events.includes('dive'), 'dive event: ' + s.events.join(','));
  assert.ok(p.dive && p.jump > C.JUMP_TIME, 'longer flight');
  const b = s.ball;
  assert.ok(Math.hypot(20 - b.x, b.z) < Math.hypot(20 - 15.5, 7) - 0.8, 'released further in');
  for (let i = 0; i < 90; i++) step(s, [idle(), null], DT);
  assert.ok(Math.hypot(20 - p.x, p.z) >= C.GOAL_AREA_R - 1e-6, 'back out of the area after landing');
});

test('a central shot is a normal jump shot, not a dive', () => {
  const s = createMatchState(); scatter(s); s.phase = 'play';
  Object.assign(s.players[1], { x: 10, z: 1, facing: 0 }); giveBall(s, 1); s.controlled[0] = 1;
  s.shootCharge[0] = 0.6;
  step(s, [{ ...idle(), shootRelease: true }, null], DT);
  assert.ok(s.events.includes('shot') && !s.events.includes('dive'));
});
