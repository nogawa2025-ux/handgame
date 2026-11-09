import * as THREE from 'three';
import { C } from '../sim/constants.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const MODEL_URL = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/models/gltf/Xbot.glb';
const COLORS = { field: [0x2a5bd7, 0xd33a3a], gk: [0xf2c200, 0x7a3fd1] };

/** Sim facing (angle in x–z plane) → three.js rotation.y for a model facing +z. */
const yaw = (facing) => Math.PI / 2 - facing;

function fallbackModel(color) {
  // capsule-ish humanoid when the GLB cannot be loaded
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.8, 4, 8), mat);
  body.position.y = 1.0;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), new THREE.MeshStandardMaterial({ color: 0xf0c9a0 }));
  head.position.y = 1.65;
  g.add(body, head);
  return g;
}

export async function loadPlayers(scene, players) {
  let gltf = null;
  try { gltf = await new GLTFLoader().loadAsync(MODEL_URL); } catch (e) { console.warn('model load failed, using fallback', e); }

  const views = players.map((p) => {
    const color = COLORS[p.role][p.team];
    let root, mixer = null, actions = {}, arm = null, armL = null;
    if (gltf) {
      root = cloneSkinned(gltf.scene);
      root.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.frustumCulled = false;
          const m = o.material.clone();
          if (/Surface/i.test(o.name)) m.color.setHex(color);
          else m.color.setHex(0xeeeeee);
          o.material = m;
        }
        if (o.isBone && o.name === 'mixamorigRightArm') arm = o;
        if (o.isBone && o.name === 'mixamorigLeftArm') armL = o;
      });
      mixer = new THREE.AnimationMixer(root);
      for (const clip of gltf.animations) {
        if (['idle', 'walk', 'run'].includes(clip.name)) {
          const a = mixer.clipAction(clip);
          a.play();
          a.setEffectiveWeight(clip.name === 'idle' ? 1 : 0);
          actions[clip.name] = a;
        }
      }
      mixer.update(Math.random()); // desync identical animations
    } else {
      root = fallbackModel(color);
    }
    scene.add(root);
    return { root, mixer, actions, arm, armL, weights: { idle: 1, walk: 0, run: 0 } };
  });

  // controlled-player marker: ring on the floor + triangle above the head
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.45, 0.6, 32),
    new THREE.MeshBasicMaterial({ color: 0xffe600, transparent: true, opacity: 0.9, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 3), new THREE.MeshBasicMaterial({ color: 0xffe600 }));
  arrow.rotation.x = Math.PI;
  scene.add(ring, arrow);

  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), new THREE.MeshStandardMaterial({ color: 0xf2cf14, roughness: 0.55 }));
  ball.castShadow = true;
  scene.add(ball);
  const ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.16, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
  ballShadow.rotation.x = -Math.PI / 2;
  ballShadow.position.y = 0.015;
  scene.add(ballShadow);

  // aiming target on the goal mouth (only for the local shooter)
  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.12, 0.2, 24),
    new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.95, depthTest: false, side: THREE.DoubleSide }),
  );
  reticle.renderOrder = 10;
  reticle.visible = false;
  scene.add(reticle);

  let t = 0;
  return {
    /** Update all views from a MatchState. aim: local shooter's {z, h} or null. */
    update(state, dt, localTeam, aim = null) {
      const shooting = aim && state.duel && state.duel.team === localTeam;
      reticle.visible = !!shooting;
      if (shooting) {
        const d = localTeam === 0 ? 1 : -1;
        reticle.position.set(d * (C.COURT_HALF_X + 0.05), C.SHOT_Y_MID + aim.h * C.AIM_REACH * C.SHOT_Y_RANGE, aim.z * C.AIM_REACH * C.GOAL_HALF_W);
        reticle.rotation.set(0, Math.PI / 2, 0);
        const pulse = 1 + Math.sin(t * 10) * 0.08;
        reticle.scale.set(pulse, pulse, pulse);
      }
      t += dt;
      state.players.forEach((p, i) => {
        const v = views[i];
        const jt = p.jump > 0 ? 1 - p.jump / C.JUMP_TIME : 0; // 0→1 through the jump
        v.root.position.set(p.x, p.jump > 0 ? 4 * C.JUMP_H * jt * (1 - jt) : 0, p.z);
        // keeper's read: shift and tilt toward the side it covers, crouch for low balls
        const lz = p.role === 'gk' ? (p.leanZ ?? 0) : 0, lh = p.role === 'gk' ? (p.leanH ?? 0) : 0;
        v.root.position.z += lz * 0.3;
        v.root.rotation.z = lz * 0.32 * (p.team === 0 ? 1 : -1);
        if (lh < 0) v.root.position.y += lh * 0.18;
        const target = yaw(p.facing);
        let diff = target - v.root.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        v.root.rotation.y += diff * Math.min(1, dt * 14);
        if (!v.mixer) { if (!(p.jump > 0)) v.root.position.y = p.anim === 'run' ? Math.abs(Math.sin(t * 12)) * 0.08 : 0; return; }
        const speed = Math.hypot(p.vx, p.vz);
        const want = { idle: speed < 0.6 ? 1 : 0, walk: speed >= 0.6 && speed < 3 ? 1 : 0, run: speed >= 3 ? 1 : 0 };
        for (const k of ['idle', 'walk', 'run']) {
          if (!v.actions[k]) continue;
          v.weights[k] += (want[k] - v.weights[k]) * Math.min(1, dt * 8);
          v.actions[k].setEffectiveWeight(v.weights[k]);
        }
        if (v.actions.run) v.actions.run.setEffectiveTimeScale(Math.max(0.6, speed / 5.5));
        v.mixer.update(dt);
        // blocking defenders and a keeper reading high: both arms up; reading low: arms out
        const up = p.armsUp ? 1 : p.role === 'gk' ? Math.max(0, lh) : 0;
        const out = p.role === 'gk' ? Math.max(0, -lh) * 0.8 + 0.25 : 0;
        if (v.arm && v.armL && (up > 0 || out > 0)) {
          v.arm.rotation.z += 1.5 * up + out; v.armL.rotation.z -= 1.5 * up + out;
        }
        // throw/shoot pose: raise the right arm briefly
        if (v.arm && (p.anim === 'pass' || p.anim === 'shoot') && p.animTimer > 0) {
          const k = Math.sin(Math.min(1, p.animTimer / (p.anim === 'shoot' ? 0.4 : 0.3)) * Math.PI);
          v.arm.rotation.z += (p.anim === 'shoot' ? 1.6 : 1.0) * k;
          v.arm.rotation.x -= 0.6 * k;
        }
      });
      const c = state.players[state.controlled[localTeam]];
      ring.visible = arrow.visible = !state.duel; // markers would sit in front of the goal in the duel view
      if (c) {
        ring.position.x = c.x; ring.position.z = c.z;
        arrow.position.set(c.x, 2.25 + Math.sin(t * 6) * 0.06, c.z);
      }
      const b = state.ball;
      ball.position.set(b.x, b.y, b.z);
      ballShadow.position.x = b.x; ballShadow.position.z = b.z;
    },
  };
}
