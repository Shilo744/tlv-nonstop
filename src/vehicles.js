// vehicles.js - TLV NONSTOP: car models, arcade physics, collisions, traffic AI, parked cars, police steering.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G } from './core.js';

// Hull GLBs have their FRONT at -Z; game heading 0 looks toward +Z. One-line fix if the lead sees cars driving backwards.
const MODEL_YAW = Math.PI;

// L/W = collision length/width, H = hull height, sx = hull x-scale (the hulls are wide hover bodies), clear = ground clearance,
// wr = wheel radius, glass/stripe = [y0,y1] bands (hull-local) painted dark / blue through vertex colours, ly = light height (fraction of H).
const TYPES = {
  taxi:       { file: 'street_taxi_C', hi: 'street_taxi_B', L: 4.4, W: 2.0, H: 1.29, sx: 0.86, clear: 0.22, wr: 0.33, vmax: 33, acc: 9, grip: 8, mass: 1400, glass: [0.2, 0.56], color: 0xf6f6f1 },
  roadster:   { file: 'street_roadster_C', L: 4.4, W: 1.95, H: 1.0, sx: 1, clear: 0.17, wr: 0.33, vmax: 46, acc: 14, grip: 9, mass: 1100, glass: [0.33, 0.47] },
  van:        { file: 'street_van_C', hi: 'street_van_B', L: 5.2, W: 2.2, H: 2.22, sx: 0.8, clear: 0.25, wr: 0.38, vmax: 27, acc: 7, grip: 7, mass: 2400, glass: [0.45, 0.98], ly: 0.25 },
  pickup:     { file: 'street_pickup_C', L: 5.0, W: 2.15, H: 2.04, sx: 1, clear: 0.02, wr: 0.42, vmax: 31, acc: 8.5, grip: 7.5, mass: 2000, glass: [0.75, 0.98], ly: 0.54 },
  police:     { file: 'street_police_C', hi: 'street_police_B', L: 4.6, W: 2.2, H: 1.18, sx: 0.74, clear: 0.24, wr: 0.35, vmax: 43, acc: 13, grip: 9, mass: 1600, glass: [0.38, 0.54], stripe: [-0.22, 0.02], color: 0xf2f5fa, ly: 0.36 },
  scooter:    { file: 'street_bike_scooter_C', L: 1.8, W: 0.7, H: 1.02, sx: 1, clear: 0.08, wr: 0.22, vmax: 15, acc: 7, grip: 9, mass: 120, bike: true, ly: 0.6 },
  sportbike:  { file: 'street_bike_sporty_C', L: 2.2, W: 0.8, H: 0.84, sx: 0.7, clear: 0.2, wr: 0.3, vmax: 48, acc: 16, grip: 9, mass: 220, bike: true, ly: 0.55 },
  policebike: { file: 'street_bike_police_C', L: 2.3, W: 0.8, H: 0.96, sx: 1, clear: 0.16, wr: 0.3, vmax: 42, acc: 14, grip: 9, mass: 260, bike: true, color: 0xf2f5fa, ly: 0.55 },
  courier:    { file: 'courier_C', hi: 'courier_B', L: 4.6, W: 2.2, H: 1.06, sx: 0.62, clear: 0.28, wr: 0.34, vmax: 38, acc: 11, grip: 8.5, mass: 1300, ly: 0.34 },
};
for (const k in TYPES) { const s = TYPES[k]; s.name = k; s.wb = s.L * 0.58; s.brake = s.bike ? 18 : 24; s.geo = null; s.geoHi = null; }

const COLORS = [0xd81e2c, 0x1565c0, 0x0f9d8a, 0xf2a900, 0x2b2d33, 0xe8e9ec, 0x8e9aa6, 0x6a1b9a, 0xff6d3a, 0x1b7f3b, 0x0d2a52, 0xc2185b, 0x4fc3f7];
const TRAFFIC_MIX = ['taxi', 'taxi', 'taxi', 'roadster', 'roadster', 'van', 'van', 'pickup', 'pickup', 'scooter', 'scooter', 'sportbike', 'courier'];
const PARKED_MIX = ['roadster', 'taxi', 'van', 'pickup', 'courier', 'scooter', 'scooter', 'sportbike', 'roadster', 'pickup'];
const TRAFFIC_TARGET = 22, PARKED_TARGET = 25;

const list = [];
const M = {}, GEO = {}, paints = new Map(), usedSpots = new Set(), nodeMap = new Map();
const ctl = { thr: 0, steer: 0, hb: false, boost: false };
const _p = new THREE.Vector3(), _d = new THREE.Vector3();
let nextId = 1, playerVeh = null, ready = false, frame = 0, mgrT = 0, filled = false, lightsOn = false, spot = null, errs = 0;
let LO = 1.9, HW = 5;

// ------------------------------------------------------------------ small helpers
const FX = (n, a, b) => { try { const f = G.fx && G.fx[n]; if (typeof f === 'function') f.call(G.fx, a, b); } catch (e) { /* ignore */ } };
const SND = (n, o) => { try { G.audio?.play?.(n, o); } catch (e) { /* ignore */ } };
const nd = (n) => (n && typeof n === 'object' ? n : nodeMap.get(n));
function nearCam(v, d) { const c = G.camera && G.camera.position; if (!c) return true; const dx = v.pos.x - c.x, dz = v.pos.z - c.z; return dx * dx + dz * dz < d * d; }
function logErr(where, e) { if (errs++ < 6) console.error('[vehicles:' + where + ']', e); }
function tint(g, r, gg, b) {
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = r; a[i * 3 + 1] = gg; a[i * 3 + 2] = b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g;
}
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

// ------------------------------------------------------------------ materials + shared geometry
function paint(color) {
  let m = paints.get(color);
  if (!m) { m = new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06, vertexColors: true, envMapIntensity: 1.2 }); paints.set(color, m); }
  return m;
}
function makeShared() {
  const E = (c, e, i) => new THREE.MeshStandardMaterial({ color: c, emissive: e, emissiveIntensity: i, roughness: 0.4 });
  M.wheel = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.25 });
  M.rider = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  M.headOff = E(0xd9dee4, 0x000000, 0); M.headOn = E(0xffffff, 0xfff1c8, 3.2);
  M.tailOff = E(0x5a0a0a, 0x400000, 0.35); M.tailOn = E(0xa01010, 0xff1808, 1.3); M.tailBrake = E(0xff2010, 0xff1808, 4.5);
  M.red0 = E(0x5a1010, 0x000000, 0); M.red1 = E(0xff2020, 0xff0000, 6);
  M.blue0 = E(0x101a5a, 0x000000, 0); M.blue1 = E(0x2a50ff, 0x0030ff, 7);
  M.burnt = new THREE.MeshStandardMaterial({ color: 0x141211, roughness: 0.95, metalness: 0.3 });
  M.fire = new THREE.MeshBasicMaterial({ color: 0xff7a18, transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false });
  const signTex = canvasTex(256, 96, (x, w, h) => {
    x.fillStyle = '#ffd21a'; x.fillRect(0, 0, w, h); x.strokeStyle = '#111'; x.lineWidth = 8; x.strokeRect(4, 4, w - 8, h - 8);
    x.fillStyle = '#111'; x.font = 'bold 62px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('מונית', w / 2, h / 2 + 4);
  });
  M.sign = new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.75, roughness: 0.5 });
  M.plates = [];
  for (let i = 0; i < 4; i++) {
    const txt = `${10 + ((Math.random() * 89) | 0)}-${100 + ((Math.random() * 899) | 0)}-${10 + ((Math.random() * 89) | 0)}`;
    const t = canvasTex(256, 64, (x, w, h) => {
      x.fillStyle = '#f6c700'; x.fillRect(0, 0, w, h); x.fillStyle = '#1a3fa8'; x.fillRect(0, 0, 26, h);
      x.fillStyle = '#111'; x.font = 'bold 44px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(txt, w / 2 + 12, h / 2 + 3);
    });
    M.plates.push(new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, emissive: 0x2a2200 }));
  }
  const tire = tint(new THREE.CylinderGeometry(1, 1, 1, 18).rotateZ(Math.PI / 2), 0.05, 0.05, 0.055);
  const hubA = tint(new THREE.BoxGeometry(1.06, 1.25, 0.34), 0.75, 0.77, 0.8), hubB = tint(new THREE.BoxGeometry(1.06, 0.34, 1.25), 0.75, 0.77, 0.8);
  GEO.wheel = mergeGeometries([tire, hubA, hubB]) || tire;
  GEO.pair = mergeGeometries([new THREE.BoxGeometry(0.16, 0.1, 0.3).translate(0.5, 0, 0), new THREE.BoxGeometry(0.16, 0.1, 0.3).translate(-0.5, 0, 0)]) || new THREE.BoxGeometry(1, 0.1, 0.3);
  GEO.single = new THREE.BoxGeometry(0.16, 0.12, 0.3);
  GEO.box = new THREE.BoxGeometry(1, 1, 1);
  GEO.fire = new THREE.ConeGeometry(0.4, 1.1, 6);
  const torso = tint(new THREE.CapsuleGeometry(0.19, 0.42, 3, 8).translate(0, 0.42, 0), 0.9, 0.42, 0.08);
  const head = tint(new THREE.SphereGeometry(0.17, 10, 8).translate(0, 0.98, 0.05), 0.92, 0.92, 0.95);
  GEO.rider = mergeGeometries([torso, head]) || torso;
}
// Vertex colours: white everywhere, dark glass band on the cabin sides, blue stripe on police cars. Multiplied by the paint colour.
function paintGeo(g, sp) {
  const pos = g.attributes.position, nor = g.attributes.normal, n = pos.count, c = new Float32Array(n * 3).fill(1);
  if (sp.glass || sp.stripe) for (let i = 0; i < n; i++) {
    const y = pos.getY(i), ny = nor ? Math.abs(nor.getY(i)) : 0;
    if (sp.glass && y > sp.glass[0] && y < sp.glass[1] && ny < 0.72) { c[i * 3] = 0.035; c[i * 3 + 1] = 0.045; c[i * 3 + 2] = 0.06; }
    else if (sp.stripe && y > sp.stripe[0] && y < sp.stripe[1] && ny < 0.8) { c[i * 3] = 0.04; c[i * 3 + 1] = 0.18; c[i * 3 + 2] = 0.78; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
}
function boxGeo(sp) {   // fallback when a GLB is missing: front at -Z like the hulls
  const w = sp.W / (sp.sx || 1), H = sp.H, L = sp.L;
  if (sp.bike) return tint(new THREE.BoxGeometry(0.3, H * 0.6, L * 0.9), 1, 1, 1);
  const a = tint(new THREE.BoxGeometry(w, H * 0.55, L).translate(0, -H * 0.225, 0), 1, 1, 1);
  const b = tint(new THREE.BoxGeometry(w * 0.88, H * 0.45, L * 0.5).translate(0, H * 0.275, L * 0.08), 0.06, 0.07, 0.1);
  return mergeGeometries([a, b]) || a;
}
async function loadGeo(file, sp) {
  try {
    const gltf = await Promise.race([G.assets.loadGLB(`assets/vehicles/${file}.glb`), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))]);
    let mesh = null; gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
    if (!mesh) throw new Error('no mesh');
    const g = mesh.geometry.clone(); g.applyMatrix4(mesh.matrixWorld);   // sporty bike node carries a 180 deg yaw
    if (g.attributes.tangent) g.deleteAttribute('tangent');
    if (!g.attributes.normal) g.computeVertexNormals();
    paintGeo(g, sp); g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  } catch (e) { console.warn('[vehicles] hull fallback for', file, e && e.message); return null; }
}

// ------------------------------------------------------------------ building a vehicle
function spawn(type, x, z, heading = 0, opts) {
  opts = opts || {};
  if (!TYPES[type]) type = 'taxi';
  const sp = TYPES[type];
  if (!sp.geo) sp.geo = boxGeo(sp);
  const o = new THREE.Group(), body = new THREE.Group(); o.add(body);
  const color = opts.color != null ? opts.color : (sp.color != null ? sp.color : G.pick(COLORS));
  const hull = new THREE.Mesh(sp.geo, paint(color));
  hull.rotation.y = MODEL_YAW; hull.scale.x = sp.sx || 1; hull.position.y = sp.clear + sp.H / 2; hull.castShadow = true; body.add(hull);
  const top = sp.clear + sp.H, wheels = [];
  for (const fz of [1, -1]) for (const sx of (sp.bike ? [0] : [1, -1])) {
    const w = new THREE.Mesh(GEO.wheel, M.wheel); w.scale.set(sp.bike ? 0.12 : 0.25, sp.wr, sp.wr);
    w.position.set(sx * (sp.W / 2 - 0.13), sp.wr, fz * sp.L * (sp.bike ? 0.36 : 0.31)); w.rotation.order = 'YXZ'; w.userData.front = fz > 0;
    body.add(w); wheels.push(w);
  }
  const ly = sp.clear + sp.H * (sp.ly || 0.32);
  const headM = new THREE.Mesh(sp.bike ? GEO.single : GEO.pair, M.headOff), tailM = new THREE.Mesh(sp.bike ? GEO.single : GEO.pair, M.tailOff);
  if (!sp.bike) { headM.scale.x = sp.W * 0.68; tailM.scale.x = sp.W * 0.7; }
  headM.position.set(0, ly, sp.L / 2 - 0.135); tailM.position.set(0, ly, -(sp.L / 2 - 0.135)); body.add(headM, tailM);
  if (!sp.bike) {
    const pm = G.pick(M.plates);
    for (const s of [1, -1]) { const pl = new THREE.Mesh(GEO.box, pm); pl.scale.set(0.5, 0.12, 0.03); pl.position.set(0, sp.clear + sp.H * 0.16, s * (sp.L / 2 + 0.012)); if (s < 0) pl.rotation.y = Math.PI; body.add(pl); }
  }
  let barR = null, barB = null, rider = null, sign = null;
  if (type === 'taxi') { sign = new THREE.Mesh(GEO.box, M.sign); sign.scale.set(0.62, 0.2, 0.2); sign.position.set(0, top + 0.08, -0.2); body.add(sign); }
  if (type === 'police' || type === 'policebike') {
    const bw = sp.bike ? 0.16 : 0.5, bz = sp.bike ? -sp.L * 0.36 : -0.55;
    barR = new THREE.Mesh(GEO.box, M.red0); barB = new THREE.Mesh(GEO.box, M.blue0);
    barR.scale.set(bw, 0.12, 0.22); barB.scale.set(bw, 0.12, 0.22);
    barR.position.set(bw / 2 + 0.02, top + 0.05, bz); barB.position.set(-bw / 2 - 0.02, top + 0.05, bz); body.add(barR, barB);
  }
  if (sp.bike) { rider = new THREE.Mesh(GEO.rider, M.rider); rider.position.set(0, sp.clear + sp.H * 0.62, -sp.L * 0.12); rider.rotation.x = 0.2; rider.visible = false; body.add(rider); }
  o.position.set(x, 0, z); o.rotation.y = heading;
  const v = {
    id: nextId++, type, spec: sp, pos: o.position, heading, speed: 0, vel: new THREE.Vector3(), object3d: o, body, hull, wheels, headM, tailM, barR, barB, rider, sign,
    radius: sp.bike ? 0.8 : sp.L * 0.42, length: sp.L, width: sp.W, height: top, br: sp.L / 2 + 0.35, cr: sp.bike ? 0.42 : sp.W / 2,
    offs: sp.bike ? [-sp.L * 0.25, sp.L * 0.25] : [-sp.L * 0.3, 0, sp.L * 0.3], mass: sp.mass,
    driver: null, isPolice: type === 'police' || type === 'policebike', isBike: !!sp.bike, health: 100, destroyed: false,
    seatOffset: sp.bike ? new THREE.Vector3(0, sp.clear + sp.H * 0.62, -sp.L * 0.12) : new THREE.Vector3(0.42, sp.clear + 0.28, -0.05),
    ai: null, target: null, sirenOn: false, removed: false, color,
    steer: 0, spin: 0, braking: false, asleep: true, accL: 0, yaw: 0, vl: 0, vy: 0, smokeT: 0, skidT: 0, crashT: -9, fuse: 0, sinking: false, sinkT: 0, sunk: false, deadT: 0, fire: null, surf: 1,
  };
  v.damage = (amount, from) => damage(v, amount, from);
  v.explode = () => explode(v);
  const mode = opts.ai || null;
  if (mode === 'traffic') { v.driver = 'traffic'; v.ai = { mode, cruise: G.rand(8, 12.5), stuck: 0, lim: 99, to: null }; }
  else if (mode === 'police') { v.driver = 'police'; v.ai = { mode, stuck: 0, revT: 0, revS: 0 }; }
  else if (mode === 'parked') v.ai = { mode };
  o.userData.vehicle = v;
  if (G.scene) G.scene.add(o);
  list.push(v);
  return v;
}
function remove(v) {
  if (!v || v.removed) return;
  v.removed = true;
  const i = list.indexOf(v); if (i >= 0) list.splice(i, 1);
  if (v.object3d && v.object3d.parent) v.object3d.parent.remove(v.object3d);
  if (v.spot) usedSpots.delete(v.spot);
  if (playerVeh === v) playerVeh = null;
}
function nearest(pos, maxDist = Infinity, filterFn) {
  let best = null, bd = maxDist;
  if (!pos) return null;
  for (let i = 0; i < list.length; i++) {
    const v = list[i]; if (v.destroyed || v.sinking) continue;
    const d = Math.hypot(v.pos.x - pos.x, v.pos.z - pos.z);
    if (d < bd && (!filterFn || filterFn(v))) { bd = d; best = v; }
  }
  return best;
}
function setPlayerVehicle(v) {
  if (v && (!v.spec || v.removed)) v = null;
  if (playerVeh && playerVeh !== v && playerVeh.driver === 'player') { playerVeh.driver = null; playerVeh.steer = 0; }
  playerVeh = v;
  if (v) {
    v.driver = 'player'; v.ai = null; v.keep = true; v.asleep = false;
    if (v.spec.geoHi && !v.destroyed) v.hull.geometry = v.spec.geoHi;
  }
}
// Ray vs oriented bounding boxes. Returns { vehicle, dist, point } or null.
function raycast(origin, dir, maxDist = 120) {
  let best = null, bt = maxDist;
  for (let i = 0; i < list.length; i++) {
    const v = list[i];
    const rx = origin.x - v.pos.x, ry = origin.y - v.pos.y, rz = origin.z - v.pos.z;
    const along = -(rx * dir.x + ry * dir.y + rz * dir.z);
    if (along < -v.br - 1 || along > bt + v.br + 1) continue;
    const sh = Math.sin(v.heading), ch = Math.cos(v.heading);
    const o = [rx * ch - rz * sh, ry, rx * sh + rz * ch], d = [dir.x * ch - dir.z * sh, dir.y, dir.x * sh + dir.z * ch];
    const mn = [-v.width / 2, 0, -v.length / 2], mx = [v.width / 2, v.height, v.length / 2];
    let t0 = 0, t1 = bt, ok = true;
    for (let k = 0; k < 3 && ok; k++) {
      if (Math.abs(d[k]) < 1e-6) { if (o[k] < mn[k] || o[k] > mx[k]) ok = false; }
      else { let a = (mn[k] - o[k]) / d[k], b = (mx[k] - o[k]) / d[k]; if (a > b) { const t = a; a = b; b = t; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) ok = false; }
    }
    if (ok && t0 < bt) { bt = t0; best = v; }
  }
  if (!best) return null;
  return { vehicle: best, dist: bt, point: new THREE.Vector3(origin.x + dir.x * bt, origin.y + dir.y * bt, origin.z + dir.z * bt) };
}

// ------------------------------------------------------------------ damage / destruction
function damage(v, amount, from) {
  if (!v || v.destroyed || !(amount > 0)) return;
  if (v.driver === 'player' && G.settings && G.settings.invincible) return;
  if (v.driver === 'police' && from === 'crash') amount *= 0.3;
  v.health -= amount; v.asleep = false;
  if (v.driver === 'traffic' && v.ai && from !== 'crash') v.ai.panicT = G.time + 7;
  if (v.health <= 0) {
    if (from === 'explosion') { v.health = 0.5; v.fuse = 0.2 + Math.random() * 0.5; }
    else if (amount >= 40 && from !== 'crash') explode(v);
    else v.health = 4;   // on fire: burns down and blows up in about a second
  }
}
function hoodPos(v) { const o = v.length * 0.3; return new THREE.Vector3(v.pos.x + Math.sin(v.heading) * o, v.pos.y + v.height * 0.85, v.pos.z + Math.cos(v.heading) * o); }
function eject(v) {
  const P = G.player; if (!P) return;
  try { if (typeof P.exitVehicle === 'function') P.exitVehicle(true); } catch (e) { /* ignore */ }
  if (P.inVehicle === v) {
    P.inVehicle = null; if (P.object3d) P.object3d.visible = true;
    if (P.pos) { P.pos.x = v.pos.x + Math.cos(v.heading) * (v.width / 2 + 1); P.pos.z = v.pos.z - Math.sin(v.heading) * (v.width / 2 + 1); }
    G.events.emit('player:exitVehicle', { vehicle: v });
  }
  if (playerVeh === v) setPlayerVehicle(null);
}
function explode(v) {
  if (!v || v.destroyed) return;
  v.destroyed = true; v.health = 0; v.deadT = G.time; v.fuse = 0;
  const p = v.pos.clone(); p.y += 0.7;
  const hadPlayer = v === playerVeh || (G.player && G.player.inVehicle === v);
  FX('explosion', p, v.isBike ? 0.7 : 1.3); SND('explosion', { pos: p });
  if (!(G.settings && G.settings.reducedMotion) && nearCam(v, 60)) FX('shake', 0.8);
  v.hull.material = M.burnt; if (v.rider) v.rider.visible = false; if (v.sign) v.sign.material = M.burnt;
  v.driver = null; v.ai = null; v.sirenOn = false; v.vy = 5; v.asleep = false;
  if (!v.fire) { v.fire = new THREE.Mesh(GEO.fire, M.fire); v.fire.position.set(0, v.height * 0.7 + 0.4, 0); v.body.add(v.fire); }
  v.fire.visible = true;
  G.events.emit('vehicle:destroyed', { vehicle: v, pos: p });
  try {
    if (hadPlayer) { G.player?.damage?.(100, 'explosion'); if (G.player && G.player.inVehicle === v && G.player.alive !== false) eject(v); if (playerVeh === v) playerVeh = null; }
    const R = 7.5;
    for (const a of G.actors || []) { if (!a || !a.alive || !a.pos) continue; const d = Math.hypot(a.pos.x - p.x, a.pos.z - p.z); if (d < R) a.damage?.(130 * (1 - d / R), 'explosion'); }
    for (let i = 0; i < list.length; i++) {
      const o = list[i]; if (o === v || o.destroyed) continue;
      const dx = o.pos.x - p.x, dz = o.pos.z - p.z, d = Math.hypot(dx, dz);
      if (d < R) { damage(o, 75 * (1 - d / R), 'explosion'); const k = 6 * (1 - d / R) / (d || 1); o.vel.x += dx * k; o.vel.z += dz * k; }
    }
    const P = G.player;
    if (P && P.pos && !P.inVehicle && !hadPlayer) { const d = Math.hypot(P.pos.x - p.x, P.pos.z - p.z); if (d < R) P.damage?.(80 * (1 - d / R), 'explosion'); }
  } catch (e) { logErr('explode', e); }
}
function burn(v, dt) {
  if (v.destroyed) {
    const hot = G.time - v.deadT < 16;
    if (v.fire) { v.fire.visible = hot; if (hot) v.fire.scale.setScalar(0.8 + Math.random() * 0.6); }
    if (hot && (v.smokeT -= dt) <= 0 && nearCam(v, 120)) { v.smokeT = 0.3; FX('smoke', hoodPos(v)); }
    return;
  }
  if (v.health >= 40) { if (v.fire) v.fire.visible = false; return; }
  const onFire = v.health < 18;
  if ((v.smokeT -= dt) <= 0 && nearCam(v, 120)) { v.smokeT = onFire ? 0.1 : 0.3; FX('smoke', hoodPos(v), { dark: onFire }); }
  if (onFire) {
    if (!v.fire) { v.fire = new THREE.Mesh(GEO.fire, M.fire); v.fire.position.set(0, v.height * 0.7 + 0.3, v.length * 0.28); v.body.add(v.fire); }
    v.fire.visible = true; v.fire.scale.setScalar(0.6 + Math.random() * 0.5);
    v.health -= 3.2 * dt; if (v.health <= 0) explode(v);
  }
}
function crash(v, imp, x, z, quiet) {
  damage(v, (imp - 2.5) * (v.isBike ? 2.2 : 1.5), 'crash');
  if (G.time - v.crashT < 0.35) return;
  v.crashT = G.time;
  const pos = new THREE.Vector3(x, v.pos.y + 0.6, z);
  if (!quiet && nearCam(v, 90)) { FX('sparks', pos); SND(imp > 13 ? 'crash_big' : imp > 5 ? 'crash' : 'bump', { pos, volume: Math.min(1, 0.3 + imp / 20) }); }
  if (imp > 4) G.events.emit('vehicle:crash', { vehicle: v, speed: imp, pos });
  if (v === playerVeh && !(G.settings && G.settings.reducedMotion)) FX('shake', Math.min(1, imp / 22));
}

// ------------------------------------------------------------------ controls
function drive(v, want, power) {
  const s = v.speed;
  if (want < 0.4) { if (s > 1.3) ctl.thr = -1; else ctl.hb = true; }
  else if (s < want - 0.4) ctl.thr = power;
  else if (s > want + 1.2 && s > 1.3) ctl.thr = s > want + 4 ? -1 : -0.45;
}
// Allowed speed given what is right ahead (other vehicles, pedestrians, the player on foot).
function sense(v, pedsOnly) {
  const sh = Math.sin(v.heading), ch = Math.cos(v.heading), s = Math.max(0, v.speed), hl = v.length * 0.5, hw = v.width * 0.5, look = 5 + s * 1.3;
  let lim = 99, ped = false;
  if (!pedsOnly) for (let i = 0; i < list.length; i++) {
    const o = list[i]; if (o === v || (o.asleep && o.ai && o.ai.mode === 'parked')) continue;
    const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z, fz = dx * sh + dz * ch;
    if (fz < 0.5 || fz > look + hl + o.length * 0.5) continue;
    if (Math.abs(dx * ch - dz * sh) > hw + Math.min(o.width, 2) * 0.5 - 0.05) continue;
    const l = Math.max(0, (fz - hl - o.length * 0.5 - 1.8) * 1.1); if (l < lim) lim = l;
  }
  const A = G.actors, reach = hl + 3.5 + s * 0.9;
  if (A) for (let i = 0; i < A.length; i++) {
    const a = A[i]; if (!a || !a.alive || !a.pos) continue;
    const dx = a.pos.x - v.pos.x, dz = a.pos.z - v.pos.z, fz = dx * sh + dz * ch;
    if (fz < 0 || fz > reach || Math.abs(dx * ch - dz * sh) > hw + 0.7) continue;
    const l = Math.max(0, (fz - hl - 1.6) * 1.3); if (l < lim) { lim = l; ped = true; }
  }
  const P = G.player;
  if (P && P.pos && !P.inVehicle && v !== playerVeh) {
    const dx = P.pos.x - v.pos.x, dz = P.pos.z - v.pos.z, fz = dx * sh + dz * ch;
    if (fz >= 0 && fz <= reach && Math.abs(dx * ch - dz * sh) <= hw + 0.7) { const l = Math.max(0, (fz - hl - 1.6) * 1.3); if (l < lim) { lim = l; ped = true; } }
  }
  if (v.ai) v.ai.ped = ped;
  return lim;
}
function segDist(px, pz, a, b) {
  const ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez || 1;
  const t = G.clamp(((px - a.x) * ex + (pz - a.z) * ez) / l2, 0, 1);
  return Math.hypot(px - a.x - ex * t, pz - a.z - ez * t);
}
// Where to steer to reach (tx,tz): straight at it when close, otherwise the next road node on the shortest path (kept in the right lane).
function navAim(v, tx, tz, lane) {
  const nav = v.nav || (v.nav = { t: -1, x: tx, z: tz });
  if (G.time < nav.t) return nav;
  nav.t = G.time + 0.35; nav.x = tx; nav.z = tz;
  const W = G.world;
  if (!W || !W.nearestNode || !W.path || Math.hypot(tx - v.pos.x, tz - v.pos.z) < 30) return nav;
  try {
    const a = W.nearestNode(v.pos.x, v.pos.z), b = W.nearestNode(tx, tz);
    if (!a || !b || a === b) return nav;
    const p = W.path(a.id, b.id); if (!p || p.length < 2) return nav;
    const n0 = nd(p[0]), n1 = nd(p[1]); if (!n0 || !n1) return nav;
    const to = (segDist(v.pos.x, v.pos.z, n0, n1) < HW + 3 || Math.hypot(v.pos.x - n0.x, v.pos.z - n0.z) < HW + 1) ? n1 : n0;
    let dx = to.x - v.pos.x, dz = to.z - v.pos.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    nav.x = to.x - dz * lane; nav.z = to.z + dx * lane;
  } catch (e) { /* keep straight line */ }
  return nav;
}
function ctlPlayer(v, dt) {
  const I = G.input, S = G.settings || {};
  let thr = I.axis.y, st = I.axis.x;
  if (I.padDown(7)) thr = 1; else if (I.padDown(6)) thr = -1;
  ctl.hb = I.down('Space') || I.padDown(0);
  ctl.boost = I.down('ShiftLeft') || I.down('ShiftRight');
  if (S.oneHanded) {
    const m = I.mouse;
    v.ohx = m.locked ? G.clamp((v.ohx || 0) + m.dx * 0.004, -1, 1) : G.clamp(m.nx * 1.8, -1, 1);
    if (Math.abs(st) < 0.1 && Math.abs(v.ohx) > 0.06) st = v.ohx;
    if (thr === 0) thr = I.mouseDown(0) ? 1 : I.mouseDown(2) ? -1 : 0;
  }
  const tg = (G.missions && G.missions.active && G.missions.active.target) || v.target;
  if (S.driveAssist && tg && typeof tg.x === 'number' && typeof tg.z === 'number' && thr > 0) {
    const aim = navAim(v, tg.x, tg.z, LO);
    const diff = G.angleDiff(v.heading, Math.atan2(aim.x - v.pos.x, aim.z - v.pos.z));
    if (Math.abs(st) < 0.3) st = G.clamp(-diff * 2.4, -1, 1);
    let want = Math.max(5, v.spec.vmax * 0.6 * (1 - 0.65 * Math.min(1, Math.abs(diff) / 0.8)));
    if (frame % 3 === 0) v.assistLim = sense(v, false);
    want = Math.min(want, v.assistLim == null ? 99 : v.assistLim);
    const dT = Math.hypot(tg.x - v.pos.x, tg.z - v.pos.z); if (dT < 12) want = Math.min(want, dT * 0.9);
    if (v.speed > want + 1) { if (v.speed > 1.5) thr = -0.8; else { thr = 0; ctl.hb = true; } ctl.boost = false; }
  }
  ctl.thr = thr; ctl.steer = st;
  if (I.pressed('KeyH')) SND('horn', { pos: v.pos.clone() });
  if (I.pressed('KeyL')) lightsOn = !lightsOn;
  if ((frame & 7) === 0) { let s = null; try { s = G.world.surfaceAt ? G.world.surfaceAt(v.pos.x, v.pos.z) : null; } catch (e) { /* ignore */ } v.surf = s === 'sand' ? 0.6 : s === 'grass' ? 0.82 : 1; }
}
function setSeg(v, from, to, startHere) {
  const ai = v.ai;
  let dx = to.x - (from ? from.x : v.pos.x), dz = to.z - (from ? from.z : v.pos.z);
  const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
  const h = Math.min(HW, l * 0.35), rx = -dz * LO, rz = dx * LO;
  ai.bx = to.x + rx - dx * h; ai.bz = to.z + rz - dz * h;
  if (startHere || !from) { ai.ax = v.pos.x; ai.az = v.pos.z; } else { ai.ax = from.x + rx + dx * h; ai.az = from.z + rz + dz * h; }
  ai.from = from; ai.to = to;
  const cand = [], hd = Math.atan2(dx, dz);
  for (const id of to.links || []) { const n = nd(id); if (n && n !== from && n !== to) cand.push(n); }
  let next = cand.length ? G.pick(cand) : (from || null);
  if (cand.length > 1 && Math.random() < 0.5) { let bd = 9; for (const n of cand) { const d = Math.abs(G.angleDiff(hd, Math.atan2(n.x - to.x, n.z - to.z))); if (d < bd) { bd = d; next = n; } } }
  ai.next = next;
  ai.turn = next ? Math.abs(G.angleDiff(hd, Math.atan2(next.x - to.x, next.z - to.z))) : 3;
}
function aiInit(v, pt) {
  const W = G.world, sh = Math.sin(v.heading), ch = Math.cos(v.heading);
  let to = null, from = null;
  try {
    if (pt) {
      const a = nd(pt.nodeA), b = nd(pt.nodeB);
      if (a && b) { const da = (a.x - v.pos.x) * sh + (a.z - v.pos.z) * ch, db = (b.x - v.pos.x) * sh + (b.z - v.pos.z) * ch; if (db >= da) { to = b; from = a; } else { to = a; from = b; } }
    }
    if (!to && W && W.nearestNode) {
      const n = W.nearestNode(v.pos.x, v.pos.z);
      if (n) {
        if ((n.x - v.pos.x) * sh + (n.z - v.pos.z) * ch > 4) to = n;
        else { from = n; let bd = 9; for (const id of n.links || []) { const m = nd(id); if (!m) continue; const d = Math.abs(G.angleDiff(v.heading, Math.atan2(m.x - n.x, m.z - n.z))); if (d < bd) { bd = d; to = m; } } }
      }
    }
  } catch (e) { to = null; }
  if (!to) return false;
  setSeg(v, from, to, true);
  return true;
}
function ctlTraffic(v, dt) {
  const ai = v.ai; if (!ai) return;
  if (!ai.to && !aiInit(v, null)) { ctl.hb = true; ai.stuck += dt; if (ai.stuck > 3) ai.dead = true; return; }
  let ex = ai.bx - ai.ax, ez = ai.bz - ai.az, len = Math.hypot(ex, ez);
  let t = len > 0.5 ? ((v.pos.x - ai.ax) * ex + (v.pos.z - ai.az) * ez) / len : len;
  if (t > len - 2) {
    if (!ai.next) { ai.dead = true; ctl.hb = true; return; }
    setSeg(v, ai.to, ai.next, false);
    ex = ai.bx - ai.ax; ez = ai.bz - ai.az; len = Math.hypot(ex, ez);
    t = len > 0.5 ? ((v.pos.x - ai.ax) * ex + (v.pos.z - ai.az) * ez) / len : 0;
  }
  const il = 1 / (len || 1); ex *= il; ez *= il;
  const ta = Math.min(Math.max(t + 4.5 + Math.abs(v.speed) * 0.55, 1.5), len + 1.5);
  const diff = G.angleDiff(v.heading, Math.atan2(ai.ax + ex * ta - v.pos.x, ai.az + ez * ta - v.pos.z));
  ctl.steer = G.clamp(-diff * 2.4, -1, 1);
  const panic = G.time < (ai.panicT || 0);
  let want = ai.cruise * (panic ? 1.9 : 1);
  if (len - t < 10 + v.speed && ai.turn > 0.5) want = Math.min(want, panic ? 8 : 5.5);
  if (Math.abs(diff) > 0.45) want = Math.min(want, 4.5);
  if ((frame + v.id) % 3 === 0) ai.lim = sense(v, false);
  let lim = ai.lim;
  if (G.time < (ai.crawlT || 0) && !ai.ped) lim = Math.max(lim, 2.2);
  want = Math.min(want, lim);
  drive(v, want, panic ? 1 : 0.65);
  if (Math.abs(v.speed) < 0.6) {
    ai.stuck += dt;
    if (ai.stuck > 2.5 && lim < 0.6 && G.time > (ai.honkT || 0) && nearCam(v, 45)) { ai.honkT = G.time + G.rand(3, 7); SND('horn', { pos: v.pos.clone(), volume: 0.5 }); }
    if (ai.stuck > 6) ai.crawlT = G.time + 2.5;
    if (ai.stuck > 14 && !nearCam(v, 55)) ai.dead = true;
  } else if (v.speed > 1.5) ai.stuck = 0;
}
function ctlPolice(v, dt) {
  const t = v.target, ai = v.ai || (v.ai = { mode: 'police', stuck: 0, revT: 0, revS: 0 });
  if (!t || typeof t.x !== 'number' || typeof t.z !== 'number') { ctl.hb = true; return; }
  if (G.time < ai.revT) { ctl.thr = -1; ctl.steer = ai.revS; return; }
  const aim = navAim(v, t.x, t.z, LO * 0.5);
  const diff = G.angleDiff(v.heading, Math.atan2(aim.x - v.pos.x, aim.z - v.pos.z));
  const dT = Math.hypot(t.x - v.pos.x, t.z - v.pos.z);
  ctl.steer = G.clamp(-diff * 2.6, -1, 1);
  let want = v.spec.vmax * 0.9 * (1 - 0.68 * Math.min(1, Math.abs(diff) / 0.9));
  if (dT < 14) want = Math.min(want, 4 + dT * 0.9);
  if (dT < 5) want = 0;
  if ((frame + v.id) % 3 === 0) ai.lim = sense(v, true);
  want = Math.min(want, ai.lim == null ? 99 : ai.lim);
  drive(v, want, 1);
  if (want > 2 && Math.abs(v.speed) < 1) { ai.stuck += dt; if (ai.stuck > 1.2) { ai.stuck = 0; ai.revT = G.time + 1.3; ai.revS = diff > 0 ? 1 : -1; } } else ai.stuck = 0;
}

// ------------------------------------------------------------------ physics
function physics(v, dt) {
  const sp = v.spec, sh = Math.sin(v.heading), ch = Math.cos(v.heading), isP = v.driver === 'player';
  let vf = v.vel.x * sh + v.vel.z * ch, vl = -v.vel.x * ch + v.vel.z * sh;   // forward / right components
  const pvf = vf, hurt = v.health < 30 ? 0.75 : 1, surf = isP ? v.surf : 1;
  const vmax = sp.vmax * (ctl.boost ? 1.25 : 1) * hurt * surf;
  let braking = false;
  if (ctl.thr > 0) {
    if (vf < -1) { vf = Math.min(0, vf + sp.brake * ctl.thr * dt); braking = true; }
    else vf += sp.acc * ctl.thr * (ctl.boost ? 1.7 : 1) * hurt * Math.max(0, 1 - Math.pow(Math.max(vf, 0) / vmax, 2)) * dt;
  } else if (ctl.thr < 0) {
    if (vf > 1) { vf = Math.max(0, vf + sp.brake * ctl.thr * dt); braking = true; }
    else vf = Math.max(-vmax * 0.33, vf + sp.acc * 0.7 * ctl.thr * dt);
  } else vf -= Math.sign(vf) * Math.min(Math.abs(vf), 1.6 * dt);
  vf -= vf * (0.1 + (1 - surf) * 1.5) * dt;
  if (vf > vmax) vf -= (vf - vmax) * Math.min(1, 2 * dt);
  if (ctl.hb) { vf -= Math.sign(vf) * Math.min(Math.abs(vf), (v.driver ? 8 : 12) * dt); braking = true; }
  v.steer += (ctl.steer - v.steer) * Math.min(1, dt * (isP ? 8 : 10));
  const sMax = (isP ? 0.62 : 0.93) / (1 + Math.pow(Math.abs(vf) / 10, 1.3));
  const yaw = vf * Math.tan(v.steer * sMax * (ctl.hb ? 1.4 : 1)) / sp.wb;   // positive = turning right
  let g = sp.grip * (ctl.hb ? 0.16 : 1); if (Math.abs(vl) > 7) g *= 0.5;
  vl *= Math.exp(-g * dt);
  v.vel.x = sh * vf - ch * vl; v.vel.z = ch * vf + sh * vl;
  v.heading -= yaw * dt;
  v.pos.x += v.vel.x * dt; v.pos.z += v.vel.z * dt;
  v.speed = vf; v.braking = braking; v.accL = (vf - pvf) / dt; v.yaw = yaw; v.vl = vl;
  if (((ctl.hb && Math.abs(vf) > 6) || Math.abs(vl) > 4.5) && !v.sinking) {
    v.skidT -= dt;
    if (v.skidT <= 0 && nearCam(v, 70)) {
      v.skidT = 0.06; const bz = -v.length * 0.3, p = new THREE.Vector3(v.pos.x + sh * bz, v.pos.y + 0.05, v.pos.z + ch * bz);
      FX('tireSmoke', p); FX('skidMark', p, v.heading);
    }
  }
}
function collideWorld(v, dt) {
  const W = G.world; if (!W || !W.resolveCircle) return;
  const sh = Math.sin(v.heading), ch = Math.cos(v.heading), r = v.cr * 0.92;
  for (let k = 0; k < v.offs.length; k++) {
    const off = v.offs[k], px = v.pos.x + sh * off, pz = v.pos.z + ch * off;
    _p.set(px, 0, pz);
    const hit = W.resolveCircle(_p, r);
    const mx = _p.x - px, mz = _p.z - pz, m2 = mx * mx + mz * mz;
    if (!(m2 > 1e-8) && !hit) continue;
    let nx, nz;
    if (m2 > 1e-8 && isFinite(m2)) { const m = Math.sqrt(m2); nx = mx / m; nz = mz / m; v.pos.x += mx; v.pos.z += mz; }
    else if (hit && isFinite(hit.nx) && isFinite(hit.nz) && (hit.nx || hit.nz)) { nx = hit.nx; nz = hit.nz; }
    else continue;
    const vn = v.vel.x * nx + v.vel.z * nz;
    if (vn < 0) {
      v.vel.x -= nx * vn * 1.25; v.vel.z -= nz * vn * 1.25;
      if (-vn > 2.5) crash(v, -vn, px - nx * r, pz - nz * r, false);
    }
    if (off >= 0 && Math.abs(v.speed) > 1) {   // slide along the wall instead of sticking to it
      const tx = -nz, tz = nx, s = (sh * tx + ch * tz) >= 0 ? 1 : -1;
      v.heading += G.angleDiff(v.heading, Math.atan2(tx * s, tz * s)) * Math.min(1, 2.5 * dt);
    }
  }
}
function ground(v, dt) {
  const W = G.world; let gy = 0;
  try { gy = W.groundY ? W.groundY(v.pos.x, v.pos.z) : 0; } catch (e) { gy = 0; }
  if (!isFinite(gy)) gy = 0;
  if (!v.sinking && ((isFinite(W.seaX) && v.pos.x < W.seaX - 2.5) || gy < -0.7)) {
    v.sinking = true; v.sinkT = 0; FX('splash', v.pos.clone());
    if (v === playerVeh) G.hud?.toast?.('האוטו לא יודע לשחות. גם הביטוח לא.', 3000);
  }
  if (v.sinking) {
    v.sinkT += dt; v.pos.y = Math.max(-2.4, v.pos.y - dt * 0.9);
    v.vel.multiplyScalar(Math.max(0, 1 - 2.5 * dt)); v.body.rotation.x += (0.25 - v.body.rotation.x) * Math.min(1, dt);
    if (v.sinkT > 1) { if (v === playerVeh || (G.player && G.player.inVehicle === v)) eject(v); v.driver = null; v.ai = null; }
    if (v.sinkT > 8) v.sunk = true;
    return;
  }
  if (v.vy) { v.pos.y += v.vy * dt; v.vy -= 22 * dt; if (v.pos.y <= gy) { v.pos.y = gy; v.vy = 0; } }
  else v.pos.y = gy;
}
function visuals(v, dt) {
  const lat = v.speed * v.yaw, b = v.body, k = Math.min(1, dt * 7);
  const roll = v.sinking ? 0 : v.isBike ? G.clamp(lat * 0.05, -0.62, 0.62) : G.clamp(-lat * 0.005 - v.vl * 0.004, -0.1, 0.1);
  b.rotation.z += (roll - b.rotation.z) * k;
  if (!v.sinking) { b.rotation.x += (G.clamp(-v.accL * 0.0045, -0.07, 0.07) - b.rotation.x) * k; b.position.y = Math.sin(G.time * 11 + v.id) * 0.012 * Math.min(1, Math.abs(v.speed) / 12); }
  v.spin += (v.speed / v.spec.wr) * dt;
  const sa = -v.steer * 0.5;
  for (let i = 0; i < v.wheels.length; i++) { const w = v.wheels[i]; w.rotation.x = v.spin; if (w.userData.front) w.rotation.y = sa; }
}
function lights(v) {
  const on = !v.destroyed && !!v.driver && (!!(G.sky && G.sky.isNight) || (v === playerVeh && lightsOn));
  const hs = on ? 1 : 0;
  if (v._hs !== hs) { v._hs = hs; v.headM.material = hs ? M.headOn : M.headOff; }
  const ts = v.destroyed ? 0 : (v.braking && v.driver) ? 2 : on ? 1 : 0;
  if (v._ts !== ts) { v._ts = ts; v.tailM.material = ts === 2 ? M.tailBrake : ts === 1 ? M.tailOn : M.tailOff; }
  if (v.barR) {
    const ph = v.sirenOn && !v.destroyed ? 1 + ((Math.floor(G.time * 7) + v.id) & 1) : 0;
    if (v._ph !== ph) { v._ph = ph; v.barR.material = ph === 1 ? M.red1 : M.red0; v.barB.material = ph === 2 ? M.blue1 : M.blue0; }
  }
  if (v.rider) v.rider.visible = !v.destroyed && (v.driver === 'traffic' || v.driver === 'police');
}
function tick(v, dt) {
  if (v.fuse > 0) { v.fuse -= dt; if (v.fuse <= 0) explode(v); }
  burn(v, dt);
  v.object3d.rotation.y = v.heading;
  v.asleep = !v.driver && !v.vy && !v.sinking && (v.vel.x * v.vel.x + v.vel.z * v.vel.z) < 0.01;
  if (v.asleep) { v.speed = 0; v.braking = false; v.vel.set(0, 0, 0); lights(v); return; }
  ctl.thr = 0; ctl.steer = 0; ctl.hb = false; ctl.boost = false;
  if (v.destroyed || v.sinking) ctl.hb = true;
  else if (v.driver === 'player') ctlPlayer(v, dt);
  else if (v.driver === 'traffic') ctlTraffic(v, dt);
  else if (v.driver === 'police') ctlPolice(v, dt);
  else ctl.hb = true;
  physics(v, dt);
  if (!v.sinking) collideWorld(v, dt);
  ground(v, dt);
  v.object3d.rotation.y = v.heading;
  visuals(v, dt);
  lights(v);
}

// ------------------------------------------------------------------ collisions between things
function collidePairs() {
  for (let i = 0; i < list.length; i++) {
    const a = list[i]; if (a.sinking) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j]; if ((a.asleep && b.asleep) || b.sinking) continue;
      const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z, rr = a.br + b.br;
      if (dx * dx + dz * dz > rr * rr) continue;
      const sa = Math.sin(a.heading), ca = Math.cos(a.heading), sb = Math.sin(b.heading), cb = Math.cos(b.heading), r = a.cr + b.cr;
      let pen = 0, nx = 0, nz = 0, cx = 0, cz = 0;
      for (let p = 0; p < a.offs.length; p++) {
        const ax = a.pos.x + sa * a.offs[p], az = a.pos.z + ca * a.offs[p];
        for (let q = 0; q < b.offs.length; q++) {
          const ex = ax - (b.pos.x + sb * b.offs[q]), ez = az - (b.pos.z + cb * b.offs[q]), d2 = ex * ex + ez * ez;
          if (d2 >= r * r) continue;
          const d = Math.sqrt(d2) || 0.001;
          if (r - d > pen) { pen = r - d; nx = ex / d; nz = ez / d; cx = ax - nx * a.cr; cz = az - nz * a.cr; }
        }
      }
      if (!pen) continue;
      const ma = a.mass * (a.destroyed ? 2 : 1), mb = b.mass * (b.destroyed ? 2 : 1), ta = mb / (ma + mb), tb = 1 - ta;
      a.pos.x += nx * pen * ta; a.pos.z += nz * pen * ta; b.pos.x -= nx * pen * tb; b.pos.z -= nz * pen * tb;
      const rvn = (a.vel.x - b.vel.x) * nx + (a.vel.z - b.vel.z) * nz;
      if (rvn >= 0) continue;
      const jn = -1.35 * rvn / (1 / ma + 1 / mb), imp = -rvn;
      a.vel.x += nx * jn / ma; a.vel.z += nz * jn / ma; b.vel.x -= nx * jn / mb; b.vel.z -= nz * jn / mb;
      a.asleep = false; b.asleep = false;
      if (imp > 2.5) {
        const pv = a === playerVeh ? a : b === playerVeh ? b : null, other = pv === a ? b : a;
        const aggressor = pv && Math.abs(pv.speed) >= Math.abs(other.speed);
        crash(a, imp * (0.6 + 0.8 * ta), cx, cz, false); crash(b, imp * (0.6 + 0.8 * tb), cx, cz, true);
        if (pv && aggressor && imp > 4 && G.time - (pv.crimeT || -9) > 2 && (other.driver === 'traffic' || other.driver === 'police')) {
          pv.crimeT = G.time; G.events.emit('crime', { type: 'hit_car', pos: pv.pos.clone(), severity: other.isPolice ? 2 : 1 });
        }
      }
    }
  }
}
function collideActors() {
  const A = G.actors; if (!A || !A.length) return;
  for (let i = 0; i < list.length; i++) {
    const v = list[i]; if (v.asleep || v.sinking || Math.abs(v.speed) < 2.5) continue;
    const sh = Math.sin(v.heading), ch = Math.cos(v.heading), hw = v.width / 2 + 0.3, hl = v.length / 2 + 0.3, s = Math.abs(v.speed);
    for (let k = 0; k < A.length; k++) {
      const a = A[k]; if (!a || !a.alive || !a.pos) continue;
      const dx = a.pos.x - v.pos.x, dz = a.pos.z - v.pos.z;
      if (Math.abs(dx) > v.br + 0.5 || Math.abs(dz) > v.br + 0.5) continue;
      if (Math.abs(dx * ch - dz * sh) > hw || Math.abs(dx * sh + dz * ch) > hl) continue;
      if (G.time - (a._vehHitT || -9) < 0.7) continue;
      a._vehHitT = G.time;
      const pos = new THREE.Vector3(a.pos.x, a.pos.y + 1, a.pos.z);
      try { if (typeof a.damage === 'function') a.damage(Math.min(200, s * s * 0.5 + 5), 'vehicle'); } catch (e) { logErr('actor.damage', e); }
      FX('hitPuff', pos); SND('hit_body', { pos });
      v.vel.x *= 0.93; v.vel.z *= 0.93;
      if (v.driver === 'player') G.events.emit('crime', { type: a.kind === 'cop' ? 'hit_cop' : 'hit_ped', pos, severity: s > 12 ? 2 : 1 });
    }
  }
}
function collidePlayer() {
  const P = G.player; if (!P || !P.pos || P.inVehicle || P.alive === false) return;
  for (let i = 0; i < list.length; i++) {
    const v = list[i]; if (v.sinking) continue;
    const dx = P.pos.x - v.pos.x, dz = P.pos.z - v.pos.z;
    if (Math.abs(dx) > v.br + 0.6 || Math.abs(dz) > v.br + 0.6) continue;
    const sh = Math.sin(v.heading), ch = Math.cos(v.heading), lx = dx * ch - dz * sh, lz = dx * sh + dz * ch;
    const px = v.width / 2 + 0.35 - Math.abs(lx), pz = v.length / 2 + 0.35 - Math.abs(lz);
    if (px <= 0 || pz <= 0) continue;
    const s = Math.abs(v.speed);
    if (s > 4 && G.time - (v.hitPlayerT || -9) > 1) { v.hitPlayerT = G.time; try { P.damage?.(Math.min(90, s * s * 0.3), 'vehicle'); } catch (e) { logErr('player.damage', e); } }
    if (px < pz) { const k = (lx >= 0 ? 1 : -1) * px; P.pos.x += ch * k; P.pos.z -= sh * k; }
    else { const k = (lz >= 0 ? 1 : -1) * pz; P.pos.x += sh * k; P.pos.z += ch * k; }
  }
}

// ------------------------------------------------------------------ population (traffic ring + parked pool)
function inView(x, z) {
  const c = G.camera; if (!c) return false;
  c.getWorldDirection(_d);
  const dx = x - c.position.x, dz = z - c.position.z;
  return (dx * _d.x + dz * _d.z) / ((Math.hypot(dx, dz) || 1) * (Math.hypot(_d.x, _d.z) || 1)) > 0.45;
}
function spawnTraffic(pp, minD) {
  const W = G.world; if (!W.randomRoadPoint) return false;
  const pt = W.randomRoadPoint(pp, minD, 220);
  if (!pt || !isFinite(pt.x) || !isFinite(pt.z)) return false;
  const d = Math.hypot(pt.x - pp.x, pt.z - pp.z);
  if (d < minD * 0.8 || (filled && d < 150 && inView(pt.x, pt.z))) return false;
  for (let i = 0; i < list.length; i++) if (Math.abs(list[i].pos.x - pt.x) < 9 && Math.abs(list[i].pos.z - pt.z) < 9) return false;
  const h = pt.heading || 0, v = spawn(G.pick(TRAFFIC_MIX), pt.x, pt.z, h, { ai: 'traffic' });
  v.mine = true; aiInit(v, pt);
  v.vel.set(Math.sin(h) * 6, 0, Math.cos(h) * 6); v.speed = 6;
  return true;
}
function manage() {
  const W = G.world; if (!W) return;
  const P = G.player;
  const pp = (P && P.pos) || (W.spawn ? _p.set(W.spawn.x, 0, W.spawn.z).clone() : null);
  if (!pp) return;
  let traffic = 0, parked = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const v = list[i];
    if (v === playerVeh || (P && P.inVehicle === v)) continue;
    const d = Math.hypot(v.pos.x - pp.x, v.pos.z - pp.z);
    if (v.sunk || (v.destroyed && (G.time - v.deadT > 45 || d > 150))) { remove(v); continue; }
    if (v.driver === 'traffic') { if (d > 260 || (v.ai && v.ai.dead)) { remove(v); continue; } traffic++; }
    else if (v.pooled) { if (d > (v.keep ? 400 : 230)) { remove(v); continue; } parked++; }
    else if (v.mine && !v.driver && d > (v.keep ? 400 : 250)) { remove(v); continue; }
  }
  try {
    const want = filled ? 2 : 14;
    for (let n = 0, tries = 0; traffic < TRAFFIC_TARGET && n < want && tries < want * 4; tries++) if (spawnTraffic(pp, filled ? 80 : 45)) { n++; traffic++; }
  } catch (e) { logErr('traffic', e); }
  try {
    const spots = W.parkingSpots;
    if (spots && parked < PARKED_TARGET) {
      const cand = [];
      for (const s of spots) { if (!s || usedSpots.has(s)) continue; const d = Math.hypot(s.x - pp.x, s.z - pp.z); if (d < 170 && (!filled || d > 55)) cand.push([d, s]); }
      cand.sort((a, b) => a[0] - b[0]);
      for (const [, s] of cand) {
        if (parked >= PARKED_TARGET) break;
        let free = true;
        for (let i = 0; i < list.length; i++) if (Math.abs(list[i].pos.x - s.x) < 4.5 && Math.abs(list[i].pos.z - s.z) < 4.5) { free = false; break; }
        if (!free) continue;
        const v = spawn(G.pick(PARKED_MIX), s.x, s.z, s.heading || 0, { ai: 'parked' });
        v.pooled = true; v.spot = s; usedSpots.add(s); parked++;
      }
    }
  } catch (e) { logErr('parked', e); }
  filled = true;
}
// The promised roadster right next to the spawn point, and an electric scooter beside it.
function spawnHeroCars() {
  const W = G.world, s = W && W.spawn; if (!s) return;
  const h = s.heading || 0, sh = Math.sin(h), ch = Math.cos(h);
  let best = null, bd = 14;
  for (const p of W.parkingSpots || []) { if (!p) continue; const d = Math.hypot(p.x - s.x, p.z - s.z); if (d < bd && d > 1.6) { bd = d; best = p; } }
  let car;
  if (best) { car = spawn('roadster', best.x, best.z, best.heading || 0, { ai: 'parked', color: 0xe3122a }); car.spot = best; usedSpots.add(best); }
  else {
    let x = s.x - ch * 3.4, z = s.z + sh * 3.4;
    try { if (W.blocked && W.blocked(x, z, 1.2)) { x = s.x + ch * 3.4; z = s.z - sh * 3.4; } } catch (e) { /* ignore */ }
    car = spawn('roadster', x, z, h, { ai: 'parked', color: 0xe3122a });
  }
  car.keep = true;
  for (const [f, r] of [[2.6, 0.9], [2.6, -0.9], [-2.6, 0.9], [-2.6, -0.9], [0, 2], [0, -2], [3.5, 0]]) {
    const x = s.x + sh * f - ch * r, z = s.z + ch * f + sh * r;
    let bad = Math.hypot(x - car.pos.x, z - car.pos.z) < 2.6;
    try { if (!bad && W.blocked && W.blocked(x, z, 0.5)) bad = true; } catch (e) { /* ignore */ }
    if (bad) continue;
    spawn('scooter', x, z, h, { ai: 'parked', color: 0x12c8b4 }).keep = true;
    return;
  }
  spawn('scooter', s.x + sh * 2.6, s.z + ch * 2.6, h, { ai: 'parked', color: 0x12c8b4 }).keep = true;
}
function updateSpot() {
  if (!spot) return;
  const v = playerVeh;
  if (!v || v.destroyed || v.sinking || !((G.sky && G.sky.isNight) || lightsOn)) { spot.intensity = 0; return; }
  const sh = Math.sin(v.heading), ch = Math.cos(v.heading);
  spot.intensity = 120;
  spot.position.set(v.pos.x + sh * v.length * 0.45, v.pos.y + 0.8, v.pos.z + ch * v.length * 0.45);
  spot.target.position.set(v.pos.x + sh * 24, v.pos.y - 0.4, v.pos.z + ch * 24);
}

// ------------------------------------------------------------------ module entry points
export async function init(_G) {
  makeShared();
  await Promise.all(Object.values(TYPES).map(async (sp) => { sp.geo = (await loadGeo(sp.file, sp)) || boxGeo(sp); }));
  const R = G.world && G.world.roads;
  if (R) {
    if (isFinite(R.laneOffset) && R.laneOffset > 0) LO = R.laneOffset;
    if (isFinite(R.halfWidth) && R.halfWidth > 0) HW = R.halfWidth;
    for (const n of R.nodes || []) if (n) nodeMap.set(n.id, n);
  }
  G.vehicles = { list, spawn, remove, nearest, setPlayerVehicle, raycast, types: Object.keys(TYPES), MODEL_YAW };
  try {
    if (G.scene) { spot = new THREE.SpotLight(0xfff0d0, 0, 60, 0.55, 0.7, 1.4); spot.castShadow = false; G.scene.add(spot); G.scene.add(spot.target); }
  } catch (e) { spot = null; }
  G.events.on('crime', (d) => {
    if (!d || d.type !== 'shoot') return;
    const p = d.pos || (G.player && G.player.pos); if (!p) return;
    for (const v of list) if (v.driver === 'traffic' && v.ai && Math.hypot(v.pos.x - p.x, v.pos.z - p.z) < 65) v.ai.panicT = G.time + G.rand(5, 9);
  });
  try { spawnHeroCars(); } catch (e) { logErr('heroCars', e); }
  // higher detail hulls for the car the player drives: loaded in the background, never blocks start-up
  for (const sp of Object.values(TYPES)) if (sp.hi) loadGeo(sp.hi, sp).then((g) => { if (!g) return; sp.geoHi = g; if (playerVeh && playerVeh.spec === sp && !playerVeh.destroyed) playerVeh.hull.geometry = g; }).catch(() => {});
  ready = true;
}

export function update(dt) {
  if (!ready || !G.world) return;
  dt = Math.min(dt, 0.05); if (!(dt > 0)) return;
  frame++;
  const P = G.player;
  if (P && P.inVehicle !== undefined) { const pv = P.inVehicle || null; if (pv !== playerVeh && (!pv || pv.spec)) setPlayerVehicle(pv); }
  mgrT -= dt;
  if (mgrT <= 0) { mgrT = 0.5; try { manage(); } catch (e) { logErr('manage', e); } }
  for (let i = 0; i < list.length; i++) { const v = list[i]; try { tick(v, dt); } catch (e) { logErr('tick', e); } }
  try { collidePairs(); } catch (e) { logErr('pairs', e); }
  try { collideActors(); } catch (e) { logErr('actors', e); }
  try { collidePlayer(); } catch (e) { logErr('player', e); }
  try { updateSpot(); } catch (e) { /* ignore */ }
}
