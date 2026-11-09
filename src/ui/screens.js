// Full-screen UI states rendered into #screen.
const el = () => document.getElementById('screen');

let token = 0; // bumps on every screen change so stale countdown timers stop

function render(html, { clear = false, keep = false } = {}) {
  if (!keep) token++;
  const s = el();
  s.classList.remove('hidden');
  s.classList.toggle('clear', clear);
  s.innerHTML = html;
  return s;
}
const on = (sel, fn) => el().querySelector(sel)?.addEventListener('click', fn);

export function clear() {
  token++;
  el().innerHTML = '';
  el().classList.add('hidden');
}

export function tutorialDone({ onCpu, onTitle }) {
  render(`
    <div class="panel">
      <p class="result win">準備OK！</p>
      <p class="final">これで全部の操作を覚えました</p>
      <div class="row">
        <button class="primary" id="b-cpu">CPUと練習</button>
        <button id="b-title">タイトルへ</button>
      </div>
    </div>`);
  on('#b-cpu', onCpu);
  on('#b-title', onTitle);
}

export function title({ onCreate, onJoin, onCpu, onTutorial, easy, onToggleEasy }) {
  render(`
    <div class="panel">
      <h1 class="title">ハンドボール<span>対戦</span></h1>
      <p class="sub">友だちとオンラインで5分間の真剣勝負</p>
      <div class="menu">
        <button class="primary" id="b-create">部屋を作る</button>
        <button id="b-join">部屋に入る</button>
        <button id="b-cpu">CPUと練習</button>
        <button id="b-tut">チュートリアル</button>
      </div>
      <button class="mode" id="b-mode">操作：<b>${easy ? 'かんたん' : '上級'}</b><small>${easy ? '自動で狙う・パス先を選ぶ・守備も自動' : '狙い・パス先・カットを全部自分で'}</small></button>
    </div>`);
  on('#b-create', onCreate);
  on('#b-join', onJoin);
  on('#b-cpu', onCpu);
  on('#b-tut', onTutorial);
  on('#b-mode', onToggleEasy);
}

export function lobbyWaiting() {
  render(`<div class="panel"><p class="sub">部屋を準備しています…</p></div>`);
}

export function lobby(code, url, onCancel) {
  render(`
    <div class="panel">
      <p class="sub">この部屋コードを友だちに送ってください</p>
      <div class="code">${code}</div>
      <div class="row">
        <button class="primary" id="b-share">招待URLを共有</button>
        <button id="b-cancel">やめる</button>
      </div>
      <p class="note" id="note">相手を待っています…</p>
    </div>`);
  on('#b-share', async () => {
    const note = el().querySelector('#note');
    const data = { title: 'ハンドボール対戦', text: `ハンドボールで勝負しよう！ 部屋コード: ${code}`, url };
    try {
      if (navigator.share) { await navigator.share(data); return; }
    } catch (e) { if (e?.name === 'AbortError') return; }
    try {
      await navigator.clipboard.writeText(`${data.text}\n${url}`);
      note.textContent = 'コピーしました。LINEなどに貼り付けて送ってください';
    } catch {
      note.textContent = url;
    }
  });
  on('#b-cancel', onCancel);
}

export function join(onSubmit, onBack) {
  render(`
    <div class="panel">
      <p class="sub">友だちから届いた部屋コードを入力</p>
      <input class="code-input" id="code" maxlength="5" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text">
      <div class="row">
        <button class="primary" id="b-go">入る</button>
        <button id="b-back">戻る</button>
      </div>
      <p class="note err" id="note"></p>
    </div>`);
  const input = el().querySelector('#code');
  input.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
  setTimeout(() => input.focus(), 50);
  const go = () => {
    const code = input.value.trim().toUpperCase();
    if (code.length !== 5) { el().querySelector('#note').textContent = '5文字のコードを入力してください'; return; }
    input.blur();
    onSubmit(code);
  };
  on('#b-go', go);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  on('#b-back', onBack);
}

export function connecting(code) {
  render(`<div class="panel"><p class="sub">部屋 ${code} に接続しています…</p></div>`);
}

export function error(message, onBack) {
  render(`
    <div class="panel">
      <p class="final err">${message}</p>
      <div class="row"><button class="primary" id="b-back">タイトルへ</button></div>
    </div>`);
  on('#b-back', onBack);
}

export function countdown(from = 3) {
  let n = Math.ceil(from);
  const my = ++token;
  const tick = () => {
    if (token !== my) return;
    if (n <= 0) {
      render(`<div class="countdown">スタート！</div>`, { clear: true, keep: true });
      setTimeout(() => { if (token === my) clear(); }, 700);
      return;
    }
    render(`<div class="countdown">${n}</div>`, { clear: true, keep: true });
    n--;
    setTimeout(tick, 1000);
  };
  tick();
}

export function result(winner, localTeam, score, { rematchLabel, onRematch, onTitle }) {
  const me = score[localTeam], op = score[1 - localTeam];
  const [text, cls] = winner === 'draw' ? ['引き分け', 'lose'] : winner === localTeam ? ['勝利！', 'win'] : ['敗北…', 'lose'];
  render(`
    <div class="panel">
      <p class="result ${cls}">${text}</p>
      <p class="final">あなた ${me} - ${op} 相手</p>
      <div class="row">
        <button class="primary" id="b-again">${rematchLabel}</button>
        <button id="b-title">タイトルへ</button>
      </div>
      <p class="note" id="note"></p>
    </div>`);
  on('#b-again', () => {
    el().querySelector('#b-again').disabled = true;
    el().querySelector('#note').textContent = '相手を待っています…';
    onRematch();
  });
  on('#b-title', onTitle);
}
