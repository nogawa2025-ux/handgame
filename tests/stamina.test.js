import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatchState, giveBall } from '../src/sim/state.js';
import { step } from '../src/sim/step.js';
import { movePlayer, shoot, substitute } from '../src/sim/actions.js';
import { C } from '../src/sim/constants.js';
import { idle, scatter, DT } from './helpers.js';

const fresh = () => ({ id: 1, team: 0, role: 'field', x: -10, z: 0, vx: 0, vz: 0, facing: 0, stamina: 1, anim: 'idle', animTimer: 0, stealCd: 0, stun: 0 });
const runFor = (p, secs, dx, dash) => { for (let i = 0; i < secs / DT; i++) { movePlayer(p, dx, 0, dash, false, DT); if (p.x > 10) p.x = -10; } };

test('running tires slowly, dashing much faster, standing recovers', () => {
  const run = fresh(), dash = fresh(), rest = fresh();
  runFor(run, 10, 1, false);
  runFor(dash, 10, 1, true);
  assert.ok(run.stamina < 1 && run.stamina > 0.9, `run ${run.stamina}`);
  assert.ok(dash.stamina < run.stamina - 0.15, `dash ${dash.stamina}`);
  rest.stamina = 0.5;
  runFor(rest, 10, 0, false);
  assert.ok(rest.stamina > 0.5);
});

test('a tired player is slower', () => {
  const a = fresh(), b = fresh();
  b.stamina = 0.2;
  runFor(a, 1, 1, false); runFor(b, 1, 1, false);
  assert.ok(b.vx < a.vx * 0.92, `${b.vx} vs ${a.vx}`);
});

test('an exhausted player cannot dash', () => {
  const p = fresh(); p.stamina = 0.05;
  runFor(p, 1, 1, true);
  assert.ok(p.vx <= C.RUN + 0.01);
});

test('a tired shooter shoots slower', () => {
  const mk = (st) => {
    const s = createMatchState(); scatter(s);
    Object.assign(s.players[1], { x: 10, z: 0, stamina: st });
    giveBall(s, 1); shoot(s, 1, 0, 1);
    return Math.hypot(s.ball.vx, s.ball.vz);
  };
  assert.ok(mk(0.2) < mk(1) * 0.92);
});

test('every team has a bench of 6 fresh players with jersey numbers', () => {
  const s = createMatchState();
  for (const t of [0, 1]) {
    assert.equal(s.bench[t].length, 6);
    assert.ok(s.bench[t].every((b) => b.stamina === 1 && b.num > 0));
  }
  const nums = s.players.filter((p) => p.team === 0).map((p) => p.num).concat(s.bench[0].map((b) => b.num));
  assert.equal(new Set(nums).size, 13, 'unique numbers per team');
});

test('substitute swaps the most tired field player (not the ball holder) for the freshest bench player', () => {
  const s = createMatchState(); s.phase = 'play';
  s.players[1].stamina = 0.1; // ball holder, very tired — must stay
  s.players[3].stamina = 0.3;
  s.players[4].stamina = 0.6;
  const oldNum = s.players[3].num;
  const ok = substitute(s, 0);
  assert.equal(ok, true);
  assert.equal(s.players[3].stamina, 1);
  assert.notEqual(s.players[3].num, oldNum);
  assert.ok(s.bench[0].some((b) => b.num === oldNum && Math.abs(b.stamina - 0.3) < 1e-9));
  assert.equal(s.players[1].stamina, 0.1);
  assert.ok(s.events.some((e) => e.startsWith('sub:0:')));
});

test('the sub button substitutes; bench players recover', () => {
  const s = createMatchState(); s.phase = 'play';
  s.players[3].stamina = 0.2;
  step(s, [{ ...idle(), sub: true }, idle()], DT);
  assert.ok(s.players[3].stamina > 0.99);
  const benched = s.bench[0].find((b) => b.stamina < 0.5);
  const before = benched.stamina;
  for (let i = 0; i < 600; i++) step(s, [idle(), idle()], DT);
  assert.ok(benched.stamina > before + 0.1);
});

test('CPU teams substitute tired players by themselves', () => {
  const s = createMatchState(); s.phase = 'play';
  for (const id of [9, 10, 11]) s.players[id].stamina = 0.2;
  let subs = 0;
  for (let i = 0; i < 60 * 20; i++) { step(s, [idle(), null], DT); subs += s.events.filter((e) => e.startsWith('sub:1:')).length; }
  assert.ok(subs >= 2, `cpu subs ${subs}`);
});
