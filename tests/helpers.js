export const idle = () => ({ mx: 0, mz: 0, dash: false, pass: false, long: false, shootHeld: false, shootRelease: false });
export const DT = 1 / 60;
/** Put every player far away (to build isolated scenarios). */
export function scatter(s) {
  s.players.forEach((p, i) => {
    if (p.role === 'gk') { p.x = p.team === 0 ? -19 : 19; p.z = 0; }
    else { p.x = -15 + i * 2; p.z = -9 + (i % 2) * 18; }
    p.vx = p.vz = 0;
  });
}
