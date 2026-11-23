// world_lite.js - compact fallback city (used when world.js is missing). Implements the full G.world contract.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G } from './core.js';

const XS = [-330, -220, -110, 0, 110, 220, 330, 440];
const XN = ['הירקון', 'בן יהודה', 'דיזנגוף', 'ריינס', 'אבן גבירול', 'ויצמן', 'דרך בגין', 'איילון'];
const ZS = [-600, -480, -360, -240, -120, 0, 120, 240, 360, 480, 600];
const ZN = ['יורדי הסירה', 'נורדאו', 'ארלוזורוב', 'גורדון', 'פרישמן', 'בוגרשוב', 'אלנבי', 'שדרות רוטשילד', 'דרך יפו', 'סלמה', 'יפת'];
const HALF = 7, SETBACK = 12, SEA = -424, SAND0 = -415;
const BOUNDS = { minX: -470, maxX: 452, minZ: -612, maxZ: 612 };
let seed = 1337;
const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const colliders = [], nightMats = [];
let glassMat = null;

function box(list, cx, cz, w, d, h, T = 9, y0 = 0) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
  for (let i = 0; i < 24; i++) {
    if (i >= 8 && i < 16) { uv.setXY(i, 0.01, 0.01); continue; }
    const wide = (i < 8) ? d : w;
    uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(wide / T)), uv.getY(i) * Math.max(1, Math.round(h / T)));
  }
  g.translate(cx, y0 + h / 2, cz); list.push(g);
  colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, h: y0 + h });
}
const tex = (url, o) => G.assets.loadTexture(url, o).catch(() => null);
async function facade(name, tint) {
  const [c, n, e] = await Promise.all([tex(`assets/tex/${name}/color.jpg`, { repeat: [1, 1] }), tex(`assets/tex/${name}/normal.jpg`, { srgb: false, repeat: [1, 1] }), tex(`assets/tex/${name}/emis.jpg`, { repeat: [1, 1] })]);
  const m = new THREE.MeshStandardMaterial({ map: c, normalMap: n, color: tint || 0xffffff, roughness: 0.82, metalness: 0.05 });
  if (e) { m.emissiveMap = e; m.emissive = new THREE.Color(0xffd9a0); m.emissiveIntensity = 0; nightMats.push(m); }
  return m;
}
function mesh(geos, mat, shadow = true) {
  if (!geos.length) return null;
  const m = new THREE.Mesh(mergeGeometries(geos, false), mat); m.castShadow = shadow; m.receiveShadow = true; G.scene.add(m); return m;
}
function flat(x0, x1, z0, z1, y, ru, rv) {
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0); g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  const uv = g.attributes.uv; for (let i = 0; i < 4; i++) uv.setXY(i, uv.getX(i) * ru, uv.getY(i) * rv); return g;
}

export async function init() {
  const scene = G.scene;
  // ---------------- ground, roads, beach
  const [pave, paveN, road, roadN, tile] = await Promise.all([
    tex('assets/tex/PavingStones128/color.jpg', { repeat: [1, 1] }), tex('assets/tex/PavingStones128/normal.jpg', { srgb: false, repeat: [1, 1] }),
    tex('assets/tex/Road012A/color.jpg', { repeat: [1, 1] }), tex('assets/tex/Road012A/normal.jpg', { srgb: false, repeat: [1, 1] }),
    tex('assets/tex/Tiles107/color.jpg', { repeat: [1, 1] })]);
  const ground = new THREE.Mesh(flat(SAND0 + 50, 1300, -1500, 1500, 0, 400, 750), new THREE.MeshStandardMaterial({ map: pave, normalMap: paveN, roughness: 0.9, color: 0xd8d2c6 }));
  ground.receiveShadow = true; scene.add(ground);
  const roadGeos = [];
  for (const x of XS) roadGeos.push(flat(x - HALF, x + HALF, -640, 640, 0.03, 2, 180));
  for (const z of ZS) roadGeos.push(flat(XS[0] - HALF, XS[XS.length - 1] + HALF, z - HALF, z + HALF, 0.045, 110, 2));
  const roadMesh = mesh(roadGeos, new THREE.MeshStandardMaterial({ map: road, normalMap: roadN, roughness: 0.85, color: 0x9a9a9a }), false);
  if (roadMesh) roadMesh.material.polygonOffset = true, roadMesh.material.polygonOffsetFactor = -1;
  // dashed centre lines
  const cv = document.createElement('canvas'); cv.width = 8; cv.height = 64; const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, 8, 34);
  const dash = new THREE.CanvasTexture(cv); dash.wrapS = dash.wrapT = THREE.RepeatWrapping;
  const lineGeos = [];
  for (const x of XS) lineGeos.push(flat(x - 0.14, x + 0.14, -640, 640, 0.075, 1, 210));
  for (const z of ZS) { const g = flat(-0.14, 0.14, -400, 400, 0.085, 1, 130); g.rotateY(Math.PI / 2); g.translate((XS[0] + XS[XS.length - 1]) / 2, 0, z); lineGeos.push(g); }
  const lm = mesh(lineGeos, new THREE.MeshStandardMaterial({ map: dash, transparent: true, alphaTest: 0.5, color: 0xd8d8cc, roughness: 0.8 }), false); if (lm) lm.receiveShadow = false;
  // crosswalk stripes at every intersection
  const zebra = [];
  for (const x of XS) for (const z of ZS) for (let k = -5; k <= 5; k += 2) {
    zebra.push(flat(x + k * 1.1 - 0.4, x + k * 1.1 + 0.4, z + HALF + 0.6, z + HALF + 3.4, 0.09, 1, 1));
    zebra.push(flat(x + HALF + 0.6, x + HALF + 3.4, z + k * 1.1 - 0.4, z + k * 1.1 + 0.4, 0.09, 1, 1));
  }
  const zm = mesh(zebra, new THREE.MeshStandardMaterial({ color: 0xcfcfc6, roughness: 0.8 }), false); if (zm) zm.receiveShadow = false;
  // promenade + sand (slopes into the sea)
  const prom = new THREE.Mesh(flat(-366, XS[0] - HALF, -1500, 1500, 0.035, 7, 750), new THREE.MeshStandardMaterial({ map: tile, roughness: 0.6, color: 0xf0e2d0 }));
  prom.receiveShadow = true; scene.add(prom);
  const sg = new THREE.PlaneGeometry(240, 3000, 48, 1); sg.rotateX(-Math.PI / 2); sg.translate(-486, 0, 0);
  const sp = sg.attributes.position; for (let i = 0; i < sp.count; i++) { const x = sp.getX(i); sp.setY(i, x > SAND0 ? 0.02 : 0.02 + (x - SAND0) * 0.045); }
  sg.computeVertexNormals();
  const sand = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: 0xecd9ab, roughness: 1 })); sand.receiveShadow = true; scene.add(sand);

  // ---------------- buildings
  const names = ['Facade002', 'Facade009', 'Facade013', 'Facade017', 'Facade018A', 'Facade020B'];
  const mats = await Promise.all([...names.map((n) => facade(n)), facade('Facade013', 0xe8c890), facade('Facade017', 0xff9ec4), facade('Facade009', 0x9be0d0)]);
  const lists = mats.map(() => []), glass = [], roofs = [];
  glassMat = new THREE.MeshStandardMaterial({ color: 0x86b4d6, metalness: 0.9, roughness: 0.1, emissive: 0xffc988, emissiveIntensity: 0 });
  for (let i = 0; i < XS.length - 1; i++) for (let j = 0; j < ZS.length - 1; j++) {
    const x0 = XS[i] + SETBACK, x1 = XS[i + 1] - SETBACK, z0 = ZS[j] + SETBACK, z1 = ZS[j + 1] - SETBACK;
    if (i === 6 && j === 4) continue;                       // the three towers block
    const biz = i >= 5 && j >= 3 && j <= 6, jaffa = i <= 1 && j >= 9, flor = j >= 8 && !jaffa;
    const w = (x1 - x0 - 6) / 2, d = (z1 - z0 - 6) / 2;
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
      const iw = w - rnd() * 5, id = d - rnd() * 5;
      const cxx = x0 + w / 2 + a * (w + 6), czz = z0 + d / 2 + b * (d + 6);
      if (biz && rnd() < 0.55) { box(glass, cxx, czz, iw - 6, id - 6, 45 + rnd() * 90, 9); continue; }
      const h = jaffa ? 9 + rnd() * 6 : 12 + Math.floor(rnd() * 5) * 3.2;
      const mi = jaffa ? 6 : flor ? 7 + ((rnd() * 2) | 0) : (rnd() * 6) | 0;
      box(lists[mi], cxx, czz, iw, id, h);
      const rg = new THREE.BoxGeometry(iw + 0.6, 0.5, id + 0.6); rg.translate(cxx, h + 0.25, czz); roofs.push(rg);
      if (rnd() < 0.7) { const t = new THREE.CylinderGeometry(0.5, 0.5, 1.4, 8); t.translate(cxx + (rnd() - 0.5) * iw * 0.6, h + 1.3, czz + (rnd() - 0.5) * id * 0.6); roofs.push(t.toNonIndexed ? t : t); }
    }
  }
  // three signature towers: round, triangular, square
  const tw = [];
  const c1 = new THREE.CylinderGeometry(21, 21, 187, 40); c1.translate(362, 93.5, -88); tw.push(c1); colliders.push({ minX: 343, maxX: 381, minZ: -107, maxZ: -69, h: 187 });
  const c2 = new THREE.CylinderGeometry(25, 25, 169, 3); c2.translate(410, 84.5, -84); tw.push(c2); colliders.push({ minX: 391, maxX: 429, minZ: -104, maxZ: -64, h: 169 });
  const c3 = new THREE.BoxGeometry(36, 154, 36); c3.translate(386, 77, -34); tw.push(c3.toNonIndexed()); colliders.push({ minX: 368, maxX: 404, minZ: -52, maxZ: -16, h: 154 });
  for (const g of tw) { const m = new THREE.Mesh(g, glassMat); m.castShadow = true; scene.add(m); }
  // Jaffa clock tower + far skyline (outside the playable bounds)
  box(lists[6], -352, 560, 6, 6, 27); box(lists[6], -352, 560, 3.4, 3.4, 5, 9, 27);
  const nc = colliders.length;
  for (let k = 0; k < 46; k++) { const far = k < 26; box(glass, far ? 480 + rnd() * 150 : -300 + rnd() * 760, far ? -650 + rnd() * 1300 : (k % 2 ? 650 + rnd() * 80 : -650 - rnd() * 80), 22 + rnd() * 16, 22 + rnd() * 16, 30 + rnd() * 120); }
  colliders.length = nc;
  lists.forEach((l, i) => mesh(l, mats[i]));
  mesh(glass, glassMat);
  mesh(roofs.map((g) => (g.index ? g.toNonIndexed() : g)), new THREE.MeshStandardMaterial({ color: 0xe9e6df, roughness: 0.9 }));

  // ---------------- street lamps (emissive bulbs), beach umbrellas, palms, billboards
  const lampPts = [];
  for (const x of XS) for (let z = -590; z <= 590; z += 40) { if (ZS.some((s) => Math.abs(s - z) < 9)) continue; lampPts.push([x - 8.2, z], [x + 8.2, z + 20]); }
  const dummy = new THREE.Object3D();
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.13, 6.5, 6), new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.5, metalness: 0.6 }), lampPts.length);
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff1cc, emissive: 0xffc56e, emissiveIntensity: 0 }); nightMats.push(bulbMat); bulbMat.userData.k = 4;
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.32, 8, 6), bulbMat, lampPts.length);
  lampPts.forEach(([x, z], i) => { dummy.position.set(x, 3.25, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); poles.setMatrixAt(i, dummy.matrix); dummy.position.y = 6.6; dummy.updateMatrix(); bulbs.setMatrixAt(i, dummy.matrix); });
  scene.add(poles, bulbs);
  const NU = 70, um = new THREE.InstancedMesh(new THREE.ConeGeometry(2.3, 0.9, 10), new THREE.MeshStandardMaterial({ roughness: 0.8 }), NU);
  const up = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 5), new THREE.MeshStandardMaterial({ color: 0xffffff }), NU);
  const cols = [0xff5e5e, 0xffb347, 0x4fc3f7, 0xffffff, 0xff7eb6, 0x7ee081], col = new THREE.Color();
  for (let i = 0; i < NU; i++) {
    const x = -410 + rnd() * 38, z = -560 + rnd() * 1120;
    dummy.position.set(x, 2.6, z); dummy.rotation.set((rnd() - 0.5) * 0.2, rnd() * 6, 0); dummy.updateMatrix(); um.setMatrixAt(i, dummy.matrix); um.setColorAt(i, col.setHex(cols[(rnd() * cols.length) | 0]));
    dummy.position.y = 1.2; dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); up.setMatrixAt(i, dummy.matrix);
  }
  um.castShadow = true; scene.add(um, up);
  try {
    const gl = await G.assets.loadGLB('assets/props/palm.glb'); let src = null; gl.scene.traverse((o) => { if (o.isMesh && !src) src = o; });
    if (src) {
      const pts = []; for (let z = -600; z <= 600; z += 24) pts.push([-354 + (rnd() - 0.5) * 3, z + rnd() * 6]);
      for (let z = -100; z <= 100; z += 40) pts.push([-372, z + 12]);
      const pm = new THREE.InstancedMesh(src.geometry, src.material, pts.length);
      pts.forEach(([x, z], i) => { const s = 5.2 + rnd() * 1.6; dummy.position.set(x, 0.84 * s, z); dummy.rotation.set(0, rnd() * 6.28, 0); dummy.scale.set(s, s, s); dummy.updateMatrix(); pm.setMatrixAt(i, dummy.matrix); });
      pm.castShadow = true; scene.add(pm); dummy.scale.set(1, 1, 1);
    }
  } catch (e) { /* palms are optional */ }
  for (let k = 0; k < 8; k++) {
    const url = `assets/gen/billboard_0${k + 1}.png`; const t = await tex(url); if (!t) continue;
    const x = XS[(k % 4) + 0] + 9.5, z = ZS[1 + k] + (k % 2 ? 9.5 : -9.5);
    const m = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.15, side: THREE.DoubleSide, roughness: 0.6 }); m.userData.k = 0.9; m.userData.base = 0.15; nightMats.push(m);
    const b = new THREE.Mesh(new THREE.PlaneGeometry(13, 6.5), m); b.position.set(x, 10.5, z); b.rotation.y = k % 2 ? Math.PI / 2 : 0; scene.add(b);
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 7.5, 8), poles.material); p.position.set(x, 3.75, z); scene.add(p);
  }

  // ---------------- road graph + API
  const NZ = ZS.length, nodes = [];
  XS.forEach((x, i) => ZS.forEach((z, j) => { const links = []; if (i > 0) links.push((i - 1) * NZ + j); if (i < XS.length - 1) links.push((i + 1) * NZ + j); if (j > 0) links.push(i * NZ + j - 1); if (j < NZ - 1) links.push(i * NZ + j + 1); nodes.push({ id: i * NZ + j, x, z, links }); }));
  const parkingSpots = [{ x: XS[0] - 5.6, z: 14, heading: 0 }, { x: XS[0] - 5.6, z: 26, heading: 0 }];
  for (const x of XS) for (let j = 0; j < NZ - 1; j++) for (let z = ZS[j] + 24; z < ZS[j + 1] - 20; z += 18) { if (rnd() < 0.45) parkingSpots.push({ x: x - 5.6, z, heading: 0 }); if (rnd() < 0.45) parkingSpots.push({ x: x + 5.6, z, heading: Math.PI }); }
  const corner = (i, j, sx = 1, sz = 1) => ({ x: XS[i] + sx * 9.5, z: ZS[j] + sz * 9.5 });
  const L = (p, name) => ({ ...p, name });
  const world = {
    bounds: BOUNDS, seaX: SEA, colliders, parkingSpots,
    spawn: { x: -343, z: 10, heading: -Math.PI / 2 },
    roads: { nodes, laneOffset: 3.5, halfWidth: HALF },
    landmarks: {
      dizengoff: L(corner(2, 4), 'כיכר דיזנגוף'), azrieli: L(corner(6, 5, 1, -1), 'המגדלים'), rothschild: L(corner(3, 7), 'שדרות רוטשילד'),
      beach: L({ x: -385, z: 0 }, 'חוף גורדון'), jaffa: L({ x: -343, z: 566 }, 'מגדל השעון, יפו'), carmel: L(corner(1, 6), 'שוק הכרמל'),
      port: L({ x: -345, z: -590 }, 'נמל תל אביב'), sarona: L(corner(5, 5), 'שרונה'), habima: L(corner(4, 6), 'הבימה'), florentin: L(corner(3, 9), 'פלורנטין'),
      hospital: L(corner(4, 3), 'איכילוב'), police: L(corner(2, 5), 'תחנת דיזנגוף'),
    },
    resolveCircle(p, r) {
      let hit = null;
      for (let i = 0; i < colliders.length; i++) {
        const c = colliders[i];
        if (p.x < c.minX - r || p.x > c.maxX + r || p.z < c.minZ - r || p.z > c.maxZ + r) continue;
        const qx = Math.max(c.minX, Math.min(c.maxX, p.x)), qz = Math.max(c.minZ, Math.min(c.maxZ, p.z));
        let dx = p.x - qx, dz = p.z - qz; const d2 = dx * dx + dz * dz;
        if (d2 > r * r) continue;
        if (d2 > 1e-8) { const d = Math.sqrt(d2); dx /= d; dz /= d; p.x = qx + dx * r; p.z = qz + dz * r; hit = { nx: dx, nz: dz }; } else {
          const l = p.x - c.minX, rr = c.maxX - p.x, t = p.z - c.minZ, b = c.maxZ - p.z, m = Math.min(l, rr, t, b);
          if (m === l) { p.x = c.minX - r; hit = { nx: -1, nz: 0 }; } else if (m === rr) { p.x = c.maxX + r; hit = { nx: 1, nz: 0 }; } else if (m === t) { p.z = c.minZ - r; hit = { nx: 0, nz: -1 }; } else { p.z = c.maxZ + r; hit = { nx: 0, nz: 1 }; }
        }
      }
      if (p.x < BOUNDS.minX + r) { p.x = BOUNDS.minX + r; hit = { nx: 1, nz: 0 }; } if (p.x > BOUNDS.maxX - r) { p.x = BOUNDS.maxX - r; hit = { nx: -1, nz: 0 }; }
      if (p.z < BOUNDS.minZ + r) { p.z = BOUNDS.minZ + r; hit = { nx: 0, nz: 1 }; } if (p.z > BOUNDS.maxZ - r) { p.z = BOUNDS.maxZ - r; hit = { nx: 0, nz: -1 }; }
      return hit;
    },
    blocked(x, z, r = 0) {
      if (x < BOUNDS.minX + r || x > BOUNDS.maxX - r || z < BOUNDS.minZ + r || z > BOUNDS.maxZ - r) return true;
      for (let i = 0; i < colliders.length; i++) { const c = colliders[i]; if (x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r) return true; }
      return false;
    },
    raycast(o, d, maxDist = 200) {
      let best = maxDist, bn = null;
      for (let i = 0; i < colliders.length; i++) {
        const c = colliders[i]; let t0 = 0, t1 = best, ax = -1;
        const mn = [c.minX, 0, c.minZ], mx = [c.maxX, c.h, c.maxZ], oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z]; let ok = true;
        for (let a = 0; a < 3; a++) {
          if (Math.abs(dd[a]) < 1e-9) { if (oo[a] < mn[a] || oo[a] > mx[a]) { ok = false; break; } continue; }
          let ta = (mn[a] - oo[a]) / dd[a], tb = (mx[a] - oo[a]) / dd[a]; if (ta > tb) { const s = ta; ta = tb; tb = s; }
          if (ta > t0) { t0 = ta; ax = a; } if (tb < t1) t1 = tb; if (t0 > t1) { ok = false; break; }
        }
        if (ok && ax >= 0 && t0 < best) { best = t0; bn = new THREE.Vector3(ax === 0 ? -Math.sign(dd[0]) : 0, ax === 1 ? -Math.sign(dd[1]) : 0, ax === 2 ? -Math.sign(dd[2]) : 0); }
      }
      return bn ? { dist: best, point: new THREE.Vector3(o.x + d.x * best, o.y + d.y * best, o.z + d.z * best), normal: bn } : null;
    },
    groundY: (x) => (x >= SAND0 ? 0 : (x - SAND0) * 0.045),
    surfaceAt(x, z) {
      if (x < SEA) return 'water'; if (x < -366) return 'sand'; if (x < XS[0] - HALF) return 'plaza';
      for (const s of XS) if (Math.abs(x - s) <= HALF) return 'road';
      for (const s of ZS) if (Math.abs(z - s) <= HALF && x <= XS[XS.length - 1] + HALF) return 'road';
      return world.blocked(x, z, 0) ? 'building' : 'sidewalk';
    },
    nearestNode(x, z) { let b = nodes[0], bd = 1e18; for (const n of nodes) { const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; b = n; } } return b; },
    randomRoadPoint(near, minD = 0, maxD = 1e9) {
      let out = null;
      for (let k = 0; k < 80; k++) {
        const a = nodes[(Math.random() * nodes.length) | 0], b = nodes[a.links[(Math.random() * a.links.length) | 0]], t = 0.15 + Math.random() * 0.7;
        const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz), fx = dx / len, fz = dz / len;
        out = { x: a.x + dx * t - fz * 3.5, z: a.z + dz * t + fx * 3.5, heading: Math.atan2(fx, fz), nodeA: a, nodeB: b };
        if (!near) return out; const dist = Math.hypot(out.x - near.x, out.z - near.z); if (dist >= minD && dist <= maxD) return out;
      }
      return out;
    },
    randomSidewalkPoint(near, minD, maxD) {
      for (let k = 0; k < 12; k++) {
        const p = world.randomRoadPoint(near, minD, maxD), fx = Math.sin(p.heading), fz = Math.cos(p.heading);
        const q = { x: p.x - fz * 6, z: p.z + fx * 6, heading: p.heading }; if (!world.blocked(q.x, q.z, 0.5)) return q;
      }
      const p = world.randomRoadPoint(near, minD, maxD); return { x: p.x, z: p.z, heading: p.heading };
    },
    path(from, to) {
      const f = typeof from === 'object' ? from.id : from, t = typeof to === 'object' ? to.id : to; if (f === t) return [f];
      const prev = new Int32Array(nodes.length).fill(-1), q = [f]; prev[f] = f;
      for (let h = 0; h < q.length; h++) { const n = q[h]; if (n === t) break; for (const l of nodes[n].links) if (prev[l] < 0) { prev[l] = n; q.push(l); } }
      if (prev[t] < 0) return [f]; const out = [t]; let c = t; while (c !== f) { c = prev[c]; out.push(c); } return out.reverse();
    },
    districtAt(x, z) {
      if (x < -366) return 'חוף הים'; if (z < -480 && x < -110) return 'נמל תל אביב'; if (z > 480 && x < -110) return 'יפו העתיקה'; if (z > 360) return 'פלורנטין';
      if (x >= 220 && Math.abs(z) <= 240) return x >= 330 ? 'מתחם המגדלים' : 'שרונה'; if (z < -240) return 'הצפון הישן';
      if (z > 120 && x < -110) return 'שוק הכרמל'; if (z > 120) return 'שדרות רוטשילד'; return 'לב העיר';
    },
    streetAt(x, z) { let b = '', bd = 1e9; XS.forEach((s, i) => { const d = Math.abs(x - s); if (d < bd) { bd = d; b = XN[i]; } }); ZS.forEach((s, i) => { const d = Math.abs(z - s); if (d < bd) { bd = d; b = ZN[i]; } }); return x < -345 ? 'הטיילת' : b; },
  };
  G.world = world;
}

export function update() { applyNight(); }
export function updatePaused() { applyNight(); }
function applyNight() {
  const nf = G.sky?.nightFactor ?? (G.sky?.isNight ? 1 : 0);
  for (const m of nightMats) m.emissiveIntensity = (m.userData.base || 0) + nf * (m.userData.k || 1.5);
  if (glassMat) glassMat.emissiveIntensity = nf * 0.12;
}
