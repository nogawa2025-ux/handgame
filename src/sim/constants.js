// All gameplay tunables (meters, seconds).
export const C = Object.freeze({
  COURT_HALF_X: 20,
  COURT_HALF_Z: 10,
  GOAL_AREA_R: 6,
  FREE_THROW_R: 9,
  GOAL_HALF_W: 1.5,
  GOAL_H: 2,
  MATCH_TIME: 300,
  OVERTIME: 60,
  RUN: 5.5,
  DASH: 7.5,
  AI_RUN: 5.0,
  GK_SPEED: 4.5,
  DRIBBLE_MULT: 0.85,
  HOLD_LIMIT: 3,
  PASS_SPEED: 14,
  LONG_PASS_SPEED: 18,
  SHOT_MIN: 14,
  SHOT_MAX: 24,
  SHOT_CHARGE_TIME: 0.8,
  STEAL_RANGE: 1.2,
  STEAL_RANGE_DRIBBLE: 1.6,
  STEAL_COOLDOWN: 0.6,
  CATCH_R: 0.7,
  GK_REACH: 1.1,
  GK_DIVE: 3,
  GK_REACT: 0.18,
  STAMINA_DRAIN: 0.25,
  STAMINA_REGEN: 0.1,
  GOAL_PAUSE: 2,
  RESTART_PAUSE: 1,
  COUNTDOWN: 3,
  GRAVITY: 9.8,
  SNAPSHOT_HZ: 20,
  FEINT_STUN: 0.45,      // how long a fooled defender is wrong-footed
  FEINT_IMMUNE: 1.0,     // a fooled defender reads the next feint for this long
  FEINT_RANGE: 2.5,      // only defenders this close bite on a feint
  FEINT_MIN_CHARGE: 0.25, // shot feint needs a believable wind-up
  STEP_BOOST: 1.15,      // burst after a step feint, × DASH
  STEP_WINDOW: 0.25,     // stick reversal within this time counts as a step feint
  GK_FEINT_RANGE: 13,    // keeper reacts to shot feints from this distance
  GK_OFF_BALANCE: 0.7,
});
