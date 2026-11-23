// vehicles_lite.js - compact vehicles: models, arcade driving, traffic, parked cars, police steering. Implements G.vehicles.
import * as THREE from 'three';
import { G } from './core.js';

const MODEL_YAW = Math.PI;   // hull front is -Z in the files; heading 0 must face +Z
const TYPES = {
  taxi: { file: 'street_taxi_C', max: 30, acc: 11, color: 0xf4f4f0 }, roadster: { file: 'street_roadster_C', max: 46, acc: 17, color: 0x12b5a6 },
  van: { file: 'street_van_C', max: 25, acc: 8, color: 0xe8e8e8 }, pickup: { file: 'street_pickup_C', max: 28, acc: 9, color: 0x9a3b2e },
  police: { file: 'street_police_C', max: 40, acc: 15, color: 0xf2f6ff }, scooter: { file: 'street_bike_scooter_C', max: 17, acc: 9, color: 0x35d07f, bike: true },
  sportbike: { file: 'street_bike_sporty_C', max: 44, acc: 19, color: 0xe03a3a, bike: true }, policebike: { file: 'street_bike_police_C', max: 40, acc: 17, color: 0xf2f6ff, bike: true },
  courier: { file: 'courier_C', max: 27, acc: 9, color: 0xffb347 },
};
const PAINT = [0xc62828, 0x1565c0, 0xeeeeee, 0x212121, 0xf9a825, 0x2e7d32, 0x8e24aa, 0x90a4ae, 0xff7043, 0x00897b];
const geo = {}, list = [];
let nextId = 1, playerV = null, spawnT = 0;
const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 14); wheelGeo.rotateZ(Math.PI / 2);
const wheelMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.7 });
const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2cc, emissiveIntensity: 1.5 });
const tailMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1a1a, emissiveIntensity: 1.2 });
const lightGeo = new THREE.BoxGeometry(0.34, 0.14, 0.08);
const _p = { x: 0, z: 0 };

function build(type, color) {
  const T = TYPES[type], g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  let hg = geo[type], W = 1.9, L = 4.3, H = 1.3;
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08 });
  if (hg) {
    const bb = hg.boundingBox; W = bb.max.x - bb.min.x; L = bb.max.z - bb.min.z; H = bb.max.y - bb.min.y;
    const m = new THREE.Mesh(hg, paint); m.rotation.y = MODEL_YAW; m.position.y = -bb.min.y + (T.bike ? 0.02 : 0.2); m.castShadow = true; body.add(m);
  } else { const m = new THREE.Mesh(new THREE.BoxGeometry(W, 0.9, L), paint); m.position.y = 0.75; m.castShadow = true; body.add(m); }
  const wheels = [];
  const wp = T.bike ? [[0, L * 0.36], [0, -L * 0.36]] : [[W * 0.44, L * 0.31], [-W * 0.44, L * 0.31], [W * 0.44, -L * 0.31], [-W * 0.44, -L * 0.31]];
  if (!T.bike) for (const [x, z] of wp) { const w = new THREE.Mesh(wheelGeo, wheelMat); w.position.set(x, 0.34, z); g.add(w); wheels.push(w); }
  if (!T.bike) for (const s of [-1, 1]) {
    const h = new THREE.Mesh(lightGeo, headMat); h.position.set(s * W * 0.33, 0.62, L * 0.5 - 0.02); body.add(h);
    const t = new THREE.Mesh(lightGeo, tailMat); t.position.set(s * W * 0.33, 0.66, -L * 0.5 + 0.02); body.add(t);
  }
  let bar = null;
  if (type === 'police' || type === 'policebike') {
    bar = new THREE.Mesh(new THREE.BoxGeometry(T.bike ? 0.3 : 1.1, 0.14, 0.26), new THREE.MeshStandardMaterial({ color: 0x2244ff, emissive: 0x2244ff, emissiveIntensity: 0.4 }));
    bar.position.set(0, 0.2 + H + 0.05, T.bike ? -L * 0.3 : 0); body.add(bar);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(W + 0.03, 0.2, L * 0.6), new THREE.MeshStandardMaterial({ color: 0x1a47c8 })); stripe.position.y = 0.2 + H * 0.45; if (!T.bike) body.add(stripe);
  }
  if (type === 'taxi') { const s = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, 0.3), new THREE.MeshStandardMaterial({ color: 0xffd400, emissive: 0xffc400, emissiveIntensity: 0.9 })); s.position.y = 0.2 + H + 0.08; body.add(s); }
  return { g, body, wheels, bar, W, L, H };
}

function spawn(type, x, z, heading = 0, opts = {}) {
  if (!TYPES[type]) type = 'taxi';
  const T = TYPES[type], color = opts.color ?? ((type === 'taxi' || type === 'police' || type === 'policebike' || type === 'roadster' || type === 'scooter') ? T.color : G.pick(PAINT));
  const b = build(type, color);
  const v = {
    id: nextId++, type, pos: new THREE.Vector3(x, 0, z), heading, speed: 0, vel: new THREE.Vector3(), object3d: b.g, _b: b,
    radius: Math.max(b.W, 1) * 0.62, length: b.L, width: b.W, driver: null, isPolice: type === 'police' || type === 'policebike', isBike: !!T.bike,
    health: 100, destroyed: false, seatOffset: new THREE.Vector3(0, T.bike ? 0.72 : 0.45, T.bike ? -0.1 : 0), ai: null, target: null, sirenOn: false, drifting: false, _steer: 0, _hitT: 0,
    damage(n) { if (v.destroyed) return; v.health -= n; if (v.health <= 0) v.explode(); },
    explode() {
      if (v.destroyed) return; v.destroyed = true; v.speed = 0; v.health = 0;
      G.fx?.explosion?.(v.pos.clone().setY(1), 1.3); G.audio?.play?.('explosion', { pos: v.pos }); G.events.emit('vehicle:destroyed', { vehicle: v, pos: v.pos.clone() });
      v.object3d.traverse((o) => { if (o.isMesh) o.material = wreckMat; }); v._dead = 25;
      if (playerV === v) G.player?.damage?.(60, 'explosion');
    },
  };
  const ai = opts.ai || null;
  if (ai === 'traffic') { v.driver = 'traffic'; v.ai = { from: opts.nodeA || null, to: opts.nodeB || null, cruise: 8 + Math.random() * 4 }; }
  else if (ai === 'police') { v.driver = 'police'; v.sirenOn = true; }
  b.g.position.copy(v.pos); b.g.rotation.y = heading; G.scene.add(b.g); list.push(v); return v;
}
const wreckMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 1 });
function remove(v) { const i = list.indexOf(v); if (i >= 0) list.splice(i, 1); G.scene.remove(v.object3d); if (playerV === v) playerV = null; }

function steerTo(v, tx, tz, dt, rate) {
  const want = Math.atan2(tx - v.pos.x, tz - v.pos.z), d = G.angleDiff(v.heading, want);
  v.heading += G.clamp(d, -rate * dt, rate * dt); return d;
}
function blockedAhead(v, dist) {
  const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
  const test = (px, pz, r) => { const dx = px - v.pos.x, dz = pz - v.pos.z, f = dx * fx + dz * fz; return f > 0.5 && f < dist && Math.abs(dx * fz - dz * fx) < r; };
  for (const o of list) if (o !== v && test(o.pos.x, o.pos.z, 1.7)) return true;
  const p = G.player; if (p && !p.inVehicle && test(p.pos.x, p.pos.z, 1.5)) return true;
  for (const a of G.actors) if (a.alive && test(a.pos.x, a.pos.z, 1.3)) return true;
  return false;
}

function drive(v, dt) {
  const T = TYPES[v.type]; let thr = 0, steer = 0, brake = false, maxS = T.max;
  if (v === playerV) {
    const inp = G.input, S = G.settings;
    thr = inp.axis.y; steer = inp.axis.x; brake = inp.down('Space') || inp.padDown(0);
    if (inp.padDown(7)) thr = 1; if (inp.padDown(6)) thr = -1;
    if (S.oneHanded) { thr = inp.mouseDown(0) ? 1 : inp.mouseDown(2) ? -1 : 0; steer = G.clamp(inp.mouse.nx * 1.6, -1, 1); }
    if (inp.down('ShiftLeft') || inp.down('ShiftRight')) maxS *= 1.25;
    if (inp.pressed('KeyH')) G.audio?.play?.('horn', { pos: v.pos });
    if (S.driveAssist && v.target) {                      // the car drives itself toward the target
      const dx = v.target.x - v.pos.x, dz = v.target.z - v.pos.z, dist = Math.hypot(dx, dz);
      const d = G.angleDiff(v.heading, Math.atan2(dx, dz)); steer = G.clamp(-d * 2.2, -1, 1);
      const want = dist < 10 ? 0 : blockedAhead(v, 9) ? 0 : Math.abs(d) > 0.6 ? 6 : 15;
      thr = v.speed < want ? 0.8 : v.speed > want + 2 ? -1 : 0; maxS = 16;
    }
  }
  // longitudinal
  if (thr > 0) v.speed += (v.speed < 0 ? 28 : T.acc * (1 - Math.max(0, v.speed) / (maxS * 1.05))) * thr * dt;
  else if (thr < 0) v.speed += (v.speed > 0.5 ? 30 : T.acc * 0.6) * thr * dt;
  v.speed -= v.speed * (brake ? 2.2 : 0.35) * dt;
  v.speed = G.clamp(v.speed, -maxS * 0.35, maxS);
  // steering (right = heading decreases)
  v._steer = G.lerp(v._steer, steer, Math.min(1, dt * 8));
  const grip = G.clamp(Math.abs(v.speed) / 6, 0, 1) * (1.9 - Math.min(1, Math.abs(v.speed) / T.max) * 0.9) * (brake ? 1.5 : 1);
  v.heading -= v._steer * grip * dt * Math.sign(v.speed || 1) * (v.isBike ? 1.25 : 1);
  v.drifting = brake && Math.abs(v.speed) > 9 && Math.abs(v._steer) > 0.3;
  if (v.drifting && Math.random() < 0.5) { G.fx?.tireSmoke?.(v.pos); G.fx?.skidMark?.(v.pos, v.heading); }
}

function aiTraffic(v, dt) {
  const a = v.ai, W = G.world; if (!a || !a.to) return;
  const fx = a.to.x - (a.from ? a.from.x : v.pos.x), fz = a.to.z - (a.from ? a.from.z : v.pos.z), len = Math.hypot(fx, fz) || 1;
  const tx = a.to.x - (fz / len) * 3.5 - (fx / len) * 6, tz = a.to.z + (fx / len) * 3.5 - (fz / len) * 6;
  const d = steerTo(v, tx, tz, dt, 1.6), dist = Math.hypot(tx - v.pos.x, tz - v.pos.z);
  let want = Math.abs(d) > 0.5 ? 4 : a.cruise; if (blockedAhead(v, 5 + v.speed * 0.9)) want = 0;
  v.speed += G.clamp(want - v.speed, -22 * dt, 6 * dt);
  if (dist < 5) {
    const opts = a.to.links.map((i) => W.roads.nodes[i]).filter((n) => !a.from || n.id !== a.from.id);
    const next = opts.length ? G.pick(opts) : a.from; a.from = a.to; a.to = next;
  }
}
function aiPolice(v, dt) {
  const t = v.target; if (!t) { v.speed -= v.speed * dt; return; }
  const dist = Math.hypot(t.x - v.pos.x, t.z - v.pos.z), d = steerTo(v, t.x, t.z, dt, 2.2);
  const want = dist < 9 ? 0 : Math.abs(d) > 0.8 ? 7 : Math.min(TYPES[v.type].max * 0.75, 8 + dist * 0.4);
  v.speed += G.clamp(want - v.speed, -30 * dt, 14 * dt);
}

function physics(v, dt) {
  const W = G.world, fx = Math.sin(v.heading), fz = Math.cos(v.heading);
  v.vel.set(fx * v.speed, 0, fz * v.speed); v.pos.x += v.vel.x * dt; v.pos.z += v.vel.z * dt;
  if (W && Math.abs(v.speed) > 0.05) {
    for (const off of [v.length * 0.3, -v.length * 0.3]) {
      _p.x = v.pos.x + fx * off; _p.z = v.pos.z + fz * off; const h = W.resolveCircle(_p, v.radius);
      if (h) {
        v.pos.x = _p.x - fx * off; v.pos.z = _p.z - fz * off;
        const into = -(fx * h.nx + fz * h.nz) * Math.sign(v.speed || 1), sp = Math.abs(v.speed);
        if (into > 0.25) {
          if (sp > 6 && G.time - v._hitT > 0.4) { v._hitT = G.time; G.fx?.sparks?.(v.pos.clone().setY(0.6)); G.audio?.play?.(sp > 16 ? 'crash_big' : 'crash', { pos: v.pos }); G.events.emit('vehicle:crash', { vehicle: v, speed: sp, pos: v.pos.clone() }); v.damage(sp * 0.9); if (v === playerV) G.fx?.shake?.(Math.min(1, sp / 30)); }
          v.speed *= -0.25 * into;
        } else { v.speed *= 1 - 0.6 * dt; v.heading += (fx * h.nz - fz * h.nx) * 1.2 * dt * Math.sign(v.speed || 1); }
      }
    }
  }
  if (Math.abs(v.speed) > 2.5) {                           // people
    const hx = v.pos.x + fx * v.length * 0.4 * Math.sign(v.speed), hz = v.pos.z + fz * v.length * 0.4 * Math.sign(v.speed);
    for (const a of G.actors) {
      if (!a.alive) continue; const dx = a.pos.x - hx, dz = a.pos.z - hz; if (dx * dx + dz * dz > 1.7) continue;
      a.damage?.(Math.abs(v.speed) * 7, v === playerV ? 'vehicle' : 'traffic');
      if (v === playerV) { G.events.emit('crime', { type: 'hit_ped', pos: a.pos.clone(), severity: Math.abs(v.speed) > 9 ? 2 : 1 }); G.audio?.play?.('hit_body', { pos: a.pos }); }
      v.speed *= 0.9;
    }
    const p = G.player;
    if (p && !p.inVehicle && v !== playerV && Math.abs(v.speed) > 4) { const dx = p.pos.x - hx, dz = p.pos.z - hz; if (dx * dx + dz * dz < 1.6 && G.time - v._hitT > 0.8) { v._hitT = G.time; p.damage?.(Math.abs(v.speed) * 2.5, 'vehicle'); } }
  }
  for (const o of list) {                                   // other vehicles
    if (o === v || o.id < v.id) continue; const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z, rr = v.radius + o.radius + 0.25, d2 = dx * dx + dz * dz;
    if (d2 > rr * rr || d2 < 1e-6) continue; const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, push = (rr - d) * 0.5, rel = Math.abs(v.speed - o.speed);
    v.pos.x -= nx * push; v.pos.z -= nz * push; o.pos.x += nx * push; o.pos.z += nz * push;
    if (rel > 5 && G.time - v._hitT > 0.4) {
      v._hitT = G.time; G.audio?.play?.(rel > 15 ? 'crash_big' : 'crash', { pos: v.pos }); G.fx?.sparks?.(v.pos.clone().setY(0.6)); v.damage(rel * 0.7); o.damage(rel * 0.7);
      G.events.emit('vehicle:crash', { vehicle: v, speed: rel, pos: v.pos.clone() });
      if (v === playerV || o === playerV) { G.fx?.shake?.(Math.min(1, rel / 30)); G.events.emit('crime', { type: 'hit_car', pos: v.pos.clone(), severity: 1 }); }
      const vs = v.speed; v.speed = v.speed * 0.4 + o.speed * 0.2; o.speed = o.speed * 0.5 + vs * 0.35 * Math.sign(Math.cos(o.heading - v.heading) || 1);
    }
  }
  const b = v._b; v.object3d.position.set(v.pos.x, G.world?.groundY?.(v.pos.x, v.pos.z) ?? 0, v.pos.z); v.object3d.rotation.y = v.heading;
  if (v.isBike) b.body.rotation.z = G.lerp(b.body.rotation.z, v._steer * 0.35 * Math.min(1, Math.abs(v.speed) / 8), 0.15);
  else { b.body.rotation.z = G.lerp(b.body.rotation.z, -v._steer * 0.05 * Math.min(1, Math.abs(v.speed) / 15), 0.2); }
  for (let i = 0; i < b.wheels.length; i++) { b.wheels[i].rotation.x += v.speed * dt / 0.34; if (i < 2) b.wheels[i].rotation.y = -v._steer * 0.4; }
  if (b.bar) { const on = v.sirenOn; b.bar.material.emissiveIntensity = on ? 4 : 0.4; if (on) b.bar.material.emissive.setHex(Math.floor(G.time * 6) % 2 ? 0xff1a1a : 0x2255ff); }
  if (v.health < 35 && !v.destroyed && Math.random() < 0.15) G.fx?.smoke?.(v.pos.clone().setY(1.1), { dark: v.health < 18 });
}

function populate(dt) {
  const W = G.world, p = G.player; if (!W || !p) return;
  spawnT -= dt; if (spawnT > 0) return; spawnT = 0.5;
  let traffic = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const v = list[i], d = G.dist2D(v.pos, p.pos);
    if (v.driver === 'traffic') { if (d > 270) remove(v); else traffic++; }
    else if (v._dead !== undefined) { v._dead -= 0.5; if (v._dead <= 0 && v !== playerV) remove(v); }
  }
  if (traffic < (G.settings.quality === 'low' ? 10 : 18)) {
    const r = W.randomRoadPoint(p.pos, 70, 210); if (!r || !r.nodeB) return;
    for (const o of list) if (G.dist2D(o.pos, r) < 12) return;
    const v = spawn(G.pick(['taxi', 'taxi', 'van', 'pickup', 'roadster', 'courier', 'taxi', 'pickup', 'scooter']), r.x, r.z, r.heading, { ai: 'traffic', nodeA: r.nodeA, nodeB: r.nodeB });
    if (v.type === 'roadster') v._b.body.children[0].material.color.setHex(G.pick(PAINT)); v.speed = 6;
  }
}

export async function init() {
  await Promise.all(Object.entries(TYPES).map(async ([k, T]) => {
    try {
      const gl = await G.assets.loadGLB(`assets/vehicles/${T.file}.glb`); let m = null; gl.scene.traverse((o) => { if (o.isMesh && !m) m = o; });
      if (m) { const g = m.geometry; if (!g.attributes.normal) g.computeVertexNormals(); g.computeBoundingBox(); geo[k] = g; }
    } catch (e) { /* box fallback */ }
  }));
  G.vehicles = {
    list, spawn, remove,
    nearest(pos, maxDist = 5, filter) { let b = null, bd = maxDist; for (const v of list) { if (v.destroyed || (filter && !filter(v))) continue; const d = G.dist2D(v.pos, pos) - v.radius * 0.5; if (d < bd) { bd = d; b = v; } } return b; },
    setPlayerVehicle(v) {
      if (playerV && playerV !== v) { if (playerV.driver === 'player') playerV.driver = null; }
      playerV = v || null; if (v) { v.driver = 'player'; v.ai = null; }
    },
    raycast(o, d, maxDist = 100) {
      let best = null;
      for (const v of list) {
        const cx = v.pos.x - o.x, cy = 0.7 - o.y, cz = v.pos.z - o.z, t = cx * d.x + cy * d.y + cz * d.z; if (t < 0 || t > maxDist) continue;
        const px = o.x + d.x * t - v.pos.x, py = o.y + d.y * t - 0.7, pz = o.z + d.z * t - v.pos.z, r = v.length * 0.42;
        if (px * px + py * py * 2 + pz * pz < r * r && (!best || t < best.dist)) best = { vehicle: v, dist: Math.max(0, t - r * 0.6), point: new THREE.Vector3(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t) };
      }
      return best;
    },
  };
  const W = G.world; if (!W) return;
  const s = W.spawn, ps = W.parkingSpots || [];
  const near = ps.slice().sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z));
  if (near[0]) spawn('roadster', near[0].x, near[0].z, near[0].heading); else spawn('roadster', s.x + 5, s.z, 0);
  spawn('scooter', s.x + 1.5, s.z - 3.5, s.heading + Math.PI);
  let n = 0; for (let i = 2; i < near.length && n < 34; i += 1 + ((i * 7) % 3)) { const q = near[i]; spawn(G.pick(['taxi', 'van', 'pickup', 'roadster', 'courier', 'scooter', 'sportbike']), q.x, q.z, q.heading); n++; }
}

export function update(dt) {
  populate(dt);
  const night = G.sky?.isNight; headMat.emissiveIntensity = night ? 5 : 1.2;
  let braking = false;
  for (let i = 0; i < list.length; i++) {
    const v = list[i]; if (v.destroyed) continue;
    if (v === playerV) { drive(v, dt); braking = G.input.axis.y < 0 || G.input.down('Space'); }
    else if (v.driver === 'traffic') aiTraffic(v, dt);
    else if (v.driver === 'police') aiPolice(v, dt);
    else if (Math.abs(v.speed) > 0.01) v.speed -= v.speed * Math.min(1, 2.5 * dt);
    if (v.driver || Math.abs(v.speed) > 0.02) physics(v, dt);
  }
  tailMat.emissiveIntensity = braking ? 4 : night ? 2 : 1;
}
