// hud.js - TLV NONSTOP 2D layer: title screen, in-game HUD, minimap, big map, pause, accessibility + controls menus.
import { G } from './core.js';

const $ = (tag, cls, text, attrs) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
};
const add = (p, ...kids) => { for (const k of kids) if (k) p.appendChild(k); return p; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const en = () => G.settings.language === 'en';
const L = (he, e) => (en() && e ? e : he);
const sfx = (n) => { try { G.audio?.play?.(n); } catch { /* ignore */ } };
const setT = (el, t) => { if (el && el._t !== t) { el._t = t; el.textContent = t; } };
const TAU = Math.PI * 2;

let root = null, hg, ov, live;
const els = {}, i18n = [];
const stack = [];                 // open menus: { name, from }
const blips = new Map();
let route = null, mini, mctx, mapCanvas = null, mapCtx = null;
let links = null, linksN = -1, _dir = null, range = 110;
let lastFast = 0, lastText = 0, lastMap = 0, tOpen = 0, hadLock = false;
let lastDistrict = null, lowHpSaid = false, wantedLvl = 0, objText = null, lastCap = '', lastCapT = 0;
const money = { shown: 0, target: 0, init: false };
const T = {};                     // timeouts
const tx = (el, he, e) => { i18n.push([el, he, e]); el.textContent = L(he, e); return el; };
const topName = () => (stack.length ? stack[stack.length - 1].name : null);

// ---------------------------------------------------------------- palettes (shape first, colour second)
const PALS = {
  off: { mission: '#ffd166', police: '#4d8dff', shop: '#46e6a0', target: '#ff5470', pickup: '#ff8ad1', def: '#ffffff', route: '#ff3d8b' },
  protan: { mission: '#f0e442', police: '#0072b2', shop: '#56b4e9', target: '#e69f00', pickup: '#cc79a7', def: '#ffffff', route: '#f0e442' },
  tritan: { mission: '#ff6b6b', police: '#00c2a8', shop: '#ffffff', target: '#d55e00', pickup: '#cc79a7', def: '#ffffff', route: '#ff6b6b' },
};
PALS.deutan = PALS.protan;
const pal = () => PALS[G.settings.colorblind] || PALS.off;
const mapCols = () => (G.settings.highContrast
  ? { land: '#000000', road: '#ffffff', sea: '#0a3fa8', route: '#ffe600', bg: '#000000' }
  : { land: '#18214e', road: '#7384cc', sea: '#1f78b4', route: pal().route, bg: '#0a1024' });
function colStr(c, fallback) {
  if (c == null) return fallback;
  if (typeof c === 'number') return '#' + (c & 0xffffff).toString(16).padStart(6, '0');
  if (typeof c === 'string') return c;
  if (c.getHexString) return '#' + c.getHexString();
  return fallback;
}
const blipCol = (b) => { const P = pal(); const base = P[b.icon] || P.def; return (G.settings.colorblind && G.settings.colorblind !== 'off') || G.settings.highContrast ? base : colStr(b.color, base); };

function shape(ctx, icon, x, y, r, fill) {
  ctx.beginPath();
  if (icon === 'mission') { ctx.moveTo(x, y - r * 1.25); ctx.lineTo(x + r * 1.05, y); ctx.lineTo(x, y + r * 1.25); ctx.lineTo(x - r * 1.05, y); ctx.closePath(); }
  else if (icon === 'police') { ctx.moveTo(x, y - r * 1.15); ctx.lineTo(x + r * 1.15, y + r * 0.9); ctx.lineTo(x - r * 1.15, y + r * 0.9); ctx.closePath(); }
  else if (icon === 'shop') ctx.rect(x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8);
  else if (icon === 'pickup') {
    const a = r * 0.42, b = r * 1.15;
    ctx.moveTo(x - a, y - b); ctx.lineTo(x + a, y - b); ctx.lineTo(x + a, y - a); ctx.lineTo(x + b, y - a); ctx.lineTo(x + b, y + a); ctx.lineTo(x + a, y + a);
    ctx.lineTo(x + a, y + b); ctx.lineTo(x - a, y + b); ctx.lineTo(x - a, y + a); ctx.lineTo(x - b, y + a); ctx.lineTo(x - b, y - a); ctx.lineTo(x - a, y - a); ctx.closePath();
  } else ctx.arc(x, y, r, 0, TAU);
  ctx.lineJoin = 'round'; ctx.lineWidth = r * 0.8; ctx.strokeStyle = '#05081a'; ctx.stroke();
  ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = r * 0.2; ctx.strokeStyle = '#ffffff'; ctx.stroke();
  if (icon === 'target' || icon === 'mission') { ctx.beginPath(); ctx.arc(x, y, r * (icon === 'target' ? 0.45 : 0.28), 0, TAU); ctx.fillStyle = '#05081a'; ctx.fill(); }
}
function arrow(ctx, x, y, ang, r) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  ctx.beginPath(); ctx.moveTo(0, -r * 1.3); ctx.lineTo(r * 0.95, r); ctx.lineTo(0, r * 0.45); ctx.lineTo(-r * 0.95, r); ctx.closePath();
  ctx.lineJoin = 'round'; ctx.lineWidth = r * 0.7; ctx.strokeStyle = '#05081a'; ctx.stroke(); ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.restore();
}
function getLinks() {
  const nodes = G.world?.roads?.nodes;
  if (!nodes || !nodes.length) return [];
  if (links && linksN === nodes.length) return links;
  const byId = new Map(); nodes.forEach((n, i) => byId.set(n.id ?? i, n));
  const out = [], seen = new Set();
  nodes.forEach((n, i) => {
    const a = n.id ?? i;
    for (const l of (n.links || [])) {
      const bId = (l && typeof l === 'object') ? l.id : l, m = byId.get(bId);
      if (!m) continue;
      const key = a < bId ? a + '|' + bId : bId + '|' + a;
      if (seen.has(key)) continue; seen.add(key); out.push(n.x, n.z, m.x, m.z);
    }
  });
  links = out; linksN = nodes.length; return out;
}
function drawRoads(ctx, s, col, minPx) {
  const lk = getLinks(); if (!lk.length) return;
  ctx.beginPath();
  for (let i = 0; i < lk.length; i += 4) { ctx.moveTo(lk[i], lk[i + 1]); ctx.lineTo(lk[i + 2], lk[i + 3]); }
  ctx.lineCap = 'round'; ctx.lineWidth = Math.max((G.world?.roads?.halfWidth || 5) * 2, minPx / s); ctx.strokeStyle = col; ctx.stroke();
}
function drawRoute(ctx, s, col, px) {
  if (!route || route.length < 2) return;
  ctx.beginPath(); ctx.moveTo(route[0].x, route[0].z);
  for (let i = 1; i < route.length; i++) ctx.lineTo(route[i].x, route[i].z);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.lineWidth = (px + 3) / s; ctx.strokeStyle = '#05081a'; ctx.stroke();
  ctx.lineWidth = px / s; ctx.strokeStyle = col; ctx.setLineDash([px * 2.2 / s, px * 1.6 / s]); ctx.stroke(); ctx.setLineDash([]);
}
const blipPos = (b) => { const t = b.follow ? (b.follow.pos || b.follow) : b; return (t && isFinite(t.x) && isFinite(t.z)) ? t : null; };
function playerPos() { return G.player?.pos || G.camera?.position || { x: 0, z: 0 }; }
function playerHeading() { const p = G.player; return (p?.inVehicle?.heading ?? p?.heading ?? 0) || 0; }

// ---------------------------------------------------------------- minimap
function drawMini() {
  if (!mctx) return;
  const ctx = mctx, S = mini.width, R = S / 2, u = S / 196, C = mapCols(), w = G.world;
  const pp = playerPos(), px = pp.x || 0, pz = pp.z || 0;
  let fx = 0, fz = 0;
  if (G.camera) { _dir = _dir || new G.THREE.Vector3(); G.camera.getWorldDirection(_dir); fx = _dir.x; fz = _dir.z; }
  let len = Math.hypot(fx, fz);
  if (len < 0.05) { const h = G.player?.camYaw ?? playerHeading(); fx = Math.sin(h); fz = Math.cos(h); len = 1; }
  fx /= len; fz /= len;
  const rx = -fz, rz = fx;
  range += ((G.player?.inVehicle ? 175 : 110) - range) * 0.08;
  const s = R / range;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = C.land; ctx.fillRect(0, 0, S, S);
  ctx.setTransform(rx * s, -fx * s, rz * s, -fz * s, R - (px * rx + pz * rz) * s, R + (px * fx + pz * fz) * s);
  if (w && typeof w.seaX === 'number') { ctx.fillStyle = C.sea; ctx.fillRect(w.seaX - 5000, pz - 5000, 5000, 10000); }
  drawRoads(ctx, s, C.road, 2.2 * u);
  drawRoute(ctx, s, C.route, 4.5 * u);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const edge = R - 13 * u;
  for (const b of blips.values()) {
    const t = blipPos(b); if (!t) continue;
    const dx = t.x - px, dz = t.z - pz;
    let sx = (dx * rx + dz * rz) * s, sy = -(dx * fx + dz * fz) * s, r = 7.5 * u;
    const d = Math.hypot(sx, sy);
    if (d > edge) { sx *= edge / d; sy *= edge / d; r = 6 * u; }
    shape(ctx, b.icon, R + sx, R + sy, r, blipCol(b));
  }
  const h = playerHeading(), hx = Math.sin(h), hz = Math.cos(h);
  arrow(ctx, R, R, Math.atan2(hx * rx + hz * rz, hx * fx + hz * fz), 8 * u);
  // north marker
  const nx = R - fx * (R - 13 * u), ny = R + fz * (R - 13 * u);
  ctx.beginPath(); ctx.arc(nx, ny, 9.5 * u, 0, TAU); ctx.fillStyle = '#05081a'; ctx.fill(); ctx.lineWidth = 1.5 * u; ctx.strokeStyle = '#ffffff'; ctx.stroke();
  ctx.fillStyle = G.settings.highContrast ? '#ffe600' : '#ffb347'; ctx.font = `900 ${12 * u}px 'Segoe UI', Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(en() ? 'N' : 'צ', nx, ny + 0.5 * u);
}

// ---------------------------------------------------------------- big map
function drawBigMap() {
  const c = mapCanvas; if (!c || !mapCtx) return;
  const wrap = c.parentNode, dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(60, (wrap.clientWidth * dpr) | 0), H = Math.max(60, (wrap.clientHeight * dpr) | 0);
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const ctx = mapCtx, w = G.world, C = mapCols(), ts = clamp(G.settings.textScale || 1, 1, 1.6);
  let b = w?.bounds;
  if (!b || !(b.maxX > b.minX) || !(b.maxZ > b.minZ)) {
    const lk = getLinks(); b = { minX: -500, maxX: 500, minZ: -500, maxZ: 500 };
    if (lk.length) { b = { minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9 }; for (let i = 0; i < lk.length; i += 2) { b.minX = Math.min(b.minX, lk[i] - 60); b.maxX = Math.max(b.maxX, lk[i] + 60); b.minZ = Math.min(b.minZ, lk[i + 1] - 60); b.maxZ = Math.max(b.maxZ, lk[i + 1] + 60); } }
  }
  const s = Math.min(W / (b.maxX - b.minX), H / (b.maxZ - b.minZ)) * 0.96;
  const ox = W / 2 - (b.minX + b.maxX) / 2 * s, oz = H / 2 - (b.minZ + b.maxZ) / 2 * s;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  ctx.setTransform(s, 0, 0, s, ox, oz);
  ctx.fillStyle = C.land; ctx.fillRect(b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ);
  if (w && typeof w.seaX === 'number' && w.seaX > b.minX) { ctx.fillStyle = C.sea; ctx.fillRect(b.minX, b.minZ, w.seaX - b.minX, b.maxZ - b.minZ); }
  drawRoads(ctx, s, C.road, 1.8 * dpr);
  drawRoute(ctx, s, C.route, 5 * dpr);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const label = (text, x, y, col, size) => {
    ctx.font = `800 ${size * dpr * ts}px 'Heebo', 'Assistant', 'Segoe UI', Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.lineJoin = 'round'; ctx.lineWidth = 4.5 * dpr; ctx.strokeStyle = '#05081a'; ctx.strokeText(text, x, y); ctx.fillStyle = col; ctx.fillText(text, x, y);
  };
  if (w && typeof w.seaX === 'number' && w.seaX > b.minX + 30) label(L('הים התיכון', 'Mediterranean'), ox + (b.minX + w.seaX) / 2 * s, H / 2, '#cfe9ff', 13);
  const lm = w?.landmarks || {};
  for (const k in lm) {
    const m = lm[k]; if (!m || !isFinite(m.x) || !isFinite(m.z)) continue;
    const x = ox + m.x * s, y = oz + m.z * s;
    ctx.beginPath(); ctx.arc(x, y, 4 * dpr, 0, TAU); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.lineWidth = 2 * dpr; ctx.strokeStyle = '#05081a'; ctx.stroke();
    label(m.name || k, x, y + 6 * dpr, G.settings.highContrast ? '#ffe600' : '#ffe1c4', 14);
  }
  for (const bl of blips.values()) {
    const t = blipPos(bl); if (!t) continue;
    const x = clamp(ox + t.x * s, 14 * dpr, W - 14 * dpr), y = clamp(oz + t.z * s, 14 * dpr, H - 14 * dpr);
    shape(ctx, bl.icon, x, y, 9 * dpr, blipCol(bl));
    if (bl.label) label(String(bl.label), x, y + 12 * dpr, '#ffffff', 12);
  }
  const pp = playerPos(), h = playerHeading();
  const x = ox + (pp.x || 0) * s, y = oz + (pp.z || 0) * s;
  ctx.beginPath(); ctx.arc(x, y, (16 + 4 * Math.sin(performance.now() / 250)) * dpr, 0, TAU); ctx.lineWidth = 2.5 * dpr; ctx.strokeStyle = G.settings.highContrast ? '#ffe600' : '#ff6b5e'; ctx.stroke();
  arrow(ctx, x, y, Math.atan2(Math.sin(h), -Math.cos(h)), 9 * dpr);
}

// ---------------------------------------------------------------- speech + live region
function speak(text) {
  try {
    const ss = window.speechSynthesis; if (!ss || !window.SpeechSynthesisUtterance || !text) return;
    if (ss.speaking && ss.pending) ss.cancel();
    const u = new SpeechSynthesisUtterance(String(text));
    u.lang = en() ? 'en-US' : 'he-IL'; u.rate = 1.05; u.volume = clamp(G.settings.masterVolume ?? 0.8, 0.2, 1);
    ss.speak(u);
  } catch { /* ignore */ }
}
function announce(text) {
  if (text == null || text === '') return;
  const t = String(text);
  if (live) { live.textContent = ''; clearTimeout(T.live); T.live = setTimeout(() => { live.textContent = t; }, 40); }
  if (G.settings.screenReader) speak(t);
}

// ---------------------------------------------------------------- HUD API
function toast(text, ms = 3200) {
  if (text == null || !els.toasts) return;
  const t = $('div', 'toast', String(text));
  els.toasts.appendChild(t);
  while (els.toasts.children.length > 4) els.toasts.firstChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 450); }, ms);
}
const SPK = ['#ffb347', '#ff8ad1', '#7ad7ff', '#b6f09c', '#ffd166', '#c9b2ff'];
function subtitle(speaker, text, ms) {
  if (text === undefined || typeof text === 'number') { ms = text; text = speaker; speaker = ''; }
  if (text == null) { els.subtitle.hidden = true; return; }
  speaker = speaker ? String(speaker) : ''; text = String(text);
  if (G.settings.screenReader) speak(speaker ? `${speaker}: ${text}` : text);
  if (!G.settings.subtitles) return;
  let hsh = 0; for (let i = 0; i < speaker.length; i++) hsh = (hsh * 31 + speaker.charCodeAt(i)) >>> 0;
  els.subSpk.textContent = speaker; els.subSpk.style.color = SPK[hsh % SPK.length]; els.subTxt.textContent = text;
  els.subtitle.hidden = false;
  clearTimeout(T.sub); T.sub = setTimeout(() => { els.subtitle.hidden = true; }, ms || Math.max(2600, text.length * 75));
}
function setObjective(text) {
  text = text ? String(text) : null;
  if (text === objText) return; objText = text;
  els.objective.hidden = !text;
  if (text) {
    els.objT.textContent = text;
    els.objective.classList.remove('flash'); void els.objective.offsetWidth; els.objective.classList.add('flash');
    announce(L('יעד חדש: ', 'New objective: ') + text);
  }
}
function bigText(title, sub, ms = 3600) {
  const b = els.banner; clearTimeout(T.b1); clearTimeout(T.b2);
  els.banT.textContent = title ?? ''; els.banS.textContent = sub ?? '';
  b.hidden = false; b.className = 'banner'; void b.offsetWidth; b.className = 'banner show';
  T.b1 = setTimeout(() => { b.className = 'banner hide'; T.b2 = setTimeout(() => { b.hidden = true; }, 500); }, ms);
  announce(sub ? `${title}. ${sub}` : title);
}
function prompt(text) {
  text = text ? String(text) : null;
  if (els.prompt._t === text) return; els.prompt._t = text;
  els.prompt.hidden = !text; els.prompt.textContent = '';
  if (!text) return;
  const m = /^\s*([A-Za-z0-9]{1,6}|רווח)\s*[-–:]\s*(.+)$/.exec(text);
  if (m) add(els.prompt, $('kbd', null, m[1]), $('span', null, m[2])); else add(els.prompt, $('span', null, text));
}
function timer(sec) {
  if (sec == null || !isFinite(sec)) { els.timer.hidden = true; return; }
  const s = Math.max(0, Math.ceil(sec));
  setT(els.timer, `${String((s / 60) | 0).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`);
  els.timer.hidden = false; els.timer.classList.toggle('low', s <= 10);
}
function caption(text) {
  if (text == null || G.settings.captions === false || !G.settings.subtitles && G.settings.captions !== true) return;
  text = String(text); const now = performance.now();
  if (text === lastCap && now - lastCapT < 1800) return; lastCap = text; lastCapT = now;
  const c = add($('div', 'cap'), $('i'), $('span', null, text));
  els.caps.appendChild(c);
  while (els.caps.children.length > 4) els.caps.firstChild.remove();
  setTimeout(() => { c.classList.add('out'); setTimeout(() => c.remove(), 450); }, 3600);
}
function addBlip(id, o) { if (id != null && o) blips.set(id, { ...o }); }
function removeBlip(id) { blips.delete(id); }
function setRoute(r) { route = (Array.isArray(r) && r.length > 1) ? r : null; }

// ---------------------------------------------------------------- menus
const focusables = () => (ov ? Array.from(ov.querySelectorAll('[tabindex="0"]')) : []);
function focusAt(items, i) {
  if (!items.length) return;
  const el = items[((i % items.length) + items.length) % items.length];
  try { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest' }); } catch { /* ignore */ }
}
function mk(el, act, label) {       // make any element a keyboard + mouse operable control
  el.setAttribute('tabindex', '0'); if (!el.getAttribute('role')) el.setAttribute('role', 'button');
  if (label) el.setAttribute('aria-label', label);
  el._act = act;
  el.addEventListener('click', (e) => { e.stopPropagation(); if (el._act) el._act(e); });
  el.addEventListener('mouseenter', () => { try { el.focus({ preventScroll: true }); } catch { /* ignore */ } });
  return el;
}
const btn = (ic, he, e, small, act, cls) => {
  const b = add($('div', 'btn' + (cls ? ' ' + cls : '')), $('span', 'ic', ic), $('span', null, L(he, e)), small ? $('small', null, small) : null);
  b.querySelector('.ic').setAttribute('aria-hidden', 'true');
  return mk(b, act, L(he, e));
};
function panel(cls, title, sub, closeLabel) {
  const p = $('div', 'panel ' + cls, null, { role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const h2 = $('h2', null, title); if (sub) h2.appendChild($('small', null, sub));
  const x = mk($('div', 'x', closeLabel || L('סגירה (Esc)', 'Close (Esc)')), back);
  add(p, add($('div', 'panel-head'), h2, x));
  ov.appendChild(p);
  return p;
}
const foot = (p, pairs) => { const f = $('div', 'panel-foot'); for (const [k, t] of pairs) add(f, add($('span'), $('kbd', null, k), document.createTextNode(' ' + t))); p.appendChild(f); return f; };

function render(focusIdx, focusKey) {
  const top = topName();
  ov.textContent = ''; mapCanvas = null; mapCtx = null;
  hg.classList.toggle('off', !G.started);
  if (!top) {
    ov.hidden = true; G.input.enabled = true;
    if (G.started) {
      G.paused = false;
      if (!G.settings.oneHanded) G.input.requestPointerLock();
      try { document.activeElement?.blur?.(); G.renderer?.domElement?.focus?.({ preventScroll: true }); } catch { /* ignore */ }
    }
    return;
  }
  ov.hidden = false; ov.className = 'ov' + (top === 'title' ? ' ov-title' : '');
  G.input.enabled = false; if (G.started) G.paused = true;
  try { G.input.exitPointerLock(); } catch { /* ignore */ }
  try { MENUS[top](); } catch (e) { console.error('[hud menu]', e); }
  const items = focusables();
  const f = (focusKey && ov.querySelector(`[data-k="${focusKey}"]`)) || items[focusIdx >= 0 ? Math.min(focusIdx, items.length - 1) : 0];
  if (f) { try { f.focus({ preventScroll: true }); f.scrollIntoView({ block: 'nearest' }); } catch { /* ignore */ } }
  if (top === 'map') drawBigMap();
}
const ALIAS = { accessibility: 'access', a11y: 'access', settings: 'access', options: 'access', main: 'title', keys: 'controls', bigmap: 'map' };
function showMenu(name) {
  if (!root) return false;
  if (!name) { stack.length = 0; if (!G.started) stack.push({ name: 'title', from: 0 }); render(); return true; }
  const n = ALIAS[name] || name;
  if (!MENUS[n] || (n === 'title' && G.started)) return false;
  if (topName() === n) return true;
  stack.push({ name: n, from: focusables().indexOf(document.activeElement) });
  tOpen = performance.now(); sfx('ui_select'); render();
  return true;
}
function back() {
  if (!stack.length || topName() === 'title') return;
  const top = stack.pop(); sfx('ui_select');
  if (!stack.length && !G.started) stack.push({ name: 'title', from: 0 });
  render(top.from);
}
function startGame() {
  if (G.started) return;
  stack.length = 0; G.started = true; G.paused = false; sfx('ui_select');
  render();
  G.events.emit('game:start');
  toast(L('Tab - נגישות  ·  M - מפה  ·  Esc - תפריט', 'Tab - Accessibility  ·  M - Map  ·  Esc - Menu'), 5000);
  announce(L('המשחק התחיל. ברוכים הבאים לתל אביב.', 'Game started. Welcome to Tel Aviv.'));
}

const OPTS = [
  { g: ['ראייה', 'VISION'] },
  { k: 'highContrast', t: 'bool', l: ['ניגודיות גבוהה', 'High contrast'], d: ['רקעים שחורים, מסגרות עבות וטקסט צהוב-לבן. קריא גם בשמש של יולי.', 'Solid black plates, thick outlines, yellow and white text.'] },
  { k: 'colorblind', t: 'seg', l: ['התאמה לעיוורון צבעים', 'Colour-blind mode'], d: ['פלטה בטוחה, ולכל סימון במפה צורה משלו. אף פעם לא רק צבע.', 'Safe palette, and every map marker has its own shape.'], o: [['off', 'כבוי', 'Off'], ['protan', 'פרוטן', 'Protan'], ['deutan', 'דויטן', 'Deutan'], ['tritan', 'טריטן', 'Tritan']] },
  { k: 'textScale', t: 'seg', l: ['גודל טקסט', 'Text size'], d: ['מגדיל את כל הממשק. בלי משקפיים, בלי בושה.', 'Scales the whole interface.'], o: [[1, '100%'], [1.25, '125%'], [1.5, '150%'], [2, '200%']] },
  { k: 'screenReader', t: 'bool', l: ['הקראה קולית', 'Screen-reader mode'], d: ['מקריא יעדים, מד בלגן, שכונות ותפריטים. עובד גם עם קורא מסך.', 'Speaks objectives, chaos level, districts and menus.'] },
  { g: ['שמיעה', 'HEARING'] },
  { k: 'subtitles', t: 'bool', l: ['כתוביות', 'Subtitles'], d: ['כל דיאלוג על רקע אטום, עם שם הדובר בצבע.', 'All dialogue on a solid plate with the speaker name.'] },
  { k: 'captions', t: 'bool', l: ['כיתוב לצלילים', 'Sound captions'], d: ['[סירנות], [צופר], [פיצוץ] - מה שהאוזן מפספסת, העין תופסת.', '[sirens], [horn], [explosion] shown as text.'] },
  { g: ['מוטוריקה', 'MOTOR'] },
  { k: 'oneHanded', t: 'bool', l: ['מצב יד אחת (עכבר בלבד)', 'One-handed (mouse only)'], d: ['לחצן שמאלי = לנסוע, ימני = בלם ורוורס, הסמן מכוון. היד השנייה פנויה לקפה.', 'LMB = go, RMB = brake/reverse, the cursor steers.'] },
  { k: 'holdToToggle', t: 'bool', l: ['לחיצה אחת במקום החזקה', 'Toggle instead of hold'], d: ['ריצה וכיוון נדלקים בלחיצה ונשארים. בלי להחזיק מקשים.', 'Sprint and aim are toggles, no holding keys.'] },
  { k: 'driveAssist', t: 'bool', l: ['נהיגה בסיוע', 'Drive assist'], d: ['הרכב מנווט לבד אל היעד. רק מחזיקים W. כמו מונית, בלי המונה.', 'The car steers itself to the objective; just hold W.'] },
  { k: 'aimAssist', t: 'bool', l: ['סיוע בכיוון', 'Aim assist'], d: ['הכוונת ננעלת על המטרה הקרובה.', 'Locks on to the nearest target.'] },
  { g: ['קצב וריכוז', 'PACE & FOCUS'] },
  { k: 'gameSpeed', t: 'seg', l: ['מהירות המשחק', 'Game speed'], d: ['מאטים את כל העיר. בתל אביב ממילא אף אחד לא מגיע בזמן.', 'Slows the whole city down.'], o: [[1, '100%'], [0.75, '75%'], [0.5, '50%']] },
  { k: 'reducedMotion', t: 'bool', l: ['פחות תנועה והבהובים', 'Reduced motion'], d: ['בלי רעידות מצלמה, בלי הבזקים, אנימציות רגועות.', 'No camera shake, no flashes, calm animations.'] },
  { k: 'invincible', t: 'bool', l: ['מצב סיפור (בלי נזק)', 'Story mode (no damage)'], d: ['אי אפשר להיפגע. באים ליהנות מהעיר, לא לסבול.', 'You cannot be hurt. Just enjoy the city.'] },
  { g: ['קול ותמונה', 'AUDIO & VIDEO'] },
  { k: 'masterVolume', t: 'vol', l: ['עוצמה כללית', 'Master volume'], d: ['כל הצלילים יחד.', 'Everything at once.'] },
  { k: 'musicVolume', t: 'vol', l: ['מוזיקה ורדיו', 'Music & radio'], d: ['תחנות הרדיו והפסקול.', 'Radio stations and soundtrack.'] },
  { k: 'sfxVolume', t: 'vol', l: ['אפקטים', 'Sound effects'], d: ['מנועים, צפירות ושאר רעשי עיר.', 'Engines, horns and city noise.'] },
  { k: 'quality', t: 'seg', l: ['איכות גרפיקה', 'Graphics quality'], d: ['נמוכה = רץ חלק גם על מחשב ישן. חלק מהשינוי נכנס אחרי רענון.', 'Low runs smoothly on old laptops. Partly applies after reload.'], o: [['low', 'נמוכה', 'Low'], ['medium', 'בינונית', 'Medium'], ['high', 'גבוהה', 'High']] },
  { k: 'language', t: 'seg', l: ['שפה', 'Language'], d: ['שפת הממשק.', 'Interface language.'], o: [['he', 'עברית'], ['en', 'English']] },
];
const PRESETS = [
  { l: ['ראייה', 'Vision'], ic: '◉', s: { highContrast: true, textScale: 1.5, screenReader: true, subtitles: true, aimAssist: true } },
  { l: ['שמיעה', 'Hearing'], ic: '≋', s: { subtitles: true, captions: true, textScale: 1.25 } },
  { l: ['מוטוריקה', 'Motor'], ic: '✋', s: { oneHanded: true, holdToToggle: true, driveAssist: true, aimAssist: true, gameSpeed: 0.75 } },
  { l: ['קוגניטיבי', 'Cognitive'], ic: '◔', s: { gameSpeed: 0.75, reducedMotion: true, driveAssist: true, aimAssist: true, invincible: true, subtitles: true } },
];
const RESET = { highContrast: false, colorblind: 'off', textScale: 1, subtitles: true, captions: true, screenReader: false, reducedMotion: false, gameSpeed: 1, driveAssist: false, aimAssist: true, oneHanded: false, holdToToggle: true, invincible: false };
const val = (k) => (k === 'captions' ? G.settings.captions !== false : G.settings[k]);
function setOpt(o, v, say) {
  if (val(o.k) === v) return;
  G.setSetting(o.k, v); sfx('ui_select');
  if (G.settings.screenReader && say) speak(`${L(...o.l)}: ${say}`);
}
function accRow(o) {
  const row = $('div', 'acc-row'); row.dataset.k = o.k;
  const name = L(...o.l), desc = L(...o.d), ctl = $('div', 'acc-ctl');
  add(row, add($('div', 'acc-text'), $('div', 'acc-label', name), $('div', 'acc-desc', desc)), ctl);
  const onOff = (v) => (v ? L('פועל', 'On') : L('כבוי', 'Off'));
  if (o.t === 'bool') {
    row.setAttribute('role', 'switch');
    const txt = $('span', 'sw-txt');
    add(ctl, txt, add($('span', 'sw'), $('span', 'sw-knob')));
    row._sync = () => { const v = !!val(o.k); row.classList.toggle('on', v); row.setAttribute('aria-checked', String(v)); txt.textContent = onOff(v); row.setAttribute('aria-label', `${name}, ${onOff(v)}. ${desc}`); };
    mk(row, () => setOpt(o, !val(o.k), onOff(!val(o.k))));
    row._adj = () => row._act();
  } else if (o.t === 'seg') {
    row.setAttribute('role', 'slider'); row.setAttribute('aria-valuemin', '0'); row.setAttribute('aria-valuemax', String(o.o.length - 1));
    const seg = $('div', 'seg'), lab = (x) => L(x[1], x[2]);
    const cells = o.o.map((x) => { const c = $('span', 'seg-opt', lab(x)); c.addEventListener('click', (e) => { e.stopPropagation(); setOpt(o, x[0], lab(x)); }); seg.appendChild(c); return c; });
    ctl.appendChild(seg);
    const idx = () => Math.max(0, o.o.findIndex((x) => x[0] === val(o.k)));
    row._sync = () => { const i = idx(); cells.forEach((c, j) => c.classList.toggle('sel', j === i)); row.setAttribute('aria-valuenow', String(i)); row.setAttribute('aria-valuetext', lab(o.o[i])); row.setAttribute('aria-label', `${name}, ${lab(o.o[i])}. ${desc}`); };
    mk(row, () => { const x = o.o[(idx() + 1) % o.o.length]; setOpt(o, x[0], lab(x)); });
    row._adj = (d) => { const x = o.o[clamp(idx() + d, 0, o.o.length - 1)]; setOpt(o, x[0], lab(x)); };
  } else {
    row.setAttribute('role', 'slider'); row.setAttribute('aria-valuemin', '0'); row.setAttribute('aria-valuemax', '100');
    const fill = $('span', 'vol-fill'), bar = add($('span', 'vol-bar'), fill), num = $('span', 'vol-val');
    const cur = () => clamp(Number(val(o.k)) || 0, 0, 1);
    const setV = (v) => { v = Math.round(clamp(v, 0, 1) * 10) / 10; setOpt(o, v, Math.round(v * 100) + '%'); };
    const minus = $('span', 'vol-btn', '−'), plus = $('span', 'vol-btn', '+');
    minus.addEventListener('click', (e) => { e.stopPropagation(); setV(cur() - 0.1); });
    plus.addEventListener('click', (e) => { e.stopPropagation(); setV(cur() + 0.1); });
    bar.addEventListener('click', (e) => { e.stopPropagation(); const r = bar.getBoundingClientRect(); setV(en() ? (e.clientX - r.left) / r.width : (r.right - e.clientX) / r.width); });
    add(ctl, minus, bar, plus, num);
    row._sync = () => { const p = Math.round(cur() * 100); fill.style.width = p + '%'; num.textContent = p + '%'; row.setAttribute('aria-valuenow', String(p)); row.setAttribute('aria-label', `${name}, ${p}%. ${desc}`); };
    mk(row, () => setV(cur() >= 1 ? 0 : cur() + 0.1));
    row._adj = (d) => setV(cur() + d * 0.1);
  }
  row._sync();
  return row;
}
function syncAccess() { if (ov) ov.querySelectorAll('.acc-row').forEach((r) => r._sync && r._sync()); }

const KEYS = [
  ['תנועה ונהיגה', 'Move / drive', ['W', 'A', 'S', 'D', '↑ ↓ ← →'], ['סטיק שמאלי', 'Left stick']],
  ['מבט ומצלמה', 'Look / camera', ['עכבר', 'Mouse'], ['סטיק ימני', 'Right stick']],
  ['ריצה / בוסט', 'Sprint / boost', ['Shift'], null],
  ['קפיצה / בלם יד', 'Jump / handbrake', ['Space'], ['A']],
  ['כניסה ויציאה מרכב', 'Enter / exit vehicle', ['F'], ['X']],
  ['לדבר / להתחיל משימה', 'Interact / talk / mission', ['E'], null],
  ['מכה / ירי', 'Attack / shoot', ['לחצן שמאלי', 'LMB'], ['RT']],
  ['כיוון', 'Aim', ['לחצן ימני', 'RMB'], ['LT']],
  ['גז / בלם ברכב', 'Gas / brake', ['W', 'S'], ['RT', 'LT']],
  ['החלפת נשק', 'Switch weapon', ['1', '2', '3', 'גלגלת', 'Wheel'], null],
  ['תחנת רדיו הבאה', 'Next radio station', ['R'], null],
  ['צופר (חובה בתל אביב)', 'Horn', ['H'], null],
  ['פנסים', 'Headlights', ['L'], null],
  ['מצב מצלמה', 'Camera mode', ['C'], null],
  ['מפה גדולה', 'Big map', ['M'], null],
  ['תפריט הפסקה', 'Pause menu', ['Esc', 'P'], null],
  ['תפריט נגישות', 'Accessibility menu', ['Tab'], null],
];
const pick2 = (a) => (a.length === 2 && /[א-ת]/.test(a[0]) ? [L(a[0], a[1])] : a.filter((x) => (en() ? !/[א-ת]/.test(x) : !['Wheel', 'LMB', 'RMB', 'Mouse'].includes(x))));

const MENUS = {
  title() {
    const t = $('div', 'title'), art = $('div', 'title-art'), col = $('div', 'title-col');
    art.setAttribute('aria-hidden', 'true');
    if (els.artUrl) { art.style.backgroundImage = `url("${els.artUrl}")`; art.classList.add('on'); }
    els.art = art;
    const logo = $('div', 'logo', null, { role: 'img', 'aria-label': 'TLV NONSTOP - תל אביב נון-סטופ' });
    add(logo, add($('div', 'logo-row'), $('span', 'logo-tlv', 'TLV'), $('i', 'logo-sun')),
      add($('div', 'logo-ns'), $('span', null, 'NONSTOP'), $('i', 'logo-ff')), $('div', 'logo-he', 'תל אביב נון-סטופ'));
    const tag = $('p', 'tagline', L('עיר שלמה. בלי התקנה. לכל אחד.', 'A whole city. No install. For everyone.'));
    const menu = $('div', 'menu', null, { role: 'menu', 'aria-label': L('תפריט ראשי', 'Main menu') });
    add(menu,
      btn('▶', 'התחל משחק', 'Start game', 'Enter', startGame, 'primary'),
      btn('◐', 'נגישות', 'Accessibility', 'Tab', () => showMenu('access')),
      btn('⌨', 'שליטה', 'Controls', '', () => showMenu('controls')),
      btn('ⓘ', 'אודות', 'About', '', () => showMenu('about')));
    const ft = $('div', 'title-foot');
    for (const [k, he, e] of [['↑ ↓', 'ניווט', 'Navigate'], ['Enter', 'בחירה', 'Select'], ['Tab', 'נגישות', 'Accessibility']]) add(ft, add($('span'), $('kbd', null, k), document.createTextNode(' ' + L(he, e))));
    add(ov, add(t, art, add(col, add($('h1', 'sr'), document.createTextNode('TLV NONSTOP')), logo, tag, menu, ft)));
  },
  pause() {
    const p = panel('pause', L('הפסקה קלה', 'Paused'), L('העיר מחכה לך. הפקקים גם.', 'The city is waiting. So is the traffic.'), L('חזרה (Esc)', 'Back (Esc)'));
    const body = $('div', 'panel-body'), menu = $('div', 'menu', null, { role: 'menu' });
    add(menu,
      btn('▶', 'להמשיך לשחק', 'Resume', 'Esc', back, 'primary'),
      btn('◐', 'נגישות', 'Accessibility', 'Tab', () => showMenu('access')),
      btn('⌨', 'שליטה', 'Controls', '', () => showMenu('controls')),
      btn('◈', 'מפה', 'Map', 'M', () => showMenu('map')),
      btn('↺', 'להתחיל מחדש', 'Restart', '', () => { try { location.reload(); } catch { /* ignore */ } }));
    add(p, add(body, menu));
    foot(p, [['↑ ↓', L('ניווט', 'Navigate')], ['Enter', L('בחירה', 'Select')]]);
  },
  access() {
    const p = panel('access', L('נגישות', 'Accessibility'), L('כל אחד משחק אחרת. כאן מתאימים את העיר אליך, ולא להפך.', 'Everyone plays differently. Fit the city to you.'));
    const pr = $('div', 'presets', null, { role: 'group', 'aria-label': L('התאמה מהירה', 'Quick presets') });
    pr.appendChild($('span', 'presets-lbl', L('התאמה מהירה:', 'Quick presets:')));
    for (const ps of PRESETS) {
      const name = L(...ps.l), b = add($('div', 'pre'), $('span', 'pi', ps.ic), $('span', null, name));
      pr.appendChild(mk(b, () => { for (const k in ps.s) G.setSetting(k, ps.s[k]); sfx('chime'); toast(L(`הופעלה התאמת ${name}`, `${name} preset applied`)); announce(L(`הופעלה התאמת ${name}`, `${name} preset applied`)); }, L(`התאמה מהירה: ${name}`, `Preset: ${name}`)));
    }
    pr.appendChild(mk(add($('div', 'pre reset'), $('span', null, L('איפוס', 'Reset'))), () => { for (const k in RESET) G.setSetting(k, RESET[k]); toast(L('ההגדרות אופסו', 'Settings reset')); announce(L('ההגדרות אופסו', 'Settings reset')); }, L('איפוס הגדרות הנגישות', 'Reset accessibility settings')));
    const body = $('div', 'panel-body');
    for (const o of OPTS) body.appendChild(o.g ? $('div', 'acc-group', L(...o.g), { role: 'heading', 'aria-level': '3' }) : accRow(o));
    add(p, pr, body);
    foot(p, [['↑ ↓', L('מעבר בין אפשרויות', 'Move')], ['← →', L('שינוי ערך', 'Change')], ['Enter', L('הפעלה / כיבוי', 'Toggle')], ['Esc', L('חזרה', 'Back')]]);
    p.appendChild($('div', 'sr', L('אפשר לתפעל את כל התפריט במקלדת בלבד או בעכבר בלבד.', 'Fully operable by keyboard only or mouse only.')));
  },
  controls() {
    const p = panel('controls', L('שליטה', 'Controls'), L('מקלדת, עכבר או שלט. מה שנוח.', 'Keyboard, mouse or gamepad.'));
    const body = $('div', 'panel-body'), tb = $('table', 'keys'), head = $('tr');
    add(head, $('th', null, L('פעולה', 'ACTION'), { scope: 'col' }), $('th', null, L('מקלדת ועכבר', 'KEYBOARD & MOUSE'), { scope: 'col' }), $('th', null, L('שלט', 'GAMEPAD'), { scope: 'col' }));
    add(tb, add($('thead'), head));
    const bd = $('tbody');
    for (const [he, e, ks, pad] of KEYS) {
      const k = $('td'), g = $('td');
      for (const x of pick2(ks)) k.appendChild($('kbd', null, x));
      if (pad) for (const x of pick2(pad)) g.appendChild($('span', 'pad', x)); else g.textContent = '—';
      add(bd, add($('tr'), $('td', null, L(he, e)), k, g));
    }
    add(body, add(tb, bd), $('p', 'note', L('מצב יד אחת (בתפריט הנגישות): לחצן שמאלי = לנסוע, לחצן ימני = בלם ורוורס, הסמן מכוון. אפשר לשחק בלי לגעת במקלדת.', 'One-handed mode (accessibility menu): LMB = go, RMB = brake/reverse, the cursor steers.')));
    const x = p.querySelector('.x'); add(p, body);
    foot(p, [['Esc', L('חזרה', 'Back')], ['Tab', L('מעבר', 'Next')]]);
    void x;
  },
  about() {
    const p = panel('about', L('אודות', 'About'), 'TLV NONSTOP');
    const body = $('div', 'panel-body');
    const p1 = $('p'); p1.innerHTML = L('<b>תל אביב נון-סטופ</b> היא עיר פתוחה מקורית שרצה ישר בדפדפן: בלי התקנה, בלי חשבון, בלי כרטיס מסך מפלצתי. פותחים קישור ונוסעים.', '<b>TLV NONSTOP</b> is an original open city that runs right in the browser: no install, no account. Open a link and drive.');
    const p2 = $('p'); p2.innerHTML = L('היא נבנתה סביב רעיון אחד: <b>שכל אחד יוכל לשחק.</b>', 'It is built around one idea: <b>everyone should be able to play.</b>');
    const ul = $('ul');
    for (const [he, e] of [['ניגודיות גבוהה, התאמה לעיוורון צבעים וטקסט עד 200%', 'High contrast, colour-blind palettes, text up to 200%'], ['כתוביות, כיתוב לצלילים והקראה קולית', 'Subtitles, sound captions and speech'], ['מצב יד אחת, נהיגה בסיוע וסיוע בכיוון', 'One-handed mode, drive assist, aim assist'], ['האטת המשחק, פחות תנועה ומצב סיפור בלי נזק', 'Slower game speed, reduced motion, story mode'], ['תפעול מלא במקלדת בלבד, בעכבר בלבד או בשלט', 'Fully playable by keyboard only, mouse only or gamepad']]) ul.appendChild($('li', null, L(he, e)));
    add(body, p1, p2, ul, add($('div', 'menu'), btn('◐', 'לתפריט הנגישות', 'Open accessibility', 'Tab', () => showMenu('access'))));
    add(p, body);
  },
  map() {
    const p = panel('map', L('מפת העיר', 'City map'), L('צפון למעלה. הים, כרגיל, במערב.', 'North is up. The sea, as always, is in the west.'), L('סגירה (M / Esc)', 'Close (M / Esc)'));
    const body = $('div', 'map-body'), wrap = $('div', 'map-canvas-wrap'), lg = $('div', 'legend');
    mapCanvas = $('canvas', null, null, { role: 'img', 'aria-label': L('מפת תל אביב עם סימוני יעדים', 'Map of Tel Aviv with markers') });
    mapCtx = mapCanvas.getContext('2d');
    lg.appendChild($('h3', null, L('מקרא', 'LEGEND')));
    const P = pal();
    for (const [ic, he, e] of [['me', 'אתה כאן', 'You'], ['mission', 'משימה', 'Mission'], ['target', 'יעד', 'Target'], ['police', 'משטרה', 'Police'], ['shop', 'חנות', 'Shop'], ['pickup', 'איסוף', 'Pickup'], ['other', 'נקודת עניין', 'Point of interest']]) {
      const c = $('canvas'); c.width = c.height = 52; const x = c.getContext('2d');
      if (ic === 'me') arrow(x, 26, 28, 0, 11); else shape(x, ic, 26, 26, 12, P[ic] || P.def);
      add(lg, add($('div', 'legend-item'), c, $('span', null, L(he, e))));
    }
    const here = $('div', 'legend-here'); let st = '', di = '';
    try { const pp = playerPos(); st = G.world?.streetAt?.(pp.x, pp.z) || ''; di = G.world?.districtAt?.(pp.x, pp.z) || ''; } catch { /* ignore */ }
    add(here, document.createTextNode(L('אתה נמצא ב:', 'You are at:')), $('b', null, st || '—'), document.createTextNode(di));
    lg.appendChild(here);
    add(p, add(body, add(wrap, mapCanvas), lg));
    if (st) announce(L(`מפה. אתה ברחוב ${st}, ${di}`, `Map. You are on ${st}, ${di}`));
  },
};

function onKey(e) {
  const top = topName(), c = e.code;
  if (!top) {
    if (!G.started || e.repeat) return;
    if (c === 'Tab') { e.preventDefault(); showMenu('access'); }
    else if (c === 'Escape' || c === 'KeyP') showMenu('pause');
    else if (c === 'KeyM') showMenu('map');
    return;
  }
  const a = document.activeElement, items = focusables(), i = items.indexOf(a);
  if (c === 'Escape') { if (!e.repeat && performance.now() - tOpen > 300) back(); }
  else if ((c === 'KeyM' && top === 'map') || (c === 'KeyP' && top === 'pause')) { if (!e.repeat && performance.now() - tOpen > 300) back(); }
  else if (c === 'Tab' && (top === 'title' || top === 'pause')) { if (!e.repeat) showMenu('access'); }
  else if (c === 'ArrowDown' || (c === 'Tab' && !e.shiftKey)) focusAt(items, i + 1);
  else if (c === 'ArrowUp' || c === 'Tab') focusAt(items, i < 0 ? items.length - 1 : i - 1);
  else if (c === 'ArrowLeft' || c === 'ArrowRight') { const d = ((c === 'ArrowLeft') === !en()) ? 1 : -1; if (i >= 0 && a._adj) a._adj(d); else focusAt(items, i + d); }
  else if (c === 'Enter' || c === 'NumpadEnter' || c === 'Space') { if (!e.repeat) { if (i >= 0 && a._act) a._act(e); else focusAt(items, 0); } }
  else if (c === 'Home') focusAt(items, 0);
  else if (c === 'End') focusAt(items, items.length - 1);
  else return;
  e.preventDefault();
}

// ---------------------------------------------------------------- build + settings
function buildHud() {
  hg = $('div', 'hg off');
  // top-left: money, clock, chaos meter
  els.money = add($('div', 'chip money'), $('span', 'cur', '₪'), els.moneyV = $('span', null, '0'), els.delta = $('span', 'delta'));
  els.clock = add($('div', 'chip'), els.sun = $('i', 'sunmoon'), els.clockV = $('span', null, '--:--'));
  els.chaos = $('div', 'chaos', null, { role: 'img' });
  els.sirens = $('span', 'sirens'); for (let i = 0; i < 5; i++) els.sirens.appendChild($('i', 'siren'));
  add(els.chaos, tx($('span', 'chaos-lbl'), 'מד בלגן', 'CHAOS'), els.sirens, els.chaosNum = $('span', 'chaos-num', '0/5'));
  add(hg, add($('div', 'hg-tl'), add($('div', 'chiprow'), els.money, els.clock), els.chaos));
  // top-right: objective + sound captions
  els.objective = $('div', 'objective'); els.objective.hidden = true;
  add(els.objective, add($('div', 'obj-h'), $('i', 'obj-pin'), tx($('span'), 'המשימה עכשיו', 'OBJECTIVE')), els.objT = $('div', 'obj-t'));
  els.caps = $('div', 'captions', null, { 'aria-hidden': 'true' });
  add(hg, add($('div', 'hg-tr'), els.objective, els.caps));
  // top-centre: timer + toasts
  els.timer = $('div', 'timer', null, { role: 'timer' }); els.timer.hidden = true;
  els.toasts = $('div', 'toasts', null, { role: 'status', 'aria-live': 'polite' });
  add(hg, add($('div', 'hg-tc'), els.timer, els.toasts));
  // bottom-left: minimap + vitals
  mini = $('canvas', null, null, { role: 'img', 'aria-label': 'מפה קטנה' }); mini.width = mini.height = 392; mctx = mini.getContext('2d');
  els.loc = add($('div', 'loc'), els.street = $('span', 'loc-street', ''), els.dist = $('span', 'loc-dist', ''));
  els.hp = add($('div', 'bar health'), els.hpFill = $('i'), els.hpLbl = $('span', 'bar-lbl'));
  els.armor = add($('div', 'bar armor'), els.arFill = $('i')); els.armor.hidden = true;
  els.weapon = add($('div', 'weapon'), els.wIco = $('i', 'w-ico fists'), els.wName = $('span'), els.ammo = $('span', 'ammo'));
  add(hg, add($('div', 'hg-bl'), add($('div', 'mini-wrap'), add($('div', 'mini'), mini), els.loc), add($('div', 'vitals'), els.weapon, els.armor, els.hp)));
  // bottom-right: speedometer, radio, hints
  els.ring = $('div', 'speedo-ring');
  add(els.ring, add($('div', 'speedo-in'), els.kmh = $('b', null, '0'), tx($('small'), 'קמ"ש', 'km/h')));
  els.radio = add($('div', 'radio'), $('i', 'radio-ico'), els.radioT = $('span')); els.radio.hidden = true;
  els.speedo = add($('div', 'speedo'), els.ring, els.radio); els.speedo.hidden = true;
  const hints = $('div', 'hintrow');
  for (const [k, he, e, m] of [['Tab', 'נגישות', 'Accessibility', 'access'], ['M', 'מפה', 'Map', 'map'], ['Esc', 'תפריט', 'Menu', 'pause']]) {
    const b = $('div', 'hint', null, { role: 'button' }); add(b, $('kbd', null, k), tx($('span'), he, e));
    b.addEventListener('click', () => showMenu(m)); hints.appendChild(b);
  }
  add(hg, add($('div', 'hg-br'), els.speedo, hints));
  // bottom-centre: prompt + subtitles
  els.prompt = $('div', 'prompt'); els.prompt.hidden = true; els.prompt._t = null;
  els.subtitle = add($('div', 'subtitle'), els.subSpk = $('span', 'sub-speaker'), els.subTxt = $('span')); els.subtitle.hidden = true;
  add(hg, add($('div', 'hg-bc'), els.prompt, els.subtitle));
  // overlays
  els.cross = add($('div', 'crosshair', null, { 'aria-hidden': 'true' }), $('i'), $('i'), $('i'), $('i'), $('b')); els.cross.hidden = true;
  els.vig = $('div', 'vignette');
  els.dcard = add($('div', 'district-card'), tx($('small'), 'נכנסת אל', 'NOW ENTERING'), els.dname = $('b'));
  els.banner = add($('div', 'banner'), $('div', 'banner-stripe'), els.banT = $('div', 'banner-title'), els.banS = $('div', 'banner-sub')); els.banner.hidden = true;
  add(hg, els.vig, els.cross, els.dcard, els.banner);
}
function applySettings() {
  const s = G.settings;
  root.classList.toggle('hc', !!s.highContrast); root.classList.toggle('rm', !!s.reducedMotion);
  if (s.colorblind && s.colorblind !== 'off') root.dataset.cb = s.colorblind; else delete root.dataset.cb;
  root.style.setProperty('--hud-scale', String(Number(s.textScale) || 1));
  root.setAttribute('dir', en() ? 'ltr' : 'rtl'); root.setAttribute('lang', en() ? 'en' : 'he');
  if (!s.subtitles) els.subtitle.hidden = true;
  if (s.captions === false) els.caps.textContent = '';
}
function setWanted(lv) {
  lv = clamp(Math.round(Number(lv) || 0), 0, 5);
  const kids = els.sirens.children;
  for (let i = 0; i < kids.length; i++) kids[i].classList.toggle('on', i < lv);
  els.chaos.classList.toggle('hot', lv > 0); setT(els.chaosNum, `${lv}/5`);
  els.chaos.setAttribute('aria-label', L(`מד בלגן: ${lv} מתוך 5`, `Chaos meter: ${lv} of 5`));
  if (lv !== wantedLvl) {
    announce(lv === 0 ? L('מד הבלגן התאפס. המשטרה ויתרה.', 'Chaos cleared. The police gave up.') : lv > wantedLvl ? L(`מד בלגן עלה לדרגה ${lv} מתוך 5. המשטרה בדרך.`, `Chaos level up: ${lv} of 5. Police incoming.`) : L(`מד בלגן ירד לדרגה ${lv}.`, `Chaos level down: ${lv}.`));
    wantedLvl = lv;
  }
}
const WNAMES = { fists: ['אגרופים', 'Fists'], pistol: ['אקדח', 'Pistol'], smg: ['תת-מקלע', 'SMG'] };
function refreshText() {
  const p = G.player, w = G.world, s = G.sky;
  if (p) {
    const hp = clamp(Number(p.health ?? 100) || 0, 0, 100), ar = clamp(Number(p.armor) || 0, 0, 100);
    els.hpFill.style.width = hp + '%'; setT(els.hpLbl, `${L('בריאות', 'HEALTH')} ${Math.ceil(hp)}`);
    els.armor.hidden = ar <= 0; els.arFill.style.width = ar + '%';
    const low = hp < 25 && hp > 0 && p.alive !== false;
    els.hp.classList.toggle('low', low); els.vig.classList.toggle('lowhp', low);
    if (low && !lowHpSaid) { lowHpSaid = true; announce(L('הבריאות נמוכה! לתפוס מחסה.', 'Health is low! Take cover.')); } else if (hp > 40) lowHpSaid = false;
    const wp = p.weapon || 'fists', wn = WNAMES[wp] || [wp, wp];
    setT(els.wName, L(wn[0], wn[1])); if (els.wIco._w !== wp) { els.wIco._w = wp; els.wIco.className = 'w-ico ' + (WNAMES[wp] ? wp : 'pistol'); }
    const am = wp !== 'fists' ? p.ammo?.[wp] : null; setT(els.ammo, am != null ? String(am) : '');
    if (typeof p.money === 'number') { money.target = p.money; if (!money.init) { money.init = true; money.shown = p.money; setT(els.moneyV, Math.round(p.money).toLocaleString('en-US')); } }
    try {
      const st = w?.streetAt?.(p.pos.x, p.pos.z) || '', di = w?.districtAt?.(p.pos.x, p.pos.z) || '';
      setT(els.street, st); setT(els.dist, di); els.loc.hidden = !st && !di;
      if (di && di !== lastDistrict) {
        if (lastDistrict !== null) { els.dname.textContent = di; els.dcard.classList.add('show'); clearTimeout(T.dc); T.dc = setTimeout(() => els.dcard.classList.remove('show'), 2800); announce(L(`נכנסת אל ${di}`, `Now entering ${di}`)); }
        lastDistrict = di;
      }
    } catch { /* ignore */ }
    const cur = p.inVehicle ? G.audio?.radio?.current : null;
    const rn = cur ? (typeof cur === 'string' ? cur : (cur.name || cur.title || cur.label || '')) : '';
    els.radio.hidden = !rn; setT(els.radioT, rn);
  }
  if (s && typeof s.hour === 'number') {
    const hr = ((s.hour % 24) + 24) % 24;
    setT(els.clockV, `${String(hr | 0).padStart(2, '0')}:${String(((hr % 1) * 60) | 0).padStart(2, '0')}`);
    els.sun.classList.toggle('night', !!s.isNight);
  }
  const lv = G.wanted?.level; if (typeof lv === 'number' && Math.round(lv) !== wantedLvl) setWanted(lv);
}
function fast() {
  const p = G.player, v = p?.inVehicle;
  els.speedo.hidden = !v;
  if (v) { const k = Math.round(Math.abs(Number(v.speed) || 0) * 3.6); setT(els.kmh, String(k)); els.ring.style.setProperty('--p', String(Math.min(100, k / 1.8))); }
  const aim = !!p?.isAiming, showX = !!p && p.alive !== false && !v && (aim || (p.weapon && p.weapon !== 'fists'));
  els.cross.hidden = !showX; els.cross.classList.toggle('aim', aim);
  try { drawMini(); } catch (e) { if (!drawMini._e) { drawMini._e = 1; console.error('[hud minimap]', e); } }
}
function tickMoney(dt) {
  if (money.shown === money.target) return;
  const d = money.target - money.shown;
  money.shown = Math.abs(d) < 1 ? money.target : money.shown + d * Math.min(1, dt * 7);
  setT(els.moneyV, Math.round(money.shown).toLocaleString('en-US'));
}

// ---------------------------------------------------------------- module entry points
export async function init() {
  root = document.getElementById('hud-root');
  if (!root) { root = $('div'); root.id = 'hud-root'; document.body.appendChild(root); }
  root.textContent = '';
  buildHud();
  ov = $('div', 'ov'); ov.hidden = true;
  live = $('div', 'sr', null, { 'aria-live': 'assertive', 'aria-atomic': 'true', role: 'alert' });
  add(root, hg, ov, live);
  applySettings();

  G.hud = {
    toast, subtitle, setObjective, bigText, announce, addBlip, removeBlip, setRoute, prompt, showMenu, timer, caption,
    closeMenu: () => showMenu(null), get menuOpen() { return stack.length > 0; }, blips,
  };

  window.addEventListener('keydown', onKey);
  ov.addEventListener('focusin', (e) => { if (G.settings.screenReader && e.target && e.target !== ov) speak(e.target.getAttribute?.('aria-label') || e.target.textContent); });
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement) { hadLock = true; return; }
    if (hadLock && G.started && !stack.length && !G.settings.oneHanded) showMenu('pause');
    hadLock = false;
  });
  G.renderer?.domElement?.addEventListener('mousedown', () => { if (G.started && !stack.length && !G.settings.oneHanded) G.input.requestPointerLock(); });

  const E = G.events;
  E.on('settings:change', (d) => {
    applySettings();
    if (d && d.key === 'language') { for (const [el, he, e] of i18n) el.textContent = L(he, e); els.hpLbl._t = null; els.wName._t = null; setWanted(wantedLvl); if (stack.length) render(-1, 'language'); }
    else syncAccess();
  });
  E.on('wanted:change', (d) => setWanted(d?.level ?? G.wanted?.level ?? 0));
  E.on('money', (d) => {
    if (!d) return;
    if (typeof d.total === 'number') money.target = d.total;
    const a = Math.round(Number(d.amount) || 0); if (!a) return;
    els.delta.textContent = (a > 0 ? '+' : '−') + Math.abs(a).toLocaleString('en-US') + ' ₪';
    els.delta.className = 'delta ' + (a > 0 ? 'plus' : 'minus'); void els.delta.offsetWidth; els.delta.classList.add('show');
  });
  E.on('player:damage', () => { els.vig.classList.add('hit'); clearTimeout(T.vig); T.vig = setTimeout(() => els.vig.classList.remove('hit'), 220); });
  E.on('player:died', () => announce(L('נפלת. מתעוררים בבית החולים.', 'You went down. Waking up at the hospital.')));
  E.on('mission:start', (d) => announce(L('משימה התחילה: ', 'Mission started: ') + (d?.title || '')));
  E.on('mission:complete', (d) => announce(L('משימה הושלמה: ', 'Mission complete: ') + (d?.title || '')));
  E.on('mission:fail', (d) => announce(L('המשימה נכשלה: ', 'Mission failed: ') + (d?.title || '')));
  E.on('player:enterVehicle', () => { if (G.settings.driveAssist) caption(L('[נהיגה בסיוע פעילה]', '[drive assist on]')); });

  // title screen (the live 3D world keeps rendering behind it)
  stack.push({ name: 'title', from: 0 });
  render();
  G.assets?.exists?.('assets/gen/title.png').then((ok) => {
    if (!ok) return; els.artUrl = 'assets/gen/title.png';
    if (els.art && els.art.isConnected) { els.art.style.backgroundImage = `url("${els.artUrl}")`; els.art.classList.add('on'); }
  }).catch(() => {});
}

export function update(dt) {
  if (!root) return;
  if (hg.classList.contains('off')) hg.classList.remove('off');
  tickMoney(dt);
  const now = performance.now();
  if (now - lastFast > 32) { lastFast = now; fast(); }
  if (now - lastText > 100) { lastText = now; try { refreshText(); } catch (e) { if (!refreshText._e) { refreshText._e = 1; console.error('[hud text]', e); } } }
}

export function updatePaused() {
  if (!root) return;
  const now = performance.now();
  if (mapCanvas && now - lastMap > 100) { lastMap = now; try { drawBigMap(); } catch { /* ignore */ } }
}
