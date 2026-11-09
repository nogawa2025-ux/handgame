import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatchState, resetForThrowOff } from '../src/sim/state.js';

test('createMatchState has 14 players, ids 0..13, GKs are 0 and 7', () => {
  const s = createMatchState();
  assert.equal(s.players.length, 14);
  s.players.forEach((p, i) => assert.equal(p.id, i));
  assert.equal(s.players[0].role, 'gk');
  assert.equal(s.players[7].role, 'gk');
  assert.equal(s.players.filter(p => p.role === 'gk').length, 2);
});

test('team 0 holds the ball at start and time is 300', () => {
  const s = createMatchState();
  const h = s.players[s.ball.holder];
  assert.equal(h.team, 0);
  assert.equal(h.role, 'field');
  assert.equal(s.time, 300);
  assert.deepEqual(s.score, [0, 0]);
  assert.equal(s.phase, 'countdown');
});

test('formation keeps field players out of goal areas', () => {
  const s = createMatchState();
  for (const p of s.players.filter(p => p.role === 'field')) {
    assert.ok(Math.hypot(p.x - 20, p.z) > 6);
    assert.ok(Math.hypot(p.x + 20, p.z) > 6);
  }
});

test('resetForThrowOff(s,1) gives ball to team 1 at center', () => {
  const s = createMatchState();
  resetForThrowOff(s, 1);
  assert.equal(s.players[s.ball.holder].team, 1);
  assert.ok(Math.abs(s.ball.x) < 0.5);
});
