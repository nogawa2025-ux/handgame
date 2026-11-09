import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatchState, giveBall } from '../src/sim/state.js';
import { step, expirePass } from '../src/sim/step.js';
import { throwBall } from '../src/sim/actions.js';
import { PendingInput } from '../src/input/pending.js';
import { isValidCode } from '../src/net/peer.js';
import { Predictor } from '../src/net/sync.js';
import { idle, scatter, DT } from './helpers.js';

test('C1: keeper collects a resting ball anywhere in its goal area', () => {
  for (const [x, z] of [[17, 4], [15.5, 1], [16, -3]]) {
    const s = createMatchState(); s.phase = 'play'; scatter(s);
    Object.assign(s.ball, { holder: null, x, z, y: 0.11, vx: 0, vy: 0, vz: 0, passTarget: null, shot: false });
    let got = false;
    for (let i = 0; i < 4 / DT && !got; i++) { step(s, [idle(), idle()], DT); got = s.ball.holder === 7; }
    assert.ok(got, `ball at ${x},${z}`);
  }
});

test('I1: a missed pass stops being a pass so players chase the loose ball', () => {
  const b = { holder: null, vx: 6, vz: 0, passTarget: 2, flightAge: 0 };
  expirePass(b, 1.0);
  assert.equal(b.passTarget, 2, 'still a live pass after 1s at speed');
  expirePass(b, 0.6);
  assert.equal(b.passTarget, null, 'expired after 1.5s');
  const slow = { holder: null, vx: 1, vz: 1, passTarget: 3, flightAge: 0.2 };
  expirePass(slow, 0.01);
  assert.equal(slow.passTarget, null, 'expired once the ball has slowed down');
});

test('C2: press events survive frames without a sim step', () => {
  const q = new PendingInput();
  q.add({ ...idle(), pass: true });
  q.add({ ...idle(), mx: 1 });           // next frame, no step ran in between
  const a = q.take();
  assert.equal(a.pass, true);
  assert.equal(a.mx, 1);
  assert.equal(q.take().pass, false, 'delivered once');
});

test('M2: room codes are validated', () => {
  assert.equal(isValidCode('ABCDE'), true);
  assert.equal(isValidCode('AB<D>'), false);
  assert.equal(isValidCode('ABCD'), false);
});

test('I4: prediction reconciles against the acknowledged input, not the latest snapshot', () => {
  const s = createMatchState(); s.phase = 'play';
  const pred = new Predictor();
  const team = 1, id = s.controlled[team];
  const inp = { ...idle(), mx: 1 };
  // predict 30 frames of running; host acks only seq 10 (it lags behind)
  let latest = structuredClone(s);
  for (let seq = 1; seq <= 30; seq++) {
    const view = structuredClone(latest);
    const out = pred.apply(view, latest, team, inp, DT, seq);
    if (seq === 10) {
      latest = structuredClone(latest);
      latest.players[id].x = out.players[id].x; // host agrees with our prediction at seq 10
      latest.ack = 10;
    }
  }
  const before = pred.p.x;
  for (let seq = 31; seq < 61; seq++) pred.apply(structuredClone(latest), latest, team, idle(), DT, seq);
  // host agreed at the acked seq → no pull-back even though latest lags far behind
  assert.ok(pred.p.x >= before - 0.05, `pulled back from ${before} to ${pred.p.x}`);
});
