// Interactive tutorial: a list of lessons played on the real sim.
// Each lesson sets up the court, says what to do and detects when it was done.
import { C } from '../sim/constants.js';
import { resetForThrowOff, giveBall, teamIds } from '../sim/state.js';
import { possessionTeam } from '../sim/step.js';

const ZONE_Z = [-7.2, -4.4, -1.5, 1.5, 4.4, 7.2];

/** Fresh live play with team `team` on the ball at the centre. */
function base(s, team = 0) {
  resetForThrowOff(s, team);
  s.phase = 'play'; s.phaseTimer = 0;
  if (!(s.time > 60)) s.time = C.MATCH_TIME;
  s.shootCharge = [0, 0];
  s.feintHold = [false, false];
  s.lastStick = [null, null];
  s.attack = { team: null, time: 0, warned: false };
  s.ball.shot = false;
  for (const p of s.players) { p.stun = 0; p.fooledCd = 0; p.offBalance = 0; p.stealCd = 0; p.stamina = 1; }
}

/** Our player #1 on the ball about 9.5m from goal; the other team in its 6-0 zone. */
function shootingSpot(s) {
  base(s, 0);
  const [, ...ours] = teamIds(0);
  const [, ...theirs] = teamIds(1);
  ours.forEach((id, i) => Object.assign(s.players[id], { x: 6 + (i % 3) * 1.5, z: [-7, 7, -3.5, 3.5, 0][i - 1] ?? 0 }));
  Object.assign(s.players[ours[0]], { x: 10.5, z: 0, facing: 0 });
  theirs.forEach((id, i) => {
    const z = ZONE_Z[i] * 0.95;
    Object.assign(s.players[id], { x: 20 - Math.sqrt(6.7 * 6.7 - z * z), z, facing: Math.PI, vx: 0, vz: 0 });
  });
  giveBall(s, ours[0]);
  s.controlled[0] = ours[0];
}

/** Opponents stand still and can't interfere (re-applied every tick). */
const calm = (s) => { for (const id of teamIds(1).slice(1)) { const p = s.players[id]; p.stun = 0.2; p.vx = p.vz = 0; } };

export const LESSONS = [
  {
    title: '移動',
    text: '左のスティックで選手を動かそう',
    pc: 'WASD / 矢印キー',
    setup(s, m) { base(s); calm(s); const p = s.players[s.controlled[0]]; m.x = p.x; m.z = p.z; },
    tick: calm,
    done(s, ev, inp, m) { const p = s.players[s.controlled[0]]; return Math.hypot(p.x - m.x, p.z - m.z) > 6; },
  },
  {
    title: 'ダッシュ',
    text: 'ダッシュを押しながら走ろう（スタミナを多く使う）',
    pc: 'Shift',
    setup(s, m) { base(s); calm(s); m.t = 0; },
    tick: calm,
    done(s, ev, inp, m, dt) { if (inp.dash && Math.hypot(inp.mx, inp.mz) > 0.3) m.t += dt; return m.t > 1.2; },
  },
  {
    title: 'パス',
    text: 'スティックを味方の方へ倒して、パス',
    easyText: 'パスを押すだけで、いちばん良い味方へパス（スティックを倒せばその方向の味方へ）',
    pc: 'J',
    setup(s) { base(s); calm(s); },
    tick: calm,
    done(s, ev) { return ev.includes('pass') && s.ball.lastTeam === 0; },
  },
  {
    title: 'シュート',
    text: 'シュートを長押しして力をためて、離して打つ。スティックの上下で左右の隅を狙おう。ゴールを決めたらクリア',
    easyText: 'シュートを押すだけで、キーパーのいない隅を自動で狙う（長押しでさらに強く）。ゴールを決めたらクリア',
    pc: 'K / スペース 長押し',
    attack: true,
    setup(s) { shootingSpot(s); calm(s); },
    tick: calm,
    done(s, ev) { return ev.includes('goal:0'); },
    retryHint: 'キーパーのいない側の隅を狙おう',
  },
  {
    title: 'シュートフェイント',
    text: 'シュートを長押ししている途中でパス → 打つふりで守備とキーパーをだます',
    pc: 'K 長押し中に J',
    attack: true,
    setup(s) { shootingSpot(s); },
    done(s, ev) { return ev.includes('feint') && s.feintHold[0]; },
    retryHint: 'ボールを取られた。もう一度',
  },
  {
    title: '切り返し',
    text: 'ボールを持ってスティックを素早く逆に倒す → 鋭く切り返して守備を置き去りに',
    pc: '移動キーを素早く逆へ',
    attack: true,
    setup(s) { shootingSpot(s); },
    done(s, ev) { return ev.includes('feint') && !s.feintHold[0] && possessionTeam(s) === 0; },
    retryHint: 'ボールを取られた。もう一度',
  },
  {
    title: '守備',
    text: '守備ではパスでボールに近い選手に切替、シュートでカット。正面から狙おう。ボールを奪えばクリア',
    easyText: '守備は自動でボールに近い選手に切り替わる。ボールを持つ相手に正面から走って近づけば自動でカット。ボールを奪えばクリア',
    pc: 'J で切替 / K でカット',
    defend: true,
    setup(s) { base(s, 1); },
    done(s, ev) { return ev.includes('steal') || (ev.includes('intercept') && possessionTeam(s) === 0) || ev.includes('block'); },
    retryHint: 'もう一度守ろう',
  },
  {
    title: '交代',
    text: '疲れた選手（左上のバーが赤）を、右上の交代ボタンでベンチの選手と替えよう',
    pc: 'C',
    setup(s) { base(s); calm(s); s.players[3].stamina = 0.15; },
    tick: calm,
    done(s, ev) { return ev.some((e) => e.startsWith('sub:0')); },
  },
];

/**
 * Lesson runner. Hooks: onLesson(i, lesson), onClear(i), onRetry(hint), onFinish().
 * Call before(s) before each sim step and after(s, events, input, dt) after it.
 */
export function createTutorial(hooks = {}) {
  let i = -1, mem = {}, wait = 0, pending = null;
  const t = {
    get index() { return i; },
    get lesson() { return LESSONS[i]; },
    finished: false,
    start(s, n = 0) {
      i = n; mem = {}; wait = 0; pending = null;
      if (i >= LESSONS.length) { t.finished = true; hooks.onFinish?.(); return; }
      LESSONS[i].setup(s, mem);
      hooks.onLesson?.(i, LESSONS[i]);
    },
    skip(s) { t.start(s, i + 1); },
    before(s) {
      if (t.finished) return;
      if (s.time < 60) s.time = C.MATCH_TIME; // the clock never runs out (it still ticks so luck varies)
      if (s.attack) { s.attack.time = 0; s.attack.warned = false; }
      if (!pending) LESSONS[i].tick?.(s);
    },
    after(s, events, input, dt) {
      if (t.finished) return;
      if (pending) {
        wait -= dt;
        if (wait <= 0) { const p = pending; pending = null; p(); }
        return;
      }
      const L = LESSONS[i];
      if (L.done(s, events, input, mem, dt)) {
        hooks.onClear?.(i);
        pending = () => t.start(s, i + 1); wait = 1.3;
        return;
      }
      const lost = (L.attack && (possessionTeam(s) === 1 || s.phase === 'goal'))
        || (L.defend && (s.phase === 'goal' || s.ball.holder === 0 || s.phase === 'restart'));
      if (lost) {
        hooks.onRetry?.(L.retryHint ?? 'もう一度');
        pending = () => { mem = {}; L.setup(s, mem); }; wait = 1.2;
      }
    },
  };
  return t;
}
