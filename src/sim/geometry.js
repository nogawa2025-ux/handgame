import { C } from './constants.js';

/** x of the goal that `team` attacks. */
export const goalX = (team) => (team === 0 ? C.COURT_HALF_X : -C.COURT_HALF_X);

/** Goal area approximated as a 6m half-circle around the goal center. */
export function inGoalArea(x, z, goalSide) {
  return Math.hypot(x - goalSide * C.COURT_HALF_X, z) < C.GOAL_AREA_R;
}

export function clampOutOfGoalArea(p) {
  for (const side of [1, -1]) {
    const gx = side * C.COURT_HALF_X;
    const dx = p.x - gx, dz = p.z;
    const d = Math.hypot(dx, dz);
    if (d < C.GOAL_AREA_R) {
      const nx = d < 1e-6 ? -side : dx / d, nz = d < 1e-6 ? 0 : dz / d;
      p.x = gx + nx * C.GOAL_AREA_R;
      p.z = nz * C.GOAL_AREA_R;
    }
  }
}

/** Returns the team that scored, or null. */
export function checkGoal(b) {
  if (Math.abs(b.z) >= C.GOAL_HALF_W || b.y >= C.GOAL_H) return null;
  if (b.x > C.COURT_HALF_X) return 0;
  if (b.x < -C.COURT_HALF_X) return 1;
  return null;
}

export function checkOut(b) {
  if (Math.abs(b.z) > C.COURT_HALF_Z) return { type: 'side', x: b.x, z: Math.sign(b.z) * C.COURT_HALF_Z };
  if (Math.abs(b.x) > C.COURT_HALF_X) return { type: 'goalline', x: Math.sign(b.x) * C.COURT_HALF_X, z: b.z };
  return null;
}
