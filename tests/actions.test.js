import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatchState, giveBall } from '../src/sim/state.js';
import { movePlayer, pickPassTarget, trySteal, nearestToBall } from '../src/sim/actions.js';
import { C } from '../src/sim/constants.js';
import { scatter, DT } from './helpers.js';

const fresh = () => ({ id: 1, team: 0, role: 'field', x: 0, z: 0, vx: 0, vz: 0, facing: 0, stamina: 1, anim: 'idle', animTimer: 0, stealCd: 0 });

test('dash is faster than run and drains stamina', () => {
  const a = fresh(), b = fresh();
  for (let i = 0; i < 60; i++) { movePlayer(a, 1, 0, false, false, DT); movePlayer(b, 1, 0, true, false, DT); }
  assert.ok(b.x > a.x + 1);
  assert.ok(b.stamina < 1);
  assert.ok(a.stamina > b.stamina);
});

test('dribbling after HOLD_LIMIT slows by 0.85', () => {
  const a = fresh(), b = fresh();
  for (let i = 0; i < 60; i++) { movePlayer(a, 1, 0, false, false, DT); movePlayer(b, 1, 0, false, true, DT); }
  assert.ok(Math.abs(b.vx / a.vx - C.DRIBBLE_MULT) < 0.01);
});

test('field player cannot enter goal area', () => {
  const p = fresh(); p.x = 10;
  for (let i = 0; i < 300; i++) movePlayer(p, 1, 0, false, false, DT);
  assert.ok(Math.hypot(p.x - 20, p.z) >= 6 - 0.01);
});

test('pickPassTarget prefers teammate in stick direction', () => {
  const s = createMatchState(); scatter(s);
  Object.assign(s.players[1], { x: 0, z: 0 });
  Object.assign(s.players[2], { x: 5, z: 0 });   // straight ahead
  Object.assign(s.players[3], { x: 0, z: 5 });   // to the side
  Object.assign(s.players[4], { x: 10, z: 1 });  // ahead but further
  assert.equal(pickPassTarget(s, 1, 1, 0), 2);
  assert.equal(pickPassTarget(s, 1, 0, 1), 3);
});

test('pickPassTarget returns null when nobody within 60°', () => {
  const s = createMatchState();
  s.players.forEach(p => { if (p.team === 0) { p.x = -5; p.z = 0; } });
  Object.assign(s.players[1], { x: 0, z: 0 });
  assert.equal(pickPassTarget(s, 1, 1, 0), null);
});

function stealSetup(dist, facing) {
  const s = createMatchState(); scatter(s);
  Object.assign(s.players[1], { x: 0, z: 0 });
  giveBall(s, 1);
  Object.assign(s.players[8], { x: dist, z: 0, facing, stealCd: 0 });
  return s;
}
test('trySteal fails beyond STEAL_RANGE, succeeds within when facing, fails when facing away', () => {
  let s = stealSetup(C.STEAL_RANGE + 0.3, Math.PI);
  assert.equal(trySteal(s, 8), false);
  s = stealSetup(C.STEAL_RANGE - 0.2, Math.PI);
  assert.equal(trySteal(s, 8), true);
  assert.equal(s.ball.holder, 8);
  s = stealSetup(C.STEAL_RANGE - 0.2, 0);
  assert.equal(trySteal(s, 8), false);
});

test('trySteal range grows when holder is dribbling', () => {
  const s = stealSetup(C.STEAL_RANGE + 0.2, Math.PI);
  s.ball.holdTime = C.HOLD_LIMIT + 0.1;
  assert.equal(trySteal(s, 8), true);
});

test('nearestToBall ignores goalkeepers', () => {
  const s = createMatchState(); scatter(s);
  s.ball.holder = null; s.ball.x = -19; s.ball.z = 0;
  assert.notEqual(nearestToBall(s, 0), 0);
});
