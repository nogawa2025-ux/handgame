import * as THREE from 'three';

/**
 * Broadcast-style camera on the side line. When `mirror` is true the camera sits
 * on the opposite side so the local team (team 1) also attacks to the right.
 */
export function createCamera() {
  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 200);
  const focus = new THREE.Vector3(0, 0, 0);
  let first = true;
  return {
    camera,
    follow(state, dt, mirror) {
      const b = state.ball;
      const narrow = innerWidth / innerHeight < 1.9;
      const tx = Math.max(-13, Math.min(13, b.x));
      const tz = b.z * 0.3;
      const k = first ? 1 : Math.min(1, dt * 3);
      first = false;
      focus.x += (tx - focus.x) * k;
      focus.z += (tz - focus.z) * k;
      const side = mirror ? -1 : 1;
      const dist = narrow ? 15 : 13.5;
      camera.position.set(focus.x, dist * 0.72, focus.z + side * dist);
      camera.lookAt(focus.x, 0, focus.z + side * 1.5);
    },
  };
}
