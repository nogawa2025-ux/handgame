import { C } from './constants.js';

// Formation offsets in "attack space": +x = toward the goal the team attacks.
const THROWOFF_SPOTS = [[-0.4, 0], [-3, -6], [-3, 6], [-6, -3], [-6, 3], [-9, 0]];
const RECEIVE_SPOTS = [[-3, 0], [-5, -5], [-5, 5], [-8, -3], [-8, 3], [-11, 0]];

export const attackDir = (team) => (team === 0 ? 1 : -1);
export const teamIds = (team) => (team === 0 ? [0, 1, 2, 3, 4, 5, 6] : [7, 8, 9, 10, 11, 12, 13]);
export const gkId = (team) => (team === 0 ? 0 : 7);

function makePlayer(id) {
  const team = id < 7 ? 0 : 1;
  const num = (id % 7) + 1; // GK #1, court players #2–#7
  return {
    id, team, num, role: id % 7 === 0 ? 'gk' : 'field',
    x: 0, z: 0, vx: 0, vz: 0, facing: team === 0 ? 0 : Math.PI,
    stamina: 1, anim: 'idle', animTimer: 0, stealCd: 0, stun: 0, fooledCd: 0, offBalance: 0, lean: 0,
  };
}

export function createMatchState() {
  const s = {
    time: C.MATCH_TIME, overtime: false, phase: 'countdown', phaseTimer: C.COUNTDOWN,
    score: [0, 0],
    players: Array.from({ length: 14 }, (_, i) => makePlayer(i)),
    ball: { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, holder: null, holdTime: 0, lastTeam: 0, passTarget: null, shot: false, shotTeam: null },
    controlled: [1, 8],
    shootCharge: [0, 0],
    winner: null,
    events: [],
    restartTeam: 0,
    gkTimer: [0, 0],
    // bench: #8–#13 for each team
    bench: [0, 1].map(() => Array.from({ length: 6 }, (_, i) => ({ num: 8 + i, stamina: 1 }))),
  };
  resetForThrowOff(s, 0);
  return s;
}

export function resetForThrowOff(s, team) {
  for (const t of [0, 1]) {
    const d = attackDir(t);
    const spots = t === team ? THROWOFF_SPOTS : RECEIVE_SPOTS;
    const ids = teamIds(t);
    const gk = s.players[ids[0]];
    gk.x = -d * (C.COURT_HALF_X - 1); gk.z = 0;
    gk.vx = gk.vz = 0; gk.facing = d === 1 ? 0 : Math.PI;
    ids.slice(1).forEach((id, i) => {
      const p = s.players[id];
      p.x = spots[i][0] * d; p.z = spots[i][1] * d;
      p.vx = p.vz = 0; p.facing = d === 1 ? 0 : Math.PI; p.anim = 'idle';
    });
  }
  const holder = s.players[teamIds(team)[1]];
  giveBall(s, holder.id);
  s.controlled = [1, 8];
  s.controlled[team] = holder.id;
  s.shootCharge = [0, 0];
}

export function giveBall(s, id) {
  const p = s.players[id];
  const b = s.ball;
  b.holder = id; b.holdTime = 0; b.lastTeam = p.team; b.passTarget = null;
  b.shot = false; b.shotTeam = null;
  p.feinted = false; p.shotFeinted = false; p.windup = 0;
  b.x = p.x; b.z = p.z; b.y = 1; b.vx = b.vy = b.vz = 0;
}
