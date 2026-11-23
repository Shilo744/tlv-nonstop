// npcs.js - the living street crowd of Tel Aviv: pooled pedestrians around the player,
// ambient behaviours (walkers, joggers, talkers, cafe sitters, beach people), reactions
// (panic, filming, dodging cars), cartoon knock-downs and script-controlled peds for missions.
import * as THREE from 'three';
import { G } from './core.js';

// Which way the character GLBs face at rotation.y = 0. Verified from the bind pose
// (toes at +Z, left hand at +X) -> they face +Z, so no correction is needed.
const MODEL_YAW = 0;

const MODEL_NAMES = ['npc_a', 'npc_b', 'npc_c', 'npc_d', 'npc_e', 'npc_f', 'npc_g', 'npc_h', 'npc_i'];
// Guess (only used for the speaker label and scream pitch) - one-line fix if wrong.
const FEMALE_MODELS = new Set(['npc_b', 'npc_d', 'npc_f', 'npc_h']);

const SPAWN_MIN = 35, SPAWN_MAX = 110;
const RECYCLE2 = 130 * 130;
const VIS2 = 150 * 150;
const ANIM_NEAR2 = 28 * 28, ANIM_MID2 = 50 * 50, ANIM_FAR2 = 70 * 70;
const AI_NEAR2 = 45 * 45;
const SHADOW2 = 40 * 40;
const DOWN_TIME = 10, FADE_TIME = 1.5;
const HALF_PI = Math.PI / 2, TAU = Math.PI * 2;
const WALK_CLIP_SPEED = 1.4, RUN_CLIP_SPEED = 3.6;   // m/s the clips look right at
const SIT_BACK = 0.45, SEAT_H = 0.56;                // sit clips put the hips 0.45 m behind the origin

const ST = { WALK: 0, WAIT: 1, IDLE: 2, TALK: 3, SIT: 4, BEACH: 5, WAVE: 6, REACT: 7, FLEE: 8, COWER: 9, FILM: 10, DODGE: 11, DOWN: 12, SCRIPT: 13 };
const ANIM_FALLBACK = { nod: 'talk', shrug: 'talk', shake_head: 'shrug', slump: 'think', think: 'idle', point: 'wave', wave: 'idle', celebrate: 'wave', sit_talk: 'sit_idle', sit_idle: 'idle', talk: 'idle', run: 'walk', walk: 'idle' };
const TALK_ANIMS = ['talk', 'talk', 'nod', 'shrug', 'talk', 'think'];
const BEACH_ANIMS = ['celebrate', 'idle', 'celebrate', 'wave', 'talk', 'idle'];

// ---------------------------------------------------------------- Hebrew one-liners
const L_BUMP = [
  'אחי, זה לא מסלול אופניים!',
  'סליחה?! יש פה תור, גם על המדרכה.',
  'זהירות, הקפה הזה עלה 24 שקל!',
  'מה נסגר, נחתת עכשיו מרמת גן?',
  'תסתכל לאן אתה הולך, לא בטלפון!',
  'אם נשפכה לי השקשוקה, אתה משלם.',
  'וואלה, גם על המדרכה יש פקק?!',
  'יאללה זוז, אני בדרך לפילאטיס.',
  'המדרכה מספיק רחבה לשנינו. בערך.',
  'עוד דחיפה אחת ואני כותב על זה פוסט.',
  'חביבי, מרחב אישי. שמעת על זה?',
];
const L_PASS = [
  'שמעת? שכר הדירה שוב עלה. גם אתמול.',
  'אני מחפש חניה משנת 2019.',
  'איפה יש פה חומוס טוב? לא, באמת טוב.',
  'הקורקינט שלי נגמר באמצע אבן גבירול.',
  'אומרים שבקיץ הבא יהיה פחות לח. אומרים.',
  'יש לי סטארטאפ: אפליקציה שמוצאת חניה. היא לא מוצאת.',
  'חמישים שקל לסלט?! טוב נו, עם טחינה.',
  'הרכבת הקלה? ברגל יותר מהר.',
  'הכלב שלי טבעוני. הוא עוד לא יודע.',
  'בוא נקבע קפה. לא באמת, סתם אומרים.',
  'שתי דקות מהים, אמר המתווך. בטיל.',
  'מישהו ראה זוג אופניים כחולות? היו נעולות.',
  'איזה חום. ועכשיו רק שמונה בבוקר.',
  'שלושים מטר, שלושה שותפים ופסנתר. חלום.',
  'עיר בלי הפסקה, ואני בלי שינה.',
  'קפה הפוך על שיבולת, חזק, בלי קצף. כן, זה שם.',
  'אל תגיד לאף אחד, אבל מצאתי חניה בכחול לבן.',
];
const L_CAR = [
  'זה מעבר חציה, לא מסלול מרוצים!',
  'את הרישיון קיבלת בהגרלה?!',
  'היי! פה הולכים, לא טסים!',
  'אפילו נהגי המוניות מתביישים בך!',
  'יש מדרכה, יש כביש. תבחר אחד!',
];
const L_PANIC = [
  'אמאל׳ה! רוצו!',
  'מישהו יתקשר למשטרה!',
  'לא שוב, רק הזמנתי קפה!',
  'זה לא היה בתחזית!',
];
const L_FILM = [
  'רגע, אני מצלם את זה לסטורי!',
  'זה הולך להיות ויראלי, בטוח.',
  'חברים, אתם לא מאמינים מה קורה פה.',
];
const L_HURT = [
  'איי! מה עשיתי לך?!',
  'עזוב אותי, משוגע!',
  'הצילו! יש פה מטורף!',
];

// ---------------------------------------------------------------- module state
const models = [];          // { name, gltf, clips:{name:clip}, female }
const pool = [];            // every pooled ped (active or not)
const list = [];            // every active ped (pooled + scripted) == G.npcs.list
let ready = false;
let poolSize = 40;
let nextId = 1;
let frameNo = 0;
let lastLineT = -99, lastScreamT = -99;
let vehT = 0;
let warmT = 3;              // seconds of generous spawning after start
let beachCount = 0;
let frustumFrame = -1;
let px = 0, pz = 0;         // player position this frame
let camX = 0, camY = 0, camZ = 0;

const _camDir = new THREE.Vector3(0, 0, -1);
const _frustum = new THREE.Frustum();
const _m4 = new THREE.Matrix4();
const _sphere = new THREE.Sphere(new THREE.Vector3(), 1.5);
const _pt = { x: 0, z: 0, heading: 0 };
const _col = new THREE.Color();
const _zero = new THREE.Vector3();
const SKIN_BOUNDS = new THREE.Sphere(new THREE.Vector3(0, 0.95, 0), 2.3);   // generous, shared, read-only

let seatGeo = null, seatMat = null, beachSeatMat = null, tableGeo = null, tableMat = null;
let fbBodyGeo = null, fbHeadGeo = null;

const api = { list, count: 0, panicAt, spawnAt, MODEL_YAW };

// ---------------------------------------------------------------- small helpers
const rnd = (a, b) => a + Math.random() * (b - a);
const pickOf = (arr) => arr[(Math.random() * arr.length) | 0];

function surf(x, z) {
  const W = G.world;
  return W && W.surfaceAt ? W.surfaceAt(x, z) : 'sidewalk';
}
function groundY(x, z) {
  const W = G.world;
  if (W && W.groundY) { const y = W.groundY(x, z); return Number.isFinite(y) ? Math.max(y, -0.6) : 0; }
  return 0;
}
function resolve(pos, r) {
  const W = G.world;
  return W && W.resolveCircle ? W.resolveCircle(pos, r) : null;
}
const isRoad = (s) => s === 'road';
const isSolid = (s) => s === 'building' || s === 'water';

function playerPos() {
  const pl = G.player;
  if (pl) {
    if (pl.inVehicle && pl.inVehicle.pos) return pl.inVehicle.pos;
    if (pl.pos) return pl.pos;
  }
  return G.camera ? G.camera.position : _zero;
}

function say(p, lines, minGap) {
  const now = G.time;
  if (now - lastLineT < minGap) return false;
  lastLineT = now;
  const speaker = p.name || (p.female ? 'עוברת אורח' : 'עובר אורח');
  try { G.hud?.subtitle?.(speaker, pickOf(lines), 3200); } catch { /* hud not ready */ }
  return true;
}

function removeFrom(arr, item) {
  const i = arr.indexOf(item);
  if (i >= 0) arr.splice(i, 1);
}

// ---------------------------------------------------------------- visuals
function buildVisual(model) {
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  const mats = [];
  let inner, mixer = null, mesh = null, head = null;
  if (model) {
    inner = G.assets.clone(model.gltf);
    inner.traverse((o) => {
      if (o.isMesh) {
        mesh = o;
        o.castShadow = false; o.receiveShadow = false;
        o.frustumCulled = true;
        if (o.isSkinnedMesh) o.boundingSphere = SKIN_BOUNDS;   // animation is in place, so a fixed generous sphere is correct
        if (Array.isArray(o.material)) {
          o.material = o.material.map((m) => { const c = m.clone(); mats.push(c); return c; });
        } else if (o.material) {
          o.material = o.material.clone(); mats.push(o.material);
        }
      }
      if (!head && o.isBone && o.name === 'Head') head = o;
    });
    mixer = new THREE.AnimationMixer(inner);
  } else {
    // Fallback when no character model could be loaded: a friendly capsule person.
    if (!fbBodyGeo) {
      fbBodyGeo = new THREE.CapsuleGeometry(0.26, 0.95, 4, 10); fbBodyGeo.translate(0, 0.75, 0);
      fbHeadGeo = new THREE.SphereGeometry(0.17, 12, 10); fbHeadGeo.translate(0, 1.62, 0);
    }
    inner = new THREE.Group();
    const bm = new THREE.MeshStandardMaterial({ color: 0x4a7fb5, roughness: 0.8 });
    const hm = new THREE.MeshStandardMaterial({ color: 0xd9a47c, roughness: 0.8 });
    mats.push(bm, hm);
    mesh = new THREE.Mesh(fbBodyGeo, bm);
    inner.add(mesh, new THREE.Mesh(fbHeadGeo, hm));
  }
  // Slight per-ped tint (multiplies the texture).
  if (model) {
    _col.setHSL(Math.random(), 0.22, rnd(0.8, 0.95));
    for (const m of mats) if (m.color) m.color.multiply(_col);
  } else {
    mats[0].color.setHSL(Math.random(), 0.5, 0.5);
  }
  inner.rotation.y = MODEL_YAW;
  root.add(inner);
  root.visible = false;
  return { root, inner, mixer, mesh, head, mats };
}

function makePed(model, scripted) {
  const v = buildVisual(model);
  const p = {
    id: nextId++, kind: 'ped', isNpc: true,
    pos: new THREE.Vector3(), radius: 0.35, height: 1.8, alive: false, active: false,
    health: 50, heading: 0, dir: 0, speed: 1.4, baseSpeed: 1.4,
    object3d: v.root, root: v.root, inner: v.inner, mixer: v.mixer, mesh: v.mesh, head: v.head, mats: v.mats,
    model: model || null, female: model ? model.female : Math.random() < 0.5, name: null,
    actions: {}, cur: null, prev: null, animName: '',
    state: ST.WALK, stateT: 0, retState: ST.WALK, retAnim: 'idle', retT: 0,
    scripted: !!scripted, isStatic: false, canPanic: !scripted, invincible: false, facePlayer: false, homeHeading: 0,
    jog: false, role: '', partner: null,
    crossing: 0, wasOnRoad: false, probeT: 0, stuckT: 0, stuckN: 0, lastX: 0, lastZ: 0,
    acc: 0, animAcc: 0, hop: 0, lookYaw: 0, scale: 1, reflex: 1,
    bumpCd: 0, chatCd: 0, waveCd: 0, dodgeCd: 0, gestT: 0,
    dodgeX: 0, dodgeZ: 0, dangerX: 0, dangerZ: 0,
    vx: 0, vy: 0, vz: 0, ry: 0, tilt: 0, tiltTarget: 0, spin: 0, landed: false, bounces: 0, fading: false,
    seat: null, table: null,
    damage: null,
  };
  p.damage = (amount, from) => damagePed(p, amount, from);
  // Script helpers (handy for missions.js; harmless for pooled peds).
  p.setAnim = (name, fade) => { setAnim(p, name, fade === undefined ? 0.25 : fade, 1); p.retAnim = name; };
  p.say = (text, ms) => { try { G.hud?.subtitle?.(p.name || (p.female ? 'עוברת אורח' : 'עובר אורח'), text, ms || 3500); } catch { /* ignore */ } };
  p.remove = () => { if (p.scripted) destroyScripted(p); else recycle(p); };
  if (G.scene) G.scene.add(v.root);
  return p;
}

function setAnim(p, name, fade, timeScale) {
  if (!p.mixer || !p.model) return;
  let act = p.actions[name];
  if (act === undefined) {
    const clip = p.model.clips[name];
    act = p.actions[name] = clip ? p.mixer.clipAction(clip) : null;
  }
  if (!act) {
    const fb = ANIM_FALLBACK[name] || (name !== 'idle' ? 'idle' : null);
    if (fb) setAnim(p, fb, fade, timeScale);
    return;
  }
  act.timeScale = timeScale || 1;
  if (p.cur === act) return;
  if (p.prev && p.prev !== act) p.prev.stop();
  act.reset();
  act.setEffectiveWeight(1);
  act.play();
  if (p.cur) act.crossFadeFrom(p.cur, fade > 0 ? fade : 0.01, false);
  p.prev = p.cur; p.cur = act; p.animName = name;
}

function ensureSeat(p, beach) {
  if (!seatGeo) {
    seatGeo = new THREE.CylinderGeometry(0.2, 0.16, SEAT_H, 10); seatGeo.translate(0, SEAT_H / 2, 0);
    seatMat = new THREE.MeshStandardMaterial({ color: 0x9a6a3c, roughness: 0.7 });
    beachSeatMat = new THREE.MeshStandardMaterial({ color: 0x2f9fd0, roughness: 0.8 });
  }
  if (!p.seat) {
    p.seat = new THREE.Mesh(seatGeo, seatMat);
    p.seat.position.set(Math.sin(MODEL_YAW) * -SIT_BACK, 0, Math.cos(MODEL_YAW) * -SIT_BACK);
    p.root.add(p.seat);
  }
  p.seat.material = beach ? beachSeatMat : seatMat;
  p.seat.visible = true;
}
function ensureTable(p) {
  if (!tableGeo) {
    const pts = [[0.2, 0], [0.2, 0.03], [0.035, 0.05], [0.035, 0.7], [0.36, 0.71], [0.36, 0.75], [0, 0.75]].map((a) => new THREE.Vector2(a[0], a[1]));
    tableGeo = new THREE.LatheGeometry(pts, 14);
    tableMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.5, metalness: 0.2 });
  }
  if (!p.table) {
    p.table = new THREE.Mesh(tableGeo, tableMat);
    p.table.position.set(0, 0, 0.42);
    p.root.add(p.table);
  }
  p.table.visible = true;
}
function hideFurniture(p) {
  if (p.seat) p.seat.visible = false;
  if (p.table) p.table.visible = false;
}

// ---------------------------------------------------------------- activation / recycling
function activate(p, x, z, heading) {
  p.active = true; p.alive = true; p.health = 50;
  p.pos.set(x, groundY(x, z), z);
  p.heading = p.dir = p.homeHeading = heading || 0;
  p.state = ST.WALK; p.stateT = 0; p.partner = null; p.role = ''; p.jog = false;
  p.crossing = 0; p.wasOnRoad = false; p.probeT = Math.random() * 0.3; p.stuckT = 0; p.stuckN = 0; p.lastX = x; p.lastZ = z;
  p.acc = 0; p.animAcc = 0; p.hop = 0; p.lookYaw = 0;
  p.bumpCd = 0; p.chatCd = rnd(2, 25); p.waveCd = rnd(4, 40); p.dodgeCd = 0; p.gestT = rnd(2, 5);
  p.reflex = rnd(0.3, 1);
  p.landed = false; p.bounces = 0; p.tilt = 0; p.fading = false;
  p.scale = rnd(0.93, 1.06);
  p.root.scale.setScalar(p.scale);
  p.root.rotation.set(0, p.heading, 0);
  p.inner.position.y = 0;
  p.root.position.copy(p.pos);
  p.root.visible = true;
  hideFurniture(p);
  for (const m of p.mats) { if (m.transparent) { m.transparent = false; m.needsUpdate = true; } m.opacity = 1; }
  if (G.actors.indexOf(p) < 0) G.actors.push(p);
  if (list.indexOf(p) < 0) list.push(p);
}

function deactivate(p) {
  if (p.role === 'beach') beachCount = Math.max(0, beachCount - 1);
  p.role = '';
  p.active = false; p.alive = false;
  p.root.visible = false;
  if (p.partner) { if (p.partner.partner === p) { p.partner.partner = null; if (p.partner.state === ST.TALK) p.partner.stateT = Math.min(p.partner.stateT, 1); } p.partner = null; }
  hideFurniture(p);
  if (p.mixer) { p.mixer.stopAllAction(); p.cur = null; p.prev = null; p.animName = ''; }
  p.inner.position.y = 0;
  p.root.rotation.set(0, 0, 0);
  removeFrom(G.actors, p);
  removeFrom(list, p);
}

function recycle(p) { deactivate(p); }

function destroyScripted(p) {
  deactivate(p);
  if (p.root.parent) p.root.parent.remove(p.root);
  if (p.mixer) { try { p.mixer.uncacheRoot(p.inner); } catch { /* ignore */ } }
  for (const m of p.mats) m.dispose?.();
}

function freePed(except) {
  const n = pool.length;
  if (!n) return null;
  const start = (Math.random() * n) | 0;
  for (let i = 0; i < n; i++) {
    const p = pool[(start + i) % n];
    if (!p.active && p !== except) return p;
  }
  return null;
}

function settlePose(p) {
  if (p.mixer) p.mixer.update(Math.random() * 2 + 0.05);
  p.root.position.set(p.pos.x, p.pos.y, p.pos.z);
  p.root.rotation.y = p.heading;
}

// ---------------------------------------------------------------- behaviours setup
function startWalk(p, jog) {
  p.jog = !!jog;
  p.baseSpeed = p.speed = jog ? rnd(3.1, 3.9) : rnd(1.1, 1.7);
  resumeWalk(p);
}
function resumeWalk(p) {
  if (p.scripted && p.isStatic) { p.state = ST.SCRIPT; setAnim(p, p.retAnim || 'idle', 0.3, 1); p.dir = p.homeHeading; return; }
  p.state = ST.WALK;
  p.speed = p.baseSpeed;
  p.hop = 0;
  if (p.partner) { if (p.partner.partner === p) p.partner.partner = null; p.partner = null; }
  hideFurniture(p);
  if (p.role === 'beach') { p.role = ''; beachCount = Math.max(0, beachCount - 1); }
  p.stuckT = 0; p.lastX = p.pos.x; p.lastZ = p.pos.z;
  setAnim(p, p.jog ? 'run' : 'walk', 0.25, p.jog ? p.speed / RUN_CLIP_SPEED : p.speed / WALK_CLIP_SPEED);
}
function startIdle(p, anim, t) {
  p.state = ST.IDLE; p.stateT = t;
  p.baseSpeed = rnd(1.1, 1.6);
  setAnim(p, anim, 0.3, 1);
}
function startTalkPair(a, b, x, z, h) {
  activate(a, x, z, h);
  a.state = ST.TALK; a.stateT = rnd(18, 45); a.baseSpeed = rnd(1.1, 1.6);
  setAnim(a, 'talk', 0, 1);
  settlePose(a);
  if (b) {
    const bx = x + Math.sin(h) * 0.95, bz = z + Math.cos(h) * 0.95;
    activate(b, bx, bz, h + Math.PI);
    b.state = ST.TALK; b.stateT = a.stateT + rnd(0, 2); b.baseSpeed = rnd(1.1, 1.6);
    setAnim(b, 'nod', 0, 1);
    a.partner = b; b.partner = a;
    settlePose(b);
  }
}
function startSit(p, anim, beach) {
  p.state = ST.SIT; p.stateT = 1e9; p.baseSpeed = rnd(1.1, 1.6);
  if (p.model) ensureSeat(p, beach);
  setAnim(p, p.model && p.model.clips.sit_idle ? anim : 'idle', 0, 1);
}
function startCafePair(a, b, x, z, h) {
  activate(a, x, z, h);
  startSit(a, 'sit_talk', false);
  if (a.model) ensureTable(a);
  settlePose(a);
  if (b) {
    activate(b, x + Math.sin(h) * 0.84, z + Math.cos(h) * 0.84, h + Math.PI);
    startSit(b, 'sit_idle', false);
    a.partner = b; b.partner = a;
    settlePose(b);
  }
}
function startBeach(p) {
  p.state = ST.BEACH; p.stateT = rnd(40, 120); p.gestT = rnd(3, 8);
  p.baseSpeed = rnd(1.0, 1.4);
  p.role = 'beach'; beachCount++;
  setAnim(p, pickOf(BEACH_ANIMS), 0, 1);
}
// Temporary state (wave / react); returns to what the ped was doing.
function startTemp(p, st, anim, t) {
  if (p.state !== ST.WAVE && p.state !== ST.REACT) { p.retState = p.state; p.retAnim = p.animName || 'idle'; p.retT = p.stateT; }
  p.state = st; p.stateT = t;
  setAnim(p, anim, 0.2, 1);
}
function endTemp(p) {
  const rs = p.retState;
  if (rs === ST.WALK || rs === ST.WAIT || rs === ST.FLEE || rs === ST.COWER || rs === ST.FILM || rs === ST.DODGE) { resumeWalk(p); return; }
  p.state = rs; p.stateT = p.retT;
  setAnim(p, p.retAnim || 'idle', 0.3, 1);
  if (rs === ST.SCRIPT) p.dir = p.homeHeading;
}

function startFlee(p, fromX, fromZ, t) {
  let dx = p.pos.x - fromX, dz = p.pos.z - fromZ;
  if (dx * dx + dz * dz < 0.01) { dx = Math.random() - 0.5; dz = Math.random() - 0.5; }
  if (p.partner) { if (p.partner.partner === p) p.partner.partner = null; p.partner = null; }
  hideFurniture(p);
  if (p.role === 'beach') { p.role = ''; beachCount = Math.max(0, beachCount - 1); }
  p.state = ST.FLEE; p.stateT = t;
  p.dangerX = fromX; p.dangerZ = fromZ;
  p.dir = Math.atan2(dx, dz) + rnd(-0.5, 0.5);
  p.speed = rnd(4.3, 5.6);
  p.crossing = 99; p.hop = 0;
  p.stuckT = 0; p.lastX = p.pos.x; p.lastZ = p.pos.z;
  setAnim(p, 'run', 0.15, p.speed / RUN_CLIP_SPEED);
}

// ---------------------------------------------------------------- spawning
function inFrustum(x, z) {
  const cam = G.camera;
  if (!cam) return false;
  if (frustumFrame !== frameNo) {
    frustumFrame = frameNo;
    _m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_m4);
  }
  _sphere.center.set(x, 1, z);
  return _frustum.intersectsSphere(_sphere);
}

function pickSpawnPoint(initial) {
  const W = G.world;
  const P = playerPos();
  const minD = initial ? 7 : SPAWN_MIN, maxD = initial ? 85 : SPAWN_MAX;
  for (let t = 0; t < 5; t++) {
    let x, z, h;
    let pt = null;
    if (W && W.randomSidewalkPoint) { try { pt = W.randomSidewalkPoint(P, minD, maxD); } catch { pt = null; } }
    if (pt && Number.isFinite(pt.x) && Number.isFinite(pt.z)) {
      x = pt.x; z = pt.z; h = Number.isFinite(pt.heading) ? pt.heading : Math.random() * TAU;
    } else {
      const ang = Math.random() * TAU, d = rnd(minD, maxD);
      x = P.x + Math.sin(ang) * d; z = P.z + Math.cos(ang) * d; h = Math.random() * TAU;
      if (W && W.blocked && W.blocked(x, z, 0.5)) continue;
      const s = surf(x, z);
      if (isRoad(s) || isSolid(s)) continue;
    }
    const dx = x - P.x, dz = z - P.z, d2 = dx * dx + dz * dz;
    if (!initial) {
      if (d2 < 28 * 28) continue;
      if (d2 > RECYCLE2 * 0.9) continue;
      if (t < 4 && d2 < 70 * 70 && inFrustum(x, z)) continue;
    } else if (d2 < 5 * 5) continue;
    _pt.x = x; _pt.z = z; _pt.heading = h;
    return true;
  }
  return false;
}

function pickBeachPoint(initial) {
  const W = G.world;
  if (!W || !W.surfaceAt) return false;
  const P = playerPos();
  const lm = W.landmarks && W.landmarks.beach;
  const seaX = Number.isFinite(W.seaX) ? W.seaX : (lm ? lm.x - 20 : null);
  if (seaX === null) return false;
  if (Math.abs(P.x - seaX) > 170) return false;
  for (let t = 0; t < 4; t++) {
    let x, z;
    if (lm && t % 2 === 0) { x = lm.x + rnd(-30, 30); z = lm.z + rnd(-90, 90); }
    else { x = seaX + rnd(3, 48); z = P.z + rnd(-100, 100); }
    if (surf(x, z) !== 'sand') continue;
    const dx = x - P.x, dz = z - P.z, d2 = dx * dx + dz * dz;
    if (d2 > 120 * 120) continue;
    if (!initial && (d2 < 25 * 25 || (d2 < 60 * 60 && inFrustum(x, z)))) continue;
    if (initial && d2 < 16) continue;
    _pt.x = x; _pt.z = z; _pt.heading = -HALF_PI + rnd(-0.6, 0.6);   // look out to sea (west)
    return true;
  }
  return false;
}

function spawnOne(initial) {
  const a = freePed(null);
  if (!a) return false;
  // Beach crowd first when the player is near the sea.
  if (beachCount < 9 && Math.random() < 0.5 && pickBeachPoint(initial)) {
    const x = _pt.x, z = _pt.z, h = _pt.heading;
    const r = Math.random();
    if (r < 0.22) {
      const b = freePed(a);
      startTalkPair(a, b, x, z, Math.random() * TAU);
      a.role = 'beach'; beachCount++;
      if (b) { b.role = 'beach'; beachCount++; }
    } else if (r < 0.42) {
      activate(a, x, z, h); startSit(a, 'sit_idle', true); a.role = 'beach'; beachCount++; settlePose(a);
    } else {
      activate(a, x, z, r < 0.7 ? h : Math.random() * TAU); startBeach(a); settlePose(a);
    }
    return true;
  }
  if (!pickSpawnPoint(initial)) return false;
  const x = _pt.x, z = _pt.z;
  let h = _pt.heading;
  const r = Math.random();
  if (r < 0.13) {
    startTalkPair(a, freePed(a), x, z, h + HALF_PI * (Math.random() < 0.5 ? 0 : 1));
  } else if (r < 0.23) {
    startCafePair(a, Math.random() < 0.8 ? freePed(a) : null, x, z, h);
  } else if (r < 0.31) {
    activate(a, x, z, Math.random() * TAU);
    startIdle(a, Math.random() < 0.6 ? 'think' : 'idle', rnd(10, 30));
    settlePose(a);
  } else {
    if (Math.random() < 0.5) h += Math.PI;
    activate(a, x, z, h);
    startWalk(a, r < 0.43);
    settlePose(a);
  }
  return true;
}

// ---------------------------------------------------------------- per-ped logic
function turnToward(p, target, rate, dt) {
  const d = G.angleDiff(p.heading, target), m = rate * dt;
  p.heading += d > m ? m : d < -m ? -m : d;
}

function pickSide(p, L) {
  const a = p.dir + HALF_PI, b = p.dir - HALF_PI;
  const sa = surf(p.pos.x + Math.sin(a) * L, p.pos.z + Math.cos(a) * L);
  const sb = surf(p.pos.x + Math.sin(b) * L, p.pos.z + Math.cos(b) * L);
  const oka = !isRoad(sa) && !isSolid(sa), okb = !isRoad(sb) && !isSolid(sb);
  if (oka && okb) return Math.random() < 0.5 ? a : b;
  if (oka) return a;
  if (okb) return b;
  return NaN;
}

function probeAhead(p) {
  const x = p.pos.x, z = p.pos.z;
  const cur = surf(x, z);
  if (p.crossing > 0 && p.state !== ST.FLEE) {
    if (isRoad(cur)) p.wasOnRoad = true;
    else if (p.wasOnRoad) { p.crossing = 0; p.wasOnRoad = false; }
  }
  const L = p.state === ST.FLEE ? 2.6 : 1.6;
  const s = surf(x + Math.sin(p.dir) * L, z + Math.cos(p.dir) * L);
  if (isSolid(s)) {
    const side = pickSide(p, 2.2);
    p.dir = Number.isNaN(side) ? p.dir + Math.PI + rnd(-0.4, 0.4) : side;
    return;
  }
  if (isRoad(s) && p.crossing <= 0) {
    if (isRoad(cur)) { p.crossing = 8; p.wasOnRoad = true; return; }   // somehow standing in the road: get off it
    const side = pickSide(p, 2.5);
    if (Number.isNaN(side) || Math.random() < 0.3) {
      // wait at the curb, then cross
      p.state = ST.WAIT; p.stateT = rnd(1.2, 3.8);
      setAnim(p, 'idle', 0.3, 1);
    } else p.dir = side;
  }
}

function walkStep(p, dt) {
  p.probeT -= dt;
  if (p.probeT <= 0) {
    p.probeT = 0.22 + Math.random() * 0.12;
    probeAhead(p);
    if (p.state === ST.WAIT) return;
  }
  if (p.crossing > 0) p.crossing -= dt;
  turnToward(p, p.dir, p.state === ST.FLEE ? 7 : 3.5, dt);
  const sp = p.speed * dt;
  p.pos.x += Math.sin(p.heading) * sp;
  p.pos.z += Math.cos(p.heading) * sp;
  const hit = resolve(p.pos, p.radius);
  if (hit) {
    const fx = Math.sin(p.dir), fz = Math.cos(p.dir);
    if (fx * hit.nx + fz * hit.nz < -0.25) {
      let tx = -hit.nz, tz = hit.nx;
      const dot = fx * tx + fz * tz;
      if (dot < 0) { tx = -tx; tz = -tz; }
      p.dir = Math.atan2(tx, tz);
      if (Math.abs(dot) < 0.15 && Math.random() < 0.5) p.dir += Math.PI;
    }
  }
  p.pos.y = groundY(p.pos.x, p.pos.z);
  // stuck detection
  p.stuckT += dt;
  if (p.stuckT > 2) {
    const mx = p.pos.x - p.lastX, mz = p.pos.z - p.lastZ;
    if (mx * mx + mz * mz < 0.5 * p.speed * p.speed) {
      p.stuckN++;
      p.dir = p.heading + Math.PI * rnd(0.5, 1.5);
      p.crossing = 6;
    } else p.stuckN = 0;
    p.stuckT = 0; p.lastX = p.pos.x; p.lastZ = p.pos.z;
  }
}

function proximity(p, dt, d2) {
  const onFoot = !(G.player && G.player.inVehicle);
  const st = p.state;
  if (d2 < 0.72 * 0.72 && onFoot && st !== ST.SIT) {
    const d = Math.sqrt(d2) || 0.01;
    const push = 0.72 - d;
    p.pos.x += ((p.pos.x - px) / d) * push;
    p.pos.z += ((p.pos.z - pz) / d) * push;
    resolve(p.pos, p.radius);
    if (p.bumpCd <= 0) {
      p.bumpCd = 5;
      say(p, L_BUMP, 2.5);
      if (st === ST.WALK || st === ST.IDLE || st === ST.BEACH || st === ST.TALK || st === ST.WAIT) startTemp(p, ST.REACT, Math.random() < 0.5 ? 'shrug' : 'shake_head', 1.5);
    }
  } else if (d2 < 22 && p.chatCd <= 0) {
    p.chatCd = rnd(25, 60);
    if (Math.random() < 0.55) say(p, L_PASS, 8);
  } else if (d2 > 9 && d2 < 100 && p.waveCd <= 0) {
    p.waveCd = rnd(30, 70);
    if (onFoot && Math.random() < 0.3 && ((st === ST.WALK && !p.jog) || st === ST.IDLE || st === ST.BEACH)) startTemp(p, ST.WAVE, 'wave', 2.4);
  }
}

function think(p, dt, d2) {
  if (p.bumpCd > 0) p.bumpCd -= dt;
  if (p.chatCd > 0) p.chatCd -= dt;
  if (p.waveCd > 0) p.waveCd -= dt;
  if (p.dodgeCd > 0) p.dodgeCd -= dt;
  const st0 = p.state;
  if (d2 < 100 && !p.scripted && st0 !== ST.FLEE && st0 !== ST.DODGE && st0 !== ST.COWER) proximity(p, dt, d2);

  switch (p.state) {
    case ST.WALK:
      walkStep(p, dt);
      if (p.stuckN > 4 && !p.scripted && d2 > 30 * 30) recycle(p);
      break;
    case ST.WAIT:
      p.stateT -= dt;
      turnToward(p, p.dir, 3, dt);
      if (p.stateT <= 0) { p.crossing = 14; p.wasOnRoad = false; resumeWalk(p); }
      break;
    case ST.IDLE:
      p.stateT -= dt;
      if (d2 < 30) { p.dir = Math.atan2(px - p.pos.x, pz - p.pos.z); turnToward(p, p.dir, 2.5, dt); }
      if (p.stateT <= 0) { p.dir = p.heading; resumeWalk(p); }
      break;
    case ST.TALK:
      p.stateT -= dt; p.gestT -= dt;
      if (p.gestT <= 0) { p.gestT = rnd(2.5, 6); setAnim(p, pickOf(TALK_ANIMS), 0.35, 1); }
      if (p.stateT <= 0) {
        const q = p.partner;
        p.dir = p.heading + (Math.random() < 0.5 ? HALF_PI : -HALF_PI);
        resumeWalk(p);
        if (q && q.state === ST.TALK) q.stateT = Math.min(q.stateT, rnd(0.5, 1.5));
      }
      break;
    case ST.SIT:
      p.gestT -= dt;
      if (p.gestT <= 0) { p.gestT = rnd(4, 9); setAnim(p, Math.random() < 0.5 ? 'sit_talk' : 'sit_idle', 0.4, 1); }
      break;
    case ST.BEACH:
      p.stateT -= dt; p.gestT -= dt;
      if (p.gestT <= 0) { p.gestT = rnd(3.5, 8); setAnim(p, pickOf(BEACH_ANIMS), 0.35, 1); }
      if (d2 < 25) { p.dir = Math.atan2(px - p.pos.x, pz - p.pos.z); turnToward(p, p.dir, 2.5, dt); }
      if (p.stateT <= 0) { p.dir = Math.random() * TAU; resumeWalk(p); }
      break;
    case ST.WAVE:
    case ST.REACT:
      p.stateT -= dt;
      p.dir = Math.atan2(px - p.pos.x, pz - p.pos.z);
      turnToward(p, p.dir, 5, dt);
      if (p.stateT <= 0) { p.dir = p.retState === ST.WALK ? p.heading : p.dir; endTemp(p); if (p.state === ST.WALK) p.dir = p.homeHeading = p.dir; }
      break;
    case ST.FLEE:
      p.stateT -= dt;
      walkStep(p, dt);
      if (p.stateT <= 0) {
        p.crossing = 10; p.wasOnRoad = false;
        if (Math.random() < 0.4) { p.state = ST.COWER; p.stateT = rnd(3.5, 7); setAnim(p, 'slump', 0.3, 1); }
        else resumeWalk(p);
      }
      break;
    case ST.COWER:
      p.stateT -= dt;
      if (p.stateT <= 0) resumeWalk(p);
      break;
    case ST.FILM: {
      p.stateT -= dt;
      p.dir = Math.atan2(p.dangerX - p.pos.x, p.dangerZ - p.pos.z);
      turnToward(p, p.dir, 4, dt);
      const ddx = p.dangerX - p.pos.x, ddz = p.dangerZ - p.pos.z;
      if (ddx * ddx + ddz * ddz < 49 || d2 < 9) startFlee(p, d2 < 9 ? px : p.dangerX, d2 < 9 ? pz : p.dangerZ, rnd(4, 7));
      else if (p.stateT <= 0) { p.dir = p.heading + Math.PI; resumeWalk(p); }
      break;
    }
    case ST.DODGE: {
      p.stateT -= dt;
      const k = G.clamp(1 - p.stateT / 0.45, 0, 1);
      p.hop = Math.sin(k * Math.PI) * 0.35;
      p.pos.x += p.dodgeX * 5.4 * dt;
      p.pos.z += p.dodgeZ * 5.4 * dt;
      resolve(p.pos, p.radius);
      p.pos.y = groundY(p.pos.x, p.pos.z);
      if (p.stateT <= 0) { p.hop = 0; p.crossing = 8; p.wasOnRoad = false; resumeWalk(p); }
      break;
    }
    case ST.SCRIPT:
      if (p.facePlayer && d2 < 36) p.dir = Math.atan2(px - p.pos.x, pz - p.pos.z); else p.dir = p.homeHeading;
      turnToward(p, p.dir, 3, dt);
      break;
    default: break;
  }
}

function updateDown(p, dt) {
  p.stateT += dt;
  if (!p.landed) {
    p.vy -= 20 * dt;
    p.pos.x += p.vx * dt; p.pos.z += p.vz * dt;
    if (resolve(p.pos, 0.3)) { p.vx *= -0.25; p.vz *= -0.25; }
    p.ry += p.vy * dt;
    p.tilt += p.spin * dt;
    if (p.ry <= 0.22) {
      p.ry = 0.22;
      if (p.vy < -4 && p.bounces < 2) {
        p.vy = -p.vy * 0.3; p.vx *= 0.55; p.vz *= 0.55; p.spin *= 0.5; p.bounces++;
        try { G.audio?.play?.('hit_body', { pos: p.pos, volume: 0.6 }); } catch { /* ignore */ }
      } else {
        p.landed = true;
        p.tiltTarget = Math.round((p.tilt - HALF_PI) / Math.PI) * Math.PI + HALF_PI;
      }
    }
  } else {
    const f = Math.max(0, 1 - 5 * dt);
    p.pos.x += p.vx * dt; p.pos.z += p.vz * dt;
    p.vx *= f; p.vz *= f;
    p.tilt += (p.tiltTarget - p.tilt) * Math.min(1, 10 * dt);
  }
  const g = groundY(p.pos.x, p.pos.z);
  p.pos.y = g;
  p.root.position.set(p.pos.x, g + p.ry, p.pos.z);
  p.root.rotation.x = p.tilt;
  if (p.stateT > DOWN_TIME) {
    if (!p.fading) { p.fading = true; for (const m of p.mats) { m.transparent = true; m.needsUpdate = true; } }
    const k = 1 - (p.stateT - DOWN_TIME) / FADE_TIME;
    if (k <= 0) { if (p.scripted) destroyScripted(p); else recycle(p); return; }
    for (const m of p.mats) m.opacity = k;
  }
}

function updatePed(p, dt, shadowsOn) {
  const dx = p.pos.x - px, dz = p.pos.z - pz;
  const d2 = dx * dx + dz * dz;
  if (p.state === ST.DOWN) { updateDown(p, dt); return; }
  if (!p.scripted && d2 > RECYCLE2) { recycle(p); return; }
  const vis = d2 < VIS2;
  if (p.root.visible !== vis) p.root.visible = vis;

  p.acc += dt;
  if (d2 < AI_NEAR2 || ((frameNo + p.id) % 3) === 0) {
    const step = p.acc > 0.25 ? 0.25 : p.acc;
    p.acc = 0;
    think(p, step, d2);
    if (!p.active || p.state === ST.DOWN) return;
  }
  p.root.position.set(p.pos.x, p.pos.y + p.hop, p.pos.z);
  p.root.rotation.y = p.heading;

  if (p.mesh) {
    const cs = shadowsOn && d2 < SHADOW2;
    if (p.mesh.castShadow !== cs) p.mesh.castShadow = cs;
  }
  if (p.mixer && vis) {
    p.animAcc += dt;
    if (d2 < ANIM_FAR2) {
      const behind = ((p.pos.x - camX) * _camDir.x + (p.pos.y + 1 - camY) * _camDir.y + (p.pos.z - camZ) * _camDir.z) < -2.5;
      const every = d2 < ANIM_NEAR2 ? 1 : d2 < ANIM_MID2 ? 2 : 3;
      if (!behind && ((frameNo + p.id) % every) === 0) {
        p.mixer.update(p.animAcc > 0.2 ? 0.2 : p.animAcc);
        p.animAcc = 0;
        // look at the player when close (head bone, applied on top of the animation)
        if (p.head) {
          let target = 0;
          if (d2 < 49 && p.state !== ST.FLEE && p.state !== ST.COWER) {
            const a = G.angleDiff(p.heading, Math.atan2(px - p.pos.x, pz - p.pos.z));
            if (a > -1.9 && a < 1.9) target = a > 1.05 ? 1.05 : a < -1.05 ? -1.05 : a;
          }
          p.lookYaw += (target - p.lookYaw) * Math.min(1, 6 * dt * every);
          if (p.lookYaw > 0.02 || p.lookYaw < -0.02) p.head.rotateY(p.lookYaw);
        }
      } else if (p.animAcc > 0.3) p.animAcc = 0.3;
    } else p.animAcc = 0;
  }
}

// ---------------------------------------------------------------- reactions
function canReact(p) {
  return p.active && p.alive && p.state !== ST.DOWN && (!p.scripted || p.canPanic);
}

function panicAt(pos, radius) {
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.z)) return;
  const r = radius > 0 ? radius : 25;
  const r2 = r * r;
  let screams = 0, filmed = false;
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    if (!p || !canReact(p)) continue;
    const dx = p.pos.x - pos.x, dz = p.pos.z - pos.z, d2 = dx * dx + dz * dz;
    if (d2 > r2) continue;
    if (p.state === ST.FLEE) { if (p.stateT < 4) p.stateT = 4; continue; }
    if (p.state === ST.DODGE) continue;
    if (p.state === ST.FILM) { if (d2 > 100) { if (p.stateT < 3) p.stateT = 3; continue; } }
    else if (d2 > 14 * 14 && p.state !== ST.SIT && p.state !== ST.COWER && Math.random() < 0.2) {
      // pull out a phone and film it
      if (p.partner) { if (p.partner.partner === p) p.partner.partner = null; p.partner = null; }
      p.state = ST.FILM; p.stateT = rnd(5, 10);
      p.dangerX = pos.x; p.dangerZ = pos.z;
      setAnim(p, Math.random() < 0.6 ? 'point' : 'think', 0.25, 1);
      if (!filmed && p.root.visible) { filmed = true; if (Math.random() < 0.5) say(p, L_FILM, 6); }
      continue;
    }
    startFlee(p, pos.x, pos.z, rnd(5, 9));
    if (screams < 2 && Math.random() < 0.6 && G.time - lastScreamT > 0.5) {
      screams++; lastScreamT = G.time;
      try { G.audio?.play?.('ped_scream_f', { pos: p.pos, pitch: p.female ? rnd(0.95, 1.1) : rnd(0.72, 0.82) }); } catch { /* ignore */ }
      if (screams === 1 && Math.random() < 0.4) say(p, L_PANIC, 5);
    }
  }
}

function sourcePos(from) {
  if (from && typeof from === 'object' && from.pos && Number.isFinite(from.pos.x)) return from.pos;
  return playerPos();
}

function damagePed(p, amount, from) {
  if (!p.active || !p.alive || p.state === ST.DOWN) return;
  amount = +amount || 0;
  const isVehObj = !!(from && typeof from === 'object' && from.pos && ('speed' in from || 'vel' in from) && from !== G.player);
  const isVeh = from === 'vehicle' || isVehObj;
  const byPlayer = from === 'player' || from === 'vehicle' || (G.player && from === G.player) || (isVehObj && from.driver === 'player');
  if (p.invincible) {
    if (byPlayer) say(p, L_HURT, 3);
    return;
  }
  p.health -= amount;
  if (p.health <= 0 || (isVeh && amount >= 18)) { knockDown(p, from, isVeh, isVehObj, byPlayer); return; }
  try { G.audio?.play?.(p.female ? 'ped_hurt_f' : 'hurt', { pos: p.pos }); } catch { /* ignore */ }
  if (byPlayer) say(p, L_HURT, 3);
  const sp = sourcePos(from);
  if (canReact(p)) startFlee(p, sp.x, sp.z, rnd(6, 10));
  panicAt(p.pos, 14);
}

function knockDown(p, from, isVeh, isVehObj, byPlayer) {
  // launch velocity
  let vx = 0, vz = 0, vy = 2.4, spin = 5;
  let veh = isVehObj ? from : null;
  if (isVeh && !veh) {
    try { veh = (G.player && G.player.inVehicle) || G.vehicles?.nearest?.(p.pos, 9) || null; } catch { veh = null; }
  }
  if (veh && veh.pos) {
    let wx = 0, wz = 0;
    if (veh.vel && Number.isFinite(veh.vel.x)) { wx = veh.vel.x; wz = veh.vel.z; }
    else if (Number.isFinite(veh.heading)) { const s = veh.speed || 0; wx = Math.sin(veh.heading) * s; wz = Math.cos(veh.heading) * s; }
    const sp = Math.hypot(wx, wz);
    const ox = p.pos.x - veh.pos.x, oz = p.pos.z - veh.pos.z, ol = Math.hypot(ox, oz) || 1;
    vx = wx * 0.6 + (ox / ol) * 2; vz = wz * 0.6 + (oz / ol) * 2;
    vy = 3.5 + Math.min(6, sp * 0.25);
    spin = 5 + Math.min(9, sp * 0.4);
  } else {
    const s = sourcePos(from);
    const ox = p.pos.x - s.x, oz = p.pos.z - s.z, ol = Math.hypot(ox, oz) || 1;
    vx = (ox / ol) * 2.4; vz = (oz / ol) * 2.4;
  }
  const hv = Math.hypot(vx, vz);
  if (hv > 16) { vx *= 16 / hv; vz *= 16 / hv; }
  // fall forward when pushed from behind, backward otherwise
  const fwdDot = Math.sin(p.heading) * vx + Math.cos(p.heading) * vz;
  p.spin = fwdDot >= 0 ? spin : -spin;
  p.vx = vx; p.vy = vy; p.vz = vz;

  if (p.partner) { if (p.partner.partner === p) p.partner.partner = null; p.partner = null; }
  hideFurniture(p);
  if (p.role === 'beach') { p.role = ''; beachCount = Math.max(0, beachCount - 1); }
  p.state = ST.DOWN; p.stateT = 0; p.landed = false; p.bounces = 0; p.tilt = 0; p.fading = false; p.hop = 0;
  p.alive = false; p.health = 0;
  // pivot around the body centre for the tumble
  p.inner.position.y = -0.95;
  p.ry = 0.95 * p.scale;
  setAnim(p, 'slump', 0.1, 1);
  removeFrom(G.actors, p);

  try { G.audio?.play?.(p.female ? 'ped_hurt_f' : 'death_m', { pos: p.pos }); } catch { /* ignore */ }
  try { G.fx?.hitPuff?.(p.pos); } catch { /* ignore */ }
  try { G.missions?.dropCash?.(p.pos.clone(), 5 + ((Math.random() * 9) | 0) * 5); } catch { /* ignore */ }
  G.events.emit('npc:killed', { actor: p });
  if (byPlayer) G.events.emit('crime', { type: 'kill_ped', pos: p.pos.clone(), severity: 2 });
  else panicAt(p.pos, 20);
}

function canDodge(p) {
  if (!p.active || !p.alive || p.dodgeCd > 0) return false;
  if (p.scripted && !p.canPanic) return false;
  const s = p.state;
  return s !== ST.DOWN && s !== ST.DODGE && s !== ST.SIT && s !== ST.COWER;
}

function checkVehicles() {
  const vl = G.vehicles && G.vehicles.list;
  if (!vl) return;
  for (let i = 0; i < vl.length; i++) {
    const v = vl[i];
    if (!v || v.destroyed || !v.pos) continue;
    const ddx = v.pos.x - px, ddz = v.pos.z - pz;
    if (ddx * ddx + ddz * ddz > 95 * 95) continue;
    let vx, vz;
    if (v.vel && Number.isFinite(v.vel.x)) { vx = v.vel.x; vz = v.vel.z; }
    else { const s = v.speed || 0, h = v.heading || 0; vx = Math.sin(h) * s; vz = Math.cos(h) * s; }
    const sp = Math.hypot(vx, vz);
    if (!(sp > 6)) continue;
    const ix = vx / sp, iz = vz / sp;
    const isPlayers = v.driver === 'player';
    const halfW = (v.width || 1.8) * 0.5 + (isPlayers ? 0.85 : 0.3);
    for (let j = list.length - 1; j >= 0; j--) {
      const p = list[j];
      if (!canDodge(p)) continue;
      const rx = p.pos.x - v.pos.x, rz = p.pos.z - v.pos.z;
      const along = rx * ix + rz * iz;
      if (along < 0) continue;
      const reach = 2.5 + sp * 0.6 * p.reflex;
      if (along > reach) continue;
      const lat = rx * iz - rz * ix;
      if (lat > halfW || lat < -halfW) continue;
      const sgn = lat > 0.05 ? 1 : lat < -0.05 ? -1 : (Math.random() < 0.5 ? 1 : -1);
      if (p.partner) { if (p.partner.partner === p) p.partner.partner = null; p.partner = null; }
      p.dodgeX = iz * sgn; p.dodgeZ = -ix * sgn;
      p.state = ST.DODGE; p.stateT = 0.45; p.dodgeCd = 1.6;
      p.dir = Math.atan2(p.dodgeX, p.dodgeZ);
      if (p.baseSpeed > 2.2 && !p.jog) p.baseSpeed = rnd(1.2, 1.7);
      setAnim(p, 'run', 0.1, 1.3);
      if (isPlayers && Math.random() < 0.5) say(p, L_CAR, 4);
    }
  }
}

// ---------------------------------------------------------------- scripted peds (missions)
function spawnAt(x, z, opts) {
  opts = opts || {};
  let model = null;
  if (models.length) {
    if (opts.model) model = models.find((m) => m.name === opts.model) || null;
    if (!model) model = pickOf(models);
  }
  const p = makePed(model, true);
  p.isStatic = opts.static !== false;
  p.canPanic = !!opts.canPanic;
  p.invincible = opts.invincible !== undefined ? !!opts.invincible : p.isStatic;
  p.facePlayer = opts.facePlayer !== undefined ? !!opts.facePlayer : false;
  p.name = opts.name || null;
  if (opts.female !== undefined) p.female = !!opts.female;
  activate(p, +x || 0, +z || 0, Number.isFinite(opts.heading) ? opts.heading : 0);
  if (opts.scale) { p.scale = opts.scale; p.root.scale.setScalar(p.scale); }
  if (Number.isFinite(opts.health)) p.health = opts.health;
  const anim = opts.anim || 'idle';
  p.retAnim = anim;
  if (p.isStatic) {
    p.state = ST.SCRIPT;
    if (/^sit/.test(anim) && p.model && opts.seat !== false) ensureSeat(p, false);
    setAnim(p, anim, 0, 1);
  } else {
    startWalk(p, anim === 'run');
  }
  settlePose(p);
  api.count = list.length;
  return p;
}

// ---------------------------------------------------------------- init / update
async function loadModels() {
  const results = await Promise.allSettled(MODEL_NAMES.map((n) => G.assets.loadGLB(`assets/chars/${n}.glb`)));
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status !== 'fulfilled' || !r.value || !r.value.scene) continue;
    const clips = {};
    for (const c of (r.value.animations || [])) clips[c.name] = c;
    models.push({ name: MODEL_NAMES[i], gltf: r.value, clips, female: FEMALE_MODELS.has(MODEL_NAMES[i]) });
  }
}

export async function init(G_) {
  G.npcs = api;   // usable (spawnAt/panicAt) even if model loading fails below
  try { await loadModels(); } catch (e) { console.warn('[npcs] model loading failed', e); }
  if (!models.length) console.warn('[npcs] no character models loaded - using capsule fallback');

  poolSize = G.settings.quality === 'low' ? 22 : G.settings.quality === 'medium' ? 32 : 40;
  for (let i = 0; i < poolSize; i++) {
    const model = models.length ? models[i % models.length] : null;
    try { pool.push(makePed(model, false)); } catch (e) { console.warn('[npcs] ped build failed', e); }
  }

  G.events.on('crime', (e) => {
    if (!e || !ready) return;
    const t = e.type;
    if (t === 'speeding' || t === 'hit_car') return;
    const pos = e.pos || playerPos();
    panicAt(pos, t === 'shoot' ? 30 : 16 + (e.severity || 1) * 7);
  });
  G.events.on('vehicle:destroyed', (e) => {
    if (!ready) return;
    const pos = (e && (e.pos || (e.vehicle && e.vehicle.pos))) || null;
    if (pos) panicAt(pos, 50);
  });
  G.events.on('player:respawn', () => { warmT = 2; });
  G.events.on('game:start', () => { warmT = 3; });

  ready = true;
  // Pre-populate around the start position so the first frame is already alive.
  try {
    const P = playerPos();
    px = P.x; pz = P.z;
    if (G.camera) G.camera.updateMatrixWorld();
    let guard = 0;
    while (list.length < poolSize && guard++ < poolSize * 3) spawnOne(true);
  } catch (e) { console.warn('[npcs] pre-populate failed', e); }
  api.count = list.length;
}

export function update(dt) {
  if (!ready) return;
  frameNo++;
  const P = playerPos();
  px = P.x; pz = P.z;
  const cam = G.camera;
  if (cam) { cam.getWorldDirection(_camDir); camX = cam.position.x; camY = cam.position.y; camZ = cam.position.z; }
  const shadowsOn = G.settings.quality !== 'low';

  // keep the ring populated
  let active = 0;
  for (let i = 0; i < pool.length; i++) if (pool[i].active) active++;
  if (active < pool.length) {
    if (warmT > 0) warmT -= dt;
    let budget = warmT > 0 ? 4 : 2;
    while (budget-- > 0 && active < pool.length) {
      let ok = false;
      try { ok = spawnOne(warmT > 0 && active < pool.length * 0.5); } catch (e) { ok = false; }
      if (!ok) break;
      active++;
    }
  }

  vehT -= dt;
  if (vehT <= 0) { vehT = 0.12; try { checkVehicles(); } catch (e) { /* vehicles module mismatch: ignore */ } }

  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    if (!p || !p.active) continue;
    try { updatePed(p, dt, shadowsOn); }
    catch (e) {
      if (G.errors.length < 150) { G.errors.push('[npcs:ped] ' + (e && e.stack ? e.stack : e)); console.error(e); }
      try { if (p.scripted) { p.state = ST.SCRIPT; } else recycle(p); } catch { /* ignore */ }
    }
  }
  api.count = list.length;
}
