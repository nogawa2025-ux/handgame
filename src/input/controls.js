// Touch + keyboard controls → Input objects in court space.

const DEAD = 0.15;

/** Screen-space stick vector (x right, y down), unit-clamped, with dead zone. */
export function stickVector(ox, oy, x, y, radius) {
  let mx = (x - ox) / radius, mz = (y - oy) / radius;
  const len = Math.hypot(mx, mz);
  if (len < DEAD) return { mx: 0, mz: 0 };
  if (len > 1) { mx /= len; mz /= len; }
  return { mx, mz };
}

/** Screen direction → court direction. Camera on +z side: right = +x, down = +z. */
export function toCourt(sx, sy, mirror) {
  return mirror ? { mx: -sx, mz: -sy } : { mx: sx, mz: sy };
}

export class TouchTracker {
  constructor(radius) {
    this.radius = radius;
    this.touches = new Map(); // id → {target, ox, oy, x, y}
    this.pressed = new Set();
    this.released = new Set();
  }
  down(id, x, y, target) {
    this.touches.set(id, { target, ox: x, oy: y, x, y });
    if (target !== 'stick') this.pressed.add(target);
  }
  move(id, x, y) {
    const t = this.touches.get(id);
    if (t) { t.x = x; t.y = y; }
  }
  up(id) {
    const t = this.touches.get(id);
    if (!t) return;
    this.touches.delete(id);
    if (t.target !== 'stick') this.released.add(t.target);
  }
  cancelAll() {
    for (const id of [...this.touches.keys()]) this.up(id);
    this.pressed.clear();
    this.released.clear();
  }
  stickTouch() {
    for (const t of this.touches.values()) if (t.target === 'stick') return t;
    return null;
  }
  snapshot() {
    const st = this.stickTouch();
    const held = new Set();
    for (const t of this.touches.values()) if (t.target !== 'stick') held.add(t.target);
    const snap = {
      stick: st ? stickVector(st.ox, st.oy, st.x, st.y, this.radius) : null,
      held, pressed: new Set(this.pressed), released: new Set(this.released),
    };
    this.pressed.clear();
    this.released.clear();
    return snap;
  }
}

const KEYMAP = { KeyJ: 'pass', KeyK: 'shoot', KeyL: 'long', ShiftLeft: 'dash', ShiftRight: 'dash', Space: 'shoot', KeyC: 'sub' };

/**
 * DOM wiring. `root` contains #stick-zone, #stick-base, #stick-knob and .btn[data-btn].
 */
export function createControls(root, opts = { mirror: false }) {
  const RADIUS = 60;
  const tracker = new TouchTracker(RADIUS);
  const zone = root.querySelector('#stick-zone');
  const base = root.querySelector('#stick-base');
  const knob = root.querySelector('#stick-knob');
  const buttons = [...root.querySelectorAll('.btn')];
  const keys = new Set();
  const keyPressed = new Set(), keyReleased = new Set();
  let mirror = opts.mirror;
  let pending = { pass: false, long: false, shootRelease: false };

  const homeBase = () => { base.style.left = ''; base.style.top = ''; knob.style.transform = ''; };

  const onZoneStart = (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (tracker.stickTouch()) break;
      tracker.down(t.identifier, t.clientX, t.clientY, 'stick');
      base.style.left = `${t.clientX}px`; base.style.top = `${t.clientY}px`;
    }
  };
  const onBtnStart = (e) => {
    e.preventDefault();
    const name = e.currentTarget.dataset.btn;
    for (const t of e.changedTouches) tracker.down(t.identifier, t.clientX, t.clientY, name);
    e.currentTarget.classList.add('down');
    navigator.vibrate?.(15);
  };
  const onMove = (e) => {
    for (const t of e.changedTouches) tracker.move(t.identifier, t.clientX, t.clientY);
    const st = tracker.stickTouch();
    if (st) {
      const v = stickVector(st.ox, st.oy, st.x, st.y, RADIUS);
      knob.style.transform = `translate(${v.mx * RADIUS * 0.7}px, ${v.mz * RADIUS * 0.7}px)`;
    }
  };
  const onEnd = (e) => {
    for (const t of e.changedTouches) tracker.up(t.identifier);
    refreshButtons();
    if (!tracker.stickTouch()) homeBase();
  };
  const refreshButtons = () => {
    const held = new Set([...tracker.touches.values()].map((t) => t.target));
    for (const b of buttons) b.classList.toggle('down', held.has(b.dataset.btn));
  };
  const releaseAll = () => { tracker.cancelAll(); keys.clear(); refreshButtons(); homeBase(); };

  zone.addEventListener('touchstart', onZoneStart, { passive: false });
  for (const b of buttons) {
    b.addEventListener('touchstart', onBtnStart, { passive: false });
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  root.addEventListener('touchmove', (e) => { e.preventDefault(); onMove(e); }, { passive: false });
  root.addEventListener('touchend', onEnd);
  root.addEventListener('touchcancel', releaseAll);
  addEventListener('blur', releaseAll);
  addEventListener('resize', releaseAll);
  document.addEventListener('visibilitychange', releaseAll);

  // mouse fallback for buttons (desktop testing)
  for (const b of buttons) {
    b.addEventListener('mousedown', (e) => { e.preventDefault(); tracker.down('m', 0, 0, b.dataset.btn); refreshButtons(); });
  }
  addEventListener('mouseup', () => { tracker.up('m'); refreshButtons(); });

  const onKey = (down) => (e) => {
    if (e.repeat) return;
    const k = e.code;
    if (down) { keys.add(k); if (KEYMAP[k]) keyPressed.add(KEYMAP[k]); }
    else { keys.delete(k); if (KEYMAP[k]) keyReleased.add(KEYMAP[k]); }
  };
  addEventListener('keydown', onKey(true));
  addEventListener('keyup', onKey(false));

  return {
    setMirror(m) { mirror = m; },
    setMode(mode) {
      root.querySelector('#btn-pass').textContent = mode === 'attack' ? 'パス' : '切替';
      root.querySelector('#btn-shoot').textContent = mode === 'attack' ? 'シュート' : 'カット';
      root.querySelector('#btn-long').classList.toggle('hidden', mode !== 'attack');
    },
    /** Returns an Input; edge events are reported once. */
    read() {
      const snap = tracker.snapshot();
      let sx = snap.stick ? snap.stick.mx : 0, sy = snap.stick ? snap.stick.mz : 0;
      const kx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      const ky = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
      if (kx || ky) { const l = Math.hypot(kx, ky); sx = kx / l; sy = ky / l; }
      const { mx, mz } = toCourt(sx, sy, mirror);
      const heldKey = (name) => Object.entries(KEYMAP).some(([k, v]) => v === name && keys.has(k));
      const input = {
        mx, mz,
        dash: snap.held.has('dash') || heldKey('dash'),
        pass: snap.pressed.has('pass') || keyPressed.has('pass') || pending.pass,
        long: snap.pressed.has('long') || keyPressed.has('long') || pending.long,
        sub: snap.pressed.has('sub') || keyPressed.has('sub'),
        shootHeld: snap.held.has('shoot') || heldKey('shoot'),
        shootRelease: snap.released.has('shoot') || keyReleased.has('shoot') || pending.shootRelease,
      };
      // a press+release inside one frame still yields a held tick first
      if (snap.pressed.has('shoot') && !input.shootHeld) { input.shootHeld = true; input.shootRelease = false; pending.shootRelease = true; }
      else pending.shootRelease = false;
      pending.pass = pending.long = false;
      keyPressed.clear(); keyReleased.clear();
      return input;
    },
    releaseAll,
  };
}
