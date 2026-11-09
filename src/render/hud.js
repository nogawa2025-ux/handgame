const $ = (id) => document.getElementById(id);

export function createHud() {
  const hud = $('hud'), score = $('score-text'), clock = $('clock'), banner = $('banner');
  const charge = $('charge'), fill = $('charge-fill');
  let bannerTimer = 0;
  return {
    show(on) { hud.classList.toggle('hidden', !on); },
    update(state, localTeam, dt) {
      const me = state.score[localTeam], op = state.score[1 - localTeam];
      score.innerHTML = `<span class="me">あなた ${me}</span> - <span class="op">${op} 相手</span>`;
      const t = Math.max(0, Math.ceil(state.time));
      clock.textContent = `${state.overtime ? '延長 ' : ''}${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
      const c = state.shootCharge[localTeam];
      charge.classList.toggle('on', c > 0);
      fill.style.width = `${Math.round(c * 100)}%`;
      if (bannerTimer > 0) {
        bannerTimer -= dt;
        if (bannerTimer <= 0) banner.classList.add('hidden');
      }
    },
    flash(text, mine, secs = 1.6) {
      banner.textContent = text;
      banner.className = mine ? 'me' : 'op';
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
