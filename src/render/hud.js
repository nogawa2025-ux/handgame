const $ = (id) => document.getElementById(id);

export function createHud() {
  const hud = $('hud'), score = $('score-text'), clock = $('clock'), banner = $('banner');
  const charge = $('charge'), fill = $('charge-fill'), stam = $('stamina'), passive = $('passive');
  const mm = $('minimap'), g = mm.getContext('2d'), hint = $('duelhint');
  /** Court (40×20) → minimap pixels; mirrored so the local team always attacks to the right. */
  function drawMinimap(state, localTeam) {
    const W = mm.width, H = mm.height, pad = 6, sx = (W - pad * 2) / 40, sz = (H - pad * 2) / 20;
    const m = localTeam === 1 ? -1 : 1;
    const X = (x) => pad + (m * x + 20) * sx, Z = (z) => pad + (m * z + 10) * sz;
    g.clearRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1.5;
    g.strokeRect(X(-20 * m), Z(-10 * m), 40 * sx, 20 * sz);
    g.beginPath(); g.moveTo(X(0), Z(-10)); g.lineTo(X(0), Z(10)); g.stroke();
    g.save(); g.beginPath(); g.rect(pad, pad, 40 * sx, 20 * sz); g.clip();
    for (const side of [-1, 1]) { // goal areas
      g.beginPath(); g.ellipse(X(side * 20), Z(0), 6 * sx, 6 * sz, 0, 0, Math.PI * 2); g.stroke();
    }
    g.restore();
    for (const p of state.players) {
      const mine = p.team === localTeam;
      g.fillStyle = p.role === 'gk' ? (mine ? '#9fc0ff' : '#ffb3b3') : (mine ? '#3f7bff' : '#ff4d4d');
      g.beginPath(); g.arc(X(p.x), Z(p.z), 4, 0, Math.PI * 2); g.fill();
    }
    const c = state.players[state.controlled[localTeam]];
    if (c) { g.strokeStyle = '#ffe600'; g.lineWidth = 2; g.beginPath(); g.arc(X(c.x), Z(c.z), 6.5, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = '#ffe600'; g.strokeStyle = '#000'; g.lineWidth = 1;
    g.beginPath(); g.arc(X(state.ball.x), Z(state.ball.z), 3.2, 0, Math.PI * 2); g.fill(); g.stroke();
  }
  let stamKey = '';
  let bannerTimer = 0;
  return {
    show(on) { hud.classList.toggle('hidden', !on); },
    update(state, localTeam, dt) {
      const me = state.score[localTeam], op = state.score[1 - localTeam];
      score.innerHTML = `<span class="me">あなた ${me}</span> - <span class="op">${op} 相手</span>`;
      const t = Math.max(0, Math.ceil(state.time));
      clock.textContent = `${state.overtime ? '延長 ' : ''}${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
      // stamina bars for our 6 court players (rebuilt only when numbers change)
      const mine = state.players.filter((p) => p.team === localTeam && p.role === 'field');
      const key = mine.map((p) => p.num).join(',');
      if (key !== stamKey) {
        stamKey = key;
        stam.innerHTML = mine.map((p) => `<div class="p"><div class="bar"><i></i></div>${p.num}</div>`).join('');
      }
      [...stam.children].forEach((el, i) => {
        const p = mine[i];
        const v = Math.max(0, Math.min(1, p.stamina ?? 1));
        const bar = el.firstChild.firstChild;
        bar.style.height = `${Math.round(v * 100)}%`;
        bar.style.background = v > 0.6 ? '#43c46a' : v > 0.35 ? '#ffd400' : '#ff5a5a';
        el.classList.toggle('on', p.id === state.controlled[localTeam]);
      });
      passive.classList.toggle('hidden', !state.attack?.warned);
      drawMinimap(state, localTeam);
      const duel = state.duel;
      document.body.classList.toggle('duel', !!duel);
      hint.classList.toggle('hidden', !duel);
      if (duel) hint.textContent = duel.team === localTeam ? '🎯 スティックで狙う → 離してシュート' : '🧤 キーパー：スティックで守る側を読む';
      const c = state.shootCharge[localTeam];
      charge.classList.toggle('on', c > 0);
      fill.style.width = `${Math.round(c * 100)}%`;
      if (bannerTimer > 0) {
        bannerTimer -= dt;
        if (bannerTimer <= 0) banner.classList.add('hidden');
      }
    },
    flash(text, mine, secs = 1.6, small = false) {
      banner.textContent = text;
      banner.className = (mine ? 'me' : 'op') + (small ? ' small' : '');
      bannerTimer = secs;
    },
  };
}

export function confetti(n = 80) {
  const colors = ['#ffd400', '#2a5bd7', '#ff5a5a', '#43a047', '#ffffff'];
  for (let i = 0; i < n; i++) {
    const d = document.createElement('div');
    d.className = 'confetti';
    d.style.left = `${Math.random() * 100}vw`;
    d.style.background = colors[i % colors.length];
    d.style.animationDuration = `${2 + Math.random() * 2}s`;
    d.style.animationDelay = `${Math.random() * 0.8}s`;
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 5000);
  }
}
