import test from 'node:test';
import assert from 'node:assert/strict';
import { stickVector, TouchTracker, toCourt } from '../src/input/controls.js';

test('stickVector dead zone returns zero', () => {
  assert.deepEqual(stickVector(100, 100, 105, 103, 60), { mx: 0, mz: 0 });
});

test('stickVector clamps to unit length', () => {
  const v = stickVector(100, 100, 400, 100, 60);
  assert.ok(Math.abs(v.mx - 1) < 1e-9);
  assert.equal(v.mz, 0);
  const w = stickVector(100, 100, 130, 100, 60);
  assert.ok(w.mx > 0.4 && w.mx < 0.6);
});

test('stick and button touches tracked by identifier', () => {
  const t = new TouchTracker(60);
  t.down(1, 100, 300, 'stick');
  t.move(1, 200, 300);
  t.down(2, 700, 300, 'pass');
  t.down(3, 750, 200, 'dash');
  let s = t.snapshot();
  assert.ok(s.pressed.has('pass') && s.pressed.has('dash'));
  t.up(2);
  s = t.snapshot();
  assert.ok(s.stick && s.stick.mx > 0.9);
  assert.ok(s.held.has('dash'));
  assert.ok(!s.held.has('pass'));
  assert.ok(s.released.has('pass'));
  s = t.snapshot();
  assert.equal(s.released.size, 0, 'edge events are delivered once');
});

test('touchcancel releases stick and buttons', () => {
  const t = new TouchTracker(60);
  t.down(1, 100, 300, 'stick'); t.move(1, 160, 300);
  t.down(2, 700, 300, 'shoot');
  t.cancelAll();
  const s = t.snapshot();
  assert.equal(s.stick, null);
  assert.equal(s.held.size, 0);
});

test('toCourt maps screen directions for both camera sides', () => {
  assert.deepEqual(toCourt(1, 0, false), { mx: 1, mz: 0 });
  assert.deepEqual(toCourt(0, 1, false), { mx: 0, mz: 1 });   // screen down → toward camera (+z)
  assert.deepEqual(toCourt(1, 0, true), { mx: -1, mz: -0 });
  assert.deepEqual(toCourt(0, 1, true), { mx: -0, mz: -1 });
});
