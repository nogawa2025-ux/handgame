import * as THREE from 'three';
import { C } from '../sim/constants.js';

function courtTexture() {
  const W = 2048, H = 1152; // 44m x 24.75m floor → ~46.5 px/m
  const ppm = W / 44;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const X = (x) => W / 2 + x * ppm, Z = (z) => H / 2 + z * ppm;
  // surround
  g.fillStyle = '#1d5c8f'; g.fillRect(0, 0, W, H);
  // playing court
  g.fillStyle = '#d98a3d'; g.fillRect(X(-20), Z(-10), 40 * ppm, 20 * ppm);
  // subtle wood planks
  g.globalAlpha = 0.07;
  for (let i = 0; i < 40; i++) { g.fillStyle = i % 2 ? '#000' : '#fff'; g.fillRect(X(-20), Z(-10 + i * 0.5), 40 * ppm, 0.5 * ppm); }
  g.globalAlpha = 1;
  // goal areas
  for (const side of [1, -1]) {
    g.fillStyle = '#3d8fd1';
    g.beginPath();
    g.arc(X(side * 20), Z(0), C.GOAL_AREA_R * ppm, side === 1 ? Math.PI / 2 : -Math.PI / 2, side === 1 ? Math.PI * 1.5 : Math.PI / 2);
    g.closePath(); g.fill();
  }
  g.strokeStyle = '#ffffff'; g.lineWidth = 0.08 * ppm;
  g.strokeRect(X(-20), Z(-10), 40 * ppm, 20 * ppm);
  g.beginPath(); g.moveTo(X(0), Z(-10)); g.lineTo(X(0), Z(10)); g.stroke();
  g.beginPath(); g.arc(X(0), Z(0), 1.5 * ppm, 0, Math.PI * 2); g.stroke();
  for (const side of [1, -1]) {
    const a0 = side === 1 ? Math.PI / 2 : -Math.PI / 2, a1 = side === 1 ? Math.PI * 1.5 : Math.PI / 2;
    g.setLineDash([]);
    g.beginPath(); g.arc(X(side * 20), Z(0), C.GOAL_AREA_R * ppm, a0, a1); g.stroke();
    g.setLineDash([0.3 * ppm, 0.25 * ppm]);
    const r9 = C.FREE_THROW_R * ppm;
    g.save();
    g.beginPath(); g.rect(X(-20), Z(-10), 40 * ppm, 20 * ppm); g.clip();
    g.beginPath(); g.arc(X(side * 20), Z(0), r9, a0, a1); g.stroke();
    g.restore();
    g.setLineDash([]);
    // 7m mark
    g.beginPath(); g.moveTo(X(side * 13), Z(-0.5)); g.lineTo(X(side * 13), Z(0.5)); g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function goal(side) {
  const grp = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
  const redMat = new THREE.MeshStandardMaterial({ color: 0xd8262b, roughness: 0.4 });
  const r = 0.05, w = C.GOAL_HALF_W, h = C.GOAL_H;
  const post = (x, y, z, len, axis) => {
    const geo = new THREE.CylinderGeometry(r, r, len, 10);
    const seg = 5;
    const m = new THREE.Mesh(geo, Math.floor((y + z) * seg) % 2 ? redMat : postMat);
    m.position.set(x, y, z);
    if (axis === 'z') m.rotation.x = Math.PI / 2;
    return m;
  };
  grp.add(post(0, h / 2, -w, h), post(0, h / 2, w, h), post(0, h, 0, 2 * w, 'z'));
  const net = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, h, 2 * w),
    new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.25 }),
  );
  net.position.set(side * 0.45, h / 2, 0);
  grp.add(net);
  grp.position.x = side * C.COURT_HALF_X;
  return grp;
}

export function createScene(canvas) {
  const mobile = matchMedia('(pointer:coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile || devicePixelRatio < 2, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.75 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = !mobile;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1b2a);
  scene.fog = new THREE.Fog(0x0d1b2a, 45, 90);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(8, 25, 12);
  sun.castShadow = !mobile;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 14, bottom: -14, near: 1, far: 60 });
  scene.add(sun);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(44, 24.75),
    new THREE.MeshStandardMaterial({ map: courtTexture(), roughness: 0.75 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  scene.add(goal(1), goal(-1));

  // simple stands
  const standMat = new THREE.MeshStandardMaterial({ color: 0x24364d, roughness: 0.9 });
  for (const z of [-15.5, 15.5]) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(46, 1.2, 4), standMat);
    st.position.set(0, 0.6, z);
    scene.add(st);
  }

  const resize = (camera) => {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  return { renderer, scene, resize };
}
