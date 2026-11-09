# Handball Online Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A smartphone-browser 3D handball game where two friends play a 5-minute 1v1 (each controls a whole team) over P2P, plus a CPU practice mode, hosted on GitHub Pages.

**Architecture:** A pure, deterministic-ish simulation (`src/sim/`, no DOM, no Three.js) advanced by `step(state, inputs, dt)`; it is unit-tested with `node --test`. The browser layer wraps it: touch controls produce `Input` objects, Three.js renders the `MatchState`, and the net layer runs the sim on the host only, sending snapshots to the guest, which interpolates and predicts its own controlled player. No build step: plain ES modules, libraries from CDN via an import map.

**Tech Stack:** HTML/CSS/ES modules, Three.js 0.160.0 (jsDelivr, import map; `GLTFLoader`, `SkeletonUtils`), PeerJS 1.5.4 (jsDelivr), Node 24 built-in test runner for sim tests, GitHub Pages.

**Spec:** `docs/specs/2026-11-09-handball-online-design.md`

## Global Constraints

- Landscape only; portrait shows 「横にしてください」 overlay.
- Target ≥30fps on recent iPhone/Android; device pixel ratio capped at 2.
- Match length 5:00, single period; tie → golden goal overtime up to 1:00, then draw.
- Each team: 6 court players + 1 GK. GK is always AI; never a switch target.
- Only GKs may stand inside the 6m goal area (court players stop at the line; jump shots may fly over it).
- Holding the ball >3s → dribble: speed ×0.85 and easier to steal; pass/shoot still allowed.
- Minimal randomness in outcomes (steals and saves decided by distance/angle/timing/reach).
- No eFootball names, logos, UI art or assets. Models/sounds must be license-clean (Three.js example `Xbot.glb` is MIT-licensed with Three.js).
- No accounts, no build step; all asset/library URLs pinned to exact versions.
- ICE servers configured in exactly one place (`src/net/ice.js`); STUN only initially.
- Host advantage accepted; host/guest roles swap on every rematch.
- All user-facing text in Japanese.

## Review Focus

1. Guest opens the shared URL before the host's peer is ready, or the room code is wrong → clear 「部屋が見つかりません」 message, back to title (Task 7 test `join fails on unknown room`).
2. Connection drops mid-match (screen lock, app switch, network change) → 「相手との接続が切れました」 and return to title, no frozen game (Task 7 test `disconnect emits close`).
3. Phone rotated / screen resized mid-match → canvas and controls re-layout without stuck touches (Task 6 test `touchcancel releases stick and buttons`).
4. Ball stuck: no one can reach it (in a goal area corner, or loose in a GK area) → GK picks up any loose ball inside its own goal area (Task 3 test `GK picks up loose ball in own area`).
5. Multi-touch: stick held while pressing two buttons → all register independently (Task 6 test `stick and button touches tracked by identifier`).

---

## File Structure

```
index.html              entry, import map, screens markup
css/style.css           layout, HUD, controls, overlays
src/sim/constants.js    court dims, speeds, timings (all tunables)
src/sim/state.js        createMatchState(), resetForThrowOff()
src/sim/geometry.js     inGoalArea(), clampOutOfGoalArea(), goal/out tests
src/sim/actions.js      pass target selection, shoot, steal, possession timers
src/sim/ai.js           field-player AI (attack/defense), GK AI
src/sim/step.js         step(state, inputs, dt): orchestrates one tick
src/input/controls.js   touch joystick + buttons → Input
src/render/scene.js     renderer, court, lights, resize
src/render/players.js   Xbot loading/cloning, team colors, animations
src/render/camera.js    broadcast camera following ball
src/render/hud.js       score/time, goal & result effects (DOM)
src/net/ice.js          ICE server list (single place)
src/net/peer.js         PeerJS room create/join wrapper
src/net/sync.js         host/guest protocol, snapshot interpolation, prediction
src/ui/screens.js       title / lobby / result screens, share
src/main.js             mode wiring + game loop
tests/*.test.js         node --test (sim + pure helpers only)
package.json            { "type": "module", "scripts": { "test": "node --test tests/" } }
```

## Shared Types (used by every task)

```js
// Coordinates in meters. Court x ∈ [-20,20] (length), z ∈ [-10,10] (width), y up.
// Team 0 attacks +x (goal at x=+20); team 1 attacks -x.
/** @typedef {{mx:number, mz:number, dash:boolean, pass:boolean, long:boolean,
 *   shootHeld:boolean, shootRelease:boolean}} Input
 *  mx/mz ∈ [-1,1] in COURT space for that team (renderer/controls convert);
 *  pass/long/shootRelease are one-tick edge events. */
/** @typedef {{id:number, team:0|1, role:'gk'|'field', x:number, z:number,
 *   vx:number, vz:number, facing:number, stamina:number, anim:'idle'|'run'|'pass'|'shoot'}} Player */
/** @typedef {{x:number,y:number,z:number,vx:number,vy:number,vz:number,
 *   holder:number|null, holdTime:number, lastTeam:0|1, passTarget:number|null}} Ball */
/** @typedef {{time:number, overtime:boolean, phase:'countdown'|'play'|'goal'|'restart'|'ended',
 *   phaseTimer:number, score:[number,number], players:Player[], ball:Ball,
 *   controlled:[number,number], shootCharge:[number,number], winner:0|1|'draw'|null,
 *   events:string[]}} MatchState
 *  events: one-tick list like 'goal:0','save','steal','whistle' for render/audio. */
```

Player ids: team 0 = 0..6 (0 is GK), team 1 = 7..13 (7 is GK).

---

### Task 1: Project scaffold + constants + state

**Files:**
- Create: `package.json`, `.gitignore`, `src/sim/constants.js`, `src/sim/state.js`
- Test: `tests/state.test.js`

**Interfaces:**
- Produces: `C` (frozen constants object) from `constants.js` with at least: `COURT_HALF_X=20, COURT_HALF_Z=10, GOAL_AREA_R=6, GOAL_HALF_W=1.5, GOAL_H=2, MATCH_TIME=300, OVERTIME=60, RUN=5.5, DASH=7.5, DRIBBLE_MULT=0.85, HOLD_LIMIT=3, PASS_SPEED=14, LONG_PASS_SPEED=18, SHOT_MIN=14, SHOT_MAX=24, SHOT_CHARGE_TIME=0.8, STEAL_RANGE=1.2, STEAL_RANGE_DRIBBLE=1.6, GK_REACH=1.6, GK_REACT=0.18, STAMINA_DRAIN=0.25, STAMINA_REGEN=0.1, GOAL_PAUSE=2, COUNTDOWN=3, SNAPSHOT_HZ=20`.
- Produces: `createMatchState(): MatchState` (phase `'countdown'`, team 0 starts with the ball at center), `resetForThrowOff(state, team: 0|1): void` (formation positions, ball to that team's center player).

- [ ] **Step 1:** `git init`, add `package.json` (`"type":"module"`, test script above), `.gitignore` (`node_modules/`).
- [ ] **Step 2: Write failing tests** in `tests/state.test.js`:
  - `createMatchState has 14 players, ids 0..13, GKs are 0 and 7` 
  - `team 0 holds the ball at start and time is 300`: `s.ball.holder` is a team-0 field player, `s.time === 300`, `s.score` deep-equals `[0,0]`.
  - `formation keeps field players out of goal areas`: every field player `Math.hypot(x∓20, z) > 6` w.r.t. both goals (use distance to nearest goal center `(±20,0)`; simple circle is acceptable approximation of the 6m line).
  - `resetForThrowOff(s,1) gives ball to team 1 at center`: holder team 1, `|ball.x|<0.5`.
- [ ] **Step 3:** Run `npm test` → FAIL (modules missing).
- [ ] **Step 4:** Implement `constants.js` and `state.js`.
- [ ] **Step 5:** Run `npm test` → PASS.
- [ ] **Step 6:** Commit `feat: sim scaffold, constants and match state`.

### Task 2: Geometry and rules helpers

**Files:**
- Create: `src/sim/geometry.js`
- Test: `tests/geometry.test.js`

**Interfaces:**
- Produces: `goalX(team: 0|1): number` (x of the goal team ATTACKS: team 0 → +20), `inGoalArea(x, z, goalSide: 1|-1): boolean` (distance from `(goalSide*20, 0)` < `GOAL_AREA_R`), `clampOutOfGoalArea(p: {x,z}): void` (pushes a point radially out to the 6m line of whichever area it's in), `checkGoal(ball): 0|1|null` (team that SCORED: ball crossed x=±20 with |z|<GOAL_HALF_W and y<GOAL_H), `checkOut(ball): null|{type:'side'|'goalline', x:number, z:number}`.

- [ ] **Step 1: Failing tests:** `inGoalArea(17,0,1)` true, `(13,0,1)` false; `clampOutOfGoalArea({x:18,z:0})` → x≈14 (±0.01); `checkGoal({x:20.1,z:0.5,y:1})===0`, `({x:-20.1,z:0,y:1})===1`, `({x:20.1,z:2,y:1})===null`; `checkOut({x:0,z:10.2,y:0})` type `'side'`; `checkOut({x:20.2,z:5,y:0})` type `'goalline'`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement `geometry.js`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: court geometry and goal/out detection`.

### Task 3: Actions (move, pass, shoot, steal, possession) + step core

**Files:**
- Create: `src/sim/actions.js`, `src/sim/step.js`
- Test: `tests/actions.test.js`, `tests/step.test.js`

**Interfaces:**
- Consumes: Task 1 `C`, `createMatchState`, `resetForThrowOff`; Task 2 helpers.
- Produces (actions.js):
  - `movePlayer(p: Player, dirX, dirZ, dash: boolean, dribbling: boolean, dt): void` — speed `RUN` or `DASH` (dash only if stamina>0, drains `STAMINA_DRAIN`/s, regen `STAMINA_REGEN`/s), ×`DRIBBLE_MULT` if dribbling; field players clamped out of goal areas and inside court.
  - `pickPassTarget(state, fromId, dirX, dirZ): number|null` — teammate (field or GK) minimizing angle to dir (if dir is zero, use `facing`), ties → nearest; ignores teammates with angle > 60°.
  - `pickLongTarget(state, fromId): number|null` — the teammate furthest toward the attacked goal.
  - `throwBall(state, fromId, toId, speed): void` — leads the receiver by its velocity.
  - `shoot(state, fromId, aimZ: number /*-1..1*/, charge: number /*0..1*/): void` — speed lerp `SHOT_MIN..SHOT_MAX`, target z = `aimZ*GOAL_HALF_W*0.9`, small arc.
  - `tryCatch(state): void` — loose/passed ball within 0.7m of a player at y<2 becomes held (opponents can intercept passes too).
  - `trySteal(state, stealerId): boolean` — succeeds iff holder is an opponent field player, distance ≤ `STEAL_RANGE` (or `STEAL_RANGE_DRIBBLE` when `holdTime > HOLD_LIMIT`), and stealer faces the holder within 70°. No randomness.
  - `nearestToBall(state, team): number` — field players only.
- Produces (step.js): `step(state: MatchState, inputs: [Input, Input|null], dt: number): void` — `inputs[1] === null` means team 1 is CPU (AI fills it). Handles: countdown → play; clock (stops during 'goal'/'restart'); controlled-player auto switch (attack: holder; defense: on `pass` press or when ball changes team, nearest field player; never GK); shot charge (`shootHeld` accumulates up to `SHOT_CHARGE_TIME`, `shootRelease` fires); defense `shootRelease`/`shootHeld` press → `trySteal`; ball physics (gravity, bounce, friction); goal → score, `phase='goal'` for `GOAL_PAUSE` then `resetForThrowOff(conceding team)`; out → restart by opponent of `lastTeam` (side: nearest opponent field player at the out point; goalline by attackers: defending GK); time up → overtime if tied (`overtime=true`, time=`OVERTIME`) → first goal in overtime ends; end of overtime tied → `winner='draw'`; GK auto-picks loose ball in own area; push event strings.
  - AI is called via `import { aiTick } from './ai.js'` — in this task create `ai.js` with a stub `aiTick(state, team, dt){}`; Task 4 fills it.

- [ ] **Step 1: Failing tests** (`actions.test.js`):
  - `dash is faster than run and drains stamina`
  - `dribbling after HOLD_LIMIT slows by 0.85`
  - `field player cannot enter goal area` (move toward (20,0) for 5s → stays ≥ 6m from (20,0) − 0.01)
  - `pickPassTarget prefers teammate in stick direction` (construct positions; expect specific id)
  - `pickPassTarget returns null when nobody within 60°`
  - `trySteal fails beyond STEAL_RANGE, succeeds within when facing, fails when facing away`
  - `trySteal range grows when holder is dribbling`
- [ ] **Step 2: Failing tests** (`step.test.js`, helper `idle()` returns neutral Input):
  - `clock counts down only during play` (after countdown 3s + 1s play: time≈299)
  - `goal increments score and restarts with conceding team` (place ball at x=19.9 moving +x with no GK in path → score `[1,0]`, after `GOAL_PAUSE` holder is team 1)
  - `tie at full time goes to overtime; overtime goal ends match` 
  - `overtime tie ends in draw`
  - `controlled player never becomes GK` (run 600 ticks of random-ish deterministic inputs; assert `controlled[0] !== 0 && controlled[1] !== 7` every tick)
  - `GK picks up loose ball in own area` (ball at (18,0,0) velocity 0, holder null → after 1s holder is 7)
  - `side out gives ball to opponent of lastTeam`
- [ ] **Step 3:** `npm test` → FAIL.
- [ ] **Step 4:** Implement `actions.js`, `step.js`, stub `ai.js`.
- [ ] **Step 5:** `npm test` → PASS.
- [ ] **Step 6:** Commit `feat: match actions and step loop`.

### Task 4: AI (field players + goalkeeper)

**Files:**
- Modify: `src/sim/ai.js`
- Test: `tests/ai.test.js`

**Interfaces:**
- Consumes: Task 3 actions.
- Produces: `aiTick(state: MatchState, team: 0|1, dt: number, cpuControlsAll: boolean): void` — moves every player of `team` except `state.controlled[team]` (when `cpuControlsAll`, also drives the controlled player: dribble toward goal, pass when an opponent is within 2m, shoot from 7–9m with charge 0.7). Attack: spread to 5 spots (wings, backs, pivot) relative to ball; fast break: if ball won in own half, two players sprint to the 9m line. Defense: 6-0 zone along the 6.5m arc, shifted toward ball z; nearest defender (non-controlled) presses holder within 9m. GK: positions on segment ball→goal center at 1m from line, clamped to |z|≤GOAL_HALF_W; on a shot toward goal, after `GK_REACT` seconds moves to intercept; saves if ball passes within `GK_REACH` of GK position (ball becomes GK's), else goal. GK with ball passes to `pickLongTarget` after 1s.
  - Update `step.js` to call `aiTick(state, t, dt, inputs[t] === null)` for both teams.

- [ ] **Step 1: Failing tests:**
  - `defenders form a line outside 6m when opponent attacks` (team 0 holds at (12,0); after 3s every team-1 field player except one presser has distance 6–8m from (20,0))
  - `GK saves a slow central shot` (shot from (12,0) charge 0, aimZ 0 → after 2s holder is 7, score unchanged)
  - `GK cannot save a full-power corner shot from 7m` (aimZ 1, charge 1 → score `[1,0]`)
  - `CPU vs CPU 5-minute match scores between 4 and 40 total and never throws` (run full match with both inputs null at dt=1/60; this is a balance smoke test — the spec target is 10–25; if it lands outside, tune constants in Task 1 file, keep the test bounds as written)
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement `aiTick`; wire into `step`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: field and goalkeeper AI`.

### Task 5: 3D rendering (scene, players, camera, HUD) + CPU mode playable with keyboard

**Files:**
- Create: `index.html`, `css/style.css`, `src/render/scene.js`, `src/render/players.js`, `src/render/camera.js`, `src/render/hud.js`, `src/main.js`

**Interfaces:**
- Consumes: `MatchState`, `createMatchState`, `step`.
- Produces:
  - `createScene(canvas): {renderer, scene, resize()}` — floor with handball lines (center line, 6m solid arcs, 9m dashed arcs, goals as white posts/net), hemisphere + directional light, no shadows on mobile (`matchMedia('(pointer:coarse)')`), DPR `min(devicePixelRatio,2)`.
  - `loadPlayers(scene): Promise<PlayerViews>`; `PlayerViews.update(state: MatchState, dt, mirror: boolean)` — Xbot from `https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/models/gltf/Xbot.glb`, cloned with `SkeletonUtils.clone`, 14 instances; recolor body material: team 0 `#2a5bd7`, team 1 `#d33a3a`, GKs `#f2c200`/`#7a3fd1`; crossfade idle/walk/run by speed; pass/shoot = brief arm raise via additive bone rotation (right arm) for 0.3s; yellow ring under `controlled[localTeam]` + ▼ marker; ball = orange sphere r=0.1. `mirror` rotates the world 180° around y so the local team always attacks right.
  - `createCamera(): {camera, follow(state, dt, mirror)}` — perspective 45°, positioned at side (z=+18, y=12) looking at ball x clamped to ±12, smoothed.
  - `createHud(root): {update(state, localTeam), showGoal(team, localTeam), showResult(winner, localTeam)}` — top center 「あなた X - Y 相手 m:ss」 (「延長」 prefix in overtime); goal banner 「ゴール！」; result 「勝利！」 with confetti CSS animation / 「敗北…」 / 「引き分け」.
  - `main.js`: `startMatch({mode:'cpu'|'host'|'guest', ...})`; for this task wire `cpu` mode with temporary keyboard input (WASD/arrows + J pass, K shoot, L long, Shift dash) for desktop testing; fixed-timestep loop 60Hz sim, render each rAF.
  - `index.html`: import map `three` → `https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js`, `three/addons/` → `https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/`; viewport `width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover`; portrait overlay 「横にしてください」.

- [ ] **Step 1:** Implement the files above.
- [ ] **Step 2:** Serve locally (`npx http-server -p 8080 -c-1` or `.claude/launch.json` static server) and open in the browser pane at desktop and mobile landscape size (e.g. 812×375).
- [ ] **Step 3: Verify:** 14 colored humanoid models visible and animating, court lines correct, camera follows ball, HUD score/time counts down, keyboard play can pass/shoot/score, goal banner appears, no console errors. Screenshot both sizes.
- [ ] **Step 4:** Commit `feat: 3D rendering and CPU match`.

### Task 6: Touch controls

**Files:**
- Create: `src/input/controls.js`
- Modify: `src/main.js` (replace keyboard-only with touch + keyboard), `index.html`, `css/style.css`
- Test: `tests/controls.test.js`

**Interfaces:**
- Produces: `createControls(root: HTMLElement, opts:{mirror:boolean}): {read(): Input, setMode(mode:'attack'|'defense'): void, destroy(): void}` — floating joystick in left half (appears where touched, radius 60px, dead zone 0.15); buttons bottom-right as in `mockups/controls.png`: シュート (red, large), パス (blue), ロング (green), ダッシュ (orange); in defense mode labels change to 「切替」 (パス) and 「カット」 (シュート); ロング hidden in defense. Touches tracked by `Touch.identifier`; `touchcancel`, `blur`, `visibilitychange`, `resize` release everything. `read()` returns edge events once then clears them; converts screen stick direction to court space (screen right = local team's attack direction; `mirror` flips signs). `navigator.vibrate?.(15)` on button press.
  - Pure helper exported for tests: `stickVector(originX, originY, x, y, radius): {mx:number, mz:number}` and `class TouchTracker` with `down(id, x, y, target)`, `move(id,x,y)`, `up(id)`, `cancelAll()`, `snapshot(): {stick:{mx,mz}|null, held:Set<string>, pressed:Set<string>, released:Set<string>}`.

- [ ] **Step 1: Failing tests:** `stickVector dead zone returns zero`, `stickVector clamps to unit length`, `stick and button touches tracked by identifier` (down id1 on stick, id2 on 'pass', id3 on 'dash'; up id2 → stick still active, 'dash' held, 'pass' in released), `touchcancel releases stick and buttons` (`cancelAll()` → stick null, held empty).
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement `controls.js` and wire into `main.js`; HUD switches control mode from `state.ball.holder` team each frame.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Browser pane at mobile landscape: verify buttons render as in mockup, no page scroll/zoom on touch (`touch-action:none`), labels swap on defense. Screenshot.
- [ ] **Step 6:** Commit `feat: touch controls`.

### Task 7: Networking (PeerJS rooms + host/guest sync)

**Files:**
- Create: `src/net/ice.js`, `src/net/peer.js`, `src/net/sync.js`
- Modify: `src/main.js`
- Test: `tests/sync.test.js`, `tests/peer.test.js`

**Interfaces:**
- Produces:
  - `ice.js`: `export const ICE_SERVERS = [{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun.cloudflare.com:3478'}]`.
  - `peer.js` (PeerJS via `https://cdn.jsdelivr.net/npm/peerjs@1.5.4/+esm`): `createRoom(): Promise<{code:string, waitForGuest(): Promise<Conn>}>` — code = 5 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, peer id `hbx-` + code; retries new code on `unavailable-id`. `joinRoom(code): Promise<Conn>` — rejects with `Error('NOT_FOUND')` on `peer-unavailable` or 8s timeout. `Conn = {send(msg), onMessage(fn), onClose(fn), close()}`; close fires on DataConnection close, peer `disconnected`, or 5s without any message (heartbeat `{t:'ping'}` every 1s). Accept an injectable `PeerCtor` param for tests.
  - `sync.js`: messages `{t:'input', seq, input}` (guest→host, every tick, edge events OR-merged until sent), `{t:'snap', seq, ackSeq, state}` (host→guest at `SNAPSHOT_HZ`, state = compact arrays, numbers rounded to 2 decimals), `{t:'start', hostTeam:0}`, `{t:'rematch'}`.
    - `encodeSnapshot(state): object`, `decodeSnapshot(obj): MatchState`
    - `class SnapshotBuffer { push(snap, recvTime); sample(renderTime): MatchState }` — renders 100ms in the past, linear interpolation of positions; discrete fields from the newer snapshot.
    - `predictControlled(state, input, dt)` — guest moves its controlled player locally with `movePlayer`, blended to authoritative position over 150ms when error > 0.3m, snapped when > 2m.
  - Host is always team 0 in the sim; guest is team 1 and renders with `mirror=true`. On rematch the roles swap over the SAME connection: the side that was guest becomes the simulating host (`{t:'rematch', newHost:'guest'}`), so each player alternates host advantage. Lenient steal for guest: when evaluating a guest steal on the host, use `STEAL_RANGE + 0.3`.
- [ ] **Step 1: Failing tests:** `encode/decode snapshot round-trips positions within 0.01`, `SnapshotBuffer interpolates midway`, `SnapshotBuffer holds last snapshot when starved`, `join fails on unknown room` (fake PeerCtor that emits `error {type:'peer-unavailable'}` → rejects `NOT_FOUND`), `disconnect emits close` (fake conn emits `close` → onClose called once).
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement; wire host/guest modes in `main.js`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Manual: two browser-pane tabs on localhost — tab A 部屋を作る, tab B joins via `?room=CODE`; both see the same match, guest controls team 1, scores agree, closing tab A shows the disconnect message in B.
- [ ] **Step 6:** Commit `feat: P2P rooms and host/guest sync`.

### Task 8: Screens, flow, share, rematch

**Files:**
- Create: `src/ui/screens.js`
- Modify: `index.html`, `css/style.css`, `src/main.js`

**Interfaces:**
- Produces: `showTitle()`, `showLobby(code, url)`, `showJoin()`, `showResult(winner, localTeam, {onRematch, onTitle})`, `showError(message)`.
  - Title: 「ハンドボール対戦」 + 「部屋を作る」「部屋に入る」「CPUと練習」.
  - Lobby: big code, 「招待URLを共有」 (Web Share API `{title, text:'ハンドボールで勝負しよう！', url}`; fallback copy to clipboard + 「コピーしました」), 「相手を待っています…」.
  - Opening `?room=CODE` auto-joins. Errors: 「部屋が見つかりません」, 「相手との接続が切れました」, 「接続できませんでした。Wi-Fiで試すか、しばらくしてからやり直してください」 (ICE failure).
  - Countdown 3-2-1 overlay; result screen with 「もう一度」 (both must press; shows 「相手を待っています…」) and 「タイトルへ」.
  - Request fullscreen + `screen.orientation.lock('landscape')` on first tap where supported (ignore failures).
- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Browser pane: walk title → CPU match → result → rematch; title → create → second tab joins by URL → play → result → both press もう一度 → new match starts with roles swapped. Mobile landscape screenshots.
- [ ] **Step 3:** `npm test` → still PASS.
- [ ] **Step 4:** Commit `feat: screens, sharing and rematch flow`.

### Task 9: Tuning pass + performance check

**Files:** Modify: `src/sim/constants.js` (and AI weights if needed)

- [ ] **Step 1:** Run 5 CPU-vs-CPU matches headless (`node -e` script in scratchpad importing `step`) and record total goals; adjust constants until mean is 10–25 and the Task 4 balance test passes.
- [ ] **Step 2:** In browser pane at mobile size, measure FPS over 30s (log rAF deltas) — must be ≥30 on desktop-emulated mobile; if not, reduce DPR to 1.5 and simplify materials.
- [ ] **Step 3:** `npm test` → PASS. Commit `chore: gameplay tuning`.

### Task 10: Deploy to GitHub Pages (needs the user)

**Files:** Create: `README.md` (Japanese: how to play, how to share)

- [ ] **Step 1:** Ask the user to create a free GitHub account if they have none and to sign in with `gh auth login` in a terminal (they type credentials themselves).
- [ ] **Step 2:** `gh repo create handgame --public --source . --push`.
- [ ] **Step 3:** Enable Pages from `main` / root: `gh api -X POST repos/{owner}/handgame/pages -f "source[branch]=main" -f "source[path]=/"`.
- [ ] **Step 4:** Open `https://<owner>.github.io/handgame/` in the browser pane; verify title loads, CPU match runs, room creation works across two tabs.
- [ ] **Step 5:** Send the URL to the user; ask them to try a real match with their friend on phones. If connection fails on mobile data, propose adding a TURN service (edit only `src/net/ice.js`).
