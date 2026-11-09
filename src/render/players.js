import * as THREE from 'three';
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
    let root, mixer = null, actions = {}, arm = null;
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
    return { root, mixer, actions, arm, weights: { idle: 1, walk: 0, run: 0 } };
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

  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffa21a, roughness: 0.5 }));
  ball.castShadow = true;
  scene.add(ball);
  const ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.16, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
  ballShadow.rotation.x = -Math.PI / 2;
  ballShadow.position.y = 0.015;
  scene.add(ballShadow);

  let t = 0;
  return {
    /** Update all views from a MatchState. */
    update(state, dt, localTeam) {
      t += dt;
      state.players.forEach((p, i) => {
        const v = views[i];
        v.root.position.set(p.x, 0, p.z);
        const target = yaw(p.facing);
        let diff = target - v.root.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        v.root.rotation.y += diff * Math.min(1, dt * 14);
        if (!v.mixer) { v.root.position.y = p.anim === 'run' ? Math.abs(Math.sin(t * 12)) * 0.08 : 0; return; }
        const speed = Math.hypot(p.vx, p.vz);
        const want = { idle: speed < 0.6 ? 1 : 0, walk: speed >= 0.6 && speed < 3 ? 1 : 0, run: speed >= 3 ? 1 : 0 };
        for (const k of ['idle', 'walk', 'run']) {
          if (!v.actions[k]) continue;
          v.weights[k] += (want[k] - v.weights[k]) * Math.min(1, dt * 8);
          v.actions[k].setEffectiveWeight(v.weights[k]);
        }
        if (v.actions.run) v.actions.run.setEffectiveTimeScale(Math.max(0.6, speed / 5.5));
        v.mixer.update(dt);
        // throw/shoot pose: raise the right arm briefly
        if (v.arm && (p.anim === 'pass' || p.anim === 'shoot') && p.animTimer > 0) {
          const k = Math.sin(Math.min(1, p.animTimer / (p.anim === 'shoot' ? 0.4 : 0.3)) * Math.PI);
          v.arm.rotation.z += (p.anim === 'shoot' ? 1.6 : 1.0) * k;
          v.arm.rotation.x -= 0.6 * k;
        }
      });
      const c = state.players[state.controlled[localTeam]];
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
