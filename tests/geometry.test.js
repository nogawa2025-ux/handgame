import test from 'node:test';
import assert from 'node:assert/strict';
import { goalX, inGoalArea, clampOutOfGoalArea, checkGoal, checkOut } from '../src/sim/geometry.js';

test('goalX: team 0 attacks +20', () => {
  assert.equal(goalX(0), 20);
  assert.equal(goalX(1), -20);
});
test('inGoalArea', () => {
  assert.equal(inGoalArea(17, 0, 1), true);
  assert.equal(inGoalArea(13, 0, 1), false);
  assert.equal(inGoalArea(-17, 2, -1), true);
});
test('clampOutOfGoalArea pushes to the 6m line', () => {
  const p = { x: 18, z: 0 };
  clampOutOfGoalArea(p);
  assert.ok(Math.abs(p.x - 14) < 0.01);
  const q = { x: 5, z: 3 };
  clampOutOfGoalArea(q);
  assert.deepEqual(q, { x: 5, z: 3 });
});
test('checkGoal', () => {
  assert.equal(checkGoal({ x: 20.1, z: 0.5, y: 1 }), 0);
  assert.equal(checkGoal({ x: -20.1, z: 0, y: 1 }), 1);
  assert.equal(checkGoal({ x: 20.1, z: 2, y: 1 }), null);
  assert.equal(checkGoal({ x: 20.1, z: 0, y: 2.5 }), null);
});
test('checkOut', () => {
  assert.equal(checkOut({ x: 0, z: 10.2, y: 0 }).type, 'side');
  assert.equal(checkOut({ x: 20.2, z: 5, y: 0 }).type, 'goalline');
  assert.equal(checkOut({ x: 0, z: 0, y: 0 }), null);
});
