// world.js - the static city of TLV NONSTOP: geometry, collision, road graph (G.world).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G } from './core.js';

// ------------------------------------------------------------------ layout
const XL = [-320, -210, -100, 10, 120, 230, 340, 450];                    // north-south streets (x of centre line)
const ZL = [-600, -480, -360, -240, -120, 0, 120, 240, 360, 480];         // east-west streets (z of centre line)
const XN = ['הירקון', 'בן יהודה', 'דיזנגוף', 'ריינס', 'אבן גבירול', 'ויצמן', 'דרך נמיר', 'נתיבי איילון'];
const ZN = ['שדרות נורדאו', 'ארלוזורוב', 'גורדון', 'פרישמן', 'בוגרשוב', 'אלנבי', 'שדרות רוטשילד', 'דרך יפו', 'אילת', 'סלמה'];
const NX = XL.length, NZ = ZL.length;
const HW = 7, SW = 4.5, LANE = 2.6, SEA = -420, BEACH = -360, PROM = XL[0] - HW;
const BOUNDS = { minX: -470, maxX: 532, minZ: -696, maxZ: 578 };
const PI = Math.PI;

// seeded RNG (identical city every run)
let seed = 20261123;
function R() { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const rr = (a, b) => a + R() * (b - a), ri = (a, b) => Math.floor(rr(a, b + 1)), pk = (a) => a[Math.floor(R() * a.length)];

// ------------------------------------------------------------------ road graph
function makeNode(id, x, z) {
  const n = { id, x, z, links: [] };
  Object.defineProperty(n, 'toString', { value() { return String(this.id); } });
  Object.defineProperty(n, 'valueOf', { value() { return this.id; } });
  return n;
}
const nodes = [];
for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) nodes.push(makeNode(i * NZ + j, XL[i], ZL[j]));
for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) {
  const n = nodes[i * NZ + j];
  if (j > 0) n.links.push(n.id - 1); if (j < NZ - 1) n.links.push(n.id + 1);
  if (i > 0) n.links.push(n.id - NZ); if (i < NX - 1) n.links.push(n.id + NZ);
}
const nearIdx = (arr, v) => { let b = 0, bd = Infinity; for (let i = 0; i < arr.length; i++) { const d = Math.abs(arr[i] - v); if (d < bd) { bd = d; b = i; } } return b; };
function nearestNode(x, z) { return nodes[nearIdx(XL, +x || 0) * NZ + nearIdx(ZL, +z || 0)]; }
const nid = (v) => (v && typeof v === 'object' ? v.id : v) | 0;
function path(from, to) {
  const a = nid(from), b = nid(to);
  if (!nodes[a] || !nodes[b]) return [];
  if (a === b) return [a];
  const prev = new Int16Array(nodes.length).fill(-1), q = [a]; prev[a] = a;
  for (let h = 0; h < q.length; h++) {
    const c = q[h]; if (c === b) break;
    for (const l of nodes[c].links) if (prev[l] < 0) { prev[l] = c; q.push(l); }
  }
  if (prev[b] < 0) return [a];
  const out = [b]; let c = b; while (c !== a) { c = prev[c]; out.push(c); }
  return out.reverse();
}
function segPoint(a, b, t, lane) {
  const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
  return { x: a.x + dx * t - uz * lane, z: a.z + dz * t + ux * lane, heading: Math.atan2(ux, uz), nodeA: a, nodeB: b };
}
function randomOnRoad(near, minD, maxD, make) {
  minD = minD || 0; maxD = maxD || 1e9; let best = null, bestErr = Infinity;
  for (let k = 0; k < 40; k++) {
    let a;
    if (near) { const ang = Math.random() * PI * 2, d = minD + Math.random() * (Math.min(maxD, 700) - minD); a = nearestNode(near.x + Math.cos(ang) * d, near.z + Math.sin(ang) * d); }
    else a = nodes[(Math.random() * nodes.length) | 0];
    const b = nodes[a.links[(Math.random() * a.links.length) | 0]];
    const p = make(a, b, 0.15 + Math.random() * 0.7);
    if (!p) continue;
    if (!near) return p;
    const d = Math.hypot(p.x - near.x, p.z - near.z);
    if (d >= minD && d <= maxD) return p;
    const err = d < minD ? minD - d : d - maxD;
    if (err < bestErr) { bestErr = err; best = p; }
  }
  return best || make(nodes[0], nodes[1], 0.5) || segPoint(nodes[0], nodes[1], 0.5, LANE);
}
function randomRoadPoint(near, minD, maxD) { return randomOnRoad(near, minD, maxD, (a, b, t) => segPoint(a, b, t, LANE)); }
function randomSidewalkPoint(near, minD, maxD) {
  const p = randomOnRoad(near, minD, maxD, (a, b, t) => {
    const s = segPoint(a, b, t, HW + 2.2);
    if (blocked(s.x, s.z, 0.5)) return null;
    return { x: s.x, z: s.z, heading: Math.random() < 0.5 ? s.heading : s.heading + PI };
  });
  return { x: p.x, z: p.z, heading: p.heading };
}

// ------------------------------------------------------------------ collision
const colliders = [];
const CS = 16, GX0 = BOUNDS.minX - 32, GZ0 = BOUNDS.minZ - 32;
const GW = Math.ceil((BOUNDS.maxX - BOUNDS.minX + 64) / CS), GH = Math.ceil((BOUNDS.maxZ - BOUNDS.minZ + 64) / CS);
const cells = new Array(GW * GH).fill(null);
const cellX = (x) => { const c = Math.floor((x - GX0) / CS); return c < 0 ? 0 : c >= GW ? GW - 1 : c; };
const cellZ = (z) => { const c = Math.floor((z - GZ0) / CS); return c < 0 ? 0 : c >= GH ? GH - 1 : c; };
function gridInsert(c) {
  for (let cz = cellZ(c.minZ); cz <= cellZ(c.maxZ); cz++) for (let cx = cellX(c.minX); cx <= cellX(c.maxX); cx++) { const k = cx + cz * GW; (cells[k] || (cells[k] = [])).push(c); }
}
function addCol(minX, minZ, maxX, maxZ, h) { const c = { minX, maxX, minZ, maxZ, h, _s: 0 }; colliders.push(c); gridInsert(c); return c; }
const cbox = (x, z, w, d, h) => addCol(x - w / 2, z - d / 2, x + w / 2, z + d / 2, h);

function resolveCircle(p, r) {
  if (!p || !(p.x === p.x) || !(p.z === p.z)) return null;
  r = r || 0.4; let nx = 0, nz = 0, hit = false;
  for (let pass = 0; pass < 3; pass++) {
    let any = false;
    const c0 = cellX(p.x - r), c1 = cellX(p.x + r), d0 = cellZ(p.z - r), d1 = cellZ(p.z + r);
    for (let cz = d0; cz <= d1; cz++) for (let cx = c0; cx <= c1; cx++) {
      const cell = cells[cx + cz * GW]; if (!cell) continue;
      for (let k = 0; k < cell.length; k++) {
        const c = cell[k];
        const qx = p.x < c.minX ? c.minX : p.x > c.maxX ? c.maxX : p.x, qz = p.z < c.minZ ? c.minZ : p.z > c.maxZ ? c.maxZ : p.z;
        const dx = p.x - qx, dz = p.z - qz, d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-10) { const d = Math.sqrt(d2), s = (r - d) / d; p.x += dx * s; p.z += dz * s; nx = dx / d; nz = dz / d; }
        else {
          const l = p.x - c.minX, rt = c.maxX - p.x, t = p.z - c.minZ, b = c.maxZ - p.z, m = Math.min(l, rt, t, b);
          if (m === l) { p.x = c.minX - r; nx = -1; nz = 0; } else if (m === rt) { p.x = c.maxX + r; nx = 1; nz = 0; }
          else if (m === t) { p.z = c.minZ - r; nx = 0; nz = -1; } else { p.z = c.maxZ + r; nx = 0; nz = 1; }
        }
        hit = any = true;
      }
    }
    if (!any) break;
  }
  if (p.x < BOUNDS.minX + r) { p.x = BOUNDS.minX + r; nx = 1; nz = 0; hit = true; } else if (p.x > BOUNDS.maxX - r) { p.x = BOUNDS.maxX - r; nx = -1; nz = 0; hit = true; }
  if (p.z < BOUNDS.minZ + r) { p.z = BOUNDS.minZ + r; nx = 0; nz = 1; hit = true; } else if (p.z > BOUNDS.maxZ - r) { p.z = BOUNDS.maxZ - r; nx = 0; nz = -1; hit = true; }
  return hit ? { nx, nz } : null;
}
function blocked(x, z, r) {
  r = r || 0;
  if (!(x === x) || !(z === z)) return true;
  if (x < BOUNDS.minX + r || x > BOUNDS.maxX - r || z < BOUNDS.minZ + r || z > BOUNDS.maxZ - r) return true;
  const c0 = cellX(x - r), c1 = cellX(x + r), d0 = cellZ(z - r), d1 = cellZ(z + r);
  for (let cz = d0; cz <= d1; cz++) for (let cx = c0; cx <= c1; cx++) {
    const cell = cells[cx + cz * GW]; if (!cell) continue;
    for (let k = 0; k < cell.length; k++) {
      const c = cell[k];
      const qx = x < c.minX ? c.minX : x > c.maxX ? c.maxX : x, qz = z < c.minZ ? c.minZ : z > c.maxZ ? c.maxZ : z;
      const dx = x - qx, dz = z - qz;
      if (dx * dx + dz * dz < r * r || (dx === 0 && dz === 0)) return true;
    }
  }
  return false;
}
let stamp = 1;
function raycast(o, d, maxDist) {
  if (!o || !d) return null;
  maxDist = maxDist || 100; stamp++;
  const oy = o.y || 0, dy = d.y || 0;
  let best = maxDist, bax = -1;
  let cx = Math.floor((o.x - GX0) / CS), cz = Math.floor((o.z - GZ0) / CS);
  const sx = d.x > 0 ? 1 : -1, sz = d.z > 0 ? 1 : -1;
  const tdx = Math.abs(d.x) > 1e-9 ? Math.abs(CS / d.x) : Infinity, tdz = Math.abs(d.z) > 1e-9 ? Math.abs(CS / d.z) : Infinity;
  let tmx = tdx === Infinity ? Infinity : (((d.x > 0 ? cx + 1 : cx) * CS + GX0) - o.x) / d.x;
  let tmz = tdz === Infinity ? Infinity : (((d.z > 0 ? cz + 1 : cz) * CS + GZ0) - o.z) / d.z;
  for (let n = 0; n < 160; n++) {
    if (cx >= 0 && cx < GW && cz >= 0 && cz < GH) {
      const cell = cells[cx + cz * GW];
      if (cell) for (let k = 0; k < cell.length; k++) {
        const c = cell[k]; if (c._s === stamp) continue; c._s = stamp;
        let t0 = 0, t1 = best, ax = -1, a, b, q;
        if (Math.abs(d.x) < 1e-9) { if (o.x < c.minX || o.x > c.maxX) continue; }
        else { a = (c.minX - o.x) / d.x; b = (c.maxX - o.x) / d.x; if (a > b) { q = a; a = b; b = q; } if (a > t0) { t0 = a; ax = 0; } if (b < t1) t1 = b; if (t0 > t1) continue; }
        if (Math.abs(dy) < 1e-9) { if (oy < 0 || oy > c.h) continue; }
        else { a = (0 - oy) / dy; b = (c.h - oy) / dy; if (a > b) { q = a; a = b; b = q; } if (a > t0) { t0 = a; ax = 1; } if (b < t1) t1 = b; if (t0 > t1) continue; }
        if (Math.abs(d.z) < 1e-9) { if (o.z < c.minZ || o.z > c.maxZ) continue; }
        else { a = (c.minZ - o.z) / d.z; b = (c.maxZ - o.z) / d.z; if (a > b) { q = a; a = b; b = q; } if (a > t0) { t0 = a; ax = 2; } if (b < t1) t1 = b; if (t0 > t1) continue; }
        if (ax >= 0 && t0 < best) { best = t0; bax = ax; }
      }
    }
    let t;
    if (tmx < tmz) { t = tmx; tmx += tdx; cx += sx; } else { t = tmz; tmz += tdz; cz += sz; }
    if (!(t <= best)) break;
  }
  if (bax < 0) return null;
  const normal = new THREE.Vector3();
  if (bax === 0) normal.x = d.x > 0 ? -1 : 1; else if (bax === 1) normal.y = dy > 0 ? -1 : 1; else normal.z = d.z > 0 ? -1 : 1;
  return { dist: best, point: new THREE.Vector3(o.x + d.x * best, oy + dy * best, o.z + d.z * best), normal };
}

// ------------------------------------------------------------------ surfaces / names
const zones = [];   // { x0,z0,x1,z1,t } or { cx,cz,r,t }
const flats = [];   // decks / piers over sand or water: ground is 0 there
const inFlat = (x, z) => { for (let i = 0; i < flats.length; i++) { const f = flats[i]; if (x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1) return true; } return false; };
function groundY(x, z) {
  if (x >= BEACH) return 0;
  if (inFlat(x, z)) return 0;
  if (x >= SEA) return -0.4 * (BEACH - x) / (BEACH - SEA);
  if (x >= SEA - 35) return -0.4 - 2.2 * (SEA - x) / 35;
  return -2.6;
}
function surfaceAt(x, z) {
  if (x < BEACH) { if (inFlat(x, z)) return 'plaza'; return x < SEA ? 'water' : 'sand'; }
  if (blocked(x, z, 0)) return 'building';
  const i = nearIdx(XL, x), j = nearIdx(ZL, z);
  if (Math.abs(x - XL[i]) <= HW && z >= ZL[0] - HW && z <= ZL[NZ - 1] + HW) return 'road';
  if (Math.abs(z - ZL[j]) <= HW && x >= XL[0] - HW && x <= XL[NX - 1] + HW) return 'road';
  for (let k = 0; k < zones.length; k++) {
    const q = zones[k];
    if (q.r !== undefined) { const dx = x - q.cx, dz = z - q.cz; if (dx * dx + dz * dz <= q.r * q.r) return q.t; }
    else if (x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1) return q.t;
  }
  return x < PROM ? 'plaza' : 'sidewalk';
}
function districtAt(x, z) {
  if (z < ZL[0] - HW && x < XL[1]) return 'נמל תל אביב';
  if (x < PROM) return z > 240 ? 'יפו העתיקה' : 'הטיילת';
  if (z > 240) return x < -100 ? 'יפו העתיקה' : 'פלורנטין';
  if (x >= -210 && x < -100 && z >= 0 && z < 115) return 'שוק הכרמל';
  if (x >= 230 && z > -360) return 'מרכז העסקים';
  if (x >= 120 && z >= 0) return 'שרונה';
  if (z >= 60) return 'שדרות רוטשילד';
  if (z < -240) return 'הצפון הישן';
  return 'לב העיר';
}
function streetAt(x, z) {
  const i = nearIdx(XL, x), j = nearIdx(ZL, z);
  return Math.abs(x - XL[i]) <= Math.abs(z - ZL[j]) ? XN[i] : ZN[j];
}

const landmarks = {
  dizengoff: { x: -45, z: -156, name: 'כיכר דיזנגוף' },
  azrieli: { x: 285, z: -60, name: 'מגדלי עזריאלי' },
  rothschild: { x: -45, z: 129.3, name: 'שדרות רוטשילד' },
  beach: { x: -390, z: -60, name: 'חוף פרישמן' },
  jaffa: { x: -240, z: 376, name: 'יפו העתיקה - מגדל השעון' },
  carmel: { x: -155, z: 60, name: 'שוק הכרמל' },
  port: { x: -300, z: -640, name: 'נמל תל אביב' },
  sarona: { x: 175, z: 60, name: 'שרונה' },
  habima: { x: 65, z: 62, name: 'כיכר הבימה' },
  florentin: { x: 65, z: 249.3, name: 'פלורנטין' },
  hospital: { x: 129.3, z: -300, name: 'בית החולים איכילוב' },
  park: { x: 65, z: -420, name: 'גן העיר' },
  marina: { x: -440, z: 300, name: 'מזח יפו' },
};
const parkingSpots = [{ x: XL[0] - 5.9, z: -104, heading: 0 }];
const world = {
  bounds: BOUNDS, seaX: SEA, spawn: { x: -336, z: -120, heading: PI / 2 },
  colliders, resolveCircle, blocked, raycast, groundY, surfaceAt,
  roads: { nodes, laneOffset: LANE, halfWidth: HW },
  nearestNode, randomRoadPoint, randomSidewalkPoint, path, landmarks, districtAt, streetAt, parkingSpots,
};

// ------------------------------------------------------------------ geometry helpers
const M = {};            // materials by batch key
const nightMats = [];    // [material, strength, base]
const B = {};            // batches: key -> [geometries]
function put(k, g, x = 0, y = 0, z = 0, ry = 0) { if (ry) g.rotateY(ry); if (x || y || z) g.translate(x, y, z); (B[k] || (B[k] = [])).push(g); return g; }
function col(g, hex) { const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; }
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (a, b, h, s = 8) => new THREE.CylinderGeometry(a, b, h, s);
const sph = (r, a = 7, b = 5) => new THREE.SphereGeometry(r, a, b);
const mg = (a) => mergeGeometries(a, false);
const vbox = (hex, w, h, d, x, y, z, ry) => put('vc', col(box(w, h, d), hex), x, y, z, ry);
// box with UVs in "tile repeats": ux along width (z faces), uz along depth (x faces), v vertical
function ubox(w, h, d, ux, uz, v, u0 = 0, v0 = 0) {
  const g = box(w, h, d), uv = g.attributes.uv;
  for (let i = 0; i < 24; i++) { const f = i >> 2; if (f === 2 || f === 3) { uv.setXY(i, u0 + 0.01, v0 + 0.01); continue; } uv.setXY(i, u0 + uv.getX(i) * (f < 2 ? uz : ux), v0 + uv.getY(i) * v); }
  return g;
}
const sbox = (k, w, h, d, x, y, z, tile = 4) => put(k, ubox(w, h, d, w / tile, d / tile, h / tile), x, y, z);
function flat(k, x0, z0, x1, z1, y, tile = 4) {
  const w = x1 - x0, d = z1 - z0, g = new THREE.PlaneGeometry(w, d), uv = g.attributes.uv;
  for (let i = 0; i < 4; i++) uv.setXY(i, uv.getX(i) * w / tile, uv.getY(i) * d / tile);
  g.rotateX(-PI / 2); return put(k, g, (x0 + x1) / 2, y, (z0 + z1) / 2);
}
const mark = (cx, cz, w, d) => flat('mark', cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, 0.05, 1);
function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function ctex(c) { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }

function facadeTex(o) {
  const S = 512, [c, x] = cv(S, S), [ce, xe] = cv(S, S);
  x.fillStyle = o.wall; x.fillRect(0, 0, S, S); xe.fillStyle = '#000'; xe.fillRect(0, 0, S, S);
  for (let i = 0; i < 70; i++) { x.fillStyle = R() < 0.5 ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.05)'; x.fillRect(R() * S, R() * S, 20 + R() * 120, 4 + R() * 40); }
  const cw = S / o.cols, rh = S / o.rows;
  for (let r = 0; r < o.rows; r++) for (let q = 0; q < o.cols; q++) {
    const X = q * cw, Y = r * rh; let wx, wy, ww, wh;
    if (o.style === 'glass') { wx = X + 3; wy = Y + 4; ww = cw - 6; wh = rh - 8; }
    else if (o.style === 'ribbon') { wx = X + (q % 2 ? 0 : cw * 0.14); ww = cw * 0.86; wy = Y + rh * 0.3; wh = rh * 0.4; }
    else { wx = X + cw * 0.27; ww = cw * 0.46; wy = Y + rh * 0.22; wh = rh * 0.52; }
    const g = x.createLinearGradient(0, wy, 0, wy + wh); g.addColorStop(0, o.win[0]); g.addColorStop(1, o.win[1]);
    const shape = (ctx) => {
      if (o.style === 'arch') { ctx.beginPath(); ctx.moveTo(wx, wy + wh); ctx.lineTo(wx, wy + ww / 2); ctx.arc(wx + ww / 2, wy + ww / 2, ww / 2, PI, 0); ctx.lineTo(wx + ww, wy + wh); ctx.closePath(); ctx.fill(); }
      else ctx.fillRect(wx, wy, ww, wh);
    };
    x.fillStyle = g; shape(x);
    if (o.style === 'glass') { x.fillStyle = 'rgba(255,255,255,0.10)'; x.fillRect(wx, wy, ww, wh * 0.18); }
    else {
      x.fillStyle = 'rgba(0,0,0,0.10)'; x.fillRect(X, Y + rh - 5, cw, 5);
      x.strokeStyle = 'rgba(40,40,40,0.55)'; x.lineWidth = 2; if (o.style !== 'arch') x.strokeRect(wx, wy, ww, wh);
      if (o.shutter && R() < 0.45) { x.fillStyle = pk(o.shutter); x.fillRect(wx, wy, ww * 0.5, wh); }
    }
    if (R() < o.lit) { xe.globalAlpha = rr(0.45, 1); xe.fillStyle = pk(['#ffd9a0', '#ffe9c4', '#fff2d8', '#bfe3ff', '#ffc680']); shape(xe); xe.globalAlpha = 1; }
  }
  if (o.graf) {
    for (let n = 0; n < 30; n++) { x.globalAlpha = 0.85; x.fillStyle = `hsl(${Math.floor(R() * 360)},85%,55%)`; x.beginPath(); x.arc(R() * S, S * (0.72 + R() * 0.27), 8 + R() * 34, 0, PI * 2); x.fill(); }
    x.font = 'bold 44px Arial'; x.textAlign = 'center';
    for (let n = 0; n < 5; n++) { x.fillStyle = `hsl(${Math.floor(R() * 360)},90%,${R() < 0.5 ? 20 : 85}%)`; x.fillText(pk(['אהבה', 'TLV', 'פלורנטין', 'די!', 'יאללה', 'שלום']), 60 + R() * (S - 120), S * (0.8 + R() * 0.17)); }
    x.globalAlpha = 1;
  }
  return { map: ctex(c), emissiveMap: ctex(ce) };
}
const SHOPS = [['פלאפל הדוד מושיקו', '#d9442b'], ['חומוס עד הבית', '#c28a2a'], ['קפה הפוך על הפוך', '#5a3a22'], ['קיוסק 24/6', '#1f7a4d'],
  ['בית מרקחת "רק אקמול"', '#2a9d8f'], ['סטארט-אפ בע"מ (בקרוב)', '#3a4fd9'], ['שווארמה הנסיך', '#a12a2a'], ['מיצים של סבתא', '#e07b1a'],
  ['קורקינטים ותיקונים', '#333a44'], ['ספרים יד שלישית', '#6a4c93'], ['גלידה שלא נמסה', '#e85d9a'], ['מספרת "רק קצת מהצדדים"', '#222222'],
  ['בורקס חם חם', '#b5651d'], ['מכולת נתי - פתוח תמיד', '#2d6cdf'], ['יוגה וחומוס', '#7a9e3a'], ['אקזיט נדל"ן', '#0b3954']];
function shopTex() {
  const [c, x] = cv(2048, 512);
  for (let n = 0; n < 16; n++) {
    const X = (n % 8) * 256, Y = Math.floor(n / 8) * 256, s = SHOPS[n];
    x.fillStyle = '#e9e4d8'; x.fillRect(X, Y, 256, 256);
    x.fillStyle = s[1]; x.fillRect(X + 4, Y + 6, 248, 62);
    x.fillStyle = '#fff'; x.font = 'bold 30px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; try { x.direction = 'rtl'; } catch { /* ignore */ }
    x.fillText(s[0], X + 128, Y + 38, 236);
    const g = x.createLinearGradient(0, Y + 84, 0, Y + 236); g.addColorStop(0, '#9fd3e8'); g.addColorStop(1, '#3c5a6e');
    x.fillStyle = g; x.fillRect(X + 12, Y + 84, 146, 150);
    x.fillStyle = 'rgba(255,240,200,0.55)'; x.fillRect(X + 22, Y + 150, 126, 74);
    x.fillStyle = '#2b3138'; x.fillRect(X + 172, Y + 84, 68, 172);
    x.fillStyle = '#8fc4dc'; x.fillRect(X + 180, Y + 94, 52, 110);
    x.strokeStyle = '#444'; x.lineWidth = 3; x.strokeRect(X + 12, Y + 84, 146, 150);
    x.fillStyle = s[1]; for (let k = 0; k < 8; k++) if (k % 2 === 0) x.fillRect(X + 4 + k * 31, Y + 68, 31, 12);
  }
  return ctex(c);
}
function signTex() {
  const names = XN.concat(ZN), [c, x] = cv(512, 64 * names.length);
  names.forEach((n, r) => {
    x.fillStyle = '#17489a'; x.fillRect(0, r * 64, 512, 64); x.strokeStyle = '#fff'; x.lineWidth = 5; x.strokeRect(5, r * 64 + 5, 502, 54);
    x.fillStyle = '#fff'; x.font = 'bold 40px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(n, 256, r * 64 + 34, 480);
  });
  const t = ctex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}
function noiseTex(base, dots, n = 2500, planks = false) {
  const [c, x] = cv(256, 256); x.fillStyle = base; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < n; i++) { x.fillStyle = pk(dots); x.fillRect(R() * 256, R() * 256, 1 + R() * 3, 1 + R() * 3); }
  if (planks) { x.fillStyle = 'rgba(40,25,10,0.5)'; for (let i = 0; i < 8; i++) x.fillRect(0, i * 32, 256, 2); }
  return ctex(c);
}
function adTex(n) {
  const ads = [['חומוס. כי מגיע לך.', '#e0a020'], ['חוף הים פתוח 24/7', '#1c8fd9'], ['קורקינט שיתופי - סע בזהירות!', '#19b36b'], ['קפה קר? תמיד.', '#7a4b2a'],
    ['TLV NONSTOP', '#d9305f'], ['דירה בתל אביב? חחח', '#5b3fd0'], ['מיץ רימונים של אבא', '#b3202a'], ['פסטיבל הטיילת הלילה', '#0f766e']];
  const a = ads[n % ads.length], [c, x] = cv(512, 256);
  x.fillStyle = a[1]; x.fillRect(0, 0, 512, 256); x.fillStyle = 'rgba(255,255,255,0.15)'; x.beginPath(); x.arc(420, 40, 150, 0, PI * 2); x.fill();
  x.fillStyle = '#fff'; x.font = 'bold 46px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(a[0], 256, 128, 480);
  const t = ctex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}

const wt = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);
const safe = (name, fn) => { try { fn(); } catch (e) { console.error('[world:' + name + ']', e); } };

// instanced helpers
const _d = new THREE.Object3D(), _c = new THREE.Color();
function inst(root, geo, mat, list, shadow) {
  if (!list.length || !geo) return null;
  const m = new THREE.InstancedMesh(geo, mat, list.length);
  for (let i = 0; i < list.length; i++) {
    const p = list[i]; _d.position.set(p[0], p[1], p[2]); _d.rotation.set(0, p[3] || 0, 0); _d.scale.setScalar(p[4] || 1); _d.updateMatrix(); m.setMatrixAt(i, _d.matrix);
    if (p[5] !== undefined) m.setColorAt(i, _c.set(p[5]));
  }
  m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
  m.castShadow = !!shadow; m.receiveShadow = true; m.frustumCulled = false; root.add(m); return m;
}

// ------------------------------------------------------------------ init
let lastNight = -1;
export async function init(g) {
  const GG = g || G;
  GG.world = world; G.world = world;
  const root = new THREE.Group(); root.name = 'world';
  const A = GG.assets;

  // ---- textures (all optional)
  const T = async (set, map, srgb) => { try { return await A.loadTexture(`assets/tex/${set}/${map}.jpg`, { srgb, repeat: [1, 1] }); } catch { return null; } };
  const PB = {};
  const sets = ['Road012A', 'PavingStones128', 'PavingStones146', 'Tiles107', 'Concrete034', 'Plaster007', 'Facade002', 'Facade009', 'Facade013', 'Facade017', 'Facade018A', 'Facade020B'];
  const bbTex = new Array(8).fill(null);
  let palmGlb = null;
  await wt(Promise.all([
    ...sets.map(async (s) => {
      const fac = s.startsWith('Facade');
      const [map, normalMap, roughnessMap, emis] = await Promise.all([T(s, 'color', true), T(s, 'normal', false), T(s, 'rough', false), fac ? T(s, 'emis', true) : null]);
      const p = {}; if (map) p.map = map; if (normalMap) p.normalMap = normalMap; if (roughnessMap) p.roughnessMap = roughnessMap; if (emis) p.emissiveMap = emis;
      PB[s] = p;
    }),
    ...bbTex.map(async (_, n) => { try { const t = await A.loadTexture(`assets/gen/billboard_0${n + 1}.png`); if (t && t.image) bbTex[n] = t; } catch { /* fallback below */ } }),
    (async () => {
      try {
        const gl = await A.loadGLB('assets/props/palm.glb'); let mesh = null;
        gl.scene.updateMatrixWorld(true); gl.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
        if (!mesh) return;
        const geo = mesh.geometry.clone(); geo.applyMatrix4(mesh.matrixWorld); geo.computeBoundingBox(); const bb = geo.boundingBox;
        geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
        palmGlb = { geo, mat: mesh.material, h: Math.max(0.1, bb.max.y - bb.min.y) };
      } catch { /* procedural palms only */ }
    })(),
  ]).catch(() => null), 20000);

  // ---- materials
  const Std = THREE.MeshStandardMaterial;
  const pm = (set, fallback, extra) => { const p = Object.assign({ roughness: 0.9 }, PB[set] || {}, extra || {}); delete p.emissiveMap; if (!p.map && p.color === undefined) p.color = fallback; return new Std(p); };
  const po = (f) => ({ polygonOffset: true, polygonOffsetFactor: f, polygonOffsetUnits: f });
  const night = (m, k, base = 0) => { m.emissive = new THREE.Color(0xffffff); m.emissiveIntensity = base; nightMats.push([m, k, base]); return m; };
  M.pave = pm('PavingStones128', 0xc9c5bb);
  M.road = pm('Road012A', 0x3b3c40, po(-1));
  M.mark = new Std({ color: 0xf1efe4, roughness: 0.7, ...po(-4) });
  M.prom = pm('PavingStones146', 0xd9cfbd, po(-2));
  M.tiles = pm('Tiles107', 0xd8d2c6, po(-3));
  M.roof = pm('Concrete034', 0xb9b6ae);
  M.plaster = pm('Plaster007', 0xf4f1ea);
  M.stone = pm('Plaster007', 0xd9b77a, { color: 0xdcb77a });
  M.grass = new Std({ map: noiseTex('#5c9a45', ['#4f8a3b', '#6bab52', '#55913f']), roughness: 1, ...po(-2) });
  M.wood = new Std({ map: noiseTex('#a67c52', ['#96703f', '#b58a5c', '#8a6638'], 1500, true), roughness: 0.85, ...po(-2) });
  M.sand = new Std({ map: noiseTex('#e8d5a6', ['#dcc894', '#f0dfb4', '#d9c38c']), roughness: 1 });
  M.water = new Std({ color: 0x58c1e0, roughness: 0.12, metalness: 0.1, emissive: 0x114455, emissiveIntensity: 0.4 });
  M.vc = new Std({ vertexColors: true, roughness: 0.8 });
  M.vcD = new Std({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
  M.glow = new Std({ color: 0xfff3cf, emissive: 0xffd58a, emissiveIntensity: 0.05, roughness: 0.4 }); nightMats.push([M.glow, 5, 0.05]);
  const fac = (key, o, k = 1.3, extra) => { M[key] = night(new Std(Object.assign({ roughness: 0.85 }, facadeTex(o), extra || {})), k); };
  const WIN = ['#3c5568', '#1f2c38'];
  fac('bauA', { wall: '#f3f0e8', win: WIN, cols: 4, rows: 3, style: 'ribbon', lit: 0.5 });
  fac('bauB', { wall: '#ece4d2', win: WIN, cols: 4, rows: 3, style: 'punch', lit: 0.5, shutter: ['#6f8f7a', '#7d93a8', '#b9b19a'] });
  fac('bauC', { wall: '#f7f5f0', win: ['#4a6274', '#25323d'], cols: 4, rows: 3, style: 'punch', lit: 0.45, shutter: ['#c9c2ae', '#5f7f9a'] });
  fac('jaffa', { wall: '#d6b47a', win: ['#3b3226', '#1d1812'], cols: 4, rows: 3, style: 'arch', lit: 0.4, shutter: ['#2f6f8f', '#3f7f5f'] });
  fac('florA', { wall: '#c9c2b6', win: WIN, cols: 4, rows: 3, style: 'punch', lit: 0.5, graf: true, shutter: ['#d9442b', '#2d6cdf', '#e0a020'] });
  fac('florB', { wall: '#e3b7a0', win: WIN, cols: 4, rows: 3, style: 'ribbon', lit: 0.5, graf: true });
  fac('glassA', { wall: '#2b3f55', win: ['#8fc6ea', '#3f79a8'], cols: 4, rows: 4, style: 'glass', lit: 0.4 }, 1.1, { roughness: 0.25, metalness: 0.2 });
  fac('glassB', { wall: '#20343a', win: ['#7fd0c4', '#2f6f75'], cols: 4, rows: 4, style: 'glass', lit: 0.4 }, 1.1, { roughness: 0.25, metalness: 0.2 });
  const FALL = { f002: 'glassB', f009: 'bauA', f013: 'bauB', f017: 'bauC', f018A: 'glassA', f020B: 'glassB' };
  for (const k in FALL) {
    const p = PB['Facade' + k.slice(1)];
    if (p && p.map) { const m = new Std(Object.assign({ roughness: 0.8 }, p)); if (p.emissiveMap) night(m, 1.5); M[k] = m; } else M[k] = M[FALL[k]];
  }
  const stx = shopTex(); M.shop = night(new Std({ map: stx, emissiveMap: stx, roughness: 0.6 }), 0.6);
  const sgx = signTex(); M.sign = night(new Std({ map: sgx, emissiveMap: sgx, roughness: 0.6 }), 0.35);
  for (let n = 0; n < 8; n++) { const t = bbTex[n] || adTex(n); M['bb' + n] = night(new Std({ map: t, emissiveMap: t, roughness: 0.6 }), 0.9, 0.08); }
  const TILE = { glassA: [3, 4, 4], glassB: [3, 4, 4], f002: [12, 1, 4], f009: [12, 1, 4], f013: [12, 1, 4], f017: [12, 1, 4], f018A: [12, 1, 4], f020B: [12, 1, 4] };
  const BAU = new Set(['bauA', 'bauB', 'bauC']);

  // ---- instance lists
  const trees = [], palms = [], lamps = [], benches = [], duds = [], umbrellas = [], sunbeds = [], roofs = [];
  const FACE_RY = [PI / 2, -PI / 2, 0, PI];

  function building(x, z, w, d, fl, k, o = {}) {
    const fh = o.fh || 3.2, h = fl * fh, y0 = o.y || 0, T3 = TILE[k] || [3, 4, 3];
    put(k, ubox(w, h, d, Math.max(1, Math.round(w / T3[0])) / T3[1], Math.max(1, Math.round(d / T3[0])) / T3[1], Math.max(1, Math.round(fl)) / T3[2]), x, y0 + h / 2, z);
    put('roof', box(w + 0.5, 0.4, d + 0.5), x, y0 + h + 0.2, z);
    if (o.shop !== false) put('shop', ubox(w + 0.16, 3.3, d + 0.16, Math.max(1, Math.round(w / 6)) / 8, Math.max(1, Math.round(d / 6)) / 8, 0.5, ri(0, 7) / 8, ri(0, 1) * 0.5), x, y0 + 1.65, z);
    cbox(x, z, w, d, y0 + h);
    const face = o.face === undefined ? ri(0, 3) : o.face;
    if (BAU.has(k) && fl > 1 && o.balc !== false) {
      const ry = FACE_RY[face], W = face < 2 ? d : w, D = face < 2 ? w : d, L = W * rr(0.3, 0.5), ox = (R() < 0.5 ? -1 : 1) * (W - L) / 2 * rr(0.3, 0.8);
      for (let f = 1; f < fl; f++) {
        const y = y0 + f * fh + 0.55;
        put('plaster', box(L, 1, 1.1).translate(ox, y, D / 2 + 0.55), x, 0, z, ry);
        put('plaster', new THREE.CylinderGeometry(1.5, 1.5, 1, 10, 1, false, -PI / 2, PI).translate(-Math.sign(ox) * W * 0.27, y, D / 2), x, 0, z, ry);
      }
    }
    if (!o.tower && fl <= 9 && !k.startsWith('glass')) {
      const n = ri(1, 2); for (let q = 0; q < n; q++) duds.push([x + rr(-0.3, 0.3) * w, y0 + h + 0.4, z + rr(-0.3, 0.3) * d, ri(0, 3) * PI / 2, 1]);
      if (fl >= 4 && Math.min(w, d) >= 14 && !y0) roofs.push({ x, z, w, d, top: h + 0.4, face });
    }
    if (o.tower) { put('roof', box(w * 0.5, 4, d * 0.5), x, y0 + h + 2.4, z); vbox(0xcc2222, 0.5, 0.5, 0.5, x, y0 + h + 4.7, z); }
    return h;
  }
  function styleOf(i, j, cx, cz) {
    if (cz > 240 && cx < -100) return { w: ['jaffa'], f: [2, 4], shop: 0.4 };
    if (cz > 240) return { w: ['florA', 'florB', 'florA', 'florB', 'f013'], f: [2, 3], shop: 0.8 };
    if (i >= 5 && j >= 2 && j <= 5) return null;
    if (i >= 5) return { w: ['f002', 'f009', 'f017', 'bauA', 'bauB', 'glassB'], f: [4, 9], shop: 0.7 };
    return { w: ['bauA', 'bauA', 'bauB', 'bauB', 'bauC', 'f013', 'f017'], f: [3, 6], shop: 0.85 };
  }
  function fillBlock(x0, z0, x1, z1, st) {
    const W = x1 - x0, D = z1 - z0, nx = Math.max(2, Math.round(W / 22)), nz = Math.max(2, Math.round(D / 24)), cw = W / nx, cd = D / nz;
    for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
      if (!(a === 0 || a === nx - 1 || b === 0 || b === nz - 1)) continue;
      const face = b === 0 ? 3 : b === nz - 1 ? 2 : a === 0 ? 1 : 0, gap = rr(0.8, 2.4);
      building(x0 + (a + 0.5) * cw, z0 + (b + 0.5) * cd, cw - gap, cd - gap, ri(st.f[0], st.f[1]), pk(st.w), { face, shop: R() < st.shop });
    }
    if (nx > 2 && nz > 2) {
      flat('grass', x0 + cw, z0 + cd, x1 - cw, z1 - cd, 0.03, 3); zones.push({ x0: x0 + cw, z0: z0 + cd, x1: x1 - cw, z1: z1 - cd, t: 'grass' });
      for (let q = 0; q < 3; q++) trees.push([rr(x0 + cw + 3, x1 - cw - 3), 0, rr(z0 + cd + 3, z1 - cd - 3), R() * 6.28, rr(0.8, 1.3)]);
    }
  }
  function fillBiz(x0, z0, x1, z1) {
    const cw = (x1 - x0) / 2, cd = (z1 - z0) / 2;
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
      const cx = x0 + (a + 0.5) * cw, cz = z0 + (b + 0.5) * cd;
      if (R() < 0.5) { const s = rr(22, Math.min(32, cw - 6)); building(cx, cz, s, Math.min(s * rr(0.8, 1.15), cd - 6), ri(18, 34), pk(['glassA', 'glassB', 'glassA', 'f018A', 'f020B']), { fh: 3.6, shop: false, tower: true }); }
      else building(cx, cz, cw - 6, cd - 6, ri(6, 11), pk(['f018A', 'f020B', 'f002', 'f009']), { shop: true, face: b ? 2 : 3 });
    }
    flat('tiles', x0, z0, x1, z1, 0.04, 3); zones.push({ x0, z0, x1, z1, t: 'plaza' });
  }

  // ---- ground, sea floor, roads
  safe('ground', () => {
    flat('pave', BEACH, -1600, 1700, 1600, 0, 4);
    const xs = [BEACH, SEA, SEA - 35, -2400], ys = [0, -0.4, -2.6, -2.6], pos = [], uv = [], idx = [];
    for (const zz of [-2400, 2400]) for (let q = 0; q < 4; q++) { pos.push(xs[q], ys[q], zz); uv.push(xs[q] / 5, zz / 5); }
    for (let q = 0; q < 3; q++) idx.push(q, q + 1, q + 4, q + 1, q + 5, q + 4);
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); sg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); sg.setIndex(idx); sg.computeVertexNormals();
    const sand = new THREE.Mesh(sg, M.sand); sand.receiveShadow = true; sand.name = 'w_sand'; root.add(sand);
    flat('prom', BEACH, ZL[0] - HW, PROM, 1600, 0.03, 3);
    for (let i = 0; i < NX; i++) flat('road', XL[i] - HW, ZL[0] - HW, XL[i] + HW, ZL[NZ - 1] + HW, 0.03, 7);
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX - 1; i++) flat('road', XL[i] + HW, ZL[j] - HW, XL[i + 1] - HW, ZL[j] + HW, 0.03, 7);
  });

  safe('streets', () => {
    let sn = 0;
    for (const a of nodes) for (const id of a.links) {
      if (id < a.id) continue;
      const b = nodes[id], L = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / L, uz = (b.z - a.z) / L, ns = a.x === b.x, roth = !ns && a.z === 120;
      sn++;
      if (!roth) for (let t = 12; t < L - 12; t += 7) ns ? mark(a.x, a.z + t, 0.2, 3) : mark(a.x + t, a.z, 3, 0.2);
      else { flat('grass', a.x + 12, 119.2, b.x - 12, 120.8, 0.06, 2); for (let x = a.x + 14; x <= b.x - 14; x += 8) trees.push([x, 0, 120, R() * 6.28, rr(0.7, 0.95)]); }
      for (const e of [9.5, L - 9.5]) for (let s = -6; s <= 6.01; s += 1.2) ns ? mark(a.x + s, a.z + e, 0.6, 3) : mark(a.x + e, a.z + s, 3, 0.6);
      for (let t = 18, n = 0; t <= L - 18; t += 12, n++) {
        const side = (n + sn) % 2 ? 1 : -1, px = a.x + ux * t - uz * side * (HW + 1.1), pz = a.z + uz * t + ux * side * (HW + 1.1);
        if (px < XL[0]) continue;
        if (n % 3 === 0) lamps.push([px, 0, pz, Math.atan2(ux * side, uz * side), 1]);
        else trees.push([px, 0, pz, R() * 6.28, rr(0.75, 1.15)]);
      }
      if (R() < 0.8) {
        const side = R() < 0.5 ? 1 : -1, t = rr(24, L - 24);
        parkingSpots.push({ x: a.x + ux * t - uz * side * 5.9, z: a.z + uz * t + ux * side * 5.9, heading: side > 0 ? Math.atan2(ux, uz) : Math.atan2(-ux, -uz) });
      }
      if (!ns && !roth && sn % 5 === 0) {     // bus shelter + shared scooters on the south sidewalk
        const x = a.x + L / 2, z = a.z + HW + 2.9;
        vbox(0x2f3b46, 4.4, 0.12, 1.7, x, 2.55, z); vbox(0x9fd0e0, 4.2, 2.1, 0.06, x, 1.35, z + 0.75); vbox(0x2f3b46, 0.1, 2.5, 0.1, x - 2.1, 1.25, z + 0.7); vbox(0x2f3b46, 0.1, 2.5, 0.1, x + 2.1, 1.25, z + 0.7);
        vbox(0xb58a5a, 2.6, 0.08, 0.45, x, 0.5, z + 0.4); vbox(0xf2c200, 0.5, 0.5, 0.05, x + 2.4, 2.9, z + 0.7);
        for (let q = 0; q < 4; q++) { const sx = x + 4.5 + q * 0.8, c = pk([0x2bd47d, 0xff7a1a, 0x22aaff]); vbox(c, 0.16, 0.1, 1.0, sx, 0.16, z + 0.3); vbox(0x222222, 0.06, 1.05, 0.06, sx, 0.65, z - 0.15); vbox(c, 0.5, 0.06, 0.06, sx, 1.18, z - 0.15); }
      }
    }
    // street-name signs
    const row = (r, x, y, z, ry) => { const gq = new THREE.PlaneGeometry(2.4, 0.5), uv = gq.attributes.uv, nrows = XN.length + ZN.length; for (let q = 0; q < 4; q++) uv.setY(q, 1 - (r + 1) / nrows + uv.getY(q) / nrows); put('sign', gq, x, y, z, ry); };
    for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) {
      const x = XL[i] + 8.3, z = ZL[j] + 8.3;
      vbox(0x8a8f96, 0.09, 3.7, 0.09, x, 1.85, z);
      row(i, x + 0.03, 3.4, z + 1.25, PI / 2); row(i, x - 0.03, 3.4, z + 1.25, -PI / 2);
      row(NX + j, x + 1.25, 2.85, z + 0.03, 0); row(NX + j, x + 1.25, 2.85, z - 0.03, PI);
    }
  });

  // ---- blocks
  for (let i = 0; i < NX; i++) for (let j = -1; j < NZ; j++) safe('block' + i + '_' + j, () => {
    const x0 = XL[i] + HW + SW, x1 = i < NX - 1 ? XL[i + 1] - HW - SW : BOUNDS.maxX - 4;
    const z0 = j >= 0 ? ZL[j] + HW + SW : BOUNDS.minZ + 4, z1 = j < NZ - 1 ? ZL[j + 1] - HW - SW : BOUNDS.maxZ - 4;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, key = i + ',' + j;
    if (key === '0,-1') {                 // Tel Aviv port: wooden deck + hangars
      flat('wood', SEA, BOUNDS.minZ - 2, XL[1] - HW, ZL[0] - HW, 0.06, 5); flats.push({ x0: SEA, x1: BEACH + 0.5, z0: BOUNDS.minZ - 2, z1: ZL[0] - HW });
      zones.push({ x0: BEACH, x1: XL[1] - HW, z0: BOUNDS.minZ - 2, z1: ZL[0] - HW, t: 'plaza' });
      [-392, -350, -300, -252].forEach((hx, q) => {
        building(hx, -674, 30, 20, 2, 'bauC', { fh: 3.6, balc: false });
        put('vc', col(new THREE.CylinderGeometry(10.3, 10.3, 30.4, 12, 1, false, -PI / 2, PI).rotateX(-PI / 2).rotateY(PI / 2).scale(1, 0.35, 1), [0x2a9d8f, 0xd9442b, 0x2d6cdf, 0xe0a020][q]), hx, 7.6, -674);
      });
      for (let x = -410; x <= -230; x += 30) { lamps.push([x, 0, -612, 0, 1]); benches.push([x + 12, 0, -628, PI, 1]); }
      for (let z = -690; z <= -615; z += 15) palms.push([SEA + 4, 0, z, R() * 6, rr(0.9, 1.1)]);
    } else if (key === '2,3') {           // Dizengoff square
      const px = -45, pz = -180;
      flat('grass', x0, z0, x1, z1, 0.03, 3); zones.push({ cx: px, cz: pz, r: 37, t: 'plaza' }, { x0, z0, x1, z1, t: 'grass' });
      const cg = new THREE.CircleGeometry(37, 48), uv = cg.attributes.uv; for (let q = 0; q < uv.count; q++) uv.setXY(q, uv.getX(q) * 24, uv.getY(q) * 24);
      put('tiles', cg.rotateX(-PI / 2), px, 0.06, pz);
      put('plaster', cyl(6.4, 6.8, 0.9, 28), px, 0.45, pz); put('water', cyl(5.9, 5.9, 0.1, 28), px, 0.88, pz);
      [[3.2, 0xe63946], [2.6, 0xf4a261], [2.0, 0xe9c46a], [1.4, 0x2a9d8f], [0.8, 0x457b9d]].forEach((s, q) => put('vc', col(cyl(s[0], s[0] + 0.3, 0.55, 20), s[1]), px, 1.2 + q * 0.6, pz));
      put('water', cyl(0.12, 0.3, 3, 8), px, 5.4, pz);
      cbox(px, pz, 12.4, 12.4, 4);
      for (let q = 0; q < 12; q++) { const a = q / 12 * PI * 2; palms.push([px + Math.cos(a) * 31, 0, pz + Math.sin(a) * 31, a, rr(0.85, 1.05)]); }
      for (let q = 0; q < 8; q++) { const a = (q + 0.5) / 8 * PI * 2; benches.push([px + Math.sin(a) * 22, 0, pz + Math.cos(a) * 22, a + PI, 1]); lamps.push([px + Math.sin(a) * 35, 0, pz + Math.cos(a) * 35, a + PI / 2, 1]); }
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) for (let q = 0; q < 3; q++) trees.push([px + sx * rr(30, 41), 0, pz + sz * rr(36, 46), R() * 6, rr(0.9, 1.3)]);
    } else if (key === '1,5') {           // Carmel market
      flat('prom', x0, z0, x1, z1, 0.04, 3); zones.push({ x0, z0, x1, z1, t: 'plaza' });
      const AW = [0xd9442b, 0x2d6cdf, 0xe0a020, 0x1f9d55, 0xe85d9a, 0xf2f2f2, 0x7a3fd0, 0xff7a1a], PR = [0xff8c1a, 0x6fbf3a, 0xd62828, 0xf2d024, 0x8e3b8e, 0xc97b3a];
      for (const lx of [-190, -176, -162, -148, -134, -120]) for (const [za, zb] of [[14, 54], [66, 106]]) {
        cbox(lx, (za + zb) / 2, 3, zb - za, 2.7);
        for (let z = za + 2; z < zb; z += 4) {
          vbox(0x8b6b4a, 2.8, 0.9, 3.6, lx, 0.45, z); vbox(pk(AW), 4.0, 0.12, 4.0, lx, 2.6, z); vbox(0x555555, 0.08, 2.6, 0.08, lx, 1.3, z - 1.9);
          for (let q = 0; q < 3; q++) vbox(pk(PR), 2.4, 0.28, 0.95, lx, 1.04, z - 1.15 + q * 1.15);
        }
      }
      for (const z of [10, 60, 110]) for (const x of [-200, -112]) lamps.push([x, 0, z, x < -155 ? 0 : PI, 1]);
    } else if (key === '3,5') {           // Habima square
      flat('tiles', x0, z0, x1, z1, 0.04, 3); zones.push({ x0: 40, z0: 72, x1: 90, z1: 100, t: 'grass' }, { x0, z0, x1, z1, t: 'plaza' });
      building(65, 30, 64, 28, 4, 'bauA', { fh: 4.4, shop: false, balc: false });
      put('plaster', box(66, 1, 7), 65, 17.2, 47); for (let x = 37; x <= 93; x += 11.2) put('plaster', cyl(0.6, 0.6, 16.8, 12), x, 8.4, 49.5);
      flat('grass', 40, 72, 90, 100, 0.07, 3);
      for (let q = 0; q < 8; q++) trees.push([rr(42, 88), 0, rr(74, 98), R() * 6, rr(0.8, 1.2)]);
      for (const x of [30, 100]) for (const z of [60, 85, 104]) { lamps.push([x, 0, z, x < 65 ? 0 : PI, 1]); benches.push([x + (x < 65 ? 3 : -3), 0, z + 5, x < 65 ? PI / 2 : -PI / 2, 1]); }
    } else if (key === '4,5') {           // Sarona
      flat('grass', x0, z0, x1, z1, 0.03, 3); flat('prom', 172, z0, 178, z1, 0.07, 3); flat('prom', x0, 57, x1, 63, 0.07, 3);
      zones.push({ x0: 172, z0, x1: 178, z1, t: 'plaza' }, { x0, z0: 57, x1, z1: 63, t: 'plaza' }, { x0, z0, x1, z1, t: 'grass' });
      for (const [hx, hz] of [[146, 26], [204, 26], [146, 94], [204, 94], [150, 44], [200, 78]]) {
        building(hx, hz, 13, 10, 2, 'bauC', { shop: false, balc: false });
        put('vc', col(new THREE.ConeGeometry(9.6, 3.2, 4).rotateY(PI / 4).scale(1, 1, 0.78), 0xb5533c), hx, 6.8 + 1.6, hz);
      }
      for (let q = 0; q < 16; q++) { const tx = rr(x0 + 3, x1 - 3), tz = rr(z0 + 3, z1 - 3); if (Math.abs(tx - 175) > 6 && Math.abs(tz - 60) > 6 && !blocked(tx, tz, 2)) trees.push([tx, 0, tz, R() * 6, rr(0.9, 1.4)]); }
      for (const z of [20, 40, 80, 100]) { lamps.push([171, 0, z, 0, 1]); benches.push([179.5, 0, z + 6, -PI / 2, 1]); }
    } else if (key === '5,4') {           // the three towers: round, triangular, square
      flat('tiles', x0, z0, x1, z1, 0.04, 3); zones.push({ x0, z0, x1, z1, t: 'plaza' });
      const rg = new THREE.CylinderGeometry(18, 18, 187, 40, 1, true), ruv = rg.attributes.uv; for (let q = 0; q < ruv.count; q++) ruv.setXY(q, ruv.getX(q) * 9, ruv.getY(q) * 13);
      put('glassA', rg, 262, 93.5, -86); put('roof', cyl(18.4, 18.4, 1.2, 40), 262, 187.6, -86); put('roof', cyl(6, 6, 5, 16), 262, 190.5, -86); cbox(262, -86, 33, 33, 187);
      const tg0 = new THREE.CylinderGeometry(22, 22, 169, 3, 1, false), tuv = tg0.attributes.uv; for (let q = 0; q < tuv.count; q++) tuv.setXY(q, tuv.getX(q) * 9, tuv.getY(q) * 12);
      const tg = tg0.toNonIndexed(); tg.computeVertexNormals();
      const tri = new THREE.Mesh(tg, M.glassB); tri.position.set(310, 84.5, -86); tri.castShadow = tri.receiveShadow = true; tri.name = 'w_tri'; root.add(tri);
      put('roof', cyl(22.5, 22.5, 1, 3), 310, 169.5, -86); addCol(293, -97, 327, -66, 169);
      building(285, -32, 32, 32, 43, 'glassA', { fh: 3.6, shop: false, tower: true });
      vbox(0xcc2222, 0.6, 0.6, 0.6, 262, 193.3, -86); vbox(0xcc2222, 0.6, 0.6, 0.6, 310, 170.3, -86);
      for (const [bx, bz] of [[278, -62], [292, -62], [285, -70]]) benches.push([bx, 0, bz, R() * 6, 1]);
      for (const x of [246, 285, 324]) lamps.push([x, 0, -112, -PI / 2, 1]);
    } else if (key === '0,8') {           // old Jaffa hill + clock tower
      flat('prom', x0, z0, x1, z1, 0.04, 3); zones.push({ x0, z0, x1, z1, t: 'plaza' });
      sbox('stone', 62, 5, 66, -274, 2.5, 432); sbox('stone', 46, 5, 48, -274, 7.5, 432); cbox(-274, 432, 62, 66, 5);
      building(-274, 432, 30, 30, 3, 'jaffa', { y: 10, shop: false }); building(-262, 424, 7, 7, 4, 'jaffa', { y: 19.6, shop: false });
      put('vc', col(new THREE.ConeGeometry(5.6, 6, 4).rotateY(PI / 4), 0xb5533c), -262, 35.4, 424);
      sbox('stone', 5, 24, 5, -236, 12, 384); put('vc', col(new THREE.ConeGeometry(4, 4.5, 4).rotateY(PI / 4), 0x8a8f96), -236, 26.2, 384); cbox(-236, 384, 5, 5, 28);
      for (let q = 0; q < 4; q++) { const a = q * PI / 2; put('vc', col(cyl(1.5, 1.5, 0.16, 20).rotateX(PI / 2), 0xf7f3e3), -236 + Math.sin(a) * 2.56, 19.5, 384 + Math.cos(a) * 2.56, a); vbox(0x222222, 0.14, 1.1, 0.06, -236 + Math.sin(a) * 2.68, 19.9, 384 + Math.cos(a) * 2.68, a); }
      for (let q = 0; q < 8; q++) palms.push([rr(x0 + 2, x1 - 2), 0, q < 4 ? rr(z0 + 1, 396) : rr(467, z1), R() * 6, rr(0.8, 1.1)]);
      for (const x of [-300, -250]) { lamps.push([x, 0, 378, PI, 1]); benches.push([x + 8, 0, 392, PI, 1]); }
    } else if (key === '3,1') {           // city park
      flat('grass', x0, z0, x1, z1, 0.03, 3); flat('prom', x0, cz - 2.5, x1, cz + 2.5, 0.07, 3); zones.push({ x0, z0: cz - 2.5, x1, z1: cz + 2.5, t: 'plaza' }, { x0, z0, x1, z1, t: 'grass' });
      for (let q = 0; q < 30; q++) { const tz = rr(z0 + 3, z1 - 3); if (Math.abs(tz - cz) > 5) trees.push([rr(x0 + 3, x1 - 3), 0, tz, R() * 6, rr(0.9, 1.5)]); }
      for (let x = x0 + 10; x < x1; x += 20) { benches.push([x, 0, cz - 3.4, 0, 1]); lamps.push([x + 10, 0, cz + 3.2, PI / 2, 1]); }
    } else {
      const st = styleOf(i, j, cx, cz);
      if (st) fillBlock(x0, z0, x1, z1, st); else fillBiz(x0, z0, x1, z1);
    }
  });

  // ---- promenade + beach + pier
  safe('coast', () => {
    const sp = world.spawn; let n = 0;
    for (let z = ZL[0] + 4; z < 574; z += 13, n++) {
      if (Math.abs(z - sp.z) < 9) continue;
      palms.push([PROM - 4, 0, z, R() * 6, rr(0.9, 1.15), Math.abs(z - sp.z) < 170 ? 1 : 0]);
      if (n % 2) palms.push([BEACH + 3, 0, z + 6, R() * 6, rr(0.85, 1.1)]);
      if (n % 3 === 0) lamps.push([BEACH + 2, 0, z + 2, 0, 1]);
      if (n % 3 === 1) benches.push([BEACH + 4.5, 0, z, -PI / 2, 1]);
    }
    const UC = [0xe63946, 0x2d6cdf, 0xf4d35e, 0xffffff, 0x2a9d8f, 0xff7a1a], huts = [-420, -60, 240], nets = [-150, 100, -330];
    for (let z = -596; z < 280; z += 9) for (const x of [-372, -384, -396]) {
      if (R() > 0.7 || huts.some((h) => Math.abs(z - h) < 8) || nets.some((h) => Math.abs(z - h) < 11 && x < -376)) continue;
      const ux = x + rr(-1.5, 1.5), uz = z + rr(-2, 2), y = groundY(ux, uz), c = pk(UC);
      umbrellas.push([ux, y, uz, R() * 6, rr(0.9, 1.1), c]);
      sunbeds.push([ux - 1.1, y, uz + 0.3, PI / 2 + rr(-0.2, 0.2), 1, 0xffffff]); if (R() < 0.7) sunbeds.push([ux + 1.1, y, uz - 0.2, PI / 2 + rr(-0.2, 0.2), 1, c]);
    }
    for (const z of huts) {
      const x = -405;
      for (const [dx, dz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) vbox(0x8b6b4a, 0.16, 3, 0.16, x + dx, 1.1, z + dz);
      vbox(0xb58a5a, 4.4, 0.15, 4.4, x, 2.5, z); vbox(0xf4f1e6, 3.2, 2.3, 3.2, x, 3.7, z); vbox(0xd9442b, 4, 0.22, 4, x, 4.95, z); vbox(0x2d6cdf, 3.24, 0.5, 3.24, x, 3.0, z);
      vbox(0x444444, 0.06, 2.4, 0.06, x + 1.5, 6.2, z + 1.5); vbox(0xffffff, 1.0, 0.6, 0.04, x + 2.0, 7.0, z + 1.5); cbox(x, z, 3.4, 3.4, 5);
    }
    for (const z of nets) { vbox(0x555555, 0.12, 2.9, 0.12, -386, 1.2, z - 4.6); vbox(0x555555, 0.12, 2.9, 0.12, -386, 1.2, z + 4.6); vbox(0xffffff, 0.05, 0.95, 9.2, -386, 2.1, z); }
    // pier + boats
    put('wood', ubox(54, 0.6, 6, 9, 1, 0.1), -441, -0.24, 300); flats.push({ x0: -468, x1: BEACH, z0: 297, z1: 303 });
    for (let x = -466; x <= -424; x += 7) { vbox(0x5a4630, 0.35, 3.4, 0.35, x, -1.3, 297.2); vbox(0x5a4630, 0.35, 3.4, 0.35, x, -1.3, 302.8); }
    for (let k = 0; k < 6; k++) {
      const bx = -428 - k * 7, bz = 300 + (k % 2 ? 1 : -1) * 7;
      vbox(pk([0xffffff, 0x2d6cdf, 0xd9442b, 0xf4d35e, 0x2a9d8f]), 2.4, 1.2, 6.5, bx, -0.05, bz); vbox(0xffffff, 1.6, 0.9, 2.2, bx, 1.0, bz - 0.6); vbox(0xdddddd, 0.08, 5, 0.08, bx, 3.1, bz + 0.9);
    }
    lamps.push([-420, 0, 303.4, PI / 2, 1], [-445, 0, 303.4, PI / 2, 1], [-466, 0, 303.4, PI / 2, 1]);
    // Rothschild kiosks
    for (const x of [-240, -130, -20, 90, 200]) {
      vbox(0xf2efe6, 3.6, 2.8, 2.5, x, 1.4, 130.2); vbox(pk([0x1f7a4d, 0xd9442b, 0x2d6cdf]), 4.2, 0.14, 1.5, x, 2.75, 128.4); vbox(0x3a2a1a, 3.2, 1.0, 0.08, x, 1.9, 128.93); cbox(x, 130.2, 3.6, 2.5, 3);
      benches.push([x + 5, 0, 130.4, PI, 1]);
    }
  });

  // ---- billboards
  safe('billboards', () => {
    let bn = 0;
    const board = (x, y, z, ry, w, h) => { put('bb' + (bn++ % 8), new THREE.PlaneGeometry(w, h), x, y, z, ry); vbox(0x2a2e34, w + 0.5, h + 0.5, 0.2, x - Math.sin(ry) * 0.14, y, z - Math.cos(ry) * 0.14, ry); };
    for (let z = -540; z <= 420; z += 120) { vbox(0x444a52, 0.5, 9, 0.5, XL[7] + 9.4, 4.5, z); board(XL[7] + 9.0, 11.6, z, -PI / 2, 12, 6); }
    for (let k = 0; k < 14 && roofs.length; k++) {
      const r = roofs[Math.floor((k + 0.5) * roofs.length / 14)], ry = FACE_RY[r.face], D = r.face < 2 ? r.w : r.d, W = r.face < 2 ? r.d : r.w, w = Math.min(11, W - 2), h = w * 0.5;
      const px = r.x + Math.sin(ry) * (D / 2 - 0.4), pz = r.z + Math.cos(ry) * (D / 2 - 0.4);
      board(px, r.top + 1 + h / 2, pz, ry, w, h);
      vbox(0x444a52, 0.2, 1.2, 0.2, px + Math.cos(ry) * w * 0.3, r.top + 0.5, pz - Math.sin(ry) * w * 0.3); vbox(0x444a52, 0.2, 1.2, 0.2, px - Math.cos(ry) * w * 0.3, r.top + 0.5, pz + Math.sin(ry) * w * 0.3);
    }
  });

  // ---- merge static batches
  const NOSHADOW = new Set(['pave', 'road', 'mark', 'prom', 'tiles', 'grass', 'wood', 'water', 'sign']);
  for (const k in B) safe('merge:' + k, () => {
    const list = B[k]; if (!list.length) return;
    const vcb = k === 'vc';
    for (const gq of list) {
      for (const a of Object.keys(gq.attributes)) if (a !== 'position' && a !== 'normal' && a !== 'uv' && !(vcb && a === 'color')) gq.deleteAttribute(a);
      if (vcb && !gq.attributes.color) col(gq, 0xffffff);
    }
    const geo = mergeGeometries(list, false); if (!geo) return;
    const m = new THREE.Mesh(geo, M[k] || M.vc); m.castShadow = !NOSHADOW.has(k) && !k.startsWith('bb'); m.receiveShadow = true; m.name = 'w_' + k; root.add(m);
    for (const gq of list) gq.dispose(); B[k] = [];
  });

  // ---- instanced props
  safe('props', () => {
    const treeGeo = mg([col(cyl(0.14, 0.22, 2.8, 5).translate(0, 1.4, 0), 0x6b4a2f), col(sph(1.9).scale(1, 0.85, 1).translate(0, 4.1, 0), 0x3f8a3a), col(sph(1.3, 6, 4).translate(0.9, 3.4, 0.5), 0x4c9a45), col(sph(1.2, 6, 4).translate(-0.8, 3.6, -0.6), 0x357a33)]);
    inst(root, treeGeo, M.vc, trees, true);
    const fr = [];
    for (let k = 0; k < 9; k++) {
      const gq = new THREE.PlaneGeometry(1, 3.6, 1, 4), p = gq.attributes.position;
      for (let q = 0; q < p.count; q++) { const t = (p.getY(q) + 1.8) / 3.6; p.setXYZ(q, p.getX(q) * (1 - 0.75 * t), 1.3 * t - 2.4 * t * t + (k % 2) * 0.25, 0.2 + t * 3.3); }
      gq.computeVertexNormals(); gq.rotateY(k * PI * 2 / 9); gq.translate(0, 7.2, 0); fr.push(col(gq, k % 2 ? 0x4a8f35 : 0x3f7d2c));
    }
    const palmGeo = mg([col(cyl(0.15, 0.26, 7.2, 6).translate(0, 3.6, 0), 0x8d7556), col(sph(0.42, 6, 4).translate(0, 7.2, 0), 0x6f5a3c), ...fr]);
    const hero = palmGlb ? palms.filter((p) => p[5] === 1) : [], rest = palmGlb ? palms.filter((p) => p[5] !== 1) : palms;
    inst(root, palmGeo, M.vcD, rest.map((p) => [p[0], p[1], p[2], p[3], p[4]]), true);
    if (palmGlb) inst(root, palmGlb.geo, palmGlb.mat, hero.map((p) => [p[0], 0, p[2], p[3], p[4] * 9 / palmGlb.h]), true);
    const lampGeo = mg([col(cyl(0.08, 0.13, 7, 6).translate(0, 3.5, 0), 0x3a3f45), col(box(1.7, 0.09, 0.09).translate(0.8, 6.95, 0), 0x3a3f45), col(box(0.7, 0.14, 0.3).translate(1.5, 6.9, 0), 0x2a2d31)]);
    inst(root, lampGeo, M.vc, lamps, false); inst(root, box(0.6, 0.06, 0.24).translate(1.5, 6.8, 0), M.glow, lamps, false);
    const benchGeo = mg([col(box(1.8, 0.08, 0.5).translate(0, 0.45, 0), 0xa67c52), col(box(1.8, 0.5, 0.08).translate(0, 0.78, -0.23), 0xa67c52), col(box(0.08, 0.45, 0.5).translate(-0.8, 0.22, 0), 0x333333), col(box(0.08, 0.45, 0.5).translate(0.8, 0.22, 0), 0x333333)]);
    inst(root, benchGeo, M.vc, benches, true);
    const dudGeo = mg([col(cyl(0.32, 0.32, 1.25, 8).rotateZ(PI / 2).translate(0, 1.05, -0.2), 0xf2f2f2), col(box(1.35, 0.06, 1.7).rotateX(0.6).translate(0, 0.55, 0.75), 0x18284a), col(box(1.2, 0.7, 0.08).translate(0, 0.35, -0.2), 0x9a9a9a)]);
    inst(root, dudGeo, M.vc, duds, false);
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide });
    inst(root, mg([new THREE.ConeGeometry(1.7, 0.6, 8).translate(0, 2.35, 0), cyl(0.04, 0.04, 2.3, 5).translate(0, 1.15, 0)]), white, umbrellas, true);
    inst(root, mg([box(0.7, 0.12, 1.9).translate(0, 0.3, 0), box(0.7, 0.5, 0.1).rotateX(-0.5).translate(0, 0.45, -0.9)]), white, sunbeds, false);
  });

  // ---- finish
  for (const k in landmarks) { const l = landmarks[k]; if (blocked(l.x, l.z, 0.8)) { const nn = nearestNode(l.x, l.z); l.x = nn.x + HW + 2; l.z = nn.z + HW + 2; } }
  if (blocked(world.spawn.x, world.spawn.z, 0.6)) resolveCircle(world.spawn, 1);
  if (GG.scene) GG.scene.add(root);
  world.object3d = root;
  update(0);
}

// ------------------------------------------------------------------ update: night glow
export function update() {
  const s = G.sky; let nf = 0;
  if (s) {
    if (typeof s.nightFactor === 'number') nf = s.nightFactor;
    else if (typeof s.hour === 'number') { const h = s.hour; nf = h >= 19.5 || h <= 5 ? 1 : h >= 17.5 ? (h - 17.5) / 2 : h <= 7 ? (7 - h) / 2 : 0; }
    else if (s.isNight) nf = 1;
  }
  nf = nf < 0 ? 0 : nf > 1 ? 1 : nf;
  if (Math.abs(nf - lastNight) < 0.01) return;
  lastNight = nf;
  for (let i = 0; i < nightMats.length; i++) { const e = nightMats[i]; e[0].emissiveIntensity = e[2] + e[1] * nf; }
}
