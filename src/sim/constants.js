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
  GK_REACH: 0.9,         // reflex reach of a keeper standing square
  GK_DIVE: 2.0,
  GK_REACT: 0.18,
  // stamina (per second): moving costs a little, dashing a lot, standing/bench recovers
  STAMINA_BASE: 0.0013,
  STAMINA_RUN: 0.0022,   // × (speed / RUN)^2
  STAMINA_DASH: 0.03,
  STAMINA_REST: 0.006,
  STAMINA_BENCH: 0.03,
  STAMINA_MIN_DASH: 0.1,
  TIRED_SLOWDOWN: 0.25,  // speed × (1 - 0.25 × (1 - stamina))
  CPU_SUB_BELOW: 0.3,
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
  // cuts: a chance, not a sure thing; a missed lunge leaves the defender off balance
  STEAL_CHANCE: 0.4,
  STEAL_CHANCE_DRIBBLE: 0.85, // holding on and bouncing the ball is easy to poke away
  STEAL_CHANCE_BEHIND: 0.12,  // reaching round from behind rarely works
  STEAL_MISS_STUN: 0.35,
  // shot blocks: a defender standing in the shot's path can get a hand to it
  BLOCK_R: 0.8,
  BLOCK_H: 2.3,
  BLOCK_CHANCE: 0.4,
  BLOCK_WINDOW: 0.45,         // only early in the flight (near the shooter)
  // passive play: attack too long without a shot → warning, then the ball changes sides
  PASSIVE_WARN: 15,
  PASSIVE_LIMIT: 22,
  CPU_SUB_COOLDOWN: 15,
  // shooter–keeper duel
  DUEL_RANGE: 14,          // wind-ups closer than this start a duel (camera, slow-mo, keeper read)
  DUEL_SLOWMO: 0.6,
  GK_LEAN_RATE: 6,         // how fast the keeper's lean follows its read (per second)
  GK_LEAN_REACH: 0.6,      // full lean shifts the covered point this far sideways
  GK_LEAN_H: 0.55,         // ...and this far up/down
  GK_WRONG: 0.5,
  GK_BODY: 0.4,            // shots this close to the keeper's body are always stopped           // reach on the side opposite a committed lean
  GK_BLUFF: 0.45,          // CPU keeper: chance its visible lean is a bluff
  GK_SHOW: 0.4,            // CPU keeper: how much it leans before the release
  SHOT_Y_MID: 1.0,
  SHOT_Y_RANGE: 0.8,       // aim height = mid ± range
  AIM_REACH: 0.88,         // full stick aims just inside the post
  AIM_ERR: 0.05,           // aim scatter (goal units): + AIM_ERR_POWER × charge
  AIM_ERR_POWER: 0.1,
  ARMS_UP_R: 2.5,
  BODY_R: 0.45,
  CPU_READ: 0.5,           // CPU shooter: chance it shoots away from the keeper's lean
  CPU_WINDUP: 0.5,         // CPU wind-up time (+ up to 0.25s)
  // 1-on-1
  CONTACT_R: 0.75,         // a defender this close in front stops the carrier
  FREE_THROW_AFTER: 1.0,   // held up this long → whistle, free throw
  READ_V: 1.0,             // lateral speed (m/s) that counts as leaning one way
  // jump shot
  JUMP_TIME: 0.55,
  JUMP_H: 0.6,
  JUMP_SHOT_RANGE: 12,     // shots closer than this are jump shots
  JUMP_RELEASE_Y: 1.9,
  // CPU attack build-up: pass around the 9m line for this long (+ random) before cutting in
  BUILD_UP_MIN: 3,
  BUILD_UP_RAND: 5,
  // 7m throw
  SEVEN_LIMIT: 5,          // the thrower must shoot within this many seconds
  // かんたん操作 (assist)
  EASY_MIN_CHARGE: 0.75,   // a quick tap still shoots hard
  EASY_SWITCH_MARGIN: 1.5, // switch defender when another is this much closer to the ball
});
