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

// Keeper strength against player shots from the backcourt (9–12m), nobody else around.
function freeShot(x, z, aim, frames) {
  const s = createMatchState(); s.phase = 'play'; scatter(s);
  const hold = () => { s.players[1].x = x; s.players[1].z = z; for (const p of s.players) if (p.role === 'field' && p.id !== 1) { p.x = -15; p.z = 9; } };
  Object.assign(s.players[1], { x, z, facing: 0 }); giveBall(s, 1); s.controlled[0] = 1;
  for (let i = 0; i < 40; i++) { step(s, [idle(), idle()], DT); hold(); }
  for (let i = 0; i < frames; i++) { step(s, [{ ...idle(), shootHeld: true }, idle()], DT); hold(); }
  step(s, [{ ...idle(), shootRelease: true, mz: aim }, idle()], DT);
  for (let i = 0; i < 150; i++) { step(s, [idle(), idle()], DT); hold(); if (s.score[0] || s.events.includes('save')) break; }
  return s.score[0] ? 'goal' : s.events.includes('save') ? 'save' : 'miss';
}
const rate = (frames) => {
  let goals = 0, n = 0;
  for (const x of [8, 9.5, 11]) for (const z of [-6, -3, 0, 3, 6]) for (const aim of [-1, 1]) { n++; if (freeShot(x, z, aim, frames) === 'goal') goals++; }
  return goals / n;
};

test('keeper is realistic: full-power corner shots from distance score roughly 30–55%', () => {
  const r = rate(48);
  assert.ok(r >= 0.3 && r <= 0.55, `goal rate ${r}`);
});

test('keeper saves most half-power shots', () => {
  assert.ok(rate(24) <= 0.35);
});

test('shots from absurd distances do not go in', () => {
  let own = 0, long = 0, n = 0;
  for (const aim of [-1, -0.5, 0.5, 1]) for (const f of [30, 48]) {
    n++;
    for (const [x, z] of [[-5, 0], [-10, 3]]) if (freeShot(x, z, aim, f) === 'goal') own++;
    for (const [x, z] of [[0, 0], [2, 5], [4, -5]]) if (freeShot(x, z, aim, f) === 'goal') long++;
  }
  assert.equal(own, 0, 'from your own half');
  assert.ok(long / (n * 3) <= 0.15, `16–20m goal rate ${long / (n * 3)}`);
});
