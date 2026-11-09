import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatchState } from '../src/sim/state.js';
import { step } from '../src/sim/step.js';
import { C } from '../src/sim/constants.js';
import { idle, scatter, DT } from './helpers.js';

const run = (s, secs, inputs = () => [idle(), idle()]) => {
  for (let i = 0; i < Math.round(secs / DT); i++) step(s, inputs(i), DT);
};
const loose = (s, x, z, vx = 0, y = 1, lastTeam = 0) => {
  Object.assign(s.ball, { holder: null, x, z, y, vx, vy: 0, vz: 0, lastTeam, passTarget: null });
};

test('clock counts down only during play', () => {
  const s = createMatchState();
  run(s, C.COUNTDOWN + 1);
  assert.ok(Math.abs(s.time - 299) < 0.05, `time ${s.time}`);
});

test('goal increments score and restarts with conceding team', () => {
  const s = createMatchState(); s.phase = 'play'; scatter(s);
  s.players[7].z = 8;
  loose(s, 19.5, 0, 20);
  run(s, 0.2);
  assert.deepEqual(s.score, [1, 0]);
  assert.equal(s.phase, 'goal');
  run(s, C.GOAL_PAUSE + 0.1);
  assert.equal(s.players[s.ball.holder].team, 1);
});

test('tie at full time goes to overtime; overtime goal ends match', () => {
  const s = createMatchState(); s.phase = 'play'; s.time = 0.01;
  run(s, 0.05);
  assert.equal(s.overtime, true);
  assert.equal(s.time, C.OVERTIME);
  s.phase = 'play'; scatter(s); s.players[0].z = 8;
  loose(s, -19.5, 0, -20, 1, 1);
  run(s, 0.2);
  assert.equal(s.phase, 'ended');
  assert.equal(s.winner, 1);
});

test('full time with a lead ends without overtime', () => {
  const s = createMatchState(); s.phase = 'play'; s.time = 0.01; s.score = [3, 2];
  run(s, 0.05);
  assert.equal(s.phase, 'ended');
  assert.equal(s.winner, 0);
});

test('overtime tie ends in draw', () => {
  const s = createMatchState(); s.phase = 'play'; s.overtime = true; s.time = 0.01;
  run(s, 0.05);
  assert.equal(s.phase, 'ended');
  assert.equal(s.winner, 'draw');
});

test('controlled player never becomes GK', () => {
  const s = createMatchState();
  const inp = (i) => {
    const a = idle(), b = idle();
    a.mx = Math.cos(i / 37); a.mz = Math.sin(i / 23);
    b.mx = Math.sin(i / 19); b.mz = Math.cos(i / 41);
    a.pass = i % 45 === 0; b.pass = i % 30 === 0;
    a.shootHeld = i % 90 > 60; a.shootRelease = i % 90 === 0;
    b.shootHeld = i % 70 > 50; b.shootRelease = i % 70 === 0;
    return [a, b];
  };
  for (let i = 0; i < 1800; i++) {
    step(s, inp(i), DT);
    assert.notEqual(s.controlled[0], 0);
    assert.notEqual(s.controlled[1], 7);
  }
});

test('GK picks up loose ball in own area', () => {
  const s = createMatchState(); s.phase = 'play'; scatter(s);
  loose(s, 18, 0, 0, 0.1);
  run(s, 1);
  assert.equal(s.ball.holder, 7);
});

test('side out gives ball to opponent of lastTeam', () => {
  const s = createMatchState(); s.phase = 'play';
  loose(s, 0, 10.3, 0, 0.5, 0);
  run(s, 0.1);
  assert.equal(s.players[s.ball.holder].team, 1);
  assert.equal(s.players[s.ball.holder].role, 'field');
});

test('pass reaches the intended teammate', () => {
  const s = createMatchState(); s.phase = 'play'; scatter(s);
  Object.assign(s.players[1], { x: 0, z: 0 });
  Object.assign(s.players[2], { x: 6, z: 0 });
  s.ball.holder = 1;
  const a = idle(); a.mx = 1; a.pass = true;
  step(s, [a, idle()], DT);
  run(s, 1);
  assert.equal(s.ball.holder, 2);
  assert.equal(s.controlled[0], 2);
});
