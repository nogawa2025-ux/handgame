import * as THREE from 'three';
import { C } from '../sim/constants.js';
import { gkId } from '../sim/state.js';

const attackDir = (team) => (team === 0 ? 1 : -1);
// duel framing (metres)
export const VIEW = { KEEPER_BACK: 3.6, KEEPER_UP: 2.4, SHOOT_BACK: 3.4, SHOOT_UP: 2.6, SHOOT_SIDE: 1.1, SHOOT_LOOK_SHORT: 2.0 };

/**
 * Broadcast-style camera on the side line. When `mirror` is true the camera sits
 * on the opposite side so the local team (team 1) also attacks to the right.
 * During a shot duel it swings behind the shooter (our shot) or behind our own
 * goal (their shot), then eases back after the shot is decided.
 */
export function createCamera() {
  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 200);
  const focus = new THREE.Vector3(0, 0, 0);
  const pos = new THREE.Vector3(), look = new THREE.Vector3();
  const tPos = new THREE.Vector3(), tLook = new THREE.Vector3();
  let first = true;
  let mode = 'broadcast', hold = 0;
  const shooterAt = { x: 0, z: 0 };
  return {
    camera,
    get mode() { return mode; },
    follow(state, dt, mirror, localTeam = 0, duelCam = true) {
      const b = state.ball;
      // ----- which view?
      let want = null;
      if (duelCam && state.duel) {
        want = state.duel.team === localTeam ? 'shooter' : 'keeper';
        const sh = state.players[state.duel.shooter];
        shooterAt.x = sh.x; shooterAt.z = sh.z;
      } else if (duelCam && b.shot && b.shotTeam != null && mode !== 'broadcast') {
        want = mode; // keep watching the shot we were already following
      }
      if (want) { mode = want; hold = 0.8; } else if (hold > 0) { hold -= dt; if (hold <= 0) mode = 'broadcast'; }

      // ----- broadcast target (also keeps `focus` warm for the way back)
      const narrow = innerWidth / innerHeight < 1.9;
      const tx = Math.max(-13, Math.min(13, b.x));
      const tz = b.z * 0.3;
      const k = first ? 1 : Math.min(1, dt * 3);
      focus.x += (tx - focus.x) * k;
      focus.z += (tz - focus.z) * k;

      if (mode === 'shooter') {
        // behind the shooter, looking at the goal; further back and higher for long shots
        const gx = attackDir(localTeam) * C.COURT_HALF_X;
        let dx = gx - shooterAt.x, dz = -shooterAt.z;
        const dist = Math.hypot(dx, dz) || 1;
        dx /= dist; dz /= dist;
        const long = dist > 10.5;
        const back = long ? 4.4 : VIEW.SHOOT_BACK, up = long ? 3.4 : VIEW.SHOOT_UP;
        // over the throwing shoulder (right side of the run), so the shooter doesn't hide the goal
        const rx = -dz, rz = dx; // right-hand side of the run (looking toward the goal)
        tPos.set(shooterAt.x - dx * back + rx * VIEW.SHOOT_SIDE, up, shooterAt.z - dz * back + rz * VIEW.SHOOT_SIDE);
        // aim a little short of the goal so the shooter stays in the lower third
        tLook.set(gx - dx * VIEW.SHOOT_LOOK_SHORT, 0.8, -dz * VIEW.SHOOT_LOOK_SHORT);
      } else if (mode === 'keeper') {
        // behind our own net, looking out at the shooter
        // low enough that our own keeper fills the lower half, with the shooter beyond
        const dir = attackDir(localTeam);
        const own = -dir * C.COURT_HALF_X;
        const gk = state.players[gkId(localTeam)];
        tPos.set(own - dir * VIEW.KEEPER_BACK, VIEW.KEEPER_UP, shooterAt.z * 0.2);
        tLook.set(gk.x + (shooterAt.x - gk.x) * 0.45, 0.9, gk.z + (shooterAt.z - gk.z) * 0.45);
      } else {
        const side = mirror ? -1 : 1;
        const dist = narrow ? 15 : 13.5;
        tPos.set(focus.x, dist * 0.72, focus.z + side * dist);
        tLook.set(focus.x, 0, focus.z + side * 1.5);
      }
      // once back on the side line, follow exactly as before (no extra lag)
      const settled = mode === 'broadcast' && pos.distanceTo(tPos) < 0.6;
      const m = first || settled ? 1 : Math.min(1, dt * (mode === 'broadcast' ? 4 : 6));
      first = false;
      pos.lerp(tPos, m);
      look.lerp(tLook, m);
      camera.position.copy(pos);
      camera.lookAt(look);
    },
  };
}
