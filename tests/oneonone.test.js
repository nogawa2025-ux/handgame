import test from 'node:test';
import assert from 'node:assert/strict';
import { C } from '../src/sim/constants.js';
import { createMatchState, giveBall } from '../src/sim/state.js';
import { step } from '../src/sim/step.js';
import { stepFeint } from '../src/sim/actions.js';
import { idle, DT, scatter } from './helpers.js';

/** Our #1 on the ball at x=10 heading for goal; their #8 squarely in front. */
function duel(defVz = 0) {
  const s = createMatchState(); scatter(s); s.phase = 'play';
  Object.assign(s.players[1], { x: 10, z: 0, facing: 0 }); giveBall(s, 1); s.controlled[0] = 1;
  Object.assign(s.players[8], { x: 11.2, z: 0, vx: 0, vz: defVz, facing: Math.PI, stun: 0, fooledCd: 0 });
  return s;
}

test('a defender in front stops the carrier: no running through', () => {
  const s = duel();
  for (let i = 0; i < 40; i++) step(s, [{ ...idle(), mx: 1 }, idle()], DT);
  assert.ok(s.players[1].x < s.players[8].x - C.CONTACT_R + 0.05, 'kept in front of the defender');
});

test('held up for a second → free throw from outside 9m, defenders 3m away', () => {
  const s = duel();
  Object.assign(s.players[1], { x: 12, z: 0 }); Object.assign(s.players[8], { x: 13.2, z: 0 });
  const evs = [];
  for (let i = 0; i < 120; i++) { step(s, [{ ...idle(), mx: 1 }, idle()], DT); evs.push(...s.events); if (evs.some((e) => e.startsWith('freethrow'))) break; }
  assert.ok(evs.includes('freethrow:0'));
  assert.equal(s.ball.holder, 1);
  assert.ok(Math.hypot(20 - s.players[1].x, s.players[1].z) >= C.FREE_THROW_R, 'outside 9m');
  assert.ok(Math.hypot(s.players[8].x - s.players[1].x, s.players[8].z - s.players[1].z) >= 2.99, '3m');
  assert.equal(s.phase, 'restart');
});

test('step feint 1-on-1: a defender who bit on the first move is beaten', () => {
  const s = duel(-3); // moving toward -z while we break to +z
  stepFeint(s, 1, 0.4, 1);
  assert.ok(s.events.includes('beat'));
  assert.ok(s.players[8].stun > 0);
});

test('step feint 1-on-1: a defender who read the break stays in the way', () => {
  const s = duel(3); // already moving toward +z, where we break
  stepFeint(s, 1, 0.4, 1);
  assert.ok(s.events.includes('read'));
  assert.equal(s.players[8].stun, 0);
  assert.ok(Math.hypot(s.players[1].vx, s.players[1].vz) < C.DASH, 'burst smothered');
});

test('step feint 1-on-1: against a waiting defender it is a coin flip', () => {
  let beat = 0;
  for (let k = 0; k < 40; k++) { const s = duel(0); s.time = 100 + k * 0.731; stepFeint(s, 1, 0.4, 1); if (s.events.includes('beat')) beat++; }
  assert.ok(beat > 8 && beat < 32, `beaten ${beat}/40`);
});

test('CPU carriers play 1-on-1s: fakes and breaks happen in a match', () => {
  const s = createMatchState(); s.time = 299.3;
  const c = { beat: 0, read: 0, free: 0 };
  while (s.phase !== 'ended') {
    step(s, [null, null], DT);
    for (const e of s.events) { if (e === 'beat') c.beat++; if (e === 'read') c.read++; if (e.startsWith('freethrow')) c.free++; }
  }
  assert.ok(c.beat > 3 && c.read > 1, JSON.stringify(c));
});

test('easy defender holding the carrier up gets the free throw (no auto-cut while in contact)', () => {
  const s = duel();
  Object.assign(s.players[1], { x: 12, z: 0, contact: 0.1 }); Object.assign(s.players[8], { x: 12.8, z: 0, facing: Math.PI });
  s.controlled[1] = 8;
  const evs = [];
  for (let i = 0; i < 150; i++) {
    step(s, [{ ...idle(), mx: 1, easy: true }, { ...idle(), mx: -1, easy: true }], DT);
    evs.push(...s.events); if (evs.some((e) => e.startsWith('freethrow'))) break;
  }
  assert.ok(!evs.includes('steal'), 'no cut while holding');
  assert.ok(evs.includes('freethrow:0'), 'free throw: ' + evs.join(','));
});

test('a CPU marker holding a human carrier up does not keep poking (free throw comes)', () => {
  let free = 0;
  for (let k = 0; k < 6; k++) {
    const s = duel(); s.time -= k * 0.37;
    Object.assign(s.players[1], { x: 12, z: 0, contact: 0.1 }); Object.assign(s.players[8], { x: 12.8, z: 0, facing: Math.PI });
    for (let i = 0; i < 180; i++) {
      step(s, [{ ...idle(), mx: 1 }, null], DT);
      if (s.events.some((e) => e.startsWith('freethrow'))) { free++; break; }
      if (s.ball.holder !== 1) break;
    }
  }
  assert.ok(free >= 3, `free throws ${free}/6`);
});
