// Accumulates local input across render frames until a sim step consumes it,
// so taps on 90/120 Hz displays are never dropped.
const EDGES = ['pass', 'long', 'shootRelease'];

export class PendingInput {
  constructor() { this.cur = null; }
  add(inp) {
    if (!this.cur) { this.cur = { ...inp }; return; }
    const c = this.cur;
    Object.assign(c, { mx: inp.mx, mz: inp.mz, dash: inp.dash, shootHeld: inp.shootHeld });
    for (const k of EDGES) c[k] = c[k] || inp[k];
  }
  /** Input for the next sim step; edges are cleared after being taken once. */
  take() {
    const out = this.cur ? { ...this.cur } : { mx: 0, mz: 0, dash: false, pass: false, long: false, shootHeld: false, shootRelease: false };
    if (this.cur) for (const k of EDGES) this.cur[k] = false;
    return out;
  }
}
