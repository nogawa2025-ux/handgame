import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatchState } from '../src/sim/state.js';
import { step } from '../src/sim/step.js';
import { createTutorial, LESSONS } from '../src/ui/tutorial.js';
import { idle, DT } from './helpers.js';

/** Play one lesson with a scripted input function; returns ticks until cleared (or -1). */
function play(n, script, maxTicks = 60 * 40) {
  const s = createMatchState();
  let cleared = false, retries = 0;
  const t = createTutorial({ onClear: () => { cleared = true; }, onRetry: () => retries++ });
  t.start(s, n);
  for (let k = 0; k < maxTicks; k++) {
    const inp = { sub: false, ...script(s, k) };
    t.before(s);
    step(s, [inp, null], DT);
    t.after(s, s.events, inp, DT);
    if (cleared) return { k, retries, s, t };
  }
  return { k: -1, retries, s, t };
}

test('there is a lesson for every control', () => {
  assert.deepEqual(LESSONS.map((l) => l.title), ['移動', 'ダッシュ', 'パス', 'シュート', 'シュートフェイント', '切り返し', '守備', '交代']);
});

test('move, dash and pass lessons clear', () => {
  assert.ok(play(0, () => ({ ...idle(), mx: 1 })).k > 0);
  assert.ok(play(1, () => ({ ...idle(), mx: 1, dash: true })).k > 0);
  assert.ok(play(2, (s, k) => ({ ...idle(), mx: -1, pass: k === 5 })).k > 0);
});

test('shooting lesson clears with a charged corner shot, retrying after saves', () => {
  let c = 0;
  const r = play(3, (s) => {
    if (s.ball.holder !== s.controlled[0]) { c = 0; return idle(); }
    c++;
    const aim = s.players[7].z > 0 ? -1 : 1;
    return c < 45 ? { ...idle(), shootHeld: true, mz: aim } : { ...idle(), shootRelease: true, mz: aim };
  });
  assert.ok(r.k > 0, `retries ${r.retries}`);
});

test('shot feint and step feint lessons clear', () => {
  assert.ok(play(4, (s, k) => ({ ...idle(), shootHeld: k < 30, pass: k === 25 })).k > 0);
  assert.ok(play(5, (s, k) => ({ ...idle(), mz: k < 6 ? 1 : -1 })).k > 0);
});

test('defence lesson clears by winning the ball', () => {
  const r = play(6, (s, k) => {
    const me = s.players[s.controlled[0]], b = s.ball;
    const dx = b.x - me.x, dz = b.z - me.z, l = Math.hypot(dx, dz) || 1;
    return { ...idle(), mx: dx / l, mz: dz / l, pass: k % 30 === 0, shootHeld: l < 1.2 && k % 10 < 5 };
  }, 60 * 120);
  assert.ok(r.k > 0, `retries ${r.retries}`);
});

test('substitution lesson clears and the tutorial finishes after the last lesson', () => {
  const r = play(7, (s, k) => ({ ...idle(), sub: k === 3 }));
  assert.ok(r.k > 0);
  let finished = false;
  const s = createMatchState();
  const t = createTutorial({ onFinish: () => { finished = true; } });
  t.start(s, LESSONS.length - 1);
  t.skip(s);
  assert.ok(finished && t.finished);
});

test('the clock and passive play are frozen during the tutorial', () => {
  const r = play(0, () => idle(), 60 * 300);
  assert.ok(r.s.time >= 60 && r.s.phase !== 'ended');
  assert.equal(r.s.attack.warned, false);
});
