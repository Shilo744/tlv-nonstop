// police.js - "מד בלגן" (chaos meter): wanted level, patrol cars, officers on foot, roadblocks, arrest, escape.
// Owns G.wanted. Everything that touches another module is guarded.
import * as THREE from 'three';
import { G } from './core.js';

const MODEL_YAW = 0;                 // officer GLB facing fix (one-line change if the model looks backwards)
const THRESH = [0, 10, 35, 70, 110, 150];
const MAX_HEAT = 175;
const MAX_VEH = 6;                   // pursuit + roadblock vehicles
const MAX_OFFICERS = 8;
const SIGHT_DIST = 90;
const COMPOSITION = [
  [],
  ['police'],
  ['police', 'police'],
  ['police', 'police', 'police', 'policebike'],
  ['police', 'police', 'policebike', 'police'],
  ['police', 'van', 'policebike', 'van'],
];
const CRIME_HEAT = { speeding: 3, hit_car: 5, shoot: 7, hit_ped: 8, carjack: 14, hit_cop: 16, kill_ped: 22, kill_cop: 42 };
const CRIME_GAP = { speeding: 1.0, hit_car: 0.4, shoot: 0.7 };
const DISPATCH = [
  '',
  'מוקד 100: ניידת בדרך אליך. גם פקח חניה.',
  'מוקד: שתי ניידות עליך. מישהו העיר את התורן מהשנ"צ.',
  'מוקד: האופנוענים יצאו. אל תנסה את איילון, יש שם פקק.',
  'מוקד: חוסמים רחובות. לא שמישהו ישים לב, הכול חסום גם ככה.',
  'מוקד: כל העיר מחפשת אותך. אפילו השליחים על הקורקינטים.',
];
const SHOUTS_ARREST = [
  'עצור! משטרה!',
  'אדוני, רישיונות בבקשה',
  'לאן אתה רץ? אני במשמרת כפולה!',
  'אל תברח, אני אחרי שווארמה!',
  'ידיים למעלה, ובלי סלפי!',
  'תעמוד בצד, זה ייקח רק שלוש שעות.',
];
const SHOUTS_FIRE = [
  'עצור או שאני יורה!',
  'זרוק את הנשק!',
  'כל היחידות, הוא פה!',
  'מי נתן לך רישיון בכלל?',
  'זה נגמר, חביבי!',
];

// ------------------------------------------------------------------ state
let now = 0;
let nextId = 1;
let lastSeenT = -999, levelHoldT = 0, swapBoostT = 0;
let spawnT = 0, sightT = 0, ambientT = 1.5, blockT = 6, shoutT = 0, slowT = 0, noOfficerT = 0;
let arrestT = 0, arrestPhase = 0, arrestClock = 0, arrestWarned = false;
let spawnFails = 0, errCount = 0;
let lastCopCrimeT = -9, lastCopHeatT = -9;
let lastSeenVehicle = null;
let roadblock = null;
let parkWatch = null;
let copGltf = null;
let barrierGeo = null, barrierMats = null;
const lastKnown = new THREE.Vector3();
const crimeTimes = {};
const vehUnits = [];      // pursuit vehicles
const ambient = [];       // patrol cars driving as traffic
const officers = [];      // actors kind 'cop' (alive or dying)
const visPool = [];
const tintCache = new Map();
const ZERO = new THREE.Vector3();
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _t = new THREE.Vector3(), _cam = new THREE.Vector3();

const wanted = {
  level: 0, heat: 0, searching: false, units: [],
  add(amount, reason) { addHeat(+amount || 0, reason); },
  clear() { clearWanted('clear'); },
  setLevel(n) {
    n = Math.max(0, Math.min(5, n | 0));
    if (n === 0) { clearWanted('clear'); return; }
    wanted.heat = THRESH[n] + 4; markSeen(); refreshLevel();
  },
};

// ------------------------------------------------------------------ small helpers
const hud = () => G.hud;
function toast(text, ms) { try { G.hud?.toast?.(text, ms); } catch { /* ignore */ } }
function caption(text) { try { (G.hud?.caption || G.audio?.caption)?.(text); } catch { /* ignore */ } }
function subtitle(text, ms = 2200) { try { G.hud?.subtitle?.('שוטר', text, ms); } catch { /* ignore */ } }
function sfx(name, pos, volume) { try { G.audio?.play?.(name, pos ? { pos, volume } : { volume }); } catch { /* ignore */ } }
function music(name) { try { G.audio?.music?.(name); } catch { /* ignore */ } }
function groundY(x, z) { try { const y = G.world?.groundY?.(x, z); return Number.isFinite(y) ? Math.max(y, -0.4) : 0; } catch { return 0; } }
function playerPos() { const p = G.player; return (p?.inVehicle && p.inVehicle.pos) || p?.pos || ZERO; }
function addBlip(u) {
  if (u.blip) return;
  const h = hud(); if (!h?.addBlip) return;
  try { h.addBlip('cop' + u.id, { x: u.x, z: u.z, color: '#3aa0ff', icon: 'police', label: 'משטרה', follow: u }); u.blip = true; } catch { /* ignore */ }
}
function removeBlip(u) {
  if (!u.blip) return;
  u.blip = false;
  try { G.hud?.removeBlip?.('cop' + u.id); } catch { /* ignore */ }
}

function hasLOS(ax, az, bx, bz) {
  const w = G.world; if (!w?.raycast) return true;
  _o.set(ax, 1.3, az); _d.set(bx - ax, 0, bz - az);
  const len = _d.length(); if (len < 0.6) return true;
  _d.multiplyScalar(1 / len);
  try { const hit = w.raycast(_o, _d, len); return !hit || !(hit.dist < len - 0.8); } catch { return true; }
}
function inCameraView(x, z) {
  const cam = G.camera; if (!cam) return false;
  try {
    cam.getWorldDirection(_cam);
    const dx = x - cam.position.x, dz = z - cam.position.z;
    const d = Math.hypot(dx, dz) || 1;
    return (dx * _cam.x + dz * _cam.z) / d > 0.35;
  } catch { return false; }
}
function roadPoint(near, minD, maxD) {
  const w = G.world; if (!w?.randomRoadPoint) return null;
  try { const rp = w.randomRoadPoint(near, minD, maxD); return (rp && Number.isFinite(rp.x) && Number.isFinite(rp.z)) ? rp : null; } catch { return null; }
}
// A road point out of the player's sight if possible.
function hiddenRoadPoint(P, minD, maxD) {
  let best = null;
  for (let i = 0; i < 6; i++) {
    const rp = roadPoint(P, minD, maxD); if (!rp) continue;
    const d = Math.hypot(rp.x - P.x, rp.z - P.z);
    if (d < 45) continue;
    best = rp;
    if (!inCameraView(rp.x, rp.z) || !hasLOS(P.x, P.z, rp.x, rp.z)) break;
  }
  return best;
}
function vehicleListed(v) { const l = G.vehicles?.list; return !Array.isArray(l) || l.indexOf(v) >= 0; }
function removeVehicle(v) {
  if (!v || v === G.player?.inVehicle || v.driver === 'player') return;
  try { v.sirenOn = false; G.vehicles?.remove?.(v); } catch { /* ignore */ }
}
function spawnVehicle(type, x, z, heading, ai) {
  if (!G.vehicles?.spawn) return null;
  try {
    let v = G.vehicles.spawn(type, x, z, heading, { ai });
    if (!v && type !== 'police') v = G.vehicles.spawn('police', x, z, heading, { ai });
    return v || null;
  } catch (e) { return null; }
}

// ------------------------------------------------------------------ heat / level
function markSeen() {
  lastSeenT = now; wanted.searching = false;
  lastKnown.copy(playerPos());
  lastSeenVehicle = G.player?.inVehicle || null;
}
function addHeat(amount, reason) {
  if (!(amount > 0) || arrestPhase > 0) return;
  if (G.player && G.player.alive === false) return;
  wanted.heat = Math.min(MAX_HEAT, wanted.heat + amount);
  markSeen();
  refreshLevel();
}
function refreshLevel() {
  let lv = 0;
  for (let i = 5; i >= 1; i--) if (wanted.heat >= THRESH[i]) { lv = i; break; }
  if (lv > wanted.level) setLevel(lv, 'up');
}
function setLevel(lv, how) {
  const prev = wanted.level;
  if (lv === prev) return;
  wanted.level = lv;
  levelHoldT = lv > prev ? 9 : 3.5;
  try { G.events.emit('wanted:change', { level: lv }); } catch { /* ignore */ }
  if (lv > prev) {
    toast(DISPATCH[lv] || DISPATCH[1], 4200);
    caption('[סירנות משטרה]');
    try { G.hud?.announce?.('מד בלגן: ' + lv + ' מתוך 5'); } catch { /* ignore */ }
    if (prev === 0) { music('pursuit'); sfx('siren', null, 0.6); }
    spawnT = Math.min(spawnT, 0.5);
    if (lv >= 4) blockT = Math.min(blockT, 3);
  } else if (lv === 0) {
    wanted.heat = 0; wanted.searching = false; arrestT = 0;
    music(null);
    if (how === 'escape') { toast('התחמקת. הפעם.', 3500); caption('[הסירנות מתרחקות]'); sfx('chime'); }
    standDown();
  } else if (how === 'escape') {
    toast('מד הבלגן יורד. תמשיך להיעלם.', 2500);
  }
}
function clearWanted(how) {
  wanted.heat = 0; wanted.searching = false; swapBoostT = 0; arrestT = 0;
  if (wanted.level !== 0) setLevel(0, how);
  else standDown();
}
// Pursuit ends: cars drive off, officers walk away.
function standDown() {
  for (const u of vehUnits) if (u.mode !== 'leave') beginLeave(u);
  for (const o of officers) if (o.alive) { o.state = 'leave'; o.leaveT = 0; }
}
function beginLeave(u) {
  u.mode = 'leave'; u.leaveT = 0;
  const rp = roadPoint(playerPos(), 150, 260);
  if (rp) { u.tgt.x = rp.x; u.tgt.z = rp.z; } else { u.tgt.x = u.veh.pos.x + Math.sin(u.veh.heading || 0) * 200; u.tgt.z = u.veh.pos.z + Math.cos(u.veh.heading || 0) * 200; }
  try { u.veh.sirenOn = false; } catch { /* ignore */ }
  removeBlip(u);
}

function onCrime(ev) {
  if (!ev || arrestPhase > 0) return;
  const type = ev.type || 'misc';
  const sev = Math.max(1, Math.min(3, +ev.severity || 1));
  const gap = CRIME_GAP[type] || 0.15;
  if (now - (crimeTimes[type] ?? -99) < gap) return;
  if (type === 'hit_cop' || type === 'kill_cop') {
    if (now - lastCopHeatT < 0.35) return;      // already counted through officer.damage()
    lastCopCrimeT = now;
  }
  const pos = ev.pos || playerPos();
  let witnessed = sev >= 2 || type === 'hit_cop' || type === 'kill_cop' || (wanted.level > 0 && !wanted.searching);
  if (!witnessed) witnessed = hasWitness(pos);
  if (!witnessed) return;
  crimeTimes[type] = now;
  const base = CRIME_HEAT[type] ?? 6;
  addHeat(base * (sev === 1 ? 1 : sev === 2 ? 1.3 : 1.7), type);
}
function hasWitness(pos) {
  const R2 = 60 * 60;
  const acts = G.actors;
  for (let i = 0; i < acts.length; i++) {
    const a = acts[i]; if (!a || !a.alive || !a.pos) continue;
    const dx = a.pos.x - pos.x, dz = a.pos.z - pos.z;
    if (dx * dx + dz * dz < R2) return true;
  }
  for (const u of vehUnits) { const dx = u.veh.pos.x - pos.x, dz = u.veh.pos.z - pos.z; if (dx * dx + dz * dz < R2) return true; }
  for (const v of ambient) { const dx = v.pos.x - pos.x, dz = v.pos.z - pos.z; if (dx * dx + dz * dz < R2) return true; }
  return false;
}

// ------------------------------------------------------------------ officer visuals
function tintMaterial(m) {
  if (!m) return m;
  let t = tintCache.get(m);
  if (!t) {
    t = m.clone();
    if (t.color) t.color.multiply(new THREE.Color(0.42, 0.6, 1.0));
    if (t.emissive) { t.emissive.set(0x061a44); t.emissiveIntensity = 0.5; }
    tintCache.set(m, t);
  }
  return t;
}
function getVisual() {
  if (visPool.length) {
    const v = visPool.pop();
    try { v.mixer?.stopAllAction(); } catch { /* ignore */ }
    v.cur = null; v.holder.rotation.set(0, 0, 0);
    return v;
  }
  const holder = new THREE.Group();
  holder.rotation.order = 'YXZ';
  let obj = null, mixer = null; const actions = {};
  if (copGltf) {
    try {
      obj = G.assets.clone(copGltf);
      obj.traverse((n) => {
        if (n.isMesh) {
          n.material = Array.isArray(n.material) ? n.material.map(tintMaterial) : tintMaterial(n.material);
          n.castShadow = true; n.frustumCulled = false;
        }
      });
      mixer = new THREE.AnimationMixer(obj);
      for (const name of ['idle', 'walk', 'run', 'point']) {
        const clip = THREE.AnimationClip.findByName(copGltf.animations || [], name);
        if (clip) actions[name] = mixer.clipAction(clip, obj);
      }
    } catch (e) { obj = null; mixer = null; }
  }
  if (!obj) {
    obj = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x1f4fb8, roughness: 0.7 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.0, 4, 10), mat); body.position.y = 0.8;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), new THREE.MeshStandardMaterial({ color: 0xd9a77c, roughness: 0.8 })); head.position.y = 1.62;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.21, 0.1, 12), new THREE.MeshStandardMaterial({ color: 0x0b1f55 })); cap.position.y = 1.8;
    obj.add(body, head, cap);
  }
  obj.rotation.y = MODEL_YAW;
  holder.add(obj);
  return { holder, obj, mixer, actions, cur: null };
}
function setAnim(o, name) {
  const v = o.vis; if (!v.mixer) return;
  const a = v.actions[name] || v.actions.idle; if (!a || v.cur === a) return;
  try {
    a.reset(); a.setEffectiveWeight(1); a.fadeIn(0.18); a.play();
    if (v.cur) v.cur.fadeOut(0.18);
    v.cur = a;
  } catch { /* ignore */ }
}

// ------------------------------------------------------------------ officers
function spawnOfficer(x, z, opts) {
  if (officers.length >= MAX_OFFICERS) return null;
  let vis; try { vis = getVisual(); } catch { return null; }
  const o = {
    id: nextId++, kind: 'cop', isCop: true, name: 'שוטר',
    pos: new THREE.Vector3(x, groundY(x, z), z), x, z, vel: new THREE.Vector3(),
    radius: 0.4, height: 1.85, alive: true, hp: 100, health: 100, heading: opts?.heading || 0,
    vis, object3d: vis.holder, state: 'chase', leaveT: 0, deadT: 0, age: 0,
    fireT: G.rand(0.7, 1.6), losT: Math.random() * 0.3, los: true,
    guard: !!opts?.guard, recall: false, car: opts?.car || null,
    avoidT: 0, avoidX: 0, avoidZ: 0, blip: false,
  };
  o.damage = (amount, from) => officerDamage(o, amount, from);
  try { G.world?.resolveCircle?.(o.pos, o.radius); } catch { /* ignore */ }
  vis.holder.position.copy(o.pos);
  vis.holder.rotation.set(0, o.heading, 0);
  vis.holder.visible = true;
  G.scene?.add(vis.holder);
  setAnim(o, 'idle');
  officers.push(o);
  G.actors.push(o);
  return o;
}
function removeOfficer(o) {
  let i = officers.indexOf(o); if (i >= 0) officers.splice(i, 1);
  i = G.actors.indexOf(o); if (i >= 0) G.actors.splice(i, 1);
  o.alive = false;
  removeBlip(o);
  try { G.scene?.remove(o.vis.holder); } catch { /* ignore */ }
  visPool.push(o.vis);
}
function isPlayerSource(from) {
  const p = G.player;
  if (from == null) return !!p && G.dist2D(playerPos(), lastHitPos) < 45;
  if (typeof from === 'string') {
    if (/cop|police|traffic|npc|ped|world|fall|gang/i.test(from)) return false;
    return true;
  }
  if (from === p || from === p?.inVehicle) return true;
  if (from.driver === 'player' || from.isPlayer || from.kind === 'player') return true;
  return false;
}
const lastHitPos = new THREE.Vector3();
function officerDamage(o, amount, from) {
  if (!o.alive) return;
  amount = +amount || 0; if (amount <= 0) return;
  lastHitPos.copy(o.pos);
  const byPlayer = isPlayerSource(from);
  o.hp -= amount; o.health = Math.max(0, o.hp);
  const dead = o.hp <= 0;
  if (dead) {
    o.alive = false; o.state = 'dead'; o.deadT = 0;
    const i = G.actors.indexOf(o); if (i >= 0) G.actors.splice(i, 1);
    removeBlip(o);
    sfx('death_m', o.pos);
  } else {
    sfx('hurt', o.pos, 0.8);
    o.fireT = Math.min(o.fireT, 0.5);
  }
  if (byPlayer && now - lastCopCrimeT > 0.35) {
    lastCopHeatT = now;
    addHeat(dead ? CRIME_HEAT.kill_cop : CRIME_HEAT.hit_cop, dead ? 'kill_cop' : 'hit_cop');
  }
}
function shout(lines) {
  if (shoutT > 0) return;
  shoutT = G.rand(4.5, 7.5);
  subtitle(G.pick(lines));
}
function officerFire(o, P, dist, pSpeed) {
  const p = G.player; if (!p) return;
  const fx = Math.sin(o.heading), fz = Math.cos(o.heading);
  const from = new THREE.Vector3(o.pos.x + fx * 0.45, o.pos.y + 1.42, o.pos.z + fz * 0.45);
  const to = new THREE.Vector3(P.x, (P.y || 0) + (p.inVehicle ? 0.8 : 1.15), P.z);
  let chance = G.clamp(0.78 - dist * 0.02, 0.1, 0.68);
  if (pSpeed > 6) chance *= 0.55;
  if (wanted.level >= 5) chance *= 1.15;
  const hit = Math.random() < chance;
  if (!hit) to.set(to.x + G.rand(-1.8, 1.8), to.y + G.rand(-0.6, 1.2), to.z + G.rand(-1.8, 1.8));
  try { G.fx?.tracer?.(from, to); } catch { /* ignore */ }
  try { _d.copy(to).sub(from).normalize(); G.fx?.muzzleFlash?.(from.clone(), _d.clone()); } catch { /* ignore */ }
  sfx('pistol', o.pos, 0.75);
  caption('[יריות]');
  if (hit) {
    try {
      if (p.inVehicle) { p.inVehicle.damage?.(5, 'cop'); if (Math.random() < 0.3) p.damage?.(4, 'cop'); try { G.fx?.sparks?.(to.clone()); } catch { /* ignore */ } }
      else p.damage?.(8, 'cop');
    } catch { /* ignore */ }
  }
}
function updateOfficer(o, dt, P, pSpeed, level) {
  const vis = o.vis;
  o.age += dt;
  if (!o.alive) {                                       // dying / dead body
    o.deadT += dt;
    const k = Math.min(1, o.deadT / 0.35);
    vis.holder.rotation.x = -Math.PI * 0.5 * k;
    vis.holder.position.y = o.pos.y + 0.12 * k;
    if (o.deadT < 0.4) vis.mixer?.update(dt * 0.3);
    if (o.deadT > 7) removeOfficer(o);
    return;
  }
  const p = G.player;
  const dxp = P.x - o.pos.x, dzp = P.z - o.pos.z;
  const distP = Math.hypot(dxp, dzp);
  let tx = P.x, tz = P.z, speed = 0, anim = 'idle', face = true;
  const run = level >= 5 ? 6.3 : 5.5;

  if (o.state === 'leave') {
    o.leaveT += dt;
    if (o.car && o.car.veh && !o.car.dead) { tx = o.car.veh.pos.x; tz = o.car.veh.pos.z; }
    else { tx = o.pos.x - dxp; tz = o.pos.z - dzp; }
    const dc = Math.hypot(tx - o.pos.x, tz - o.pos.z);
    speed = 2.0; anim = 'walk'; face = false;
    if ((o.car && dc < 2.6) || o.leaveT > 14 || (distP > 45 && (o.leaveT > 3 || !inCameraView(o.pos.x, o.pos.z)))) { removeOfficer(o); return; }
  } else if (o.recall) {
    const c = o.car;
    if (!c || c.dead || !c.veh) { if (distP > 40) { removeOfficer(o); return; } o.recall = false; }
    else {
      tx = c.veh.pos.x; tz = c.veh.pos.z;
      const dc = Math.hypot(tx - o.pos.x, tz - o.pos.z);
      speed = run; anim = 'run'; face = false;
      if (dc < 2.8 || o.age > 600) { removeOfficer(o); return; }
    }
  } else {
    if (wanted.searching) { tx = lastKnown.x; tz = lastKnown.z; }
    const dt2 = Math.hypot(tx - o.pos.x, tz - o.pos.z);
    o.losT -= dt;
    if (o.losT <= 0) { o.losT = 0.3; o.los = distP < 60 && hasLOS(o.pos.x, o.pos.z, P.x, P.z); }
    const shooter = level >= 3 && p?.alive !== false && arrestPhase === 0;
    const stopDist = shooter && o.los ? (o.guard ? 45 : 11) : (o.guard && distP > 32 ? 999 : 1.5);
    if (dt2 > stopDist) { speed = dt2 > 4 ? run : 2.2; anim = dt2 > 4 ? 'run' : 'walk'; face = false; }
    if (wanted.searching && dt2 < 6) { speed = 0; anim = 'idle'; face = false; }
    if (shooter && o.los && distP < 48 && !wanted.searching) {
      if (speed === 0) anim = 'point';
      o.fireT -= dt;
      if (o.fireT <= 0) {
        o.fireT = G.rand(0.9, 1.7) * (level >= 5 ? 0.7 : 1) * (speed > 0 ? 1.5 : 1);
        o.heading = Math.atan2(dxp, dzp);
        officerFire(o, P, distP, pSpeed);
        shout(SHOUTS_FIRE);
      }
    } else if (!wanted.searching && distP < 22 && level > 0 && level < 3) shout(SHOUTS_ARREST);
    if (distP > 85 && !o.guard && !inCameraView(o.pos.x, o.pos.z)) { removeOfficer(o); return; }
    if (distP > 140) { removeOfficer(o); return; }
  }

  // movement
  if (speed > 0) {
    let mx = tx - o.pos.x, mz = tz - o.pos.z;
    const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
    if (o.avoidT > 0) { o.avoidT -= dt; mx = mx * 0.25 + o.avoidX; mz = mz * 0.25 + o.avoidZ; const l = Math.hypot(mx, mz) || 1; mx /= l; mz /= l; }
    const step = Math.min(speed * dt, ml);
    o.pos.x += mx * step; o.pos.z += mz * step;
    let hit = null;
    try { hit = G.world?.resolveCircle?.(o.pos, o.radius); } catch { hit = null; }
    if (hit && Number.isFinite(hit.nx) && o.avoidT <= 0) {
      // slide along the wall toward the side closer to the goal
      let sx = -hit.nz, sz = hit.nx;
      if (sx * (tx - o.pos.x) + sz * (tz - o.pos.z) < 0) { sx = -sx; sz = -sz; }
      o.avoidX = sx; o.avoidZ = sz; o.avoidT = 0.9;
    }
    o.vel.set(mx * speed, 0, mz * speed);
    if (!face) o.heading += G.angleDiff(o.heading, Math.atan2(mx, mz)) * Math.min(1, dt * 10);
  } else o.vel.set(0, 0, 0);
  if (face && distP > 0.3) o.heading += G.angleDiff(o.heading, Math.atan2(dxp, dzp)) * Math.min(1, dt * 8);

  // keep officers apart
  for (let i = 0; i < officers.length; i++) {
    const b = officers[i]; if (b === o || !b.alive) continue;
    const sx = o.pos.x - b.pos.x, sz = o.pos.z - b.pos.z; const d2 = sx * sx + sz * sz;
    if (d2 < 0.81 && d2 > 1e-5) { const d = Math.sqrt(d2), push = (0.9 - d) * 0.5; o.pos.x += sx / d * push; o.pos.z += sz / d * push; }
  }
  o.pos.y = groundY(o.pos.x, o.pos.z);
  o.x = o.pos.x; o.z = o.pos.z;
  vis.holder.position.copy(o.pos);
  vis.holder.rotation.x = 0;
  vis.holder.rotation.y = o.heading;
  setAnim(o, anim);
  vis.mixer?.update(dt);
}

// ------------------------------------------------------------------ pursuit vehicles
function makeVehUnit(v, type) {
  const u = {
    id: nextId++, kind: 'veh', type, veh: v, pos: v.pos, object3d: v.object3d, x: v.pos.x, z: v.pos.z, heading: v.heading || 0,
    mode: 'chase', tgt: { x: v.pos.x, z: v.pos.z }, leaveT: 0, dist: 999, los: false,
    out: false, outCd: 1.5, crew: [], fireT: G.rand(1, 2.5), wanderT: 0, hold: false,
    stuckT: 0, chkT: 1, lx: v.pos.x, lz: v.pos.z, age: 0, blip: false, dead: false,
  };
  try { v.sirenOn = true; v.target = u.tgt; v.isPolice = true; } catch { /* ignore */ }
  vehUnits.push(u);
  return u;
}
function dropVehUnit(u, removeVeh) {
  const i = vehUnits.indexOf(u); if (i >= 0) vehUnits.splice(i, 1);
  u.dead = true;
  removeBlip(u);
  for (const o of u.crew) if (o.alive && officers.indexOf(o) >= 0) { o.car = null; o.recall = false; }
  u.crew.length = 0;
  if (removeVeh) removeVehicle(u.veh);
  else { try { if (u.veh.driver !== 'player') u.veh.sirenOn = false; } catch { /* ignore */ } }
}
function spawnPursuit(type, P) {
  // a patrol car that is already nearby joins the chase first
  if (type === 'police') {
    let best = null, bd = 200;
    for (const v of ambient) { const d = G.dist2D(v.pos, P); if (d < bd && !v.destroyed) { bd = d; best = v; } }
    if (best) {
      const x = best.pos.x, z = best.pos.z, h = best.heading || 0;
      ambient.splice(ambient.indexOf(best), 1);
      removeVehicle(best);
      const v = spawnVehicle('police', x, z, h, 'police');
      if (v) { makeVehUnit(v, 'police'); return true; }
    }
  }
  const rp = hiddenRoadPoint(P, 90, 160);
  if (!rp) { spawnFails++; return false; }
  let x = rp.x, z = rp.z, h = rp.heading || 0;
  // face the player: if the lane points away, use the opposite lane
  if (Math.sin(h) * (P.x - x) + Math.cos(h) * (P.z - z) < 0) {
    const lo = G.world?.roads?.laneOffset;
    if (Number.isFinite(lo)) { x -= -Math.cos(h) * lo * 2; z -= Math.sin(h) * lo * 2; }
    h += Math.PI;
  }
  const v = spawnVehicle(type, x, z, h, 'police');
  if (!v || !v.pos) { spawnFails++; return false; }
  spawnFails = 0;
  makeVehUnit(v, type);
  return true;
}
function deployCrew(u, P) {
  const v = u.veh; const h = v.heading || 0;
  const rx = -Math.cos(h), rz = Math.sin(h);
  const side = (v.width || 1.9) * 0.5 + 0.8;
  const n = officers.length < 4 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const s = i === 0 ? 1 : -1;
    const o = spawnOfficer(v.pos.x + rx * side * s, v.pos.z + rz * side * s, { heading: Math.atan2(P.x - v.pos.x, P.z - v.pos.z), car: u });
    if (o) u.crew.push(o);
  }
  if (u.crew.length) { u.out = true; sfx('door', v.pos, 0.8); shoutT = 0; shout(wanted.level >= 3 ? SHOUTS_FIRE : SHOUTS_ARREST); }
}
function holdVehicle(u, dt) {
  const v = u.veh; const h = v.heading || 0;
  u.tgt.x = v.pos.x + Math.sin(h) * 0.6; u.tgt.z = v.pos.z + Math.cos(h) * 0.6;
  const k = Math.max(0, 1 - 7 * dt);
  if (typeof v.speed === 'number') v.speed *= k;
  if (v.vel) { v.vel.x *= k; v.vel.z *= k; }
  v.hold = true;
}
function updateVehUnit(u, dt, P, PV, pSpeed, level) {
  const v = u.veh, p = G.player;
  if (!v || !v.pos || v.destroyed || v.driver === 'player' || p.inVehicle === v) { dropVehUnit(u, false); return; }
  u.age += dt;
  u.x = v.pos.x; u.z = v.pos.z; u.heading = v.heading || 0;
  const dx = P.x - v.pos.x, dz = P.z - v.pos.z;
  const dist = Math.hypot(dx, dz); u.dist = dist;
  if (v.target !== u.tgt) v.target = u.tgt;
  if (v.driver !== 'police' && v.driver !== 'player') { try { v.driver = 'police'; } catch { /* ignore */ } }
  v.hold = false;
  v.pursuitLevel = level;

  if (u.mode === 'leave') {
    u.leaveT += dt; v.sirenOn = false;
    if (dist > 120 || u.leaveT > 40 || (u.leaveT > 6 && dist > 60 && !inCameraView(v.pos.x, v.pos.z))) dropVehUnit(u, true);
    return;
  }
  v.sirenOn = true;

  // crew bookkeeping
  if (u.out) {
    let alive = 0, far = true;
    for (let i = u.crew.length - 1; i >= 0; i--) {
      const o = u.crew[i];
      if (officers.indexOf(o) < 0) { u.crew.splice(i, 1); continue; }
      if (!o.alive) continue;
      alive++;
      if (G.dist2D(o.pos, P) < 45) far = false;
    }
    if (alive === 0 && u.crew.length === 0) { u.out = false; u.outCd = 3; }
    else if (alive === 0) { u.out = false; u.outCd = 6; u.crew.length = 0; }
    else if ((far && dist > 45) || (p.inVehicle && pSpeed > 7 && dist > 30)) { for (const o of u.crew) if (o.alive) o.recall = true; }
    if (u.out) { holdVehicle(u, dt); return; }
  }
  if (u.outCd > 0) u.outCd -= dt;

  const onFoot = !p.inVehicle;
  if (wanted.searching) {
    // drive to the last known position, then sweep the area
    const dl = Math.hypot(lastKnown.x - v.pos.x, lastKnown.z - v.pos.z);
    u.wanderT -= dt;
    if (dl < 28 && u.wanderT <= 0) {
      const rp = roadPoint(lastKnown, 30, 120);
      if (rp) { u.wx = rp.x; u.wz = rp.z; u.wanderT = 7; }
    }
    if (u.wanderT > 0 && Number.isFinite(u.wx)) { u.tgt.x = u.wx; u.tgt.z = u.wz; }
    else { u.tgt.x = lastKnown.x; u.tgt.z = lastKnown.z; }
    u.hold = false;
  } else {
    const holdR = onFoot ? 15 : 11;
    u.hold = dist < holdR && pSpeed < 3.5 && (onFoot || level < 3);
    if (u.hold) holdVehicle(u, dt);
    else {
      const lead = G.clamp(dist / 26, 0, level >= 3 ? 1.5 : 0.9);
      u.tgt.x = P.x + (PV.x || 0) * lead; u.tgt.z = P.z + (PV.z || 0) * lead;
    }
    // officers get out
    const canCarry = u.type !== 'policebike' && !v.isBike;
    if (canCarry && !u.out && u.outCd <= 0 && dist < 18 && Math.abs(v.speed || 0) < 4.5 && pSpeed < 5 && officers.length < MAX_OFFICERS && p.alive !== false) deployCrew(u, P);
    // shots from the window at high levels
    if (level >= 4 && u.los && dist < 30 && dist > 5 && p.alive !== false) {
      u.fireT -= dt;
      if (u.fireT <= 0) {
        u.fireT = G.rand(1.4, 2.6) * (level >= 5 ? 0.7 : 1);
        const from = new THREE.Vector3(v.pos.x, v.pos.y + 1.1, v.pos.z);
        const hit = Math.random() < G.clamp(0.5 - dist * 0.012, 0.12, 0.4);
        const to = new THREE.Vector3(P.x + (hit ? 0 : G.rand(-2, 2)), (P.y || 0) + 0.9, P.z + (hit ? 0 : G.rand(-2, 2)));
        try { G.fx?.tracer?.(from, to); } catch { /* ignore */ }
        sfx('pistol', v.pos, 0.6);
        if (hit) { try { if (p.inVehicle) p.inVehicle.damage?.(4, 'cop'); else p.damage?.(6, 'cop'); } catch { /* ignore */ } }
      }
    }
  }

  // stuck / far away housekeeping
  u.chkT -= dt;
  if (u.chkT <= 0) {
    u.chkT = 1;
    const moved = Math.hypot(v.pos.x - u.lx, v.pos.z - u.lz);
    u.lx = v.pos.x; u.lz = v.pos.z;
    if (!u.hold && moved < 1.2) u.stuckT += 1; else u.stuckT = 0;
    if (!vehicleListed(v)) { dropVehUnit(u, false); return; }
    if ((u.stuckT >= 6 && dist > 45 && (!u.los || !inCameraView(v.pos.x, v.pos.z))) || u.stuckT >= 14 || dist > 240) {
      dropVehUnit(u, true); spawnT = Math.min(spawnT, 0.8);
    }
  }
}

// ------------------------------------------------------------------ roadblocks
function buildBarrier(x, z, heading) {
  if (!barrierGeo) {
    barrierGeo = { bar: new THREE.BoxGeometry(2.4, 0.26, 0.1), leg: new THREE.BoxGeometry(0.1, 0.95, 0.5), lamp: new THREE.SphereGeometry(0.1, 8, 6), stripe: new THREE.BoxGeometry(0.4, 0.27, 0.11) };
    barrierMats = {
      white: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 }),
      blue: new THREE.MeshStandardMaterial({ color: 0x1846c8, roughness: 0.6 }),
      leg: new THREE.MeshStandardMaterial({ color: 0x30343c, roughness: 0.8 }),
      lamp: new THREE.MeshStandardMaterial({ color: 0xffa020, emissive: 0xff8a00, emissiveIntensity: 2 }),
    };
  }
  const g = new THREE.Group();
  const bar = new THREE.Mesh(barrierGeo.bar, barrierMats.white); bar.position.y = 0.85; g.add(bar);
  for (let i = -2; i <= 2; i += 2) { const s = new THREE.Mesh(barrierGeo.stripe, barrierMats.blue); s.position.set(i * 0.45, 0.85, 0); g.add(s); }
  for (const sx of [-1, 1]) { const l = new THREE.Mesh(barrierGeo.leg, barrierMats.leg); l.position.set(sx * 1.05, 0.47, 0); g.add(l); }
  const lamp = new THREE.Mesh(barrierGeo.lamp, barrierMats.lamp); lamp.position.set(0, 1.08, 0); g.add(lamp);
  g.rotation.order = 'YXZ';
  g.position.set(x, groundY(x, z), z); g.rotation.y = heading;
  G.scene?.add(g);
  return { obj: g, x, z, fallen: false };
}
function tryRoadblock(P) {
  const p = G.player, pv = p.inVehicle, w = G.world;
  if (!pv || !w?.randomRoadPoint || !G.vehicles?.spawn) return false;
  let dx = Math.sin(pv.heading || 0), dz = Math.cos(pv.heading || 0);
  if (pv.vel) { const s = Math.hypot(pv.vel.x, pv.vel.z); if (s > 3) { dx = pv.vel.x / s; dz = pv.vel.z / s; } }
  let rp = null;
  for (let i = 0; i < 4 && !rp; i++) {
    _t.set(P.x + dx * (85 + i * 10), 0, P.z + dz * (85 + i * 10));
    const c = roadPoint(_t, 0, 26); if (!c) continue;
    const ex = c.x - P.x, ez = c.z - P.z;
    const along = ex * dx + ez * dz, lat = Math.abs(ex * dz - ez * dx);
    const h = c.heading || 0;
    if (along < 55 || along > 150 || lat > 26) continue;
    if (Math.abs(Math.sin(h) * dx + Math.cos(h) * dz) < 0.6) continue;
    rp = c;
  }
  if (!rp) return false;
  const h = rp.heading || 0;
  const fx = Math.sin(h), fz = Math.cos(h), rx = -Math.cos(h), rz = Math.sin(h);
  const lo = Number.isFinite(w.roads?.laneOffset) ? w.roads.laneOffset : 1.75;
  const hw = Number.isFinite(w.roads?.halfWidth) ? w.roads.halfWidth : 6;
  const cx = rp.x - rx * lo, cz = rp.z - rz * lo;
  const toP = (fx * (P.x - cx) + fz * (P.z - cz)) >= 0 ? 1 : -1;     // which way along the road the player comes from
  const rb = { id: nextId++, kind: 'block', x: cx, z: cz, pos: new THREE.Vector3(cx, 0, cz), vehs: [], barriers: [], age: 0, blip: false };
  for (const s of [-1, 1]) {
    const v = spawnVehicle('police', cx + rx * 2.45 * s, cz + rz * 2.45 * s, h + Math.PI * 0.5 + 0.18 * s, 'parked');
    if (v) { try { v.sirenOn = true; v.isPolice = true; } catch { /* ignore */ } rb.vehs.push(v); }
  }
  if (!rb.vehs.length) return false;
  const edge = Math.max(hw - 0.4, 5.4);
  try {
    for (const s of [-1, 1]) {
      rb.barriers.push(buildBarrier(cx + rx * edge * s, cz + rz * edge * s, h));
      rb.barriers.push(buildBarrier(cx + rx * 2.2 * s + fx * 7 * toP, cz + rz * 2.2 * s + fz * 7 * toP, h));
    }
  } catch { /* ignore */ }
  for (const s of [-1, 1]) {
    spawnOfficer(cx + rx * (hw + 1.0) * s + fx * 2.5 * toP, cz + rz * (hw + 1.0) * s + fz * 2.5 * toP, { guard: true, heading: Math.atan2(P.x - cx, P.z - cz) });
  }
  roadblock = rb;
  toast('מחסום משטרתי בהמשך הרחוב. בהצלחה עם זה.', 3200);
  caption('[קשר משטרתי: מחסום הוקם]');
  return true;
}
function removeRoadblock() {
  const rb = roadblock; if (!rb) return;
  roadblock = null;
  removeBlip(rb);
  for (const v of rb.vehs) removeVehicle(v);
  for (const b of rb.barriers) { try { G.scene?.remove(b.obj); } catch { /* ignore */ } }
}
function updateRoadblock(dt, P, pSpeed, level) {
  const rb = roadblock; if (!rb) return;
  rb.age += dt;
  const d = Math.hypot(rb.x - P.x, rb.z - P.z);
  if (barrierMats) barrierMats.lamp.emissiveIntensity = (Math.sin(now * 9) > 0) ? 2.6 : 0.3;
  if (d < 30) {
    for (const b of rb.barriers) {
      if (b.fallen) continue;
      if (Math.hypot(b.x - P.x, b.z - P.z) < 2.3 && pSpeed > 3) {
        b.fallen = true; b.obj.rotation.x = Math.PI * 0.5; b.obj.position.y += 0.08;
        try { _t.set(b.x, 0.6, b.z); G.fx?.sparks?.(_t.clone()); G.fx?.shake?.(0.25); } catch { /* ignore */ }
        sfx('bump', null, 0.8);
      }
    }
  }
  const gone = level === 0 ? d > 60 : level < 4 ? d > 90 : d > 175;
  if (gone || (rb.age > 55 && d > 70 && !inCameraView(rb.x, rb.z)) || rb.age > 120) removeRoadblock();
}

// ------------------------------------------------------------------ ambient patrols + parking inspector
function updateAmbient(P, level) {
  for (let i = ambient.length - 1; i >= 0; i--) {
    const v = ambient[i];
    if (!v || !v.pos || v.destroyed || v.driver === 'player' || G.player?.inVehicle === v || !vehicleListed(v)) { ambient.splice(i, 1); continue; }
    const d = G.dist2D(v.pos, P);
    if (d > 290 || (level >= 3 && d > 70 && !inCameraView(v.pos.x, v.pos.z))) { ambient.splice(i, 1); removeVehicle(v); }
  }
  const want = level === 0 ? 2 : level < 3 ? 1 : 0;
  if (ambient.length < want && G.vehicles?.spawn) {
    const rp = hiddenRoadPoint(P, 110, 210);
    if (rp) { const v = spawnVehicle('police', rp.x, rp.z, rp.heading || 0, 'traffic'); if (v && v.pos) ambient.push(v); }
  }
}
function updateParking(dt) {
  const w = parkWatch; if (!w) return;
  const v = w.veh, p = G.player;
  if (!v || v.destroyed || !v.pos || p?.inVehicle === v || v._ticketed) { parkWatch = null; return; }
  if (Math.hypot(v.pos.x - w.x, v.pos.z - w.z) > 2) { parkWatch = null; return; }
  w.t += dt;
  if (w.t >= 20) {
    parkWatch = null; v._ticketed = true;
    const fine = Math.min(250, Math.max(0, p?.money | 0));
    try { if (fine > 0) { if (p.addMoney) p.addMoney(-fine); else p.money -= fine; } } catch { /* ignore */ }
    toast('פקח חניה: דוח ₪250 על חנייה על המדרכה. ערעור? בהצלחה.', 4500);
    try { G.hud?.subtitle?.('פקח', 'ראיתי אותך. גם את הרכב. גם את המדרכה.', 3000); } catch { /* ignore */ }
    sfx('ui_error');
    try { _t.set(v.pos.x, 1.6, v.pos.z); G.fx?.moneyPop?.(_t.clone(), -250); } catch { /* ignore */ }
  }
}

// ------------------------------------------------------------------ arrest
function beginArrest() {
  if (arrestPhase !== 0) return;
  arrestPhase = 1; arrestClock = 0; arrestT = 0;
  try { G.hud?.bigText?.('נעצרת', 'שוחררת בערבות. ₪300 ואקדח פחות.', 4500); } catch { /* ignore */ }
  try { G.fx?.flash?.('#000', 1200); } catch { /* ignore */ }
  try { G.hud?.announce?.('נעצרת. שוחררת בערבות.'); } catch { /* ignore */ }
  sfx('ui_error');
  caption('[אזיקים נסגרים]');
}
function finishArrest() {
  const p = G.player; if (!p) return;
  try { G.events.emit('player:arrested', {}); } catch { /* ignore */ }
  try { p.forceExitVehicle?.(); } catch { /* ignore */ }
  if (p.inVehicle) {
    try { G.vehicles?.setPlayerVehicle?.(null); } catch { /* ignore */ }
    try { const v = p.inVehicle; p.inVehicle = null; if (v && v.driver === 'player') v.driver = null; if (p.object3d) p.object3d.visible = true; G.events.emit('player:exitVehicle', { vehicle: v }); } catch { /* ignore */ }
  }
  try {
    const fine = Math.min(300, Math.max(0, p.money | 0));
    if (fine > 0) { if (p.addMoney) p.addMoney(-fine); else p.money -= fine; }
    if (p.ammo && typeof p.ammo === 'object') p.ammo.pistol = 0;
    if (p.weapon === 'pistol') p.weapon = 'fists';
  } catch { /* ignore */ }
  try {
    const w = G.world;
    const st = w?.landmarks?.police || w?.landmarks?.station || w?.policeStation || w?.spawn;
    if (st && Number.isFinite(st.x) && p.teleport) p.teleport(st.x, st.z, st.heading || 0);
  } catch { /* ignore */ }
  purgeAll();
  clearWanted('arrest');
}
// Remove every active unit at once (screen is black / player died).
function purgeAll() {
  for (let i = vehUnits.length - 1; i >= 0; i--) dropVehUnit(vehUnits[i], true);
  for (let i = officers.length - 1; i >= 0; i--) removeOfficer(officers[i]);
  removeRoadblock();
}

// ------------------------------------------------------------------ main tick
function tick(dt) {
  const p = G.player; if (!p || !p.pos) return;
  now += dt;
  const pv = p.inVehicle || null;
  const P = (pv && pv.pos) || p.pos;
  const PV = (pv && pv.vel) || p.vel || ZERO;
  const pSpeed = pv ? Math.abs(Number.isFinite(pv.speed) ? pv.speed : Math.hypot(PV.x || 0, PV.z || 0)) : Math.hypot(PV.x || 0, PV.z || 0);
  if (shoutT > 0) shoutT -= dt;
  if (swapBoostT > 0) swapBoostT -= dt;

  // arrest sequence
  if (arrestPhase === 1) { arrestClock += dt; if (arrestClock > 0.65) { finishArrest(); arrestPhase = 2; arrestClock = 0; } }
  else if (arrestPhase === 2) { arrestClock += dt; if (arrestClock > 1.5) arrestPhase = 0; }

  let level = wanted.level;

  // line of sight -> searching / escape
  sightT -= dt;
  if (sightT <= 0) {
    sightT = 0.25;
    let seen = false;
    for (const u of vehUnits) {
      if (u.mode === 'leave') { u.los = false; continue; }
      u.los = u.dist < SIGHT_DIST && hasLOS(u.veh.pos.x, u.veh.pos.z, P.x, P.z);
      if (u.los) seen = true;
    }
    if (level > 0 && !seen) {
      for (const o of officers) { if (o.alive && o.state === 'chase' && o.los && G.dist2D(o.pos, P) < 60) { seen = true; break; } }
      if (!seen) for (const v of ambient) { if (G.dist2D(v.pos, P) < 55 && hasLOS(v.pos.x, v.pos.z, P.x, P.z)) { seen = true; break; } }
      if (!seen && roadblock && G.dist2D(roadblock, P) < 50) seen = true;
    }
    if (seen && level > 0) markSeen();
  }
  if (level > 0) {
    wanted.searching = (now - lastSeenT) > 6;
    if (levelHoldT > 0) levelHoldT -= dt;
    else if (wanted.searching) {
      let rate = 3.5 + level * 1.3; if (swapBoostT > 0) rate *= 2.2;
      wanted.heat = Math.max(0, wanted.heat - rate * dt);
      if (wanted.heat < THRESH[level]) { setLevel(level - 1, 'escape'); level = wanted.level; }
    }
  } else {
    wanted.searching = false;
    if (wanted.heat > 0) wanted.heat = Math.max(0, wanted.heat - 1.2 * dt);
  }

  // spawn / trim pursuit units
  spawnT -= dt;
  if (spawnT <= 0 && arrestPhase === 0) {
    spawnT = 2.2;
    const comp = COMPOSITION[level] || COMPOSITION[0];
    let chasing = 0; for (const u of vehUnits) if (u.mode === 'chase') chasing++;
    const total = vehUnits.length + (roadblock ? roadblock.vehs.length : 0);
    if (level > 0 && p.alive !== false) {
      if (chasing < comp.length && total < MAX_VEH && G.vehicles?.spawn && spawnFails < 4) spawnPursuit(comp[chasing], P);
      else if (chasing > comp.length) {
        let far = null, fd = -1;
        for (const u of vehUnits) if (u.mode === 'chase' && !u.out && u.dist > fd) { fd = u.dist; far = u; }
        if (far) beginLeave(far);
      }
      if (spawnFails >= 4) spawnFails = 3.5 > Math.random() * 12 ? 4 : 0;    // retry now and then
    }
  }
  // officers on foot when no car can deliver them (no vehicles module, beach, plazas...)
  if (level > 0 && arrestPhase === 0 && p.alive !== false) {
    let alive = 0; for (const o of officers) if (o.alive && o.state === 'chase') alive++;
    const noCars = !G.vehicles?.spawn || spawnFails >= 4;
    if (alive === 0 || (noCars && alive < Math.min(2 + level, 6))) noOfficerT += dt; else noOfficerT = 0;
    if (noOfficerT > (noCars ? 3 : 10) && pSpeed < 9 && !wanted.searching) {
      noOfficerT = 0;
      for (let k = 0; k < 2; k++) {
        let sp = null;
        for (let i = 0; i < 5; i++) {
          let c = null;
          try { c = G.world?.randomSidewalkPoint?.(P, 35, 70) || null; } catch { c = null; }
          if (!c) { const a = Math.random() * Math.PI * 2, r = G.rand(40, 60); c = { x: P.x + Math.sin(a) * r, z: P.z + Math.cos(a) * r }; try { if (G.world?.blocked?.(c.x, c.z, 0.5)) continue; } catch { /* ignore */ } }
          if (Math.hypot(c.x - P.x, c.z - P.z) < 25) continue;
          sp = c;
          if (!inCameraView(c.x, c.z) || !hasLOS(P.x, P.z, c.x, c.z)) break;
        }
        if (sp) spawnOfficer(sp.x, sp.z, { heading: Math.atan2(P.x - sp.x, P.z - sp.z) });
      }
    }
  } else noOfficerT = 0;

  // roadblocks
  if (level >= 4 && !roadblock && arrestPhase === 0) {
    blockT -= dt;
    if (blockT <= 0) {
      blockT = 4;
      if (pv && pSpeed > 6 && vehUnits.length <= MAX_VEH - 2 && !wanted.searching) { if (tryRoadblock(P)) blockT = 16; }
    }
  }
  updateRoadblock(dt, P, pSpeed, level);

  // units
  for (let i = vehUnits.length - 1; i >= 0; i--) updateVehUnit(vehUnits[i], dt, P, PV, pSpeed, level);
  for (let i = officers.length - 1; i >= 0; i--) updateOfficer(officers[i], dt, P, pSpeed, level);

  // arrest check (levels 1-2)
  if (level > 0 && level < 3 && arrestPhase === 0 && p.alive !== false) {
    let close = false;
    const r = pv ? 3.8 : 2.2;
    if (!pv || pSpeed < 1.5) {
      for (const o of officers) { if (o.alive && o.state === 'chase' && !o.recall && G.dist2D(o.pos, P) < r) { close = true; break; } }
    }
    if (close) {
      arrestT += dt;
      if (!arrestWarned && arrestT > 0.5) { arrestWarned = true; toast('שוטר צמוד אליך - תזוז או שתיעצר!', 1800); }
      if (arrestT >= 2.5) beginArrest();
    } else { arrestT = Math.max(0, arrestT - dt * 1.5); if (arrestT === 0) arrestWarned = false; }
  } else if (arrestPhase === 0) arrestT = 0;
  wanted.arrestProgress = Math.min(1, arrestT / 2.5);

  // slow housekeeping
  ambientT -= dt;
  if (ambientT <= 0) { ambientT = 2.5; updateAmbient(P, level); }
  slowT -= dt;
  if (slowT <= 0) {
    slowT = 0.5;
    if (parkWatch && parkWatch.onWalk === undefined) {
      let s = null; try { s = G.world?.surfaceAt?.(parkWatch.x, parkWatch.z); } catch { s = null; }
      parkWatch.onWalk = s === 'sidewalk' || s === 'plaza';
      if (!parkWatch.onWalk) parkWatch = null;
    }
    // minimap blips only while the meter is on
    for (const u of vehUnits) { if (level > 0 && u.mode === 'chase') addBlip(u); else removeBlip(u); }
    for (const o of officers) { if (level > 0 && o.alive && o.state === 'chase') addBlip(o); else removeBlip(o); }
    if (roadblock) { if (level > 0) addBlip(roadblock); else removeBlip(roadblock); }
  }
  updateParking(dt);

  // public list for the minimap
  const list = wanted.units; list.length = 0;
  for (const u of vehUnits) list.push(u);
  for (const o of officers) if (o.alive) list.push(o);
  if (roadblock) list.push(roadblock);
}

// ------------------------------------------------------------------ module API
export async function init(G_) {
  G.wanted = wanted;
  G.events.on('crime', (ev) => { try { onCrime(ev); } catch (e) { console.error('[police] crime', e); } });
  G.events.on('player:died', () => { arrestT = 0; purgeAll(); clearWanted('died'); });
  G.events.on('player:respawn', () => { purgeAll(); clearWanted('died'); });
  G.events.on('player:enterVehicle', (ev) => {
    const v = ev?.vehicle; parkWatch = null;
    if (!v) return;
    for (const u of vehUnits.slice()) if (u.veh === v) dropVehUnit(u, false);
    const ai = ambient.indexOf(v); if (ai >= 0) ambient.splice(ai, 1);
    if (roadblock) { const ri = roadblock.vehs.indexOf(v); if (ri >= 0) roadblock.vehs.splice(ri, 1); }
    if (wanted.level > 0 && now - lastSeenT > 1.5 && v !== lastSeenVehicle) {
      wanted.heat *= 0.65; swapBoostT = 12; levelHoldT = Math.min(levelHoldT, 1);
      toast('החלפת רכב בלי שראו. ערמומי.', 2600);
    }
  });
  G.events.on('player:exitVehicle', (ev) => {
    const v = ev?.vehicle;
    if (!v || !v.pos || v.isPolice || v.destroyed || v._ticketed || arrestPhase !== 0) return;
    parkWatch = { veh: v, t: 0, x: v.pos.x, z: v.pos.z, onWalk: undefined };
  });

  // officer model (shared skeleton with the other characters); procedural fallback if nothing loads
  for (const url of ['assets/chars/en_warden.glb', 'assets/chars/a7_grunt.glb', 'assets/chars/en_grunt.glb']) {
    try {
      const g = await G.assets.loadGLB(url);
      if (g && g.scene) { copGltf = g; break; }
    } catch { /* try the next one */ }
  }
  // warm one visual so the first officer does not hitch
  try { visPool.push(getVisual()); visPool.push(getVisual()); } catch { /* ignore */ }
}

export function update(dt) {
  if (!(dt > 0)) return;
  if (dt > 0.1) dt = 0.1;
  try { tick(dt); }
  catch (e) { if (errCount++ < 5) console.error('[police] update', e); }
}
