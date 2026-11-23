// ai.js - "talk to the city": natural-language accessibility assistant (text + voice),
// role-play chat with any pedestrian, and live AI news flashes. Talks to POST /api/ai (server-side key).
// Everything degrades to an offline keyword fallback so the demo never breaks.
import { G } from './core.js';

const API = '/api/ai', TIMEOUT = 12000, MAX_TOK = 300;
const ai = { navTarget: null, isOpen: false, online: null, get busy() { return pending > 0; } };
let pending = 0, mode = 'assist', npc = null, rec = null, vDown = 0, wantSpeak = false;
let bar, input, logEl, titleEl, chip, micBtn, sugEl, sayEl, sayTimer = 0;
let navPts = [], navIdx = 0, navT = 0, iSetAssist = false, nodeMap = null;
let chkT = 0, nearActor = null, chipShown = false, lastNews = -30000, newsBusy = false;
const hist = [], evlog = [], chars = new WeakMap();
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const now = () => performance.now();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const safe = (fn) => { try { return fn(); } catch { return null; } };
const pos = () => { const p = G.player, v = p && p.inVehicle; return (v && v.pos) || (p && p.pos) || { x: 0, y: 0, z: 0 }; };
const hourStr = () => { const h = G.sky?.hour ?? 12; return `${Math.floor(h)}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`; };

const VEH_HE = { taxi: 'מונית', roadster: 'מכונית ספורט', van: 'ואן', pickup: 'טנדר', police: 'ניידת משטרה', scooter: 'קטנוע', sportbike: 'אופנוע ספורט', policebike: 'אופנוע משטרתי', courier: 'קטנוע שליחים' };
const CRIME_HE = { hit_ped: 'פגע בהולך רגל', kill_ped: 'חיסל הולך רגל', shoot: 'ירה באמצע הרחוב', carjack: 'חטף רכב', hit_car: 'נכנס ברכב אחר', hit_cop: 'תקף שוטר', kill_cop: 'חיסל שוטר', speeding: 'דהר במהירות מופרזת' };
const SETTING_HE = { highContrast: 'ניגודיות גבוהה', colorblind: 'מצב עיוורון צבעים', textScale: 'גודל טקסט', subtitles: 'כתוביות', screenReader: 'קורא מסך', reducedMotion: 'הפחתת תנועה', gameSpeed: 'מהירות המשחק', driveAssist: 'נהיגה אוטומטית', aimAssist: 'עזרת כיוון', oneHanded: 'מצב יד אחת', holdToToggle: 'לחיצה במקום החזקה', invincible: 'מצב סיפור בלי נזק', masterVolume: 'עוצמה כללית', musicVolume: 'עוצמת מוזיקה', sfxVolume: 'עוצמת אפקטים', quality: 'איכות גרפיקה', language: 'שפה' };
const ALIAS = { azrieli: ['עזריאלי'], dizengoff: ['דיזנגוף', 'דיזינגוף'], rothschild: ['רוטשילד'], beach: ['חוף', 'טיילת', 'לים'], jaffa: ['יפו'], carmel: ['כרמל', 'שוק'], port: ['נמל'], sarona: ['שרונה'], habima: ['הבימה'], florentin: ['פלורנטין'] };
const PERSONAS = [
  ['נועה', 'הייטקיסטית משרונה, מדברת בבאזוורדס ותמיד בין שתי פגישות'], ['יובל', 'גולש מהחוף, רגוע, הכול אצלו "אחי" ו"גלים"'],
  ['שמעון', 'בעל דוכן פלאפל בשוק הכרמל, גאה בטחינה שלו ומחלק עצות לחיים'], ['סבתא רחל', 'סבתא מרחוב בן יהודה, דואגת שאכלת, ביקורתית באהבה'],
  ['אבי', 'פקח חניה עירוני, אוהב דוחות וחשדן כלפי כולם'], ['דנה', 'מדריכת תיירים נלהבת, כל פינה אצלה היא "היסטוריה"'],
  ['עומר', "די-ג'יי מפלורנטין, ער מאתמול, מדבר רק על הסט הבא"], ['מיכל', 'מאמנת יוגה מהטיילת, נושמת עמוק ושיפוטית בשקט'],
  ['חיים', 'נהג מונית ותיק, יש לו דעה על הכול ובעיקר על פקקים'], ['תמר', 'סטודנטית לאמנות על קורקינט, צינית וממהרת'],
  ['בוריס', 'שחמטאי מהגינה, פילוסוף, מדבר במשלים'], ['ליאור', 'שליח אוכל על קטנוע, לחוץ בזמן ורעב בעצמו'],
];
const NPC_OFFLINE = ['וואלה, אין לי זמן, אבל שיהיה לך אחלה יום.', 'אתה מפה? תיזהר בכביש, כולם פה נוהגים כמו משוגעים.', 'חם היום, אה? לך תשתה משהו קר.', 'סליחה, אני באמצע משהו. נדבר בשמחות.', 'תל אביב, מה אתה רוצה. יקר, רועש, ואי אפשר לעזוב.'];

// ---------------------------------------------------------------- backend
async function callAI(body) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.error || !Array.isArray(j.content)) throw new Error('ai ' + r.status);
    ai.online = true;   // content may start with a thinking block: always pick blocks by type
    return { text: j.content.filter((b) => b && b.type === 'text' && b.text).map((b) => b.text).join(' ').trim(), tools: j.content.filter((b) => b && b.type === 'tool_use') };
  } catch (e) { ai.online = false; throw e; } finally { clearTimeout(t); }
}

// ---------------------------------------------------------------- world helpers
function findLandmark(q) {
  const L = G.world?.landmarks || {}; if (q == null) return null; q = String(q).trim(); if (!q) return null;
  if (L[q]) return { key: q, ...L[q] };
  const low = q.toLowerCase();
  for (const k in L) if (low.includes(k.toLowerCase()) || (ALIAS[k] || []).some((a) => q.includes(a))) return { key: k, ...L[k] };
  for (const k in L) { const n = L[k]?.name; if (n && (q.includes(n) || (q.length > 2 && n.includes(q)))) return { key: k, ...L[k] }; }
  return null;
}
function nodeOf(n) {
  if (n && typeof n === 'object') return n;
  if (!nodeMap) { nodeMap = new Map(); for (const x of G.world?.roads?.nodes || []) nodeMap.set(x.id, x); }
  return nodeMap.get(n);
}
function buildRoute() {
  const t = ai.navTarget; if (!t) return;
  const p = pos(), w = G.world, mid = [];
  try {
    const a = w.nearestNode(p.x, p.z), b = w.nearestNode(t.x, t.z);
    for (const id of (a && b && w.path(a.id, b.id)) || []) { const n = nodeOf(id); if (n) mid.push({ x: n.x, z: n.z }); }
    // already past the first node (we are on the segment toward the second): do not drive back to it
    if (mid.length > 1 && Math.hypot(p.x - mid[1].x, p.z - mid[1].z) < Math.hypot(mid[0].x - mid[1].x, mid[0].z - mid[1].z)) mid.shift();
  } catch { /* straight line */ }
  navPts = [{ x: p.x, z: p.z }, ...mid, { x: t.x, z: t.z }]; navIdx = Math.min(1, navPts.length - 1);
  G.hud?.setRoute?.(navPts);
}
function startNav(t) {
  ai.navTarget = { x: t.x, z: t.z, name: t.name || 'היעד' };
  buildRoute(); navT = 3;
  G.hud?.addBlip?.('ai-target', { x: t.x, z: t.z, color: '#ffd23f', icon: 'target', label: ai.navTarget.name });
  engageAssist();
}
function engageAssist() {
  const v = G.player?.inVehicle; if (!v || !ai.navTarget) return;
  v.target = navPts[navIdx] || ai.navTarget;
  if (!G.settings.driveAssist) { G.setSetting('driveAssist', true); iSetAssist = true; }
}
function endNav(arrived) {
  const t = ai.navTarget; if (!t) return;
  ai.navTarget = null; navPts = [];
  G.hud?.setRoute?.(null); G.hud?.removeBlip?.('ai-target');
  const v = G.player?.inVehicle; if (v) v.target = null;
  if (iSetAssist) { iSetAssist = false; G.setSetting('driveAssist', false); }
  if (arrived) say(`הגעת ל${t.name}. יאללה, בילוי נעים.`);
}
function relDir(dx, dz, h) {
  const f = dx * Math.sin(h) + dz * Math.cos(h), r = -dx * Math.cos(h) + dz * Math.sin(h);
  const a = Math.atan2(r, f) * 180 / Math.PI, A = Math.abs(a), side = a > 0 ? 'ימין' : 'שמאל';
  return A < 25 ? 'ישר מלפנים' : A < 65 ? 'מלפנים מ' + side : A < 115 ? 'מ' + side : A < 155 ? 'מאחור מ' + side : 'מאחור';
}
function compass(dx, dz) {
  const i = Math.round(Math.atan2(dx, -dz) * 180 / Math.PI / 45);
  return ['צפון', 'צפון-מזרח', 'מזרח', 'דרום-מזרח', 'דרום', 'דרום-מערב', 'מערב', 'צפון-מערב'][((i % 8) + 8) % 8];
}
function describe() {
  const p = pos(), pl = G.player, w = G.world, own = pl?.inVehicle, h = own?.heading ?? pl?.heading ?? 0, out = [];
  const d = safe(() => w.districtAt(p.x, p.z)), s = safe(() => w.streetAt(p.x, p.z)), surf = safe(() => w.surfaceAt(p.x, p.z));
  const SURF = { road: 'על הכביש', sidewalk: 'על המדרכה', plaza: 'בכיכר', grass: 'על הדשא', sand: 'על החול', water: 'במים' };
  out.push(`אתה ב${d || 'תל אביב'}${s ? ', ליד רחוב ' + s : ''}, ${own ? 'נוהג ב' + (VEH_HE[own.type] || 'רכב') : 'הולך ברגל ' + (SURF[surf] || '')}. השעה ${hourStr()}, ${G.sky?.isNight ? 'לילה' : 'יום'}.`);
  const near = (list, max, ok) => list.filter((o) => o && o.pos && ok(o)).map((o) => ({ o, dx: o.pos.x - p.x, dz: o.pos.z - p.z })).map((e) => ((e.d = Math.hypot(e.dx, e.dz)), e)).filter((e) => e.d < max).sort((a, b) => a.d - b.d);
  const vs = near(G.vehicles?.list || [], 45, (v) => v !== own && !v.destroyed && !v.isPolice).slice(0, 3);
  if (vs.length) out.push('רכבים: ' + vs.map((e) => `${VEH_HE[e.o.type] || 'רכב'} ${relDir(e.dx, e.dz, h)} במרחק ${Math.round(e.d)} מטר${Math.abs(e.o.speed || 0) > 2 ? ' בתנועה' : ''}`).join('; ') + '.');
  else out.push('אין רכבים קרובים.');
  const peds = near(G.actors || [], 25, (a) => a.alive && a.kind === 'ped');
  if (peds.length) out.push(`${peds.length} הולכי רגל בסביבה, הקרוב ${relDir(peds[0].dx, peds[0].dz, h)} במרחק ${Math.round(peds[0].d)} מטר.`);
  const cops = near(G.actors || [], 70, (a) => a.alive && a.kind === 'cop').concat(near(G.vehicles?.list || [], 90, (v) => v !== own && v.isPolice && !v.destroyed)).sort((a, b) => a.d - b.d);
  if (cops.length) out.push(`משטרה ${relDir(cops[0].dx, cops[0].dz, h)} במרחק ${Math.round(cops[0].d)} מטר.`);
  if ((G.wanted?.level || 0) > 0) out.push(`המשטרה מחפשת אותך, רמת בלגן ${G.wanted.level} מתוך 5.`);
  let best = null;
  for (const k in w?.landmarks || {}) { const L = w.landmarks[k], dd = Math.hypot(L.x - p.x, L.z - p.z); if (!best || dd < best.d) best = { L, d: dd }; }
  if (best) out.push(`ציון הדרך הקרוב: ${best.L.name}, ${Math.round(best.d)} מטר לכיוון ${compass(best.L.x - p.x, best.L.z - p.z)}.`);
  if (w?.seaX != null && p.x - w.seaX < 80) out.push('הים ממש קרוב, ממערב.');
  if (ai.navTarget) out.push(`מנווטים אל ${ai.navTarget.name}, עוד ${Math.round(Math.hypot(ai.navTarget.x - p.x, ai.navTarget.z - p.z))} מטר.`);
  return out.join(' ');
}
function setSetting(key, value) {
  if (!(key in G.settings)) return `אין הגדרה בשם ${key}.`;
  const cur = G.settings[key]; let v = value;
  if (typeof cur === 'boolean') v = v === true || /^(true|on|1|yes|כן)$/i.test(String(v));
  else if (typeof cur === 'number') {
    v = Number(v); if (!isFinite(v)) return 'הערך לא תקין.';
    v = key === 'textScale' ? clamp(v, 1, 2) : key === 'gameSpeed' ? clamp(v, 0.5, 1) : /Volume$/.test(key) ? clamp(v, 0, 1) : v;
  } else v = String(v);
  G.setSetting(key, v);
  return `${SETTING_HE[key] || key}: ${typeof v === 'boolean' ? (v ? 'פעיל' : 'כבוי') : v}.`;
}

// ---------------------------------------------------------------- tools (executed locally)
const IMPL = {
  navigate_to(a) {
    if (a.cancel) { endNav(false); return 'ביטלתי את הניווט.'; }
    const lm = findLandmark(a.landmark_key) || (isFinite(a.x) && isFinite(a.z) && a.x != null ? { x: +a.x, z: +a.z, name: 'הנקודה שביקשת' } : null);
    if (!lm) return 'לא מצאתי את היעד הזה.';
    startNav(lm);
    return G.player?.inVehicle ? `נוסעים ל${lm.name}, הרכב נוהג בעצמו. רק תחזיק W.` : `סימנתי מסלול ל${lm.name} במפה. תיכנס לרכב ואני אנהג בשבילך.`;
  },
  set_setting: (a) => setSetting(String(a.key), a.value),
  set_time(a) { const h = ((Number(a.hour) % 24) + 24) % 24; if (!isFinite(h) || !G.sky?.setHour) return 'השעון לא זמין.'; G.sky.setHour(h); return `השעה עכשיו ${hourStr()}.`; },
  radio(a) {
    const r = G.audio?.radio, act = ['next', 'prev', 'off'].includes(a.action) ? a.action : 'next';
    if (!r || typeof r[act] !== 'function') return 'הרדיו לא זמין כרגע.';
    r[act](); const c = r.current, n = typeof c === 'string' ? c : c?.name || c?.title || '';
    return act === 'off' ? 'כיביתי את הרדיו.' : `החלפתי תחנה${n ? ': ' + n : ''}.`;
  },
  spawn_vehicle(a) {
    const type = VEH_HE[a.type] ? a.type : 'roadster', p = pos(), pl = G.player;
    let r = safe(() => G.world.randomRoadPoint(p, 5, 22));
    if (!r || Math.hypot(r.x - p.x, r.z - p.z) > 60) r = { x: p.x + 4, z: p.z + 2, heading: pl?.heading || 0 };
    const v = safe(() => G.vehicles.spawn(type, r.x, r.z, r.heading || 0, { ai: 'parked' }));
    if (!v) return 'לא הצלחתי להביא רכב.';
    G.hud?.addBlip?.('ai-car', { x: r.x, z: r.z, color: '#4de1ff', icon: 'car', label: VEH_HE[type], follow: v });
    return `${VEH_HE[type]} מחכה לך ${relDir(r.x - p.x, r.z - p.z, pl?.heading || 0)}, ${Math.round(Math.hypot(r.x - p.x, r.z - p.z))} מטר. F כדי להיכנס.`;
  },
  teleport(a) {
    const lm = findLandmark(a.landmark_key), pl = G.player, v = pl?.inVehicle; if (!lm || !pl) return 'לא מכיר את המקום הזה.';
    const ok = (r) => (r && Math.hypot(r.x - lm.x, r.z - lm.z) < 90 ? r : lm);
    if (v) { const r = ok(safe(() => G.world.randomRoadPoint(lm, 0, 40))); v.pos.x = r.x; v.pos.z = r.z; if (r.heading != null) v.heading = r.heading; v.speed = 0; v.vel?.set?.(0, 0, 0); }
    else { const r = ok(safe(() => G.world.randomSidewalkPoint(lm, 0, 25))); pl.teleport?.(r.x, r.z, r.heading); }
    if (ai.navTarget) buildRoute();
    return `הופ, אתה ב${lm.name}.`;
  },
  start_mission(a) {
    const list = G.missions?.list || [], q = String(a.id ?? '');
    const m = list.find((x) => String(x.id) === q) || list.find((x) => (x.title || '').includes(q));
    if (!G.missions?.start) return 'אין משימות זמינות כרגע.';
    G.missions.start(m ? m.id : a.id); return `מתחילים${m?.title ? ': ' + m.title : ' משימה'}.`;
  },
  describe_surroundings() { wantSpeak = true; return describe(); },
  heal() { G.player?.heal?.(100); return 'טיפלתי בך, אתה כמו חדש.'; },
  clear_wanted() { G.wanted?.clear?.(); return 'סידרתי עם המשטרה, אתה נקי.'; },
};
const runTool = (name, args) => { try { return IMPL[name] ? IMPL[name](args || {}) : ''; } catch (e) { console.warn('[ai] tool', name, e); return 'זה לא הצליח הפעם.'; } };
const T = (name, description, properties = {}, required = []) => ({ name, description, input_schema: { type: 'object', properties, required } });
const str = { type: 'string' }, num = { type: 'number' };
const TOOLS = [
  T('navigate_to', 'ניווט GPS ליעד (landmark_key או x,z). אם השחקן ברכב, הרכב נוסע לשם לבד. cancel=true מבטל ניווט.', { landmark_key: str, x: num, z: num, cancel: { type: 'boolean' } }),
  T('set_setting', 'שינוי הגדרת משחק או נגישות', { key: str, value: { description: 'boolean | number | string' } }, ['key', 'value']),
  T('set_time', 'קביעת שעת היום במשחק', { hour: { type: 'number', description: '0-24' } }, ['hour']),
  T('radio', 'שליטה ברדיו', { action: { type: 'string', enum: ['next', 'prev', 'off'] } }, ['action']),
  T('spawn_vehicle', 'הבאת רכב ליד השחקן', { type: { type: 'string', enum: Object.keys(VEH_HE) } }, ['type']),
  T('teleport', 'שיגור מיידי לציון דרך', { landmark_key: str }, ['landmark_key']),
  T('start_mission', 'התחלת משימה לפי id', { id: str }, ['id']),
  T('describe_surroundings', 'תיאור קולי של הסביבה לשחקן שלא רואה את המסך'),
  T('heal', 'ריפוי מלא של השחקן'), T('clear_wanted', 'איפוס רמת הבלגן מול המשטרה'),
];
const SYS = 'אתה "העוזר" - עוזר הנגישות בתוך המשחק TLV NONSTOP (עולם פתוח בתל אביב). השחקן מדבר איתך בשפה חופשית, בהקלדה או בקול, במקום לשלוט במקשים. בצע את הבקשה בעזרת הכלים (אפשר כמה כלים יחד, בקריאה אחת) וצרף תמיד משפט אחד קצר בעברית, חם ועם קריצה תל-אביבית, שמאשר מה עשית. לתיאור הסביבה קרא ל-describe_surroundings: התיאור יוקרא לשחקן אוטומטית, אל תמציא אותו בעצמך. השתמש רק במפתחות שמופיעים במצב. אם אין כלי מתאים, אמור זאת בקצרה.';
function stateText() {
  const p = pos(), pl = G.player, w = G.world, act = G.missions?.active;
  const lm = Object.entries(w?.landmarks || {}).map(([k, v]) => `${k}=${v.name}`).join(', ');
  const ms = (G.missions?.list || []).slice(0, 10).map((m) => `${m.id}=${m.title || ''}`).join(', ');
  return `מצב: מיקום x=${Math.round(p.x)}, z=${Math.round(p.z)} (מזרח=+x, דרום=+z), שכונה: ${safe(() => w.districtAt(p.x, p.z)) || '?'}, רחוב: ${safe(() => w.streetAt(p.x, p.z)) || '?'}, ${pl?.inVehicle ? 'ברכב (' + pl.inVehicle.type + ')' : 'ברגל'}, בריאות ${Math.round(pl?.health ?? 100)}, כסף ${pl?.money ?? 0}, רמת בלגן ${G.wanted?.level ?? 0}/5, שעה ${hourStr()}, משימה פעילה: ${act ? (typeof act === 'object' ? act.title || act.id : act) : 'אין'}.
ציוני דרך (key=שם): ${lm || 'אין'}.
משימות (id=שם): ${ms || 'אין'}.
הגדרות: ${JSON.stringify(G.settings)}. ערכים: textScale 1|1.25|1.5|2, gameSpeed 1|0.75|0.5, colorblind off|protan|deutan|tritan, quality low|medium|high, עוצמות 0..1, השאר true/false.`;
}

// ---------------------------------------------------------------- assistant
function offline(q) {
  const has = (...w) => w.some((x) => q.includes(x)), neg = has('בטל', 'כבה', 'תכבה', 'בלי', 'תפסיק'), lm = findLandmark(q);
  if (has('תאר', 'מה סביבי', 'מה מסביב', 'איפה אני', 'מה יש פה', 'מה קורה')) return IMPL.describe_surroundings();
  if (has('בטל ניווט', 'עצור ניווט')) return IMPL.navigate_to({ cancel: true });
  if (lm && has('שגר', 'טלפורט', 'תעביר', 'קפוץ')) return IMPL.teleport({ landmark_key: lm.key });
  if (lm) return IMPL.navigate_to({ landmark_key: lm.key });
  if (has('ניגודיות')) return setSetting('highContrast', !neg);
  if (has('טקסט', 'גופן', 'אותיות', 'כתב')) return setSetting('textScale', has('הקטן', 'תקטין', 'קטן') ? 1 : Math.min(2, (G.settings.textScale || 1) + 0.5));
  if (has('תאט', 'לאט', 'האט')) return setSetting('gameSpeed', 0.5);
  if (has('מהירות רגילה', 'תאיץ', 'מהר יותר')) return setSetting('gameSpeed', 1);
  if (has('כתוביות')) return setSetting('subtitles', !neg);
  if (has('קורא מסך', 'הקראה', 'תקריא')) return setSetting('screenReader', !neg);
  if (has('נהיגה אוטומטית', 'תנהג', 'סע לבד')) return setSetting('driveAssist', !neg);
  if (has('מצב סיפור', 'נזק', 'אלמוות')) return setSetting('invincible', true);
  if (has('לילה')) return IMPL.set_time({ hour: 22 });
  if (has('בוקר')) return IMPL.set_time({ hour: 8 });
  if (has('צהריים')) return IMPL.set_time({ hour: 13 });
  if (has('שקיעה', 'ערב')) return IMPL.set_time({ hour: 18.5 });
  if (has('רדיו', 'תחנה', 'מוזיקה', 'שיר')) return IMPL.radio({ action: neg ? 'off' : 'next' });
  if (has('מונית')) return IMPL.spawn_vehicle({ type: 'taxi' });
  if (has('קטנוע')) return IMPL.spawn_vehicle({ type: 'scooter' });
  if (has('אופנוע')) return IMPL.spawn_vehicle({ type: 'sportbike' });
  if (has('מכונית', 'רכב', 'אוטו')) return IMPL.spawn_vehicle({ type: 'roadster' });
  if (has('רפא', 'בריאות', 'חיים', 'כואב')) return IMPL.heal();
  if (has('משטרה', 'מבוקש', 'שוטרים')) return IMPL.clear_wanted();
  return 'אין לי קליטה לענן כרגע, אבל אני מבין פקודות פשוטות: "קח אותי לעזריאלי", "תאר מה סביבי", "תגדיל את הטקסט".';
}
async function ask(text) {
  text = String(text || '').trim(); if (!text) return '';
  pending++; refreshChip(); wantSpeak = false;
  let reply = '';
  try {
    const r = await callAI({ system: SYS + '\n' + stateText(), messages: [...hist, { role: 'user', content: text }], max_tokens: MAX_TOK, tools: TOOLS });
    if (!r.tools.length && !r.text) throw new Error('empty');
    const res = r.tools.map((t) => ({ n: t.name, s: runTool(t.name, t.input) })).filter((x) => x.s);
    const desc = res.filter((x) => x.n === 'describe_surroundings').map((x) => x.s).join(' ');
    reply = r.text ? (desc ? r.text + ' ' + desc : r.text) : res.map((x) => x.s).join(' ') || 'בוצע.';
  } catch (e) { reply = safe(() => offline(text)) || 'משהו השתבש, נסה שוב.'; }
  hist.push({ role: 'user', content: text }, { role: 'assistant', content: reply }); if (hist.length > 6) hist.splice(0, hist.length - 6);
  pending--; refreshChip(); say(reply, wantSpeak);
  return reply;
}
function say(text, forceSpeak) {
  const ms = clamp(3500 + text.length * 55, 4000, 14000);
  if (G.hud?.subtitle) G.hud.subtitle('העוזר', text, ms);
  else if (sayEl) { sayEl.textContent = 'העוזר: ' + text; sayEl.style.display = 'block'; clearTimeout(sayTimer); sayTimer = setTimeout(() => { sayEl.style.display = 'none'; }, ms); }
  G.hud?.announce?.(text);
  if (forceSpeak && !G.settings.screenReader) speak(text);   // blind players: surroundings are always read aloud
}
function speak(text) {
  try { const ss = window.speechSynthesis; if (!ss) return; ss.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'he-IL'; u.rate = 1.05; ss.speak(u); } catch { /* ignore */ }
}

// ---------------------------------------------------------------- talk to anyone
function findTalkTarget() {
  const pl = G.player; if (!pl || pl.inVehicle || !pl.pos) return null;
  const h = pl.heading || 0, fx = Math.sin(h), fz = Math.cos(h); let best = null, bd = 4;
  for (const a of G.actors) {
    if (!a || !a.alive || !a.pos || (a.kind !== 'ped' && a.kind !== 'cop')) continue;
    const dx = a.pos.x - pl.pos.x, dz = a.pos.z - pl.pos.z, d = Math.hypot(dx, dz);
    if (d > bd || (d > 1.5 && (dx * fx + dz * fz) / d < -0.1)) continue;
    best = a; bd = d;
  }
  return best;
}
function charOf(actor) {
  let c = chars.get(actor);
  if (!c) {
    const i = Math.max(0, G.actors.indexOf(actor));
    const [name, desc] = actor.kind === 'cop' ? [i % 2 ? 'השוטרת גלית' : 'השוטר אלון', 'שוטר סיור עייף עם הומור יבש, חושד בשחקן אבל מעדיף לסיים משמרת בשקט'] : PERSONAS[i % PERSONAS.length];
    c = { name, desc, hist: [], actor }; chars.set(actor, c);
  }
  return c;
}
const recentCrimes = () => evlog.filter((e) => e.crime && now() - e.t < 90000).map((e) => e.s).join(', ');
async function talk(text) {
  const c = npc; if (!c || !text) return;
  addLine('אתה', text); pending++; refreshChip();
  const p = pos(), crimes = recentCrimes();
  const sys = `אתה ${c.name}, ${c.desc}. אתה דמות במשחק העולם הפתוח TLV NONSTOP בתל אביב, ושחקן ניגש לדבר איתך ברחוב. ענה תמיד בדמות, ב-1 עד 2 משפטים קצרים בעברית מדוברת עם הומור תל-אביבי, בלי הוראות במה ובלי אימוג'י. מקום: ${safe(() => G.world.districtAt(p.x, p.z)) || 'תל אביב'}, רחוב ${safe(() => G.world.streetAt(p.x, p.z)) || '?'}. שעה ${hourStr()} (${G.sky?.isNight ? 'לילה' : 'יום'}). רמת בלגן בעיר בגלל השחקן: ${G.wanted?.level ?? 0}/5.${crimes ? ' ראית שהשחקן לפני רגע: ' + crimes + '.' : ''}`;
  let reply = '';
  try { reply = (await callAI({ system: sys, messages: [...c.hist, { role: 'user', content: text }], max_tokens: MAX_TOK })).text; } catch { /* offline line below */ }
  if (!reply) reply = crimes ? 'ראיתי מה עשית שם. אני לא ראיתי כלום, לא שמעתי כלום.' : NPC_OFFLINE[(c.hist.length / 2 + G.actors.indexOf(c.actor) + 7) % NPC_OFFLINE.length | 0];
  c.hist.push({ role: 'user', content: text }, { role: 'assistant', content: reply }); if (c.hist.length > 12) c.hist.splice(0, c.hist.length - 12);
  pending--; refreshChip();
  if (npc === c && ai.isOpen) addLine(c.name, reply);
  G.hud?.subtitle?.(c.name, reply, 6000);
  if (G.settings.screenReader) speak(reply);
}

// ---------------------------------------------------------------- news flashes
function logEvent(s, w, crime) {
  const last = evlog[evlog.length - 1];
  if (last && last.s === s && !last.used) { last.n++; last.w += w * 0.5; last.t = now(); }
  else { evlog.push({ s, w, n: 1, t: now(), crime: !!crime, used: false }); if (evlog.length > 14) evlog.shift(); }
}
async function newsFlash(items) {
  newsBusy = true; lastNews = now(); for (const e of items) e.used = true;
  const p = pos();
  try {
    const r = await callAI({
      system: 'אתה קריין המבזקים של תחנת הרדיו הבדיונית "חדשות נון-סטופ" בתל אביב. כתוב מבזק אחד בלבד: משפט אחד שנון בעברית, עד 20 מילים, על מה שעשה עכשיו "האלמוני" בעיר. בלי מירכאות, בלי אימוג\'י ובלי הקדמות.',
      messages: [{ role: 'user', content: `אירועים מהדקה האחרונה ב${safe(() => G.world.districtAt(p.x, p.z)) || 'תל אביב'}, שעה ${hourStr()}: ${items.map((e) => e.s + (e.n > 1 ? ' (x' + e.n + ')' : '')).join('; ')}. רמת בלגן: ${G.wanted?.level ?? 0}/5.` }],
      max_tokens: MAX_TOK,
    });
    if (r.text) { G.hud?.toast?.('📻 ' + r.text, 7000); G.hud?.caption?.('[רדיו - חדשות נון-סטופ] ' + r.text); }
  } catch { /* skip silently */ } finally { newsBusy = false; }
}

// ---------------------------------------------------------------- UI
const CSS = `
#ai-chip{position:fixed;bottom:8px;left:50%;transform:translateX(-50%);z-index:40;direction:rtl;padding:5px 14px;border-radius:999px;border:1px solid #ffffff44;background:#0b1224cc;color:#fff;font:600 calc(13px*var(--ai-s,1))/1.3 'Segoe UI','Heebo',Arial,sans-serif;pointer-events:auto;cursor:pointer;white-space:nowrap;display:none}
#ai-chip.busy{background:#7a5cff;border-color:#fff;animation:aipulse 1s infinite}
@keyframes aipulse{50%{opacity:.55}}
#ai-bar{position:fixed;bottom:44px;left:50%;transform:translateX(-50%);z-index:41;width:min(680px,92vw);direction:rtl;display:none;flex-direction:column;gap:8px;padding:12px;border-radius:16px;background:#0b1224ee;border:2px solid #7a5cff;color:#fff;font:calc(16px*var(--ai-s,1))/1.4 'Segoe UI','Heebo',Arial,sans-serif;pointer-events:auto;box-shadow:0 8px 40px #000a}
#ai-bar.open{display:flex}
#ai-bar.hc{background:#000;border-color:#ffe600;color:#ffe600}
#ai-title{font-weight:800;color:#ffb347}
#ai-log{max-height:26vh;overflow:auto;display:flex;flex-direction:column;gap:4px}
#ai-log:empty{display:none}
#ai-log div{padding:5px 10px;border-radius:10px;background:#ffffff14}
#ai-log div.me{background:#7a5cff55;align-self:flex-start}
#ai-row{display:flex;gap:8px}
#ai-input{flex:1;min-width:0;direction:rtl;padding:10px 14px;border-radius:10px;border:2px solid #ffffff55;background:#05070d;color:inherit;font:inherit;outline:none}
#ai-input:focus{border-color:#ffb347}
#ai-bar button{font:inherit;color:inherit;background:#ffffff1c;border:1px solid #ffffff55;border-radius:10px;padding:6px 12px;cursor:pointer}
#ai-bar button:focus-visible{outline:3px solid #ffb347}
#ai-mic.on{background:#ff3b5c;animation:aipulse .8s infinite}
#ai-sug{display:flex;flex-wrap:wrap;gap:6px}
#ai-sug button{font-size:.82em;border-radius:999px}
#ai-say{position:fixed;bottom:16%;left:50%;transform:translateX(-50%);z-index:40;direction:rtl;max-width:80vw;padding:8px 16px;border-radius:10px;background:#000c;color:#fff;font:calc(18px*var(--ai-s,1))/1.4 'Segoe UI',Arial,sans-serif;display:none}
@media (prefers-reduced-motion:reduce){#ai-chip.busy,#ai-mic.on{animation:none}}`;
const SUGGEST = ['קח אותי לעזריאלי', 'תאר מה יש סביבי', 'תגדיל את הטקסט', 'מצב ניגודיות גבוהה', 'תאט את המשחק', 'תביא לי מונית', 'תעשה לילה'];
function el(tag, id, parent, text) { const e = document.createElement(tag); if (id) e.id = id; if (text) e.textContent = text; (parent || document.body).appendChild(e); return e; }
function buildUI() {
  const host = document.getElementById('hud-root') || document.body;
  el('style', null, document.head).textContent = CSS;
  chip = el('div', 'ai-chip', host); chip.setAttribute('role', 'button'); chip.addEventListener('click', () => open());
  sayEl = el('div', 'ai-say', host);
  bar = el('div', 'ai-bar', host); bar.setAttribute('role', 'dialog'); bar.setAttribute('aria-label', 'שיחה עם העיר');
  titleEl = el('div', 'ai-title', bar);
  logEl = el('div', 'ai-log', bar); logEl.setAttribute('role', 'log'); logEl.setAttribute('aria-live', 'polite');
  const row = el('div', 'ai-row', bar);
  micBtn = el('button', 'ai-mic', row, '🎤'); micBtn.type = 'button'; micBtn.setAttribute('aria-label', 'דיבור בקול'); micBtn.title = 'V - דיבור'; micBtn.addEventListener('click', () => { listen(); input.focus(); });
  input = el('input', 'ai-input', row); input.type = 'text'; input.autocomplete = 'off'; input.maxLength = 200; input.placeholder = 'דבר איתי... למשל: קח אותי לעזריאלי'; input.setAttribute('aria-label', 'כתוב בקשה בשפה חופשית');
  const send = el('button', 'ai-send', row, 'שלח'); send.type = 'button'; send.addEventListener('click', submit);
  sugEl = el('div', 'ai-sug', bar);
  for (const s of SUGGEST) { const b = el('button', null, sugEl, s); b.type = 'button'; b.addEventListener('click', () => { input.value = s; submit(); }); }
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();   // keep game keys (core.js, hud menus) from seeing typed text
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); submit(); }
    else if (e.code === 'Escape') { e.preventDefault(); close(); }
    else if (e.code === 'KeyV' && vDown) e.preventDefault();
  });
  applySettings(); refreshChip();
}
function applySettings() {
  document.documentElement.style.setProperty('--ai-s', String(G.settings.textScale || 1));
  bar?.classList.toggle('hc', !!G.settings.highContrast);
}
function refreshChip() {
  if (!chip) return;
  chip.classList.toggle('busy', pending > 0);
  chip.textContent = pending > 0 ? 'חושב...' : nearActor ? `T - דבר עם ${charOf(nearActor).name}` : 'T - דבר עם העיר (AI)' + (SR ? ' · V - בקול' : '');
}
function addLine(who, text) {
  if (!logEl) return; const d = el('div', null, logEl, `${who}: ${text}`); if (who === 'אתה') d.className = 'me';
  while (logEl.children.length > 8) logEl.firstChild.remove(); logEl.scrollTop = logEl.scrollHeight;
}
function open(actor) {
  if (ai.isOpen || !bar) return;
  const a = actor && actor.pos ? actor : findTalkTarget();
  mode = a ? 'npc' : 'assist'; npc = a ? charOf(a) : null; ai.isOpen = true;
  G.input.enabled = false; safe(() => G.input.exitPointerLock());
  titleEl.textContent = npc ? `${npc.name} · ${npc.desc}` : 'עוזר הנגישות · בקש כל דבר במילים שלך';
  input.placeholder = npc ? `מה תגיד ל${npc.name}?` : 'דבר איתי... למשל: קח אותי לעזריאלי';
  logEl.textContent = ''; sugEl.style.display = npc ? 'none' : '';
  if (npc) for (const m of npc.hist.slice(-6)) addLine(m.role === 'user' ? 'אתה' : npc.name, m.content);
  input.value = ''; bar.classList.add('open'); input.focus(); setTimeout(() => ai.isOpen && input.focus(), 60);
  G.audio?.play?.('ui_select');
}
function close() {
  if (!ai.isOpen) return;
  ai.isOpen = false; bar.classList.remove('open'); input.blur(); vDown = 0;
  if (rec) safe(() => rec.abort());
  G.input.enabled = true; safe(() => G.input.requestPointerLock());
}
function submit() {
  const t = input.value.trim(); if (!t) return; input.value = '';
  if (mode === 'npc' && npc) talk(t); else { close(); ask(t); }
}
function listen() {
  if (!SR) { addLine('העוזר', 'הדפדפן הזה לא תומך בזיהוי דיבור, אפשר להקליד.'); return; }
  if (rec) { safe(() => rec.stop()); return; }
  let heard = '';
  try {
    rec = new SR(); rec.lang = 'he-IL'; rec.interimResults = true; rec.continuous = false;
    rec.onresult = (e) => { let s = ''; for (let i = 0; i < e.results.length; i++) s += e.results[i][0].transcript; heard = s; input.value = s; };
    rec.onerror = () => { heard = ''; };
    rec.onend = () => { rec = null; micBtn.classList.remove('on'); if (heard.trim() && ai.isOpen) { input.value = heard; submit(); } };
    rec.start(); micBtn.classList.add('on'); G.hud?.caption?.('[מקשיב...]');
  } catch { rec = null; micBtn.classList.remove('on'); }
}

// ---------------------------------------------------------------- module API
export async function init() {
  G.ai = ai; ai.ask = ask; ai.talkTo = (actor) => open(actor); ai.open = () => open(); ai.close = close; ai.describe = describe;
  buildUI();
  window.addEventListener('keydown', (e) => {
    if (ai.isOpen) { if (e.code === 'Escape') { e.preventDefault(); close(); } return; }
    if (e.repeat || e.ctrlKey || e.altKey || e.metaKey || (e.code !== 'KeyT' && e.code !== 'KeyV')) return;
    const tg = e.target; if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable)) return;
    if (!G.started || G.paused || !G.input.enabled) return;
    e.preventDefault(); open();
    if (e.code === 'KeyV' && ai.isOpen) { vDown = now(); listen(); }
  });
  window.addEventListener('keyup', (e) => {   // push-to-talk: a long hold stops on release, a short tap leaves the mic open until silence
    if (e.code === 'KeyV' && vDown) { if (now() - vDown > 450 && rec) safe(() => rec.stop()); vDown = 0; }
  });
  const on = (n, fn) => G.events.on(n, (d) => { try { fn(d || {}); } catch (e) { console.warn('[ai]', n, e); } });
  on('settings:change', applySettings);
  on('crime', (d) => logEvent(CRIME_HE[d.type] || 'עשה בלגן', d.severity || 1, true));
  on('vehicle:destroyed', () => logEvent('פוצץ רכב', 3));
  on('mission:complete', (d) => logEvent('השלים את המשימה "' + (d.title || d.id || '') + '"', 3));
  on('wanted:change', (d) => { if ((d.level || 0) >= 2) logEvent('המשטרה העלתה את רמת הבלגן ל-' + d.level, 2); });
  on('player:died', () => logEvent('סיים את היום בבית החולים', 3));
  on('player:enterVehicle', () => { G.hud?.removeBlip?.('ai-car'); if (ai.navTarget) { buildRoute(); engageAssist(); } });
  on('player:exitVehicle', (d) => { if (ai.navTarget) { if (d.vehicle) d.vehicle.target = null; buildRoute(); } });
  on('player:respawn', () => { if (ai.navTarget) buildRoute(); });
}

export function update(dt) {
  if (!chipShown && chip) { chipShown = true; chip.style.display = 'block'; }
  const nav = ai.navTarget;
  if (nav) {
    const p = pos(), v = G.player?.inVehicle;
    if (Math.hypot(p.x - nav.x, p.z - nav.z) < (v ? 16 : 6)) endNav(true);
    else if (v && navPts.length) {
      let adv = false;
      while (navIdx < navPts.length - 1 && Math.hypot(p.x - navPts[navIdx].x, p.z - navPts[navIdx].z) < 13) { navIdx++; adv = true; }
      v.target = navPts[navIdx];
      if (adv) G.hud?.setRoute?.(navPts.slice(navIdx - 1));
    } else if ((navT -= dt) <= 0) { navT = 3; buildRoute(); }
  }
  if ((chkT -= dt) > 0) return;
  chkT = 0.35;
  const a = ai.isOpen ? nearActor : findTalkTarget();
  if (a !== nearActor) { nearActor = a; refreshChip(); }
  if (!newsBusy && !pending && now() - lastNews > 45000) {
    const items = evlog.filter((e) => !e.used && now() - e.t < 60000);
    if (items.length && items.reduce((s, e) => s + e.w, 0) >= 3 && now() - items[items.length - 1].t > 1200) newsFlash(items);
  }
}

export function updatePaused() {
  if (chipShown && !G.started && chip) { chipShown = false; chip.style.display = 'none'; }
}
