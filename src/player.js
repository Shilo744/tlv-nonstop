// player.js - hero character, on-foot movement, combat, enter/exit vehicles, death/respawn and the game camera.
import * as THREE from 'three';
import { G } from './core.js';

// ---------------------------------------------------------------- tunables
const MODEL_YAW = 0;        // extra yaw of the hero model. With AUTO_FACE the facing is measured from the foot bones and this is added on top.
const AUTO_FACE = false;     // measure Foot->Toes direction at load so the model faces +Z at rotation.y = 0 (set false to trust MODEL_YAW only)
const GUN_YAW = 0;          // pistol.glb: barrel is along -Z (bbox z -0.21..0.05). Set Math.PI if it points backwards.

const RADIUS = 0.4;
const JOG_SPEED = 3.9, SPRINT_SPEED = 7.0, AIM_SPEED = 2.0, SWIM_SPEED = 1.7;
const GRAVITY = 17, JUMP_V = 5.8;
const BASE_FOV = 62;
const PUNCH_DUR = 0.34;
const WEAPONS = ['fists', 'pistol', 'smg'];
const WEAPON_HE = { fists: 'אגרופים', pistol: 'אקדח', smg: 'תת-מקלע' };
const GUNS = {
  pistol: { dmg: 34, rate: 0.26, sound: 'pistol', recoil: 0.016, auto: false, spread: 0.0 },
  smg: { dmg: 18, rate: 0.085, sound: 'smg', recoil: 0.007, auto: true, spread: 0.012 },
};
const CAM_MODES = [
  { name: 'קרובה', dist: 6.4, pitch: 0.2, look: 1.3, side: 0, top: false },
  { name: 'רחוקה', dist: 10.5, pitch: 0.3, look: 1.45, side: 0, top: false },
  { name: 'קולנועית', dist: 5.4, pitch: 0.035, look: 0.85, side: 1.7, top: false },
  { name: 'מלמעלה', dist: 34, pitch: 1.4, look: 0.5, side: 0, top: true },
];
const HOSPITAL_FEE = 500;

// ---------------------------------------------------------------- state
const P = {
  pos: new THREE.Vector3(), heading: 0, vel: new THREE.Vector3(), object3d: null,
  health: 100, armor: 0, money: 300, alive: true,
  inVehicle: null, weapon: 'fists', ammo: { pistol: 60, smg: 0 }, owned: { fists: true, pistol: true, smg: false },
  isSprinting: false, isAiming: false, isSwimming: false,
  camYaw: 0, camPitch: 0.2,
  damage, heal, addMoney, teleport, giveWeapon,
};

let root = null, tilt = null, model = null, gun = null;
let mixer = null;
const actions = {};
const W = { idle: 1, walk: 0, run: 0, sit: 0 };
let oneShot = null, oneShotW = 0;
const B = {};   // bones

let vy = 0, onGround = true, sprintToggle = false, idleT = 0, stepAcc = 0;
let fireCd = 0, punchT = -1, punchHitDone = true, punchSide = 1, aimHoldT = 0, aimW = 0, faceCamT = 0;
let flinchT = 0, lastDamageT = -100, lastHurtSnd = -100, vehHitCd = 0;
let deathT = -1, respawnDone = true;
let entering = null;
let myPrompt = null, promptT = 0, exitHintT = -100, listCheckT = 0;
let camMode = 0, chaseYaw = 0, orbitYaw = 0, vehPitchOff = 0, lastLookT = -100;
let curDist = 4.4, curSide = 0.42, curFov = BASE_FOV, camDist = 4.4;
const followPos = new THREE.Vector3();
let snapCam = true, wasStarted = false;
let blendT = -1; const blendPos = new THREE.Vector3(), blendQuat = new THREE.Quaternion();
let titleT = 0, titleH = 34;
let lockFails = 0, unlockedPresses = 0;
const padPrev = [];
const padEdge = [];
let fadeEl = null;
let assistTarget = null;

// temporaries
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _o = new THREE.Vector3(), _dir = new THREE.Vector3(), _t = new THREE.Vector3(), _tgt = new THREE.Vector3();
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(0, 1, 0);
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _q4 = new THREE.Quaternion();
const _m = new THREE.Matrix4(), ZERO = new THREE.Vector3();
const _muzzle = new THREE.Vector3(), _hit = new THREE.Vector3();

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function angDiff(a, b) { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; }
function wrap(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }
function safe(where, fn) { try { return fn(); } catch (e) { if (G.errors && G.errors.length < 200) { G.errors.push('[player:' + where + '] ' + (e && e.stack ? e.stack : e)); } console.error('[player:' + where + ']', e); return undefined; } }
function groundAt(x, z) { const g = G.world?.groundY?.(x, z); return Number.isFinite(g) ? g : 0; }
function spawnPoint() { const s = G.world?.spawn; return s && Number.isFinite(s.x) && Number.isFinite(s.z) ? s : { x: 0, z: 0, heading: 0 }; }
function play(name, opts) { try { G.audio?.play?.(name, opts); } catch { /* ignore */ } }
function emit(name, data) { try { G.events.emit(name, data); } catch { /* ignore */ } }
function padPressed(i) { return !!padEdge[i]; }

// ---------------------------------------------------------------- init
export async function init(G_) {
  root = new THREE.Group(); root.name = 'Player';
  tilt = new THREE.Group(); root.add(tilt);
  P.object3d = root;
  const sp = spawnPoint();
  P.pos.set(sp.x, groundAt(sp.x, sp.z), sp.z);
  P.heading = sp.heading || 0; P.camYaw = P.heading;
  root.position.copy(P.pos); root.rotation.y = P.heading;
  followPos.copy(P.pos);
  G.player = P;
  G.scene?.add(root);

  // hero model
  let gltf = null;
  for (const url of ['assets/chars/hero.glb', 'assets/chars/y3.glb', 'assets/chars/runner.glb']) {
    try { gltf = await G.assets.loadGLB(url); if (gltf) break; } catch { gltf = null; }
  }
  if (gltf) {
    try {
      model = G.assets.clone(gltf);
      model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
      tilt.add(model);
      setupBones();
      setupAnims(gltf);
    } catch (e) { console.error('[player] hero setup failed', e); if (model) tilt.remove(model); model = null; mixer = null; }
  }
  if (!model) makeCapsule();

  // weapon model (lives in the scene, glued to the right hand every frame)
  gun = new THREE.Group(); gun.visible = false; G.scene?.add(gun);
  try {
    const pg = await G.assets.loadGLB('assets/props/pistol.glb');
    const pm = G.assets.clone(pg);
    const box = new THREE.Box3().setFromObject(pm); const size = box.getSize(new THREE.Vector3());
    const s = 0.27 / Math.max(0.001, size.x, size.y, size.z);
    pm.scale.setScalar(s); pm.rotation.y = GUN_YAW;
    pm.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    gun.add(pm);
  } catch {
    const gm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.11, 0.24), new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.5, metalness: 0.7 }));
    gm.position.set(0, 0, -0.08); gun.add(gm);
  }

  // pointer lock on click (must happen inside the user gesture)
  window.addEventListener('mousedown', (e) => {
    if (!G.started || G.paused || !G.input.enabled) return;
    const t = e.target;
    if (t && t.closest && t.closest('button, input, select, textarea, a, [role="button"], [data-ui]')) return;
    if (!G.input.mouse.locked) { unlockedPresses++; G.input.requestPointerLock(); }
  });
  document.addEventListener('pointerlockerror', () => { lockFails++; });
  document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement) unlockedPresses = 0; });

  G.events.on('game:start', () => { beginBlend(); });
  G.events.on('vehicle:destroyed', (d) => { if (d && d.vehicle && d.vehicle === P.inVehicle) { forceExit(true); P.damage(70, 'explosion'); } });
  G.events.on('mission:complete', () => { if (!P.inVehicle && P.alive) playOneShot('celebrate'); });
}

function makeCapsule() {
  model = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffb020, roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.33, 1.15, 6, 12), mat); body.position.y = 0.9; body.castShadow = true;
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.3), new THREE.MeshStandardMaterial({ color: 0x222222 })); nose.position.set(0, 1.55, 0.3);
  model.add(body, nose); tilt.add(model);
}

function findBone(name) {
  const want = name.replace(/[^a-z0-9]/gi, '').toLowerCase();
  let found = null;
  model.traverse((o) => { if (!found && (o.isBone || o.type === 'Bone') && o.name.replace(/[^a-z0-9]/gi, '').toLowerCase() === want) found = o; });
  if (!found) model.traverse((o) => { if (!found && o.name && o.name.replace(/[^a-z0-9]/gi, '').toLowerCase() === want) found = o; });
  return found;
}

function setupBones() {
  B.uaR = findBone('UpperArm.R'); B.laR = findBone('LowerArm.R'); B.hR = findBone('Hand.R');
  B.uaL = findBone('UpperArm.L'); B.laL = findBone('LowerArm.L'); B.hL = findBone('Hand.L');
  B.footL = findBone('Foot.L'); B.toesL = findBone('Toes.L');
  model.rotation.y = MODEL_YAW;
  if (AUTO_FACE && B.footL && B.toesL) {
    const saveP = root.position.clone(), saveR = root.rotation.y;
    root.position.set(0, 0, 0); root.rotation.y = 0; model.rotation.y = 0;
    root.updateMatrixWorld(true);
    B.footL.getWorldPosition(_a); B.toesL.getWorldPosition(_b); _b.sub(_a);
    if (Math.hypot(_b.x, _b.z) > 0.02) model.rotation.y = MODEL_YAW - Math.atan2(_b.x, _b.z);
    else model.rotation.y = MODEL_YAW;
    root.position.copy(saveP); root.rotation.y = saveR; root.updateMatrixWorld(true);
  }
}

// Remove root motion from locomotion clips (on a private copy: the cached gltf is shared with other modules).
function inPlace(clip) {
  const c = clip.clone();
  for (const tr of c.tracks) {
    if (!/hips\.position$/i.test(tr.name)) continue;
    const v = tr.values;
    for (let k = 0; k < 3; k++) {
      let mn = Infinity, mx = -Infinity;
      for (let i = k; i < v.length; i += 3) { if (v[i] < mn) mn = v[i]; if (v[i] > mx) mx = v[i]; }
      if (mx - mn > 0.6) for (let i = k; i < v.length; i += 3) v[i] = v[k];
    }
  }
  return c;
}

function setupAnims(gltf) {
  mixer = new THREE.AnimationMixer(model);
  const anims = gltf.animations || [];
  for (const n of ['idle', 'walk', 'run', 'sit_idle', 'celebrate', 'wave']) {
    let clip = THREE.AnimationClip.findByName(anims, n);
    if (!clip) continue;
    if (n === 'walk' || n === 'run') clip = inPlace(clip);
    actions[n] = mixer.clipAction(clip, model);
  }
  for (const n of ['idle', 'walk', 'run', 'sit_idle']) {
    if (!actions[n]) continue;
    actions[n].play(); actions[n].setEffectiveWeight(n === 'idle' ? 1 : 0);
  }
  if (!actions.idle && !actions.walk && !actions.run) mixer = null;
}

function playOneShot(name) {
  const a = actions[name]; if (!a || !mixer) return;
  a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.setEffectiveWeight(0); a.play();
  oneShot = { action: a, left: Math.min(3.2, a.getClip().duration) };
}

// ---------------------------------------------------------------- API
function damage(amount, from) {
  amount = Number(amount) || 0;
  if (!P.alive || amount <= 0 || G.settings?.invincible) return;
  if (P.armor > 0) { const ab = Math.min(P.armor, amount * 0.7); P.armor -= ab; amount -= ab; }
  P.health = Math.max(0, P.health - amount);
  lastDamageT = G.time; flinchT = 0.3;
  emit('player:damage', { amount, from });
  try { G.fx?.flash?.('#ff0000', 120); } catch { /* ignore */ }
  if (!G.settings?.reducedMotion) { try { G.fx?.shake?.(Math.min(0.6, 0.15 + amount / 80)); } catch { /* ignore */ } }
  if (G.time - lastHurtSnd > 0.45) { lastHurtSnd = G.time; play('hurt', { volume: 0.7 }); }
  if (P.health <= 0) die();
}
function heal(n) { if (!P.alive) return; P.health = clamp(P.health + (Number(n) || 0), 0, 100); }
function addMoney(n) {
  n = Math.round(Number(n) || 0); if (!n) return;
  const before = P.money;
  P.money = Math.max(0, P.money + n);
  emit('money', { amount: P.money - before, total: P.money });
  if (n > 0) { try { _c.copy(P.pos); _c.y += 1.9; G.fx?.moneyPop?.(_c, n); } catch { /* ignore */ } }
}
function giveWeapon(name, ammo) {
  if (!WEAPONS.includes(name)) return;
  P.owned[name] = true;
  if (name !== 'fists') P.ammo[name] = (P.ammo[name] || 0) + (Number(ammo) || 0);
  if (P.weapon === 'fists' && name !== 'fists') setWeapon(name, true);
}
function teleport(x, z, heading) {
  if (P.inVehicle) forceExit(true);
  entering = null;
  P.pos.set(x, Math.max(groundAt(x, z), -1.25), z); P.vel.set(0, 0, 0); vy = 0; onGround = true;
  if (Number.isFinite(heading)) { P.heading = heading; P.camYaw = heading; }
  if (root) { root.position.copy(P.pos); root.rotation.y = P.heading; }
  snapCam = true;
}

function setWeapon(name, quiet) {
  if (!P.owned[name] || P.weapon === name) return;
  P.weapon = name;
  if (name === 'fists') P.isAiming = false;
  fireCd = Math.max(fireCd, 0.2);
  if (!quiet) play('ui_select', { volume: 0.4 });
  try { G.hud?.toast?.(WEAPON_HE[name] + (name !== 'fists' ? ' · ' + (P.ammo[name] | 0) : ''), 900); } catch { /* ignore */ }
}

// ---------------------------------------------------------------- death / respawn
function fade(to, ms) {
  try {
    if (!fadeEl) {
      fadeEl = document.createElement('div');
      fadeEl.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;background:#000;opacity:0;pointer-events:none;z-index:3;';
      fadeEl.setAttribute('aria-hidden', 'true');
      document.body.appendChild(fadeEl);
    }
    fadeEl.style.transition = 'opacity ' + ms + 'ms linear';
    fadeEl.style.opacity = String(to);
  } catch { /* ignore */ }
}

function die() {
  if (!P.alive) return;
  if (P.inVehicle) forceExit(true);
  entering = null;
  P.alive = false; P.health = 0; P.isAiming = false; P.isSprinting = false; sprintToggle = false;
  deathT = 0; respawnDone = false; punchT = -1;
  setPrompt(null);
  play('death_m', { volume: 0.8 });
  emit('player:died', {});
  const fee = Math.min(HOSPITAL_FEE, P.money);
  P._fee = fee;
  try { G.hud?.bigText?.('הלך עליך', fee > 0 ? 'התעוררת באיכילוב. החשבון: ₪' + fee : 'התעוררת באיכילוב. הפעם על חשבון הבית', 3800); } catch { /* ignore */ }
  try { G.hud?.announce?.('הלך עליך. מתעוררים באיכילוב'); } catch { /* ignore */ }
}

function hospitalPoint() {
  const lm = G.world?.landmarks;
  if (lm) {
    for (const k of Object.keys(lm)) {
      const l = lm[k]; if (!l || !Number.isFinite(l.x) || !Number.isFinite(l.z)) continue;
      if (/ichilov|hospital|medical/i.test(k) || (l.name && /איכילוב|בית חולים/.test(l.name))) return { x: l.x, z: l.z, heading: 0 };
    }
  }
  return spawnPoint();
}

function respawn() {
  respawnDone = true;
  const hp = hospitalPoint();
  const p = { x: hp.x, z: hp.z };
  // try to land on a sidewalk near the hospital rather than inside a wall
  try {
    if (G.world?.blocked?.(p.x, p.z, RADIUS + 0.2)) {
      const sw = G.world?.randomSidewalkPoint?.(p, 0, 40);
      if (sw && Number.isFinite(sw.x)) { p.x = sw.x; p.z = sw.z; }
    }
    G.world?.resolveCircle?.(p, RADIUS);
  } catch { /* ignore */ }
  const fee = P._fee || 0;
  if (fee > 0) { P.money = Math.max(0, P.money - fee); emit('money', { amount: -fee, total: P.money }); }
  P.health = 100; P.alive = true; deathT = -1; flinchT = 0;
  P.pos.set(p.x, Math.max(groundAt(p.x, p.z), 0), p.z); P.vel.set(0, 0, 0); vy = 0; onGround = true;
  P.heading = hp.heading || 0; P.camYaw = P.heading; P.camPitch = 0.2;
  if (tilt) tilt.rotation.x = 0;
  if (root) { root.visible = true; root.position.copy(P.pos); }
  snapCam = true; lastDamageT = G.time;
  try { G.wanted?.clear?.(); } catch { /* ignore */ }
  emit('player:respawn', {});
  fade(0, 900);
}

function updateDeath(dt) {
  deathT += dt;
  // fall over backwards, then fade
  const k = smooth(0, 0.7, deathT);
  if (tilt) tilt.rotation.x = -Math.PI / 2 * k * k;
  P.vel.multiplyScalar(Math.max(0, 1 - 6 * dt));
  const gy = groundAt(P.pos.x, P.pos.z);
  P.pos.y += (Math.max(gy, -1.2) - P.pos.y) * damp(6, dt);
  if (root) { root.position.copy(P.pos); root.position.y += 0.12 * k; root.rotation.y = P.heading; }
  if (!G.settings?.reducedMotion) P.camYaw += 0.12 * dt;
  if (deathT > 2.2 && deathT - dt <= 2.2) fade(0.85, 1500);
  if (deathT >= 4 && !respawnDone) respawn();
}

// ---------------------------------------------------------------- vehicles
function setPrompt(text) {
  if (text === myPrompt) return;
  if (text === null && myPrompt === null) return;
  myPrompt = text;
  try { G.hud?.prompt?.(text); } catch { /* ignore */ }
}

function doorPoint(v, out, sideSign, extra) {
  const h = v.heading || 0;
  const off = (v.isBike ? 0.35 : (v.width || 1.8) * 0.5) + extra;
  // left of the vehicle = (cos h, 0, -sin h): the driver sits on the left (we drive on the right)
  out.set(v.pos.x + Math.cos(h) * off * sideSign, 0, v.pos.z - Math.sin(h) * off * sideSign);
  return out;
}

function tryEnter() {
  let v = null;
  try { v = G.vehicles?.nearest?.(P.pos, 3.5, (c) => c && !c.destroyed); } catch { v = null; }
  if (!v || v.destroyed) return;
  entering = { v, t: 0 };
  P.isAiming = false; sprintToggle = false; P.isSprinting = false;
  setPrompt(null);
}

function updateEntering(dt) {
  const v = entering.v;
  entering.t += dt;
  if (!v || v.destroyed || !v.pos || G.dist2D(P.pos, v.pos) > 7) { entering = null; return; }
  doorPoint(v, _a, 1, 0.45);
  const dx = _a.x - P.pos.x, dz = _a.z - P.pos.z, d = Math.hypot(dx, dz);
  const sp = Math.min(6.5, d / Math.max(0.05, 0.38 - entering.t));
  if (d > 0.05) { P.vel.set(dx / d * sp, 0, dz / d * sp); P.pos.x += P.vel.x * dt; P.pos.z += P.vel.z * dt; }
  P.heading += angDiff(P.heading, Math.atan2(v.pos.x - P.pos.x, v.pos.z - P.pos.z)) * damp(14, dt);
  P.pos.y = groundAt(P.pos.x, P.pos.z);
  root.position.copy(P.pos); root.rotation.y = P.heading;
  if (entering.t >= 0.38 || d < 0.15) { entering = null; finishEnter(v); }
}

function finishEnter(v) {
  const prevDriver = v.driver;
  if (!v.isBike) play('door', { volume: 0.7, pos: v.pos });
  try { G.vehicles?.setPlayerVehicle?.(v); } catch (e) { console.error('[player] setPlayerVehicle', e); }
  P.inVehicle = v; P.isAiming = false; P.isSprinting = false; sprintToggle = false; P.isSwimming = false;
  P.vel.set(0, 0, 0); vy = 0; onGround = true; punchT = -1;
  if (tilt) tilt.rotation.x = 0;
  if (root) root.visible = !!v.isBike;
  if (gun) gun.visible = false;
  chaseYaw = P.camYaw; orbitYaw = 0; vehPitchOff = P.camPitch - CAM_MODES[camMode].pitch; lastLookT = -100;
  if (prevDriver && prevDriver !== 'player') {
    emit('crime', { type: 'carjack', pos: P.pos.clone(), severity: v.isPolice ? 3 : 2 });
    try { G.npcs?.panicAt?.(P.pos, 12); } catch { /* ignore */ }
  }
  emit('player:enterVehicle', { vehicle: v });
  exitHintT = G.time;
}

function exitSpot(v, out) {
  const h = v.heading || 0, len = (v.length || 4.2) * 0.5;
  const cands = [[1, 0], [-1, 0], [0, -1], [0, 1]];
  for (const c of cands) {
    if (c[0]) doorPoint(v, out, c[0], 0.75);
    else out.set(v.pos.x + Math.sin(h) * (len + 0.9) * c[1], 0, v.pos.z + Math.cos(h) * (len + 0.9) * c[1]);
    let blocked = false;
    try { blocked = !!G.world?.blocked?.(out.x, out.z, RADIUS); } catch { blocked = false; }
    if (!blocked) return out;
  }
  return doorPoint(v, out, 1, 0.75);
}

function forceExit(silent) {
  const v = P.inVehicle; if (!v) return;
  if (v.pos) { exitSpot(v, _a); P.pos.set(_a.x, groundAt(_a.x, _a.z), _a.z); P.heading = v.heading || 0; }
  try { G.vehicles?.setPlayerVehicle?.(null); } catch (e) { console.error('[player] setPlayerVehicle', e); }
  P.inVehicle = null;
  P.vel.set(0, 0, 0); vy = 0; onGround = true;
  if (root) { root.visible = true; root.position.copy(P.pos); root.rotation.y = P.heading; }
  if (tilt) tilt.rotation.x = 0;
  P.camYaw = wrap(chaseYaw + orbitYaw); P.camPitch = clamp(P.camPitch, 0.05, 0.6);
  if (!silent && !v.isBike) play('door', { volume: 0.7, pos: v.pos });
  emit('player:exitVehicle', { vehicle: v });
}

function updateInVehicle(dt) {
  const v = P.inVehicle;
  listCheckT -= dt;
  if (listCheckT <= 0) {
    listCheckT = 0.5;
    const list = G.vehicles?.list;
    if (!v.pos || (Array.isArray(list) && !list.includes(v))) { forceExit(true); return; }
  }
  P.pos.copy(v.pos); P.heading = v.heading || 0;
  if (v.vel) P.vel.copy(v.vel); else P.vel.set(Math.sin(P.heading) * (v.speed || 0), 0, Math.cos(P.heading) * (v.speed || 0));
  if (v.isBike) {
    const so = v.seatOffset;
    const sx = so ? so.x || 0 : 0, sy = so ? so.y || 0 : 0.75, sz = so ? so.z || 0 : -0.2;
    const h = P.heading;
    root.visible = true;
    root.position.set(v.pos.x + Math.sin(h) * sz + Math.cos(h) * sx, (v.pos.y || 0) + Math.max(0, sy - 0.52), v.pos.z + Math.cos(h) * sz - Math.sin(h) * sx);
    root.rotation.y = h;
  } else {
    root.visible = false; root.position.copy(v.pos); root.rotation.y = P.heading;
  }
  if (G.time - exitHintT < 4 && Math.abs(v.speed || 0) < 2) setPrompt(v.isBike ? 'F - לרדת' : 'F - לצאת מהרכב'); else setPrompt(null);

  if (G.input.pressed('KeyC')) {
    camMode = (camMode + 1) % CAM_MODES.length; vehPitchOff = 0; orbitYaw = 0;
    try { G.hud?.toast?.('מצלמה ' + CAM_MODES[camMode].name, 900); } catch { /* ignore */ }
  }
  if (G.input.pressed('KeyF') || padPressed(2)) {
    if (Math.abs(v.speed || 0) < 4) { forceExit(false); setPrompt(null); }
    else { try { G.hud?.toast?.('קודם עוצרים, אחר כך יוצאים', 1200); } catch { /* ignore */ } play('ui_error', { volume: 0.4 }); }
  }
}

function collideVehicles() {
  const list = G.vehicles?.list; if (!Array.isArray(list)) return;
  for (let i = 0; i < list.length; i++) {
    const v = list[i]; if (!v || !v.pos) continue;
    const dx = P.pos.x - v.pos.x, dz = P.pos.z - v.pos.z;
    const len = v.length || 4.2, wid = v.width || 1.8;
    if (dx * dx + dz * dz > (len + 2) * (len + 2)) continue;
    if (P.pos.y > (v.pos.y || 0) + 1.6) continue;   // jumping over the bonnet
    const h = v.heading || 0, s = Math.sin(h), c = Math.cos(h);
    let lz = dx * s + dz * c, lx = dx * c - dz * s;
    const hw = wid * 0.5 + RADIUS * 0.85, hl = len * 0.5 + RADIUS * 0.85;
    if (Math.abs(lx) >= hw || Math.abs(lz) >= hl) continue;
    const px = hw - Math.abs(lx), pz = hl - Math.abs(lz);
    if (px < pz) lx = (lx >= 0 ? 1 : -1) * hw; else lz = (lz >= 0 ? 1 : -1) * hl;
    P.pos.x = v.pos.x + lx * c + lz * s; P.pos.z = v.pos.z - lx * s + lz * c;
    const sp = Math.abs(v.speed || 0);
    if (sp > 5 && vehHitCd <= 0 && v.driver !== 'player') {
      vehHitCd = 1.5;
      const dir = (v.speed || 0) >= 0 ? 1 : -1;
      P.vel.x += s * dir * sp * 0.7; P.vel.z += c * dir * sp * 0.7; vy = 3; onGround = false;
      P.damage(Math.min(35, sp * 1.5), 'vehicle');
      play('hit_body', { volume: 0.7 });
    }
  }
}

// ---------------------------------------------------------------- on foot
function updateOnFoot(dt) {
  const inp = G.input, S = G.settings || {};
  let ax = inp.axis.x, ay = inp.axis.y;
  if (S.oneHanded && !P.isAiming && inp.mouseDown(0) && inp.mouse.locked) ay = 1;
  let mag = Math.hypot(ax, ay); if (mag > 1) { ax /= mag; ay /= mag; mag = 1; }
  const moving = mag > 0.05;

  const gy = groundAt(P.pos.x, P.pos.z);
  const swim = gy < -0.6;
  if (swim && !P.isSwimming) { try { _c.set(P.pos.x, 0, P.pos.z); G.fx?.splash?.(_c); } catch { /* ignore */ } }
  P.isSwimming = swim;

  // sprint
  if (S.holdToToggle) {
    if (inp.pressed('ShiftLeft') || inp.pressed('ShiftRight') || padPressed(10)) sprintToggle = !sprintToggle;
    if (!moving) { idleT += dt; if (idleT > 0.4) sprintToggle = false; } else idleT = 0;
    P.isSprinting = sprintToggle && moving;
  } else {
    P.isSprinting = moving && (inp.down('ShiftLeft') || inp.down('ShiftRight') || inp.padDown(10));
  }
  // aim
  const canAim = P.weapon !== 'fists' && !swim;
  if (!canAim) P.isAiming = false;
  else if (S.holdToToggle) { if (inp.mousePressed(2) || padPressed(6)) P.isAiming = !P.isAiming; }
  else P.isAiming = inp.mouseDown(2) || inp.padDown(6);
  if (P.isAiming) { P.isSprinting = false; sprintToggle = false; }
  if (swim) P.isSprinting = false;

  const maxSp = (swim ? SWIM_SPEED : P.isAiming ? AIM_SPEED : P.isSprinting ? SPRINT_SPEED : JOG_SPEED) * mag;
  const yaw = P.camYaw, fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -Math.cos(yaw), rz = Math.sin(yaw);
  const dx = fx * ay + rx * ax, dz = fz * ay + rz * ax;
  const k = damp(onGround ? (moving ? 10 : 13) : 2.5, dt);
  P.vel.x += (dx * maxSp - P.vel.x) * k; P.vel.z += (dz * maxSp - P.vel.z) * k;

  // facing
  if (P.isAiming || faceCamT > 0) P.heading += angDiff(P.heading, P.camYaw) * damp(18, dt);
  else if (moving) P.heading += angDiff(P.heading, Math.atan2(dx, dz)) * damp(swim ? 5 : 11, dt);
  P.heading = wrap(P.heading);

  // integrate + collide
  P.pos.x += P.vel.x * dt; P.pos.z += P.vel.z * dt;
  let hit = null;
  try { hit = G.world?.resolveCircle?.(P.pos, RADIUS); } catch { hit = null; }
  if (hit && Number.isFinite(hit.nx) && Number.isFinite(hit.nz)) {
    const vn = P.vel.x * hit.nx + P.vel.z * hit.nz;
    if (vn < 0) { P.vel.x -= hit.nx * vn; P.vel.z -= hit.nz * vn; }
  }
  collideVehicles();

  // vertical
  if ((inp.pressed('Space') || padPressed(0)) && onGround && !swim && !P.isAiming) { vy = JUMP_V; onGround = false; play('step_asphalt', { volume: 0.25, pitch: 1.3 }); }
  const gy2 = groundAt(P.pos.x, P.pos.z);
  let base = gy2;
  if (gy2 < -0.6) {
    const sw = clamp(Math.hypot(P.vel.x, P.vel.z) / SWIM_SPEED, 0, 1);
    base = Math.max(gy2, -1.28 + sw * 0.6 + Math.sin(G.time * 2.6) * 0.05);
  }
  if (!onGround) {
    vy -= GRAVITY * dt; P.pos.y += vy * dt;
    if (P.pos.y <= base && vy <= 0) { P.pos.y = base; onGround = true; if (vy < -4) play('step_asphalt', { volume: 0.45, pitch: 0.8 }); vy = 0; }
  } else {
    P.pos.y += (base - P.pos.y) * damp(14, dt);
  }
  P.vel.y = vy;

  // footsteps
  const sp = Math.hypot(P.vel.x, P.vel.z);
  if (onGround && !swim && sp > 0.8) {
    stepAcc += sp * dt;
    const stride = sp > 5 ? 1.3 : sp > 2.6 ? 1.0 : 0.72;
    if (stepAcc >= stride) {
      stepAcc = 0;
      let surf = null; try { surf = G.world?.surfaceAt?.(P.pos.x, P.pos.z); } catch { surf = null; }
      const snd = surf === 'grass' || surf === 'sand' ? 'step_grass' : surf === 'sidewalk' || surf === 'plaza' ? 'step_concrete' : 'step_asphalt';
      play(snd, { volume: 0.3 });
    }
  } else if (swim && sp > 0.6) {
    stepAcc += sp * dt;
    if (stepAcc > 1.6) { stepAcc = 0; try { _c.set(P.pos.x, 0, P.pos.z); G.fx?.splash?.(_c); } catch { /* ignore */ } }
  }

  // body tilt: swim, flinch
  let tx = 0;
  if (swim) tx = 0.35 + clamp(sp / SWIM_SPEED, 0, 1) * 0.8;
  if (flinchT > 0) tx -= 0.28 * Math.sin((flinchT / 0.3) * Math.PI);
  tilt.rotation.x += (tx - tilt.rotation.x) * damp(10, dt);

  root.position.copy(P.pos); root.rotation.y = P.heading;

  // enter vehicle + prompt
  promptT -= dt;
  if (promptT <= 0) {
    promptT = 0.15;
    let near = null;
    try { near = G.vehicles?.nearest?.(P.pos, 3.5, (c) => c && !c.destroyed); } catch { near = null; }
    if (near && !swim) setPrompt(near.isBike ? 'F - לעלות על הדו-גלגלי' : near.isPolice ? 'F - להיכנס לניידת (רעיון רע)' : 'F - להיכנס לרכב');
    else setPrompt(null);
  }
  if ((inp.pressed('KeyF') || padPressed(2)) && !swim) tryEnter();
}

// ---------------------------------------------------------------- combat
function lookDir(out) {
  const cp = Math.cos(P.camPitch), sp = Math.sin(P.camPitch);
  return out.set(Math.sin(P.camYaw) * cp, -sp, Math.cos(P.camYaw) * cp);
}

function findAssistTarget(origin, dir, minCos, maxDist, minAlong) {
  let best = null, bestCos = minCos;
  const list = G.actors || [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i]; if (!a || !a.alive || !a.pos) continue;
    _t.set(a.pos.x - origin.x, a.pos.y + (a.height || 1.8) * 0.62 - origin.y, a.pos.z - origin.z);
    const d = _t.length(); if (d < 0.8 || d > maxDist) continue;
    const along = _t.dot(dir); if (along < minAlong) continue;
    const c = along / d;
    if (c > bestCos) { bestCos = c; best = a; }
  }
  if (!best) return null;
  _t.set(best.pos.x - origin.x, best.pos.y + (best.height || 1.8) * 0.62 - origin.y, best.pos.z - origin.z);
  const d = _t.length(); _t.multiplyScalar(1 / d);
  let wh = null; try { wh = G.world?.raycast?.(origin, _t, d); } catch { wh = null; }
  if (wh && wh.dist < d - 0.6) return null;
  return best;
}

function updateAimAssist(dt) {
  assistTarget = null;
  if (!G.settings?.aimAssist || !P.isAiming || P.inVehicle || !G.camera) return;
  lookDir(_dir); _o.copy(G.camera.position);
  const a = findAssistTarget(_o, _dir, Math.cos(0.14), 60, camDist + 0.6);
  if (!a) return;
  assistTarget = a;
  _t.set(a.pos.x - _o.x, a.pos.y + (a.height || 1.8) * 0.62 - _o.y, a.pos.z - _o.z);
  const d = _t.length(); if (d < 0.01) return;
  const wantYaw = Math.atan2(_t.x, _t.z), wantPitch = Math.asin(clamp(-_t.y / d, -1, 1));
  const mouseBusy = Math.abs(G.input.mouse.dx) + Math.abs(G.input.mouse.dy) > 10;
  const k = damp(mouseBusy ? 1.2 : 4.5, dt);
  P.camYaw += angDiff(P.camYaw, wantYaw) * k;
  P.camPitch += (wantPitch - P.camPitch) * k;
}

function startPunch() {
  punchT = 0; punchHitDone = false; punchSide = -punchSide; fireCd = 0.42;
  // turn toward a close target (soft assist), small lunge
  const tgt = findPunchTarget(G.settings?.aimAssist ? -0.3 : 0.25);
  if (tgt) P.heading = Math.atan2(tgt.pos.x - P.pos.x, tgt.pos.z - P.pos.z);
  else if (Math.hypot(P.vel.x, P.vel.z) < 0.5) faceCamT = 0.25;
  P.vel.x += Math.sin(P.heading) * 1.6; P.vel.z += Math.cos(P.heading) * 1.6;
}

function findPunchTarget(minDot) {
  const list = G.actors || []; let best = null, bd = 1e9;
  const fx = Math.sin(P.heading), fz = Math.cos(P.heading);
  for (let i = 0; i < list.length; i++) {
    const a = list[i]; if (!a || !a.alive || !a.pos) continue;
    const dx = a.pos.x - P.pos.x, dz = a.pos.z - P.pos.z, d = Math.hypot(dx, dz);
    if (d > 1.6 + (a.radius || 0.4) * 0.5 || Math.abs(a.pos.y - P.pos.y) > 1.8) continue;
    if (d > 0.01 && (dx * fx + dz * fz) / d < minDot) continue;
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}

function punchHit() {
  const a = findPunchTarget(0.2);
  if (!a) return;
  safe('punch', () => a.damage?.(25, 'player'));
  play('punch', { volume: 0.8, pos: a.pos });
  _c.set(a.pos.x, a.pos.y + 1.45, a.pos.z);
  try { G.fx?.hitPuff?.(_c); if (!G.settings?.reducedMotion) G.fx?.shake?.(0.15); } catch { /* ignore */ }
  const cop = a.kind === 'cop';
  emit('crime', { type: cop ? 'hit_cop' : 'hit_ped', pos: P.pos.clone(), severity: cop ? 2 : 1 });
}

function fireGun() {
  const name = P.weapon, g = GUNS[name]; if (!g) return;
  if ((P.ammo[name] | 0) <= 0) {
    fireCd = 0.4; play('ui_error', { volume: 0.5 });
    try { G.hud?.toast?.('נגמרה התחמושת. נשארו הידיים', 1400); } catch { /* ignore */ }
    setWeapon('fists', true); return;
  }
  P.ammo[name]--; fireCd = g.rate; aimHoldT = 0.9; faceCamT = 0.9;
  const cam = G.camera, rm = !!G.settings?.reducedMotion;
  lookDir(_dir);
  if (g.spread) { _dir.x += (Math.random() - 0.5) * g.spread; _dir.y += (Math.random() - 0.5) * g.spread; _dir.z += (Math.random() - 0.5) * g.spread; _dir.normalize(); }
  _o.copy(cam ? cam.position : P.pos);
  // start the ray level with the hero so nothing between the camera and him gets hit
  _t.set(P.pos.x, P.pos.y + 1.4, P.pos.z).sub(_o);
  _o.addScaledVector(_dir, Math.max(0, _t.dot(_dir)));
  if (G.settings?.aimAssist) {
    const tg = findAssistTarget(_o, _dir, Math.cos(P.isAiming ? 0.085 : 0.06), 70, 0.5);
    if (tg) { _dir.set(tg.pos.x - _o.x, tg.pos.y + (tg.height || 1.8) * 0.62 - _o.y, tg.pos.z - _o.z).normalize(); }
  }
  const MAXD = 140;
  let best = MAXD, kind = null, actor = null, veh = null;
  const ah = safe('rayActors', () => G.raycastActors(_o, _dir, MAXD, null));
  if (ah && ah.dist < best) { best = ah.dist; kind = 'actor'; actor = ah.actor; }
  const vh = safe('rayVehicles', () => G.vehicles?.raycast?.(_o, _dir, MAXD));
  if (vh && vh.vehicle && vh.vehicle !== P.inVehicle && vh.dist < best) { best = vh.dist; kind = 'vehicle'; veh = vh.vehicle; }
  const wh = safe('rayWorld', () => G.world?.raycast?.(_o, _dir, MAXD));
  if (wh && wh.dist < best) { best = wh.dist; kind = 'world'; }
  if (_dir.y < -0.002) { const tg = (_o.y - 0.02) / -_dir.y; if (tg > 0 && tg < best) { best = tg; kind = 'ground'; } }
  _hit.copy(_o).addScaledVector(_dir, best);

  // muzzle
  if (P.inVehicle) _muzzle.set(P.pos.x, (P.pos.y || 0) + 1.15, P.pos.z).addScaledVector(_dir, 1.4);
  else if (gun && gun.visible) _muzzle.copy(gun.position).addScaledVector(_dir, 0.26);
  else _muzzle.set(P.pos.x + Math.sin(P.heading) * 0.6, P.pos.y + 1.4, P.pos.z + Math.cos(P.heading) * 0.6);

  try {
    G.fx?.muzzleFlash?.(_muzzle, _dir);
    G.fx?.tracer?.(_muzzle, _hit);
    if (kind === 'vehicle') G.fx?.sparks?.(_hit, _t.copy(_dir).negate());
    else if (kind) G.fx?.hitPuff?.(_hit);
    if (!rm) G.fx?.shake?.(name === 'smg' ? 0.05 : 0.09);
  } catch { /* ignore */ }
  play(g.sound, { volume: 0.8 });

  if (kind === 'actor' && actor) {
    safe('actorDamage', () => actor.damage?.(g.dmg, 'player'));
    const cop = actor.kind === 'cop';
    emit('crime', { type: cop ? 'hit_cop' : 'hit_ped', pos: P.pos.clone(), severity: cop ? 3 : 2 });
  } else if (kind === 'vehicle' && veh) {
    safe('vehDamage', () => veh.damage?.(8, 'player'));
  }
  emit('crime', { type: 'shoot', pos: P.pos.clone(), severity: 1 });
  try { G.npcs?.panicAt?.(P.pos, 28); } catch { /* ignore */ }

  // recoil
  const rk = rm ? 0.35 : 1;
  if (P.inVehicle) vehPitchOff -= g.recoil * rk * 0.5; else P.camPitch -= g.recoil * rk;
  P.camYaw += (Math.random() - 0.5) * g.recoil * rk * 0.9;
}

function updateCombat(dt) {
  const inp = G.input, S = G.settings || {};
  fireCd -= dt; aimHoldT -= dt; faceCamT -= dt;

  // weapon select
  if (inp.pressed('Digit1')) setWeapon('fists');
  if (inp.pressed('Digit2')) setWeapon('pistol');
  if (inp.pressed('Digit3')) { if (P.owned.smg) setWeapon('smg'); else { try { G.hud?.toast?.('אין לך תת-מקלע (עדיין)', 1000); } catch { /* ignore */ } } }
  const wheel = inp.enabled ? inp.mouse.wheel : 0;
  if (wheel || padPressed(3)) {
    const step = wheel < 0 ? -1 : 1; let i = WEAPONS.indexOf(P.weapon);
    for (let n = 0; n < WEAPONS.length; n++) { i = (i + step + WEAPONS.length) % WEAPONS.length; if (P.owned[WEAPONS[i]]) break; }
    setWeapon(WEAPONS[i]);
  }

  // punch progress
  if (punchT >= 0) {
    punchT += dt;
    if (!punchHitDone && punchT >= PUNCH_DUR * 0.42) { punchHitDone = true; punchHit(); }
    if (punchT >= PUNCH_DUR) punchT = -1;
  }

  if (entering || P.isSwimming) return;
  const padFire = inp.padDown(7);
  const clickOk = inp.mouse.locked || lockFails > 0 || unlockedPresses >= 2 || padFire;
  if (!clickOk) return;
  const pressed = inp.mousePressed(0) || padPressed(7);
  const held = inp.mouseDown(0) || padFire;
  if (S.oneHanded && !padFire && (P.inVehicle || !P.isAiming)) return;   // LMB means "go" in one-handed mode

  if (P.weapon === 'fists') {
    if (!P.inVehicle && pressed && fireCd <= 0 && punchT < 0) startPunch();
  } else {
    const g = GUNS[P.weapon];
    if (!g) return;
    const want = g.auto ? held : (pressed || (held && fireCd <= -0.16));
    if (want && fireCd <= 0) fireGun();
  }
}

// ---------------------------------------------------------------- animation + procedural poses
function pointBone(bone, child, dirWorld, w) {
  if (!bone || !child || !bone.parent || w <= 0.002) return;
  bone.getWorldPosition(_a); child.getWorldPosition(_b);
  _b.sub(_a); if (_b.lengthSq() < 1e-8) return; _b.normalize();
  _q1.setFromUnitVectors(_b, dirWorld);
  if (w < 0.999) { _q2.identity().slerp(_q1, w); _q1.copy(_q2); }
  bone.getWorldQuaternion(_q3);
  _q1.multiply(_q3);                                   // new world rotation
  bone.parent.getWorldQuaternion(_q4).invert();
  bone.quaternion.copy(_q4.multiply(_q1));
}

function animate(dt, speed, mode) {
  if (!mixer) { applyGun(mode); return; }
  let wi = 0, ww = 0, wr = 0, ws = 0;
  if (mode === 'bike' && actions.sit_idle) ws = 1;
  else if (mode === 'bike') wi = 1;
  else {
    const mv = clamp(speed / 0.9, 0, 1), rmix = clamp((speed - 2.3) / 1.4, 0, 1);
    wi = 1 - mv; ww = mv * (1 - rmix); wr = mv * rmix;
    if (!actions.run) { ww += wr; wr = 0; }
    if (!actions.walk) { wr += ww; ww = 0; }
    if (!actions.idle) { ww += wi; wi = 0; }
  }
  const k = damp(mode === 'bike' ? 30 : 11, dt);
  W.idle += (wi - W.idle) * k; W.walk += (ww - W.walk) * k; W.run += (wr - W.run) * k; W.sit += (ws - W.sit) * k;

  // one-shot gestures (celebrate)
  if (oneShot) {
    oneShot.left -= dt;
    const want = oneShot.left > 0.25 && speed < 0.6 && mode === 'foot' ? 1 : 0;
    oneShotW += (want - oneShotW) * damp(8, dt);
    oneShot.action.setEffectiveWeight(oneShotW);
    if (want === 0 && oneShotW < 0.02) { oneShot.action.stop(); oneShot = null; oneShotW = 0; }
  }
  const base = 1 - oneShotW;
  actions.idle?.setEffectiveWeight(W.idle * base);
  actions.walk?.setEffectiveWeight(W.walk * base);
  actions.run?.setEffectiveWeight(W.run * base);
  actions.sit_idle?.setEffectiveWeight(W.sit * base);
  if (actions.walk) actions.walk.timeScale = P.isSwimming ? 0.7 : clamp(speed / 1.7, 0.75, 1.5);
  if (actions.run) actions.run.timeScale = onGround ? clamp(speed / 5.2, 0.8, 1.35) : 0.55;
  mixer.update(dt);

  // ---- procedural layer
  const h = P.heading;
  _f.set(Math.sin(h), 0, Math.cos(h)); _r.set(-Math.cos(h), 0, Math.sin(h));
  if (mode === 'bike') {
    for (let s = -1; s <= 1; s += 2) {
      const ua = s > 0 ? B.uaR : B.uaL, la = s > 0 ? B.laR : B.laL, hd = s > 0 ? B.hR : B.hL;
      _d.copy(_f).multiplyScalar(0.72).addScaledVector(_u, -0.6).addScaledVector(_r, 0.1 * s).normalize();
      pointBone(ua, la, _d, 1);
      _d.copy(_f).multiplyScalar(0.92).addScaledVector(_u, -0.22).addScaledVector(_r, -0.1 * s).normalize();
      pointBone(la, hd, _d, 1);
    }
  } else {
    const armed = P.weapon !== 'fists' && P.alive && !P.isSwimming;
    const wantAim = armed && (P.isAiming || aimHoldT > 0) ? 1 : 0;
    aimW += (wantAim - aimW) * damp(wantAim ? 18 : 8, dt);
    if (aimW > 0.01) {
      const p = clamp(P.camPitch * 0.85 - 0.06, -0.7, 0.8);
      _c.copy(_f).multiplyScalar(Math.cos(p)).addScaledVector(_u, -Math.sin(p)).normalize();      // aim direction
      _d.copy(_c).addScaledVector(_r, -0.1).normalize();
      pointBone(B.uaR, B.laR, _d, aimW);
      pointBone(B.laR, B.hR, _c, aimW);
      // support hand reaches for the weapon
      _d.copy(_c).multiplyScalar(0.75).addScaledVector(_r, 0.4).addScaledVector(_u, -0.25).normalize();
      pointBone(B.uaL, B.laL, _d, aimW * 0.9);
      if (B.hR && B.laL) {
        B.hR.getWorldPosition(_d); B.laL.getWorldPosition(_t); _d.sub(_t);
        if (_d.lengthSq() > 1e-6) { _d.normalize(); pointBone(B.laL, B.hL, _d, aimW * 0.9); }
      }
    }
    if (punchT >= 0) {
      const p = punchT / PUNCH_DUR, s = punchSide;
      const w = p < 0.12 ? p / 0.12 : p > 0.68 ? Math.max(0, (1 - p) / 0.32) : 1;
      const a = smooth(0.12, 0.42, p);
      const ua = s > 0 ? B.uaR : B.uaL, la = s > 0 ? B.laR : B.laL, hd = s > 0 ? B.hR : B.hL;
      // wind-up -> strike
      _c.copy(_f).multiplyScalar(-0.35 + 1.35 * a).addScaledVector(_u, -0.75 + 0.9 * a).addScaledVector(_r, s * (0.35 - 0.55 * a)).normalize();
      pointBone(ua, la, _c, w);
      _c.copy(_f).multiplyScalar(0.6 + 0.4 * a).addScaledVector(_u, 0.75 - 0.6 * a).addScaledVector(_r, s * (-0.2 * a)).normalize();
      pointBone(la, hd, _c, w);
    }
  }
  applyGun(mode);
}

function applyGun(mode) {
  if (!gun) return;
  const show = P.weapon !== 'fists' && P.alive && !P.isSwimming && mode === 'foot' && root.visible;
  gun.visible = show;
  if (!show) return;
  gun.scale.set(1, 1, P.weapon === 'smg' ? 1.55 : 1);
  const h = P.heading;
  _f.set(Math.sin(h), 0, Math.cos(h));
  if (B.hR && B.laR) {
    B.hR.getWorldPosition(_a); B.laR.getWorldPosition(_b);
    _c.copy(_a).sub(_b); if (_c.lengthSq() < 1e-8) _c.copy(_f); _c.normalize();     // along the forearm
    if (aimW > 0.5) {
      const p = clamp(P.camPitch * 0.85 - 0.06, -0.7, 0.8);
      _c.copy(_f).multiplyScalar(Math.cos(p)).addScaledVector(_u, -Math.sin(p)).normalize();
    }
    gun.position.copy(_a).addScaledVector(_c, 0.08);
    const upHint = Math.abs(_c.y) > 0.8 ? _f : _u;
    _m.lookAt(ZERO, _c, upHint);
    gun.quaternion.setFromRotationMatrix(_m);
    if (aimW > 0.5) gun.position.y += 0.03;
  } else {
    _r.set(-Math.cos(h), 0, Math.sin(h));
    gun.position.set(P.pos.x, P.pos.y + 1.25, P.pos.z).addScaledVector(_f, 0.45).addScaledVector(_r, 0.22);
    _m.lookAt(ZERO, _f, _u); gun.quaternion.setFromRotationMatrix(_m);
  }
}

// ---------------------------------------------------------------- camera
function beginBlend() {
  const cam = G.camera; if (!cam) return;
  snapCam = true; wasStarted = true;
  P.camYaw = P.inVehicle ? P.camYaw : P.heading; P.camPitch = 0.2;
  if (G.settings?.reducedMotion) { blendT = -1; return; }
  blendPos.copy(cam.position); blendQuat.copy(cam.quaternion); blendT = 0;
}

function updateLook(dt) {
  const inp = G.input, m = inp.mouse;
  if (!inp.enabled) return;
  const sens = 0.0023 * (P.isAiming ? 0.55 : 1);
  const dx = m.dx || 0, dy = m.dy || 0;
  if (P.inVehicle) {
    if (dx || dy) {
      orbitYaw = wrap(orbitYaw - dx * sens);
      vehPitchOff = clamp(vehPitchOff + dy * sens, -0.5, 1.1);
      if (Math.abs(dx) + Math.abs(dy) > 0.5) lastLookT = G.time;
    }
  } else {
    P.camYaw = wrap(P.camYaw - dx * sens);
    P.camPitch = clamp(P.camPitch + dy * sens, -0.55, 1.25);
  }
}

function updateCamera(dt) {
  const cam = G.camera; if (!cam) return;
  const S = G.settings || {}, rm = !!S.reducedMotion;
  const v = P.inVehicle;
  let dist, side, pitch, yaw, fov = BASE_FOV, collide = true;

  if (v && v.pos) {
    const mode = CAM_MODES[camMode] || CAM_MODES[0];
    const sp = Math.abs(v.speed || 0), h = v.heading || 0;
    chaseYaw += angDiff(chaseYaw, h) * damp(rm ? 2.2 : 4.2, dt);
    if (G.time - lastLookT > 2) {
      const kk = damp(rm ? 1.5 : 3, dt);
      orbitYaw -= orbitYaw * kk; vehPitchOff -= vehPitchOff * kk;
    }
    yaw = wrap(chaseYaw + orbitYaw);
    pitch = clamp(mode.pitch + vehPitchOff, -0.12, 1.45);
    P.camYaw = yaw; P.camPitch = pitch;
    const sc = v.isBike ? 0.72 : 1;
    dist = mode.dist * sc + (mode.top ? Math.min(22, sp * 0.6) : Math.min(4.5, sp * 0.085));
    side = mode.side;
    fov = (camMode === 2 ? 54 : BASE_FOV) + (rm ? 0 : Math.min(16, sp * 0.5));
    const la = mode.top ? Math.min(8, sp * 0.3) : Math.min(3.5, sp * 0.1);
    _tgt.set(v.pos.x + Math.sin(h) * la, (v.pos.y || 0) + mode.look * (v.isBike ? 1.12 : 1), v.pos.z + Math.cos(h) * la);
    if (snapCam) followPos.copy(_tgt); else followPos.lerp(_tgt, damp(rm ? 9 : 16, dt));
    collide = !mode.top;
  } else {
    yaw = P.camYaw; pitch = P.camPitch;
    const aim = P.isAiming && P.alive;
    dist = aim ? 2.0 : P.alive ? 4.4 : 6.5;
    side = aim ? 0.62 : 0.42;
    fov = aim ? 46 : BASE_FOV + (!rm && P.isSprinting ? 6 : 0);
    _tgt.set(P.pos.x, P.pos.y + (P.isSwimming ? 1.0 : P.alive ? 1.52 : 0.9), P.pos.z);
    if (snapCam) followPos.copy(_tgt);
    else {
      const kxz = damp(26, dt), ky = damp(9, dt);
      followPos.x += (_tgt.x - followPos.x) * kxz; followPos.z += (_tgt.z - followPos.z) * kxz; followPos.y += (_tgt.y - followPos.y) * ky;
    }
  }

  if (snapCam) { curDist = dist; curSide = side; curFov = fov; camDist = dist; }
  else {
    curDist += (dist - curDist) * damp(rm ? 4 : 8, dt);
    curSide += (side - curSide) * damp(rm ? 4 : 8, dt);
    curFov += (fov - curFov) * damp(rm ? 3 : 6.5, dt);
  }

  const cp = Math.cos(pitch), sp2 = Math.sin(pitch);
  _dir.set(-Math.sin(yaw) * cp, sp2, -Math.cos(yaw) * cp);       // from the pivot toward the camera
  _r.set(-Math.cos(yaw), 0, Math.sin(yaw));                      // camera right
  let sd = curSide;
  if (collide && Math.abs(sd) > 0.05) {
    const hs = safe('camSide', () => G.world?.raycast?.(followPos, _r, Math.abs(sd) + 0.35));
    if (hs && Number.isFinite(hs.dist)) sd = Math.max(0, Math.min(sd, hs.dist - 0.35));
  }
  _o.copy(followPos).addScaledVector(_r, sd);
  let d = curDist;
  if (collide) {
    const hc = safe('camRay', () => G.world?.raycast?.(_o, _dir, curDist + 0.45));
    if (hc && Number.isFinite(hc.dist)) d = clamp(hc.dist - 0.4, 0.45, curDist);
  }
  if (d < camDist || snapCam) camDist = d; else camDist += (d - camDist) * damp(rm ? 3 : 6, dt);
  cam.position.copy(_o).addScaledVector(_dir, camDist);
  const minY = Math.max(groundAt(cam.position.x, cam.position.z), -0.05) + 0.3;
  if (cam.position.y < minY) cam.position.y = minY;
  _t.copy(cam.position).addScaledVector(_dir, -10);
  cam.up.set(0, 1, 0);
  cam.lookAt(_t);

  // hide the hero when the camera is pushed into him
  if (!v && root && P.alive) root.visible = camDist > 0.75;

  // blend in from the title fly-by
  if (blendT >= 0) {
    blendT += dt / 1.6;
    if (blendT >= 1) blendT = -1;
    else {
      const e = 1 - smooth(0, 1, blendT);
      cam.position.lerp(blendPos, e); cam.quaternion.slerp(blendQuat, e);
    }
  }
  if (!rm && G.fx?.shakeOffset && Number.isFinite(G.fx.shakeOffset.x)) cam.position.add(G.fx.shakeOffset);
  if (Math.abs(cam.fov - curFov) > 0.02) { cam.fov = curFov; cam.updateProjectionMatrix(); }
  snapCam = false;
}

function titleCamera(dt) {
  const cam = G.camera; if (!cam) return;
  const rm = !!G.settings?.reducedMotion;
  titleT += dt * (rm ? 0.4 : 1);
  const sp = spawnPoint();
  // slow sweep on the city (east) side of the spawn, looking west over the roofs to the sea
  const a = Math.sin(titleT * 0.05) * 1.15;
  const R = 48 + 12 * Math.sin(titleT * 0.063 + 1);
  const x = sp.x + Math.cos(a) * R, z = sp.z + Math.sin(a) * R;
  let wantH = 30 + 6 * Math.sin(titleT * 0.08);
  const cols = G.world?.colliders;
  if (Array.isArray(cols)) {
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c && x > c.minX - 7 && x < c.maxX + 7 && z > c.minZ - 7 && z < c.maxZ + 7 && (c.h || 0) + 7 > wantH) wantH = (c.h || 0) + 7;
    }
  }
  titleH += (wantH - titleH) * damp(wantH > titleH ? 1.6 : 0.5, dt);
  cam.position.set(x, titleH, z);
  cam.up.set(0, 1, 0);
  cam.lookAt(sp.x - 40, 6, sp.z + Math.sin(titleT * 0.031) * 22);
  if (Math.abs(cam.fov - 55) > 0.02) { cam.fov = 55; cam.updateProjectionMatrix(); }
}

// ---------------------------------------------------------------- frame
function pollPad() {
  const pad = G.input.pad;
  for (let i = 0; i < 12; i++) {
    const d = !!(pad && pad.buttons[i] && pad.buttons[i].pressed) && G.input.enabled;
    padEdge[i] = d && !padPrev[i]; padPrev[i] = d;
  }
}

export function update(dt) {
  if (!root) return;
  dt = Math.min(Math.max(dt || 0, 0), 0.05);
  if (!wasStarted) beginBlend();
  pollPad();
  if (vehHitCd > 0) vehHitCd -= dt;
  if (flinchT > 0) flinchT -= dt;

  safe('look', () => updateLook(dt));
  if (!P.alive) {
    safe('death', () => updateDeath(dt));
    safe('anim', () => animate(dt, 0, 'foot'));
  } else {
    safe('move', () => {
      if (P.inVehicle) updateInVehicle(dt);
      else if (entering) updateEntering(dt);
      else updateOnFoot(dt);
    });
    safe('assist', () => updateAimAssist(dt));
    safe('combat', () => updateCombat(dt));
    safe('anim', () => {
      const v = P.inVehicle;
      if (v && !v.isBike) return;                       // hidden inside a car: skip the skeleton
      animate(dt, v ? 0 : Math.hypot(P.vel.x, P.vel.z), v ? 'bike' : 'foot');
    });
    // slow regeneration up to 50
    if (P.health < 50 && G.time - lastDamageT > 6) P.health = Math.min(50, P.health + 2.5 * dt);
  }
  safe('camera', () => updateCamera(dt));
}

export function updatePaused(dt) {
  if (!root) return;
  dt = Math.min(Math.max(dt || 0, 0), 0.05);
  if (!G.started) {
    safe('title', () => titleCamera(dt));
    safe('anim', () => { root.position.copy(P.pos); root.rotation.y = P.heading; animate(dt, 0, 'foot'); });
  }
}
