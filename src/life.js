// life.js - extra city life on the water: surfers riding along the shore, seagulls over the beach, sailboats on the horizon.
import * as THREE from 'three';
import { G } from './core.js';

const surfers = [], gulls = [], boats = [];
let t = 0;

export async function init() {
  const seaX = G.world?.seaX ?? -420;
  const boardGeo = new THREE.CapsuleGeometry(0.28, 1.9, 4, 10); boardGeo.rotateX(Math.PI / 2); boardGeo.scale(1, 0.18, 1);
  const boardCols = [0xff5e8a, 0xffd23f, 0x3ddad7, 0xffffff, 0xff8c42, 0x7a5cff];
  const models = ['npc_a', 'npc_c', 'npc_e', 'npc_g', 'npc_i', 'npc_b'];
  for (let i = 0; i < 6; i++) {
    const g = new THREE.Group();
    const board = new THREE.Mesh(boardGeo, new THREE.MeshStandardMaterial({ color: boardCols[i], roughness: 0.35 })); board.position.y = 0.06; g.add(board);
    let mixer = null;
    try {
      const gltf = await G.assets.loadGLB(`assets/chars/${models[i]}.glb`), body = G.assets.clone(gltf);
      body.traverse((o) => { if (o.isSkinnedMesh) o.frustumCulled = false; });
      body.rotation.y = Math.PI / 2; body.position.y = 0.1; g.add(body);
      const clip = THREE.AnimationClip.findByName(gltf.animations, i % 2 ? 'celebrate' : 'idle');
      if (clip) { mixer = new THREE.AnimationMixer(body); const a = mixer.clipAction(clip); a.play(); a.timeScale = 0.6; }
    } catch (e) { /* board only */ }
    G.scene.add(g);
    surfers.push({ g, mixer, x: seaX - 14 - i * 9, z: -260 + i * 95, dir: i % 2 ? 1 : -1, sp: 5 + i * 0.7, ph: i * 1.7 });
  }
  const wing = new THREE.BufferGeometry();
  wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.25, 0, 0, -0.25, 1.1, 0.12, 0, 0, 0, 0.25, -1.1, 0.12, 0, 0, 0, -0.25], 3)); wing.computeVertexNormals();
  const gullMat = new THREE.MeshBasicMaterial({ color: 0xf6f6f2, side: THREE.DoubleSide });
  for (let i = 0; i < 16; i++) { const m = new THREE.Mesh(wing, gullMat); G.scene.add(m); gulls.push({ m, cx: seaX + 20 + (i % 4) * 22, cz: -300 + i * 42, r: 14 + (i % 5) * 6, h: 16 + (i % 6) * 4, sp: 0.35 + (i % 3) * 0.12, ph: i * 2.1 }); }
  const hullGeo = new THREE.BoxGeometry(2.6, 1.1, 8), sailGeo = new THREE.ConeGeometry(2.6, 9, 3), hullMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
  for (let i = 0; i < 6; i++) {
    const b = new THREE.Group(), h = new THREE.Mesh(hullGeo, hullMat), s = new THREE.Mesh(sailGeo, new THREE.MeshStandardMaterial({ color: boardCols[(i + 2) % 6], roughness: 0.8 }));
    s.position.y = 5.6; s.scale.z = 0.15; b.add(h, s); G.scene.add(b); boats.push({ b, x: seaX - 120 - i * 55, z: -500 + i * 190, sp: 1.2 + i * 0.3, ph: i });
  }
}

function step(dt) {
  t += dt;
  for (const s of surfers) {
    s.z += s.dir * s.sp * dt; if (s.z > 520) s.dir = -1; if (s.z < -520) s.dir = 1;
    const wave = Math.sin(t * 1.3 + s.ph);
    s.g.position.set(s.x + Math.sin(t * 0.4 + s.ph) * 5, -0.36 + wave * 0.14, s.z);
    s.g.rotation.set(wave * 0.06, s.dir > 0 ? 0 : Math.PI, Math.sin(t * 0.9 + s.ph) * 0.14);
    if (s.mixer) s.mixer.update(dt);
  }
  for (const q of gulls) {
    const a = t * q.sp + q.ph; q.m.position.set(q.cx + Math.cos(a) * q.r, q.h + Math.sin(a * 2.3) * 1.5, q.cz + Math.sin(a) * q.r);
    q.m.rotation.set(0, -a, 0); q.m.scale.y = 1 + Math.sin(t * 7 + q.ph) * 2.2;
  }
  for (const o of boats) { o.z += o.sp * dt; if (o.z > 700) o.z = -700; o.b.position.set(o.x, -0.2 + Math.sin(t * 0.8 + o.ph) * 0.15, o.z); o.b.rotation.z = Math.sin(t * 0.7 + o.ph) * 0.05; }
}
export function update(dt) { step(dt); }
export function updatePaused(dt) { step(dt); }
