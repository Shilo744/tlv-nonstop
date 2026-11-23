// missions.js - data-driven missions, markers/beacons, world pickups and side activities for TLV NONSTOP.
import * as THREE from 'three';
import { G } from './core.js';

const M = { list: [], active: null, completed: new Set(), stats: null, start, fail, dropCash };
let ready = false, T = 0, px = 0, pz = 0, pveh = null, errCount = 0;
const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _dummy = new THREE.Object3D();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const tgt = { x: 0, z: 0 };
const C_START = 0xffd23a, C_DEST = 0x3affd0, C_ITEM = 0xff5ad0, C_FARE = 0x45b8ff;

// ---------------------------------------------------------------- helpers
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function safe(fn) { try { return fn(); } catch { return null; } }
function bounds() { const b = G.world?.bounds; return (b && Number.isFinite(b.minX) && Number.isFinite(b.maxZ)) ? b : { minX: -300, maxX: 300, minZ: -300, maxZ: 300 }; }
function gy(x, z) { const y = safe(() => G.world?.groundY?.(x, z)); return Number.isFinite(y) ? Math.max(y, -0.4) : 0; }
function surf(x, z) { return safe(() => G.world?.surfaceAt?.(x, z)) || ''; }
function lm(key, fx, fz) {
  const l = G.world?.landmarks?.[key];
  if (l && Number.isFinite(l.x) && Number.isFinite(l.z)) return { x: l.x, z: l.z };
  const b = bounds(); return { x: b.minX + (b.maxX - b.minX) * fx, z: b.minZ + (b.maxZ - b.minZ) * fz };
}
function okPoint(x, z, r = 1.5) {
  const w = G.world; if (!w) return true;
  try {
    const b = bounds(); if (x < b.minX + 3 || x > b.maxX - 3 || z < b.minZ + 3 || z > b.maxZ - 3) return false;
    if (Number.isFinite(w.seaX) && x < w.seaX + 2) return false;
    if (w.blocked?.(x, z, r)) return false;
    const s = w.surfaceAt?.(x, z); if (s === 'water' || s === 'building') return false;
  } catch { /* treat as free */ }
  return true;
}
function findFree(x, z, maxR = 40, r = 2) {
  if (okPoint(x, z, r)) return { x, z };
  for (let d = 4; d <= maxR; d += 4) for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4 + d, nx = x + Math.sin(a) * d, nz = z + Math.cos(a) * d;
    if (okPoint(nx, nz, r)) return { x: nx, z: nz };
  }
  return { x, z };
}
let nodeMap = null;
function nodeOf(id) {
  if (id && typeof id === 'object') return id;
  if (!nodeMap) { nodeMap = new Map(); for (const n of G.world?.roads?.nodes || []) nodeMap.set(n.id, n); }
  return nodeMap.get(id) || null;
}
function nodeNear(p) { const n = safe(() => G.world.nearestNode(p.x, p.z)); return (n && Number.isFinite(n.x)) ? { x: n.x, z: n.z } : findFree(p.x, p.z); }
function pathPts(a, b) {
  const pts = [];
  try {
    const w = G.world, n0 = w.nearestNode(a.x, a.z), n1 = w.nearestNode(b.x, b.z);
    if (n0 && n1 && n0 !== n1) for (const id of (w.path(n0.id, n1.id) || [])) { const n = nodeOf(id); if (n) pts.push({ x: n.x, z: n.z }); }
  } catch { pts.length = 0; }
  return pts;
}
function occupied(x, z, r) { const l = G.vehicles?.list; if (l) for (const v of l) { if (v !== pveh && v.pos && Math.hypot(v.pos.x - x, v.pos.z - z) < r) return true; } return false; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

// ---------------------------------------------------------------- beacons
const matCache = new Map(), iconCache = new Map();
let colGeo, ringGeo, dest, fareBeacon, spotMesh, ringV;
function glowMat(color, opacity) {
  const k = color + ':' + opacity; let m = matCache.get(k);
  if (!m) { m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false }); matCache.set(k, m); }
  return m;
}
function iconMat(text, color) {
  const k = text + color; let m = iconCache.get(k); if (m) return m;
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  x.fillStyle = 'rgba(8,12,28,0.88)'; x.beginPath(); x.arc(64, 64, 56, 0, 6.3); x.fill();
  x.lineWidth = 8; x.strokeStyle = '#' + new THREE.Color(color).getHexString(); x.stroke();
  x.fillStyle = '#ffffff'; x.font = 'bold 62px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",Arial';
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 64, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  m = new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false, fog: false });
  iconCache.set(k, m); return m;
}
function makeBeacon(color, icon, scale = 1) {
  const g = new THREE.Group();
  const col = new THREE.Mesh(colGeo, glowMat(color, 0.22)); col.scale.set(scale, 1, scale);
  const ring = new THREE.Mesh(ringGeo, glowMat(color, 0.95)); ring.position.y = 0.3;
  const spr = new THREE.Sprite(iconMat(icon, color)); spr.position.y = 4.4; spr.scale.setScalar(2.4);
  col.renderOrder = ring.renderOrder = spr.renderOrder = 6;
  g.add(col, ring, spr); g.userData = { col, ring, spr, scale };
  G.scene.add(g); return g;
}
function styleBeacon(b, color, icon) { const u = b.userData; u.col.material = glowMat(color, 0.22); u.ring.material = glowMat(color, 0.95); u.spr.material = iconMat(icon, color); }
function placeBeacon(b, x, z) { b.position.set(x, gy(x, z), z); b.visible = true; }
function animBeacon(b, k) {
  const u = b.userData, s = u.scale * (1 + 0.14 * Math.sin(T * 3 + k));
  u.ring.rotation.y = T * 1.7 + k; u.ring.scale.set(s, 1, s);
  u.spr.position.y = 4.4 + Math.sin(T * 2 + k) * 0.35;
}

// ---------------------------------------------------------------- dialogue queue
const queue = []; let qT = 0;
function say(lines) { if (lines) for (const l of lines) queue.push(l); }
function updateDialogue(dt) {
  qT -= dt;
  if (qT <= 0 && queue.length) { const l = queue.shift(); const ms = Math.min(4200, 1700 + l[1].length * 45); G.hud?.subtitle?.(l[0], l[1], ms); qT = ms / 1000 + 0.15; }
}

// ---------------------------------------------------------------- mission data
function firstMarkerPos(sp) {
  const h = sp.heading || 0;
  for (let pass = 0; pass < 2; pass++) for (const r of [30, 27, 34]) for (let k = 0; k < 16; k++) {
    const a = h + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 8;
    const x = sp.x + Math.sin(a) * r, z = sp.z + Math.cos(a) * r;
    if (!okPoint(x, z, 2.5)) continue;
    if (pass === 0 && surf(x, z) === 'road') continue;
    return { x, z };
  }
  return { x: sp.x + Math.sin(h) * 30, z: sp.z + Math.cos(h) * 30 };
}
function freeSpot(from, want) {
  let best = null, bs = 1e9;
  for (const s of G.world?.parkingSpots || []) { const sc = Math.abs(Math.hypot(s.x - from.x, s.z - from.z) - want); if (sc < bs && !occupied(s.x, s.z, 4.5)) { best = s; bs = sc; } }
  if (best) return { x: best.x, z: best.z, heading: best.heading || 0 };
  return safe(() => G.world.randomRoadPoint(from, want * 0.6, want * 1.3)) || findFree(from.x + want * 0.6, from.z, 40);
}
function buildMissions() {
  const w = G.world, b = bounds();
  const sp = (w?.spawn && Number.isFinite(w.spawn.x)) ? w.spawn : { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2, heading: 0 };
  const rnd = rng(77);
  // 1 - sabich express (next to the spawn point)
  const p1 = firstMarkerPos(sp);
  let s = Math.abs(p1.z - sp.z) > 8 ? Math.sign(p1.z - sp.z) : -1;
  if (p1.z + s * 140 < b.minZ + 15 || p1.z + s * 140 > b.maxZ - 15) s = -s;
  const drops = [1, 2, 3].map((i) => findFree(p1.x, p1.z + s * 42 * i, 24));
  // 2 - special taxi
  const beach = lm('beach', 0.14, 0.45), azr = nodeNear(lm('azrieli', 0.85, 0.5));
  let p2 = findFree(beach.x, beach.z, 40, 2.5);
  if (dist(p2, p1) < 45) { const c = lm('carmel', 0.3, 0.6); p2 = findFree(c.x, c.z, 40, 2.5); }
  const dl = Math.max(1, dist(p2, azr));
  const pick = nodeNear({ x: p2.x + (azr.x - p2.x) / dl * Math.min(120, dl * 0.4), z: p2.z + (azr.z - p2.z) / dl * Math.min(120, dl * 0.4) });
  const taxiTime = Math.round(G.clamp(dist(pick, azr) / 11 + 30, 55, 160));
  // 3 - last parking spot
  const dz = lm('dizengoff', 0.45, 0.3), p3 = findFree(dz.x, dz.z, 40, 2.5);
  // 4 - promenade race
  const port = lm('port', 0.15, 0.08), p4 = findFree(port.x, port.z, 40, 2.5);
  let rp = pathPts(port, lm('jaffa', 0.15, 0.9));
  if (rp.length < 3) { rp = []; const j = lm('jaffa', 0.15, 0.9); for (let i = 1; i <= 6; i++) rp.push(findFree(port.x + (j.x - port.x) * i / 6, port.z + (j.z - port.z) * i / 6, 30)); }
  if (rp.length && dist(rp[0], p4) < 18) rp.shift();
  if (rp.length > 8) { const o = [], st = (rp.length - 1) / 7; for (let i = 0; i < 8; i++) o.push(rp[Math.round(i * st)]); rp = o; }
  let rl = 0; for (let i = 0; i < rp.length; i++) rl += dist(i ? rp[i - 1] : p4, rp[i]);
  const raceSteps = [{ type: 'vehicle', text: 'קח רכב. כל דבר עם גלגלים ואגו' }];
  rp.forEach((p, i) => raceSteps.push({ type: 'goto', pos: p, r: 9, ring: true, icon: '🏁', time: i === 0 ? Math.round(rl / 14 + 22) : 0, text: 'מרוץ הטיילת: שער ' + (i + 1) + ' מתוך ' + rp.length }));
  // 5 - white night, 6 - jaffa clock
  const ro = lm('rothschild', 0.5, 0.65), p5 = findFree(ro.x, ro.z, 40, 2.5);
  const fl = lm('florentin', 0.4, 0.85), p6 = findFree(fl.x, fl.z, 40, 2.5);
  const jf = lm('jaffa', 0.15, 0.9), jfc = findFree(jf.x, jf.z, 40, 2.5);
  const packs = []; for (let i = 0; i < 5; i++) { const a = i * 1.2566 + rnd(), d = 14 + rnd() * 24; packs.push(findFree(jfc.x + Math.sin(a) * d, jfc.z + Math.cos(a) * d, 20)); }

  M.list = [
    { id: 'sabich', title: 'סביח אקספרס', sub: 'שלוש מנות, אפס סבלנות', icon: '🥙', pos: p1, reward: 400, giver: 'אבי מהסביחייה', model: 'npc_b',
      intro: [['אבי', 'אחי, שלוש מנות חמות והשליח שלי תקוע בפקק. רגשי.'], ['אבי', 'קח את הקורקינט. אם העמבה מתקררת, גם אני מתקרר אליך.']],
      timeout: 'הסביח התקרר. בעיר הזאת זה כמעט פלילי.',
      outro: [['אבי', 'שלוש מתוך שלוש! אתה רשמית השליח הכי פחות גרוע שהיה לי.']],
      steps: [
        { type: 'vehicle', vtype: 'scooter', any: true, text: 'עלה על הקורקינט החשמלי (F)' },
        { type: 'goto', pos: drops[0], r: 4.5, time: 55, icon: '🥙', pay: 40, text: 'מנה ראשונה: ללקוחה על הטיילת', done: [['לקוחה', 'סוף סוף! כבר שקלתי לאכול סלט. תבין את המצב.']] },
        { type: 'goto', pos: drops[1], r: 4.5, icon: '🥙', pay: 40, text: 'מנה שנייה: בלי חריף, עם דרמה', done: [['לקוח', 'ביקשתי בלי חציל. זה סביח? טוב, תשאיר.']] },
        { type: 'goto', pos: drops[2], r: 4.5, icon: '🥙', pay: 40, text: 'מנה אחרונה: לפני שהפיתה נרטבת', done: [['לקוחה', 'חם! אתה מקבל חמישה כוכבים וחצי חיוך.']] },
      ] },
    { id: 'taxi', title: 'מונית ספיישל', sub: 'סבב גיוס על ארבעה גלגלים', icon: '🚕', pos: p2, reward: 650, giver: 'סדרן המוניות', model: 'npc_d',
      intro: [['סדרן', 'יש לי נוסעת שמשלמת כפול ומתלוננת משולש.'], ['סדרן', 'תפוס מונית, תאסוף אותה, ואל תדבר איתה על הערכות שווי.']],
      timeout: 'המשקיעים הלכו לאכול חומוס. בלי הסטארט-אפ.',
      outro: [['נועה', 'הגענו! אם נסגור סבב, אתה מקבל אופציות. הן שוות בערך כלום.']],
      crashFrom: 2, fastLine: ['נועה', 'ככה! זה הקצב צמיחה שהבטחתי למשקיעים!'],
      crashLines: [['נועה', 'היי! הלפטופ שלי שווה יותר מהמונית הזאת!'], ['נועה', 'זה לא פיבוט, זה תאונה!'], ['נועה', 'אני מורידה לך כוכב. ואת הדירוג של כל הענף.'], ['נועה', 'עוד מכה אחת ואני עוברת לקורקינט.']],
      steps: [
        { type: 'vehicle', vtype: 'taxi', text: 'מצא מונית ועלה עליה (F)' },
        { type: 'goto', pos: pick, r: 7, stop: true, needVeh: true, icon: '🙋', text: 'אסוף את נועה, היזמית הלחוצה (לעצור לידה)', done: [['נועה', 'סע! פגישת משקיעים בעוד רגע והמצגת שלי עוד בלי שקף אחרון.']] },
        { type: 'goto', pos: azr, r: 9, stop: true, needVeh: true, time: taxiTime, icon: '🏢', text: 'למגדלים, לפני שהמשקיעים מתייאשים' },
      ] },
    { id: 'parking', title: 'החניה האחרונה בתל אביב', sub: 'יש אחת. מישהו כבר בדרך אליה', icon: '🅿️', pos: p3, reward: 800, giver: 'שכנה מהמרפסת', model: 'npc_f',
      intro: [['שכנה', 'ראיתי מהמרפסת: התפנתה חניה. אמיתית. כחול-לבן והכול.'], ['שכנה', 'רוץ! יש כבר ג\'יפ שמסתובב שם עם אורות חירום.']],
      timeout: 'הג\'יפ נכנס לחניה. נתראה בסיבוב הבא, בעוד שנה.',
      outro: [['שכנה', 'חנית! אל תזיז את האוטו לעולם. תוריש אותה לילדים.']],
      steps: [
        { type: 'vehicle', text: 'קח רכב כלשהו (F)' },
        { type: 'goto', pos: () => freeSpot(p3, 220), r: 3.2, stop: true, needVeh: true, spot: true, time: 70, icon: '🅿️', text: 'חנה בתוך המקום המסומן ועצור לגמרי' },
      ] },
    { id: 'race', title: 'מרוץ הטיילת', sub: 'שקיעה, רוח, ושום רמזור', icon: '🏁', pos: p4, reward: 900, giver: 'מארגנת המרוץ', model: 'npc_c',
      intro: [['מארגנת', 'מהנמל עד יפו דרך כל השערים. השעון רץ, הרוח בפנים.'], ['מארגנת', 'מי שעוצר לצלם שקיעה - נפסל.']],
      timeout: 'השמש שקעה לפניך. היא אפילו לא מיהרה.',
      outro: [['מארגנת', 'שיא טיילת חדש! תירשם על הקיר, בטוש מחיק.']],
      steps: raceSteps },
    { id: 'whitenight', title: 'לילה לבן', sub: 'העיר לא ישנה, וגם המשטרה לא', icon: '🌙', pos: p5, reward: 1000, giver: 'מפיק מסיבות', model: 'npc_g',
      intro: [['מפיק', 'המסיבה שלי ריקה. אני צריך שכל העיר תדבר על משהו.'], ['מפיק', 'תעשה רעש עד שלוש ניידות רודפות אחריך, ואז תיעלם כמו תקציב.']],
      outro: [['מפיק', 'כולם מדברים רק עליך! המסיבה מלאה. אתה לא ברשימה.']],
      steps: [
        { type: 'wanted', level: 3, text: 'תעשה בלגן: הגע לרמת חיפוש 3' },
        { type: 'escape', text: 'עכשיו תיעלם: נער את המשטרה מהזנב' },
      ] },
    { id: 'clock', title: 'השעון של יפו', sub: 'חמש חבילות, מגדל אחד, אפס שאלות', icon: '🕰️', pos: p6, reward: 1200, giver: 'סוחר עתיקות', model: 'npc_h',
      intro: [['סוחר', 'ליד מגדל השעון ביפו מוחבאות חמש חבילות שלי.'], ['סוחר', 'תאסוף ברגל, בעדינות, ותחזור. מה יש בפנים? געגועים.']],
      outro: [['סוחר', 'כל החמש! רגע, אחת מתקתקת. לא משנה. תודה!']],
      steps: [
        { type: 'goto', pos: jfc, r: 14, icon: '🕰️', text: 'סע למגדל השעון ביפו העתיקה' },
        { type: 'collect', points: packs, icon: '📦', text: 'אסוף ברגל את החבילות המוחבאות' },
        { type: 'goto', pos: p6, r: 6, icon: '🤝', text: 'חזור לסוחר בפלורנטין' },
      ] },
  ];
  for (let i = 0; i < M.list.length; i++) {
    const m = M.list[i];
    m.promptText = 'E - להתחיל: ' + m.title;
    m.blip = { x: m.pos.x, z: m.pos.z, color: '#ffd23a', icon: 'mission', label: m.title };
    m.marker = makeBeacon(C_START, m.icon, 1); placeBeacon(m.marker, m.pos.x, m.pos.z);
    safe(() => G.npcs?.spawnAt?.(m.pos.x + 1.9, m.pos.z + 1.2, { model: m.model, static: true, anim: 'talk', name: m.giver }));
  }
  for (const d of drops) safe(() => G.npcs?.spawnAt?.(d.x + 1.6, d.z + 0.8, { static: true, anim: 'wave', name: 'לקוח רעב' }));
}
function refreshMarkers() {
  const unlocked = 2 + M.completed.size;
  for (let i = 0; i < M.list.length; i++) {
    const m = M.list[i], vis = !M.active && i < unlocked && !M.completed.has(m.id);
    m.avail = vis; if (m.marker) m.marker.visible = vis;
    if (vis) G.hud?.addBlip?.('mission_' + m.id, m.blip); else G.hud?.removeBlip?.('mission_' + m.id);
  }
}

// ---------------------------------------------------------------- mission flow
function start(id) {
  const m = M.list.find((q) => q.id === id) || (typeof id === 'number' ? M.list[id] : null);
  if (!m || !ready) return false;
  if (M.active) cleanup();
  endFare(); promptOff();
  M.active = { id: m.id, title: m.title, mission: m, stepIndex: -1, step: null, target: null, timeLeft: null, lastSec: -999, elapsed: 0, crashes: 0, veh: null, items: null, got: 0, routeT: 0, hold: 0, hintCd: 0, lastTalk: -9, fastSaid: false };
  refreshMarkers();
  G.hud?.bigText?.(m.title, m.sub, 3000); G.audio?.play?.('ui_select'); G.hud?.announce?.('משימה: ' + m.title);
  queue.length = 0; qT = 0.4; say(m.intro);
  G.events.emit('mission:start', { id: m.id, title: m.title });
  beginStep(0);
  return true;
}
function clearItems() {
  const a = M.active; if (!a || !a.items) return;
  for (let i = 0; i < a.items.length; i++) { G.scene.remove(a.items[i].b); G.hud?.removeBlip?.('m_item_' + i); }
  a.items = null;
}
function cleanup() {
  clearItems();
  if (dest) dest.visible = false; if (spotMesh) spotMesh.visible = false;
  G.hud?.removeBlip?.('m_dest'); G.hud?.timer?.(null); G.hud?.setObjective?.(null); G.hud?.setRoute?.(null);
  M.active = null; refreshMarkers();
}
function complete() {
  const a = M.active; if (!a) return; const m = a.mission;
  M.completed.add(m.id); M.stats.missionsDone++;
  cleanup();
  G.hud?.bigText?.('משימה הושלמה', '+₪' + m.reward, 4000); G.hud?.announce?.('משימה הושלמה');
  G.player?.addMoney?.(m.reward); G.audio?.play?.('chime'); G.fx?.moneyPop?.(_f.set(px, 1.6, pz), m.reward);
  say(m.outro);
  G.events.emit('mission:complete', { id: m.id, title: m.title });
  const nx = M.list[1 + M.completed.size];
  if (nx && nx.avail) G.hud?.toast?.('משימה חדשה על המפה: ' + nx.title, 4000);
  saveStats();
}
function fail(reason) {
  const a = M.active; if (!a) return;
  const m = a.mission; M.stats.missionsFailed++;
  cleanup(); queue.length = 0;
  G.hud?.bigText?.('המשימה נכשלה', reason || 'קורה. גם לטובים ביותר, ובעיקר לך.', 4000);
  G.audio?.play?.('ui_error');
  G.events.emit('mission:fail', { id: m.id, title: m.title });
}
function setTarget(x, z) { const a = M.active; tgt.x = x; tgt.z = z; if (a) a.target = tgt; dest.position.set(x, gy(x, z), z); dest.visible = true; }
function ensureVehicle(type) {
  const V = G.vehicles; if (!V) return null;
  try {
    const v = V.nearest?.(_v.set(px, 0, pz), 90, (q) => !q.destroyed && !q.driver && !q.isPolice && (!type || q.type === type));
    if (v) return v;
    let s = null, bd = 70;
    for (const q of G.world?.parkingSpots || []) { const d = Math.hypot(q.x - px, q.z - pz); if (d > 7 && d < bd && !occupied(q.x, q.z, 4.5)) { s = q; bd = d; } }
    if (!s) s = safe(() => G.world.randomRoadPoint(_v.set(px, 0, pz), 8, 30)) || { x: px + 5, z: pz + 3, heading: 0 };
    return V.spawn?.(type || 'roadster', s.x, s.z, s.heading || 0, { ai: 'parked' }) || null;
  } catch { return null; }
}
function refreshRoute() {
  const a = M.active; if (!a) return;
  if (!a.target) { G.hud?.setRoute?.(null); return; }
  const pts = [{ x: px, z: pz }];
  if (Math.hypot(px - tgt.x, pz - tgt.z) > 40) for (const p of pathPts(pts[0], tgt)) pts.push(p);
  pts.push({ x: tgt.x, z: tgt.z });
  G.hud?.setRoute?.(pts);
}
function beginStep(i) {
  const a = M.active; if (!a) return;
  const steps = a.mission.steps;
  if (i >= steps.length) { complete(); return; }
  const s = steps[i], prevX = tgt.x, prevZ = tgt.z;
  a.stepIndex = i; a.step = s; a.hold = 0; a.target = null; a.veh = null;
  dest.visible = false; spotMesh.visible = false; ringV.visible = false; G.hud?.removeBlip?.('m_dest');
  if (s.time) { a.timeLeft = s.time; a.lastSec = -999; }
  let text = s.text;
  styleBeacon(dest, C_DEST, s.icon || '⬇');
  if (s.type === 'vehicle') {
    a.veh = ensureVehicle(s.vtype);
    if (a.veh?.pos) setTarget(a.veh.pos.x, a.veh.pos.z);
  } else if (s.type === 'goto') {
    const p = (typeof s.pos === 'function' ? safe(s.pos) : s.pos) || { x: px + 30, z: pz };
    setTarget(p.x, p.z);
    if (s.spot) { spotMesh.position.set(p.x, gy(p.x, p.z) + 0.08, p.z); spotMesh.rotation.z = p.heading || 0; spotMesh.visible = true; }
    if (s.ring) { ringV.visible = true; ringV.rotation.y = Math.atan2(p.x - (i > 1 ? prevX : px), p.z - (i > 1 ? prevZ : pz)); }
  } else if (s.type === 'collect') {
    a.items = []; a.got = 0;
    for (let k = 0; k < s.points.length; k++) {
      const p = s.points[k], b = makeBeacon(C_ITEM, s.icon || '📦', 0.45); placeBeacon(b, p.x, p.z);
      a.items.push({ x: p.x, z: p.z, b, done: false });
      G.hud?.addBlip?.('m_item_' + k, { x: p.x, z: p.z, color: '#ff5ad0', icon: 'pickup', label: 'חבילה' });
    }
    text = s.text + ' (0/' + s.points.length + ')';
  }
  if (a.target) G.hud?.addBlip?.('m_dest', { x: tgt.x, z: tgt.z, color: '#3affd0', icon: 'dest', label: s.text });
  G.hud?.setObjective?.(text); say(s.say);
  a.routeT = 2.5; refreshRoute();
}
function nextStep() {
  const a = M.active; if (!a) return; const s = a.step;
  if (s) {
    if (s.type === 'goto') { G.fx?.sparks?.(_f.set(tgt.x, gy(tgt.x, tgt.z) + 1.2, tgt.z)); G.audio?.play?.(s.pay ? 'loot' : 'ui_select'); }
    if (s.pay) { G.player?.addMoney?.(s.pay); G.fx?.moneyPop?.(_f.set(tgt.x, 1.8, tgt.z), s.pay); }
    if (s.done) say(s.done);
  }
  clearItems();
  beginStep(a.stepIndex + 1);
}
function updateMission(dt) {
  const a = M.active, s = a.step; if (!s) return;
  const m = a.mission; a.elapsed += dt; a.hintCd -= dt;
  if (a.timeLeft != null) {
    a.timeLeft -= dt; const sec = Math.ceil(a.timeLeft);
    if (sec !== a.lastSec) { a.lastSec = sec; G.hud?.timer?.(Math.max(0, sec)); if (sec <= 5 && sec > 0) G.audio?.play?.('ui_select', { volume: 0.5 }); }
    if (a.timeLeft <= 0) { fail(m.timeout || 'נגמר הזמן'); return; }
  }
  const sp = pveh ? Math.abs(pveh.speed || 0) : 0;
  if (m.fastLine && !a.fastSaid && sp > 26 && a.stepIndex >= (m.crashFrom || 0)) { a.fastSaid = true; G.hud?.subtitle?.(m.fastLine[0], m.fastLine[1], 2800); }
  if (s.type === 'vehicle') {
    if (!G.vehicles || (pveh && (s.any || !s.vtype || pveh.type === s.vtype))) { nextStep(); return; }
    const v = a.veh;
    if (v && !v.destroyed && v.pos && (!v.driver || v.driver === 'player')) setTarget(v.pos.x, v.pos.z);
    else if ((a.hold += dt) > 1.5) { a.hold = 0; a.veh = ensureVehicle(s.vtype); }
  } else if (s.type === 'goto') {
    const d = Math.hypot(px - tgt.x, pz - tgt.z), r = s.r || 5;
    if (d < r && (!s.needVeh || pveh)) {
      if (!s.stop || sp < 2) { nextStep(); return; }
      if (a.hintCd <= 0) { a.hintCd = 2.5; G.hud?.toast?.('לעצור לגמרי! בלמים זה לא המלצה', 1800); }
    }
  } else if (s.type === 'collect') {
    const it = a.items || [];
    for (let i = 0; i < it.length; i++) {
      const q = it[i]; if (q.done) continue;
      animBeacon(q.b, i * 1.3);
      if (!pveh && Math.hypot(px - q.x, pz - q.z) < 2.6) {
        q.done = true; q.b.visible = false; a.got++; G.hud?.removeBlip?.('m_item_' + i);
        G.audio?.play?.('loot'); G.fx?.sparks?.(_f.set(q.x, 1.2, q.z));
        G.hud?.setObjective?.(s.text + ' (' + a.got + '/' + it.length + ')');
        if (a.got >= it.length) { nextStep(); return; }
      } else if (pveh && a.hintCd <= 0 && Math.hypot(px - q.x, pz - q.z) < 6) { a.hintCd = 4; G.hud?.toast?.('צא מהרכב (F). חבילות אוספים ברגל', 2200); }
    }
  } else if (s.type === 'wanted') {
    if (!G.wanted || (G.wanted.level || 0) >= s.level) { G.hud?.toast?.('וואו. עכשיו כולם מכירים אותך', 2200); nextStep(); return; }
  } else if (s.type === 'escape') {
    if (!G.wanted || !(G.wanted.level > 0)) { nextStep(); return; }
  }
  if (dest.visible) animBeacon(dest, 0);
  if ((a.routeT -= dt) <= 0) { a.routeT = 2.5; refreshRoute(); }
}

// ---------------------------------------------------------------- start markers
let prompting = false, padY = false, hintT = -1;
function promptOff() { if (prompting) { G.hud?.prompt?.(null); prompting = false; } }
function ePressed() {
  const inp = G.input; if (!inp) return false;
  const y = !!inp.padDown?.(3), edge = y && !padY; padY = y;
  return edge || !!inp.pressed?.('KeyE');
}
function updateMarkers() {
  let near = null; const r = pveh ? 6.5 : 3.8;
  for (let i = 0; i < M.list.length; i++) {
    const m = M.list[i]; if (!m.avail || !m.marker) continue;
    animBeacon(m.marker, i * 0.9);
    if (Math.hypot(px - m.pos.x, pz - m.pos.z) < r) near = m;
  }
  const e = ePressed();
  if (near) { G.hud?.prompt?.(near.promptText); prompting = true; if (e) start(near.id); }
  else promptOff();
}

// ---------------------------------------------------------------- pickups
const pickups = [], dynCash = []; let dynI = 0;
const KIND = ['cash', 'hummus', 'cash', 'hummus', 'cash', 'ammo', 'cash', 'hummus', 'cash', 'armor'];
function initPickups() {
  const defs = [['cash', new THREE.BoxGeometry(0.6, 0.24, 0.34), 0x2bff6e, 54], ['hummus', new THREE.CylinderGeometry(0.4, 0.27, 0.15, 14), 0xffb84a, 18],
    ['ammo', new THREE.BoxGeometry(0.36, 0.3, 0.36), 0xff6a2a, 6], ['armor', new THREE.OctahedronGeometry(0.38), 0x4aa8ff, 6]];
  const meshes = {};
  for (const [k, geo, color, cap] of defs) {
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.6, roughness: 0.4, metalness: 0.1 });
    const im = new THREE.InstancedMesh(geo, mat, cap); im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.frustumCulled = false;
    for (let i = 0; i < cap; i++) im.setMatrixAt(i, _zero);
    im.userData.n = 0; G.scene.add(im); meshes[k] = im;
  }
  const add = (kind, x, z, amount, alive) => {
    const im = meshes[kind]; if (im.userData.n >= im.count) return null;
    const p = { kind, im, idx: im.userData.n++, x, z, y: gy(x, z) + 0.9, amount, alive, respawn: 0, ttl: 0, dyn: false, ph: pickups.length * 1.7 };
    pickups.push(p); return p;
  };
  const r = rng(20261123), b = bounds(), sp = G.world?.spawn || { x: 0, z: 0 };
  for (let i = 0; i < 60; i++) {
    let pt = null;
    for (let t = 0; t < 30 && !pt; t++) {
      let x, z;
      if (i < 10) { const a = r() * 6.283, d = 10 + r() * 50; x = sp.x + Math.sin(a) * d; z = sp.z + Math.cos(a) * d; }
      else { x = b.minX + r() * (b.maxX - b.minX); z = b.minZ + r() * (b.maxZ - b.minZ); }
      if (okPoint(x, z, 1.2)) pt = { x, z };
    }
    if (pt) add(KIND[i % 10], pt.x, pt.z, 50 + ((r() * 6) | 0) * 25, true);
  }
  for (let i = 0; i < 24; i++) { const p = add('cash', 0, 0, 0, false); if (p) { p.dyn = true; dynCash.push(p); } }
}
function hidePickup(p) { p.alive = false; p.im.setMatrixAt(p.idx, _zero); p.im.instanceMatrix.needsUpdate = true; }
function collect(p) {
  const pl = G.player;
  if (p.kind === 'cash') { pl?.addMoney?.(p.amount); G.hud?.toast?.('+₪' + p.amount + ' מצאת כסף. אל תספר למס הכנסה', 1800); G.fx?.moneyPop?.(_f.set(p.x, p.y, p.z), p.amount); M.stats.cash += p.amount; }
  else if (p.kind === 'hummus') { pl?.heal?.(40); G.hud?.toast?.('חומוס חם! +40 בריאות', 1800); }
  else if (p.kind === 'ammo') { pl?.giveWeapon?.('pistol', 24); G.hud?.toast?.('תחמושת. רק לשימוש אחראי, כן?', 1800); }
  else if (pl) { pl.armor = Math.min(100, (pl.armor || 0) + 50); G.hud?.toast?.('שכפ"ץ! +50 מגן', 1800); }
  G.audio?.play?.('loot'); M.stats.pickups++;
  hidePickup(p); p.respawn = p.dyn ? 0 : 150;
}
function updatePickups(dt) {
  const cr = pveh ? 3.2 : 1.7, cr2 = cr * cr, can = G.player?.alive !== false;
  for (let i = 0; i < pickups.length; i++) {
    const p = pickups[i];
    if (!p.alive) { if (p.respawn > 0 && (p.respawn -= dt) <= 0) p.alive = true; continue; }
    if (p.dyn && (p.ttl -= dt) <= 0) { hidePickup(p); continue; }
    const dx = p.x - px, dz = p.z - pz, d2 = dx * dx + dz * dz;
    if (d2 > 22500) continue;
    if (d2 < cr2 && can && !(p.dyn && p.ttl > 59.4)) { collect(p); continue; }
    _dummy.position.set(p.x, p.y + Math.sin(T * 2.4 + p.ph) * 0.18, p.z);
    _dummy.rotation.set(0, T * 1.8 + p.ph, p.kind === 'cash' ? 0.35 : 0);
    _dummy.scale.setScalar(1.3); _dummy.updateMatrix();
    p.im.setMatrixAt(p.idx, _dummy.matrix); p.im.instanceMatrix.needsUpdate = true;
  }
}
function dropCash(pos, amount) {
  if (!dynCash.length || !pos) return null;
  const p = dynCash[dynI]; dynI = (dynI + 1) % dynCash.length;
  p.x = pos.x + (Math.random() - 0.5) * 1.2; p.z = pos.z + (Math.random() - 0.5) * 1.2; p.y = gy(p.x, p.z) + 0.8;
  p.amount = Math.max(1, Math.round(amount || 20)); p.alive = true; p.ttl = 60;
  return p;
}

// ---------------------------------------------------------------- side activities
const st = { fast: 0, air: 0, base: 9, drift: 0, cool: 0, nmT: 0, nmPend: 0, veh: null };
let crashT = -9, lastDistrict = null, distT = 0, saveT = 20;
function bonus(label, amount) {
  G.hud?.toast?.(label + ' +₪' + amount, 1800); G.player?.addMoney?.(amount); G.audio?.play?.('ui_select', { volume: 0.6 });
  M.stats.stunts++; M.stats.stuntMoney += amount; st.cool = 3;
}
function updateStunts(dt) {
  const v = pveh; if (!v || !v.pos) { st.fast = st.air = st.drift = 0; st.veh = null; return; }
  if (st.veh !== v) { st.veh = v; st.base = 9; st.fast = st.air = st.drift = 0; }
  const sp = Math.abs(v.speed || 0); st.cool -= dt;
  M.stats.distance += sp * dt; if (sp > M.stats.topSpeed) M.stats.topSpeed = Math.round(sp);
  if (sp > 30) { st.fast += dt; if (st.fast > 2.5 && st.cool <= 0) { st.fast = 0; bonus('טיל יבשתי! מהירות שיא', 40); } } else st.fast = 0;
  const h = v.pos.y - gy(v.pos.x, v.pos.z); if (h < st.base) st.base = h;
  if (h - st.base > 0.8) st.air += dt; else { if (st.air > 0.6) bonus('זמן אוויר! הבולענים מוסרים ד"ש', Math.min(200, Math.round(st.air * 80))); st.air = 0; }
  if (v.vel && sp > 9) {
    const lat = Math.abs(v.vel.x * Math.cos(v.heading || 0) - v.vel.z * Math.sin(v.heading || 0));
    if (lat > 5) { st.drift += dt; if (st.drift > 1.1 && st.cool <= 0) { st.drift = 0; bonus('דריפט! הצמיגים בוכים', 30); } } else st.drift = 0;
  }
  if (st.nmPend > 0 && (st.nmPend -= dt) <= 0) { if (T - crashT > 1 && st.cool <= 0) bonus('כמעט! עבר בשערה', 15); }
  if ((st.nmT -= dt) <= 0 && sp > 14 && st.nmPend <= 0 && st.cool <= 0) {
    st.nmT = 0.12; const l = G.vehicles?.list;
    if (l) for (let i = 0; i < l.length; i++) { const o = l[i]; if (o === v || !o.pos || Math.abs(o.speed || 0) < 2) continue; const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z; if (dx * dx + dz * dz < 11) { st.nmPend = 0.6; break; } }
  }
}
const fare = { state: 0, x: 0, z: 0, cd: 6, pay: 0 };
function endFare() { if (fare.state) { fare.state = 0; fare.cd = 8; if (fareBeacon) fareBeacon.visible = false; G.hud?.removeBlip?.('m_fare'); } }
function fareGoto(p, label, icon) { fare.x = p.x; fare.z = p.z; styleBeacon(fareBeacon, C_FARE, icon); placeBeacon(fareBeacon, p.x, p.z); G.hud?.addBlip?.('m_fare', { x: p.x, z: p.z, color: '#45b8ff', icon: 'dest', label }); }
function updateFares(dt) {
  const v = pveh;
  if (M.active || !v || v.type !== 'taxi' || !v.pos) { endFare(); return; }
  if (fare.state === 0) {
    if ((fare.cd -= dt) > 0) return; fare.cd = 5;
    const p = safe(() => G.world.randomRoadPoint(v.pos, 50, 140)); if (!p) return;
    fare.state = 1; fareGoto(p, 'נוסע מחכה', '🙋'); G.hud?.toast?.('נוסע מנופף למונית! סע לסמן הכחול', 2600);
    return;
  }
  animBeacon(fareBeacon, 2);
  if (Math.hypot(px - fare.x, pz - fare.z) > 7 || Math.abs(v.speed || 0) > 3) return;
  if (fare.state === 1) {
    const p = safe(() => G.world.randomRoadPoint(v.pos, 150, 320)); if (!p) { endFare(); return; }
    fare.pay = 30 + Math.round(Math.hypot(p.x - px, p.z - pz) * 0.4); fare.state = 2; fareGoto(p, 'יעד הנסיעה', '📍');
    G.hud?.subtitle?.('נוסע', G.pick(['בלי מונה? סבבה, גם ככה אני בלי מזומן.', 'תעשה דרך הים, יש לי זמן ואין לי חיים.', 'אפשר מזגן? ורדיו? ושקט?']), 2800);
  } else {
    const pay = fare.pay; endFare(); G.player?.addMoney?.(pay); G.audio?.play?.('loot'); G.fx?.moneyPop?.(_f.set(px, 1.8, pz), pay);
    G.hud?.toast?.('נסיעה הושלמה +₪' + pay + ' (טיפ: חיוך)', 2400); M.stats.fares++;
  }
}
function updateDistrict(dt) {
  if ((distT -= dt) > 0) return; distT = 0.6;
  const d = safe(() => G.world?.districtAt?.(px, pz));
  if (d && d !== lastDistrict) { lastDistrict = d; G.hud?.toast?.(String(d), 2600); G.hud?.announce?.(String(d)); }
}
function loadStats() {
  const base = { missionsDone: 0, missionsFailed: 0, cash: 0, pickups: 0, stunts: 0, stuntMoney: 0, fares: 0, crashes: 0, distance: 0, topSpeed: 0, playTime: 0 };
  try { Object.assign(base, JSON.parse(localStorage.getItem('tlv_stats') || '{}')); } catch { /* ignore */ }
  return base;
}
function saveStats() { try { localStorage.setItem('tlv_stats', JSON.stringify(M.stats)); } catch { /* ignore */ } }

// ---------------------------------------------------------------- module entry points
export async function init(_G) {
  M.stats = loadStats();
  G.missions = M;
  if (!G.scene) throw new Error('missions: no scene');
  colGeo = new THREE.CylinderGeometry(1.5, 1.5, 16, 24, 1, true); colGeo.translate(0, 8, 0);
  ringGeo = new THREE.TorusGeometry(2.3, 0.14, 6, 6); ringGeo.rotateX(Math.PI / 2);
  dest = makeBeacon(C_DEST, '⬇', 1.2); dest.visible = false;
  ringV = new THREE.Mesh(new THREE.TorusGeometry(4.6, 0.24, 8, 40), glowMat(0xffa63a, 0.95)); ringV.position.y = 4.4; ringV.visible = false; dest.add(ringV);
  fareBeacon = makeBeacon(C_FARE, '🙋', 1.1); fareBeacon.visible = false;
  spotMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 5.8), glowMat(C_DEST, 0.5)); spotMesh.rotation.x = -Math.PI / 2; spotMesh.visible = false; spotMesh.renderOrder = 5; G.scene.add(spotMesh);
  try { initPickups(); } catch (e) { console.warn('[missions] pickups failed', e); }
  try { buildMissions(); } catch (e) { console.warn('[missions] build failed', e); }
  refreshMarkers();
  G.events.on('ready', refreshMarkers);
  G.events.on('game:start', () => { refreshMarkers(); hintT = 2.5; });
  G.events.on('player:died', () => { if (M.active) fail('התעלפת באמצע. ככה לא בונים קריירה.'); endFare(); });
  G.events.on('vehicle:crash', (e) => {
    if (e?.vehicle && pveh && e.vehicle !== pveh) return;
    crashT = T; M.stats.crashes++;
    const a = M.active; if (!a) return; a.crashes++;
    const l = a.mission.crashLines;
    if (l && a.stepIndex >= (a.mission.crashFrom || 0) && T - a.lastTalk > 4) { a.lastTalk = T; const c = l[a.crashes % l.length]; G.hud?.subtitle?.(c[0], c[1], 2600); }
  });
  ready = true;
}

let hudSeen = false;
export function update(dt) {
  if (!ready || errCount > 30) return;
  try {
    T += dt; M.stats.playTime += dt;
    const p = G.player; pveh = p?.inVehicle || null;
    const pp = pveh?.pos || p?.pos; if (pp) { px = pp.x; pz = pp.z; }
    if (!hudSeen && G.hud) { hudSeen = true; refreshMarkers(); }
    updatePickups(dt);
    if (M.active) updateMission(dt); else updateMarkers();
    updateDialogue(dt);
    updateStunts(dt); updateFares(dt); updateDistrict(dt);
    if (hintT > 0 && (hintT -= dt) <= 0 && !M.active && M.list[0]?.avail) {
      const m = M.list[0];
      G.hud?.setObjective?.('גש לעמוד האור הצהוב כדי להתחיל: ' + m.title);
      G.hud?.setRoute?.([{ x: px, z: pz }, { x: m.pos.x, z: m.pos.z }]);
    }
    if ((saveT -= dt) <= 0) { saveT = 20; saveStats(); }
  } catch (e) { if (errCount++ < 5) console.error('[missions] update', e); }
}
