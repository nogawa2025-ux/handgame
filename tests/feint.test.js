import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatchState, giveBall } from '../src/sim/state.js';
import { step } from '../src/sim/step.js';
import { trySteal } from '../src/sim/actions.js';
import { C } from '../src/sim/constants.js';
import { idle, scatter, DT } from './helpers.js';

function attackSetup() {
  const s = createMatchState(); s.phase = 'play'; scatter(s);
  Object.assign(s.players[1], { x: 10, z: 0, facing: 0 });
  giveBall(s, 1);
  s.controlled[0] = 1;
  Object.assign(s.players[8], { x: 11.5, z: 0, facing: Math.PI }); // defender right in front
  return s;
}
const run = (s, n, mk) => { for (let i = 0; i < n; i++) step(s, mk(i), DT); };

test('shot feint: pass while charging cancels the shot instead of passing', () => {
  const s = attackSetup();
  run(s, 20, () => [{ ...idle(), shootHeld: true }, idle()]);
  assert.ok(s.shootCharge[0] > 0);
  step(s, [{ ...idle(), shootHeld: true, pass: true }, idle()], DT);
  assert.equal(s.ball.holder, 1, 'still holding the ball');
  assert.equal(s.shootCharge[0], 0);
  assert.ok(s.events.includes('feint'));
  // releasing the button after a feint must not fire a shot
  step(s, [{ ...idle(), shootRelease: true }, idle()], DT);
  assert.equal(s.ball.holder, 1);
});

test('shot feint stuns nearby defenders and unbalances the keeper', () => {
  const s = attackSetup();
  run(s, 20, () => [{ ...idle(), shootHeld: true, mz: 1 }, idle()]);
  step(s, [{ ...idle(), shootHeld: true, pass: true, mz: 1 }, idle()], DT);
  assert.ok(s.players[8].stun > 0, 'defender stunned');
  assert.ok(s.players[7].offBalance > 0, 'keeper off balance');
});

test('stunned defender cannot steal', () => {
  const s = attackSetup();
  s.players[8].x = 10.8;
  s.players[8].stun = 0.3;
  assert.equal(trySteal(s, 8), false);
  s.players[8].stun = 0;
  assert.equal(trySteal(s, 8, 0, 0), true);
});

test('step feint: quick stick reversal bursts the other way and stuns the marker', () => {
  const s = attackSetup();
  run(s, 6, () => [{ ...idle(), mz: -1 }, idle()]);
  step(s, [{ ...idle(), mz: 1 }, idle()], DT);
  assert.ok(s.events.includes('feint'));
  assert.ok(s.players[1].vz > C.RUN, `burst speed ${s.players[1].vz}`);
  assert.ok(s.players[8].stun > 0);
});

test('no cooldown: the attacker can feint again right away', () => {
  const s2 = attackSetup(); let feints = 0;
  for (const dir of [-1, 1, -1, 1]) for (let i = 0; i < 5; i++) { step(s2, [{ ...idle(), mz: dir }, idle()], DT); if (s2.events.includes('feint')) feints++; }
  assert.ok(feints >= 3, `feints ${feints}`);
});

test('a defender who was just fooled is not stunned again immediately (realism)', () => {
  const s = attackSetup();
  run(s, 6, () => [{ ...idle(), mz: -1 }, idle()]);
  step(s, [{ ...idle(), mz: 1 }, idle()], DT);
  assert.ok(s.players[8].stun > 0);
  s.players[8].stun = 0; // pretend he recovered his feet
  run(s, 5, () => [{ ...idle(), mz: -1 }, idle()]);
  assert.equal(s.players[8].stun, 0, 'immune right after being fooled');
});

test('shot feint with no real wind-up fools nobody', () => {
  const s = attackSetup();
  step(s, [{ ...idle(), shootHeld: true }, idle()], DT);
  step(s, [{ ...idle(), shootHeld: true, pass: true }, idle()], DT);
  assert.equal(s.players[8].stun ?? 0, 0);
});

test('step feint without a defender in front does not stun anyone', () => {
  const s = attackSetup();
  s.players[8].x = -5;
  run(s, 6, () => [{ ...idle(), mz: -1 }, idle()]);
  step(s, [{ ...idle(), mz: 1 }, idle()], DT);
  assert.ok(s.players.every((p) => !(p.stun > 0)));
});

test('slow stick turns are not feints', () => {
  const s = attackSetup();
  let feint = false;
  for (let i = 0; i < 90; i++) {
    const a = Math.PI / 2 - (i / 90) * Math.PI; // sweep from +z to -z over 1.5s
    step(s, [{ ...idle(), mx: Math.cos(a), mz: Math.sin(a) }, idle()], DT);
    feint ||= s.events.includes('feint');
  }
  assert.equal(feint, false);
});

test('plain pass still works when not charging a shot', () => {
  const s = attackSetup();
  Object.assign(s.players[2], { x: 10, z: 5 });
  step(s, [{ ...idle(), mz: 1, pass: true }, idle()], DT);
  assert.equal(s.ball.passTarget, 2);
});

test('a CPU keeper sold a shot feint leans that way and the other side opens up', () => {
  const s = attackSetup(); s.players[8].x = -5;
  const quiet = () => { for (const p of s.players) if (p.team === 1 && p.role === 'field') { p.x = -15; p.z = 9; } };
  for (let i = 0; i < 30; i++) { step(s, [idle(), null], DT); quiet(); }
  for (let i = 0; i < 24; i++) { step(s, [{ ...idle(), shootHeld: true, sx: 1 }, null], DT); quiet(); }
  step(s, [{ ...idle(), shootHeld: true, pass: true, sx: 1 }, null], DT);
  step(s, [{ ...idle(), shootRelease: true }, null], DT);
  for (let i = 0; i < 12; i++) { step(s, [{ ...idle(), shootHeld: true, sx: -0.75 }, null], DT); quiet(); }
  assert.ok(s.players[7].leanZ > 0.3, 'keeper leans to the faked side');
  step(s, [{ ...idle(), shootRelease: true, sx: -0.75 }, null], DT);
  for (let i = 0; i < 90; i++) { step(s, [idle(), null], DT); if (s.score[0]) break; }
  assert.equal(s.score[0], 1, 'the shot to the open side goes in');
});

test('aiming during a wind-up never triggers a step feint', () => {
  const s = attackSetup();
  const evs = [];
  for (let i = 0; i < 20; i++) { step(s, [{ ...idle(), shootHeld: true, mz: i % 4 < 2 ? 1 : -1 }, idle()], DT); evs.push(...s.events); }
  assert.ok(!evs.includes('feint'));
});

test('CPU carriers use step feints against a close marker', () => {
  const s = createMatchState(); s.phase = 'play';
  let feints = 0;
  for (let i = 0; i < 60 * 60 * 2; i++) { step(s, [null, null], DT); feints += s.events.filter((e) => e === 'feint').length; }
  assert.ok(feints >= 3, `cpu feints ${feints}`);
});
