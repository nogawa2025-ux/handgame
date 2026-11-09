import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatchState, giveBall } from '../src/sim/state.js';
import { step } from '../src/sim/step.js';
import { shoot } from '../src/sim/actions.js';
import { idle, scatter, DT } from './helpers.js';

const runCollect = (s, secs, inputs) => {
  const ev = [];
  for (let i = 0; i < Math.round(secs / DT); i++) { step(s, inputs(), DT); ev.push(...s.events); }
  return ev;
};

test('defenders form a line outside 6m when opponent attacks', () => {
  const s = createMatchState(); s.phase = 'play';
  Object.assign(s.players[1], { x: 12, z: 0 });
  giveBall(s, 1);
  runCollect(s, 3, () => { s.ball.holdTime = 0; return [idle(), null]; }); // holdTime reset keeps the presser from stealing
  const outside = s.players.filter(p => p.team === 1 && p.role === 'field')
    .filter(p => { const d = Math.hypot(p.x - 20, p.z); return d < 6 - 0.01 || d > 8.5; });
  assert.ok(outside.length <= 1, `players off the line: ${outside.map(p => `${p.id}@${p.x.toFixed(1)},${p.z.toFixed(1)}`)}`);
});

test('GK saves a slow central shot', () => {
  const s = createMatchState(); s.phase = 'play'; scatter(s);
  Object.assign(s.players[1], { x: 12, z: 0 });
  giveBall(s, 1);
  shoot(s, 1, 0, 0);
  const ev = runCollect(s, 2, () => [idle(), idle()]);
  assert.ok(ev.includes('save'));
  assert.deepEqual(s.score, [0, 0]);
});

test('GK cannot save a full-power corner shot from 7m', () => {
  const s = createMatchState(); s.phase = 'play'; scatter(s);
  Object.assign(s.players[1], { x: 13, z: 0 });
  giveBall(s, 1);
  runCollect(s, 0.3, () => [idle(), idle()]); // let the keeper settle
  Object.assign(s.players[1], { x: 13, z: 0 });
  giveBall(s, 1);
  shoot(s, 1, 1, 1);
  runCollect(s, 1, () => [idle(), idle()]);
  assert.deepEqual(s.score, [1, 0]);
});

test('CPU vs CPU 5-minute match scores between 4 and 40 total and never throws', () => {
  const s = createMatchState();
  let ticks = 0;
  while (s.phase !== 'ended' && ticks < 60 * 60 * 8) { step(s, [null, null], DT); ticks++; }
  const total = s.score[0] + s.score[1];
  assert.equal(s.phase, 'ended');
  assert.ok(total >= 4 && total <= 40, `total goals ${total} (${s.score})`);
});
