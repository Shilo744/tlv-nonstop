// audio.js - G.audio: sfx (positional), procedural engine, sirens, radio, score music, ambience, sound captions.
// Web Audio API directly. Nothing here may throw: every public entry point is guarded.
import { G } from './core.js';

const SFX = 'assets/sfx/', MUS = 'assets/music/', GEN = 'assets/gen/';
const MAX_VOICES = 24;

// name -> number of variants (files <name>_00.ogg ...)
const VARIANTS = {
  crash: 8, crash_big: 6, bump: 5, explosion: 3, punch: 3, hit_body: 5, hurt: 6, death_m: 6,
  ped_scream_f: 4, ped_hurt_f: 7, step_asphalt: 3, step_concrete: 3, step_grass: 3, step: 5,
  step_carpet: 3, step_wood: 3, step_wetroad: 3, door: 5, loot: 2, chime: 2, ui_select: 3,
  ui_error: 2, lift: 3, arc_shot: 3,
};
const WEAPONS = { pistol: 3, shotgun: 3, smg: 3 };            // <name>_v1.._v3
const SINGLES = { crowd_loop: 1, scrape_loop: 1 };
const ALIAS = {
  shoot: 'pistol', gunshot: 'pistol', gun: 'pistol', shot: 'pistol', money: 'cash', coin: 'cash', pickup: 'loot',
  select: 'ui_select', click: 'ui_select', ui: 'ui_select', error: 'ui_error', deny: 'ui_error',
  scream: 'ped_scream_f', death: 'death_m', die: 'death_m', hit: 'hit_body', footstep: 'step_asphalt',
  step_road: 'step_asphalt', step_sidewalk: 'step_concrete', step_sand: 'step_grass', crash_small: 'bump',
  explode: 'explosion', boom: 'explosion', fists: 'punch', swing: 'whoosh', mission_complete: 'chime',
  success: 'chime', bell: 'scooter_bell', police_siren: 'siren', skid: 'screech', tire: 'screech',
  tyre: 'screech', splash: 'whoosh', honk: 'horn', car_door: 'door', reload: 'door', ped_hurt: 'ped_hurt_f',
  ped_scream: 'ped_scream_f', hurt_f: 'ped_hurt_f', crash_heavy: 'crash_big',
};
// name -> [default volume, audible distance]
const PROFILE = {
  explosion: [1.0, 260], pistol: [0.6, 170], smg: [0.5, 170], shotgun: [0.75, 190], crash_big: [0.95, 140],
  crash: [0.8, 110], bump: [0.6, 70], punch: [0.7, 40], hit_body: [0.7, 40], hurt: [0.7, 45], death_m: [0.75, 55],
  ped_scream_f: [0.6, 70], ped_hurt_f: [0.6, 50], door: [0.55, 35], loot: [0.6, 40], chime: [0.6, 60],
  ui_select: [0.45, 30], ui_error: [0.5, 30], horn: [0.5, 120], scooter_bell: [0.4, 50], whoosh: [0.4, 30],
  cash: [0.5, 40], screech: [0.35, 80],
};
const NO_PITCH_VAR = { ui_select: 1, ui_error: 1, chime: 1, loot: 1 };
const PRELOAD = ['crash', 'crash_big', 'bump', 'explosion', 'pistol', 'smg', 'punch', 'hit_body', 'hurt', 'door',
  'loot', 'chime', 'ui_select', 'ui_error', 'step_asphalt', 'ped_scream_f', 'death_m'];
const CAPTIONS = {
  crash: 'התנגשות', crash_big: 'התנגשות חזקה', explosion: 'פיצוץ', pistol: 'יריות', smg: 'יריות', shotgun: 'יריות',
  horn: 'צופר', ped_scream_f: 'צעקות', death_m: 'זעקה', scooter_bell: 'פעמון קורקינט',
};
const CAPTION_KEY = { crash_big: 'crash', smg: 'pistol', shotgun: 'pistol' };

const STATIONS = [
  { name: 'רדיו טיילת 101.5', tagline: 'הלהיטים של החוף, בלי פקקים', tracks: ['radio_pop_1', 'radio_pop_2'] },
  { name: 'לילה לבן FM', tagline: 'העיר לא הולכת לישון - גם אנחנו לא', tracks: ['club_edm_1', 'club_edm_2'] },
  { name: 'פלורנטין אנדרגראונד', tagline: 'משדרים ממקלט ליד סטודיו הקעקועים', tracks: ['radio_underground_1', 'radio_underground_2'] },
  { name: "ג'אז בשדרה", tagline: 'אספרסו כפול וסקסופון אחד', tracks: ['jazz_noir_1', 'venue_lounge'] },
  { name: "סינת' ים תיכוני", tagline: 'שקיעה, ניאון וכוס ערק', tracks: ['bar_synthwave_1', 'explore_night_1'] },
];
for (const s of STATIONS) { s.tracks = s.tracks.map((t) => MUS + t + '.ogg'); s.ti = 0; s.savedTime = -1; s.savedAt = 0; }

// ------------------------------------------------------------------ state
let ctx = null, master = null, comp = null, musicBus = null, sfxBus = null;
let whiteBuf = null, brownBuf = null, whiteSrc = null, brownSrc = null;
let running = false, startedUp = false;
const buffers = new Map();      // url -> AudioBuffer | null (failed) | Promise
const voices = [];
const lastPlayed = Object.create(null);   // name -> ms
const capLast = Object.create(null);
let warned = 0;

// listener (player position, camera orientation)
let Lx = 0, Lz = 0, Rx = 1, Rz = 0, Fx = 0, Fz = -1;
const sp = { gain: 1, pan: 0, d: 0 };

// engine nodes
let eng = null;
let lastGear = 0, shiftT = 0, engHint = null;
// siren
let sir = null, sirenD = 1e9, sirenX = 0, sirenZ = 0, sirenPrevD = 1e9, sirenApproach = false, sirenDirWord = '';
let sirenBoostUntil = 0, sirenBoostX = 0, sirenBoostZ = 0, sirenBoostPos = false;
// traffic pass-by
let traf = null, trafD = 1e9, trafX = 0, trafZ = 0, trafSpeed = 0;
// ambience
let amb = null, crowdVol = 0, scanT = 0, pedT = 0, gullT = 6;
// radio
let radioEl = null, radioNode = null, radioFilter = null, radioGain = null;
let radioActive = false, radioVeh = null, prevVeh = null, radioErr = 0, pendingSeek = 0, radioSilentT = 0, lastNextAt = 0;
// score
const scores = new Map();
let scoreName = null, scoreCur = null, scoreOverride, wantedZeroT = 0;

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function warn(where, e) { if (warned++ < 8) console.warn('[audio:' + where + ']', e); }

function ramp(p, v, tc = 0.08) {
  if (!p || !ctx) return;
  if (!(v === v)) return; // NaN guard
  const last = p._tv;
  if (last !== undefined && Math.abs(last - v) <= Math.abs(v) * 0.01 + 1e-4) return;
  p._tv = v;
  try { p.setTargetAtTime(v, ctx.currentTime, tc); } catch { /* ignore */ }
}

// ------------------------------------------------------------------ context + graph
function ensureCtx() {
  if (ctx) return ctx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC({ latencyHint: 'interactive' });
    master = ctx.createGain();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 24; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.22;
    musicBus = ctx.createGain(); sfxBus = ctx.createGain();
    musicBus.connect(master); sfxBus.connect(master); master.connect(comp); comp.connect(ctx.destination);
    applyVolumes(true);
    makeNoise();
    try { buildEngine(); } catch (e) { warn('engine', e); eng = null; }
    try { buildSiren(); } catch (e) { warn('siren', e); sir = null; }
    try { buildAmbience(); } catch (e) { warn('ambience', e); amb = null; }
    try { buildRadio(); } catch (e) { warn('radio', e); radioEl = null; }
  } catch (e) { warn('ctx', e); ctx = null; }
  return ctx;
}

function applyVolumes(instant) {
  if (!ctx) return;
  const s = G.settings || {};
  const m = clamp(+s.masterVolume >= 0 ? +s.masterVolume : 0.8, 0, 1.5);
  const mu = clamp(+s.musicVolume >= 0 ? +s.musicVolume : 0.6, 0, 1.5);
  const sf = clamp(+s.sfxVolume >= 0 ? +s.sfxVolume : 0.9, 0, 1.5);
  if (instant) { master.gain.value = m; musicBus.gain.value = mu; sfxBus.gain.value = sf; master.gain._tv = m; musicBus.gain._tv = mu; sfxBus.gain._tv = sf; } else { ramp(master.gain, m, 0.05); ramp(musicBus.gain, mu, 0.05); ramp(sfxBus.gain, sf, 0.05); }
}

function unlock() {
  try {
    if (!ensureCtx()) return;
    if (ctx.state !== 'running') { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); }
    if (ctx.state === 'running') onRunning();
    else if (ctx.resume) ctx.resume().then(() => { if (ctx.state === 'running') onRunning(); }).catch(() => {});
  } catch (e) { warn('unlock', e); }
}
function onRunning() {
  running = true;
  if (startedUp) return;
  startedUp = true;
  try { preload(PRELOAD); } catch { /* ignore */ }
  try {
    loadBuffer(SFX + 'crowd_loop.ogg').then((buf) => {
      if (!buf || !amb || amb.crowdSrc) return;
      const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.connect(amb.crowdG); s.start(); amb.crowdSrc = s;
    }).catch(() => {});
  } catch { /* ignore */ }
}

function makeNoise() {
  const sr = ctx.sampleRate;
  whiteBuf = ctx.createBuffer(1, sr * 2, sr);
  const w = whiteBuf.getChannelData(0);
  for (let i = 0; i < w.length; i++) w[i] = Math.random() * 2 - 1;
  brownBuf = ctx.createBuffer(1, sr * 4, sr);
  const b = brownBuf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < b.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
  // make the brown loop seamless-ish: crossfade the tail into the head
  const fade = Math.min(4000, b.length >> 2);
  for (let i = 0; i < fade; i++) { const t = i / fade; b[b.length - fade + i] = b[b.length - fade + i] * (1 - t) + b[i] * t; }
  whiteSrc = ctx.createBufferSource(); whiteSrc.buffer = whiteBuf; whiteSrc.loop = true; whiteSrc.start();
  brownSrc = ctx.createBufferSource(); brownSrc.buffer = brownBuf; brownSrc.loop = true; brownSrc.start();
}

function mkGain(v) { const g = ctx.createGain(); g.gain.value = v; g.gain._tv = v; return g; }
function mkFilter(type, f, q) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.frequency._tv = f; if (q !== undefined) b.Q.value = q; return b; }
function mkOsc(type, f) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.frequency._tv = f; o.start(); return o; }
function mkPan() { return ctx.createStereoPanner ? ctx.createStereoPanner() : null; }

function buildEngine() {
  const bus = mkGain(0); bus.connect(sfxBus);
  // combustion
  const lp = mkFilter('lowpass', 500, 1.2);
  const combG = mkGain(0);
  const o1 = mkOsc('sawtooth', 55), o2 = mkOsc('sawtooth', 55), o3 = mkOsc('square', 27.5);
  o2.detune.value = 14; o3.detune.value = -9;
  const g1 = mkGain(0.5), g2 = mkGain(0.4), g3 = mkGain(0.35);
  o1.connect(g1); o2.connect(g2); o3.connect(g3); g1.connect(lp); g2.connect(lp); g3.connect(lp);
  const nBp = mkFilter('bandpass', 260, 0.7), nG = mkGain(0.5);
  brownSrc.connect(nBp); nBp.connect(nG); nG.connect(lp);
  lp.connect(combG); combG.connect(bus);
  // electric whine
  const e1 = mkOsc('sine', 200), e2 = mkOsc('triangle', 300), elecG = mkGain(0), e2g = mkGain(0.25);
  const eLp = mkFilter('lowpass', 3200, 0.5);
  e1.connect(eLp); e2.connect(e2g); e2g.connect(eLp); eLp.connect(elecG); elecG.connect(bus);
  // tyre screech
  const sBp = mkFilter('bandpass', 2100, 7), sBp2 = mkFilter('bandpass', 2850, 9), screechG = mkGain(0);
  whiteSrc.connect(sBp); whiteSrc.connect(sBp2); sBp.connect(screechG); sBp2.connect(screechG); screechG.connect(bus);
  // wind
  const wBp = mkFilter('bandpass', 520, 0.5), windG = mkGain(0);
  whiteSrc.connect(wBp); wBp.connect(windG); windG.connect(bus);
  eng = { bus, lp, combG, o1, o2, o3, nBp, e1, e2, elecG, sBp, screechG, wBp, windG };
}

function buildSiren() {
  const osc = mkOsc('sawtooth', 900), osc2 = mkOsc('square', 904);
  const lfo = mkOsc('sine', 0.42), lfoG = mkGain(290);
  lfo.connect(lfoG); lfoG.connect(osc.frequency); lfoG.connect(osc2.frequency);
  const mix = mkGain(0.5), mix2 = mkGain(0.18);
  const bp = mkFilter('lowpass', 2600, 0.8), g = mkGain(0), pan = mkPan();
  osc.connect(mix); osc2.connect(mix2); mix.connect(bp); mix2.connect(bp); bp.connect(g);
  if (pan) { g.connect(pan); pan.connect(sfxBus); } else g.connect(sfxBus);
  sir = { osc, lfo, bp, g, pan };
  // traffic pass-by: low rumble that follows the nearest moving car
  const to = mkOsc('sawtooth', 62), tlp = mkFilter('lowpass', 260, 0.8), tg = mkGain(0), tpan = mkPan(), tn = mkGain(0.8), to_g = mkGain(0.35);
  to.connect(to_g); to_g.connect(tlp); brownSrc.connect(tn); tn.connect(tlp); tlp.connect(tg);
  if (tpan) { tg.connect(tpan); tpan.connect(sfxBus); } else tg.connect(sfxBus);
  traf = { o: to, lp: tlp, g: tg, pan: tpan };
}

function buildAmbience() {
  // sea: filtered noise with slow swell
  const seaLp = mkFilter('lowpass', 650, 0.4), swell = mkGain(0.6), seaG = mkGain(0), seaPan = mkPan();
  const lfo = mkOsc('sine', 0.11), lfoG = mkGain(0.38), lfo2 = mkOsc('sine', 0.07), lfo2G = mkGain(260);
  lfo.connect(lfoG); lfoG.connect(swell.gain); lfo2.connect(lfo2G); lfo2G.connect(seaLp.frequency);
  const seaHiss = mkFilter('highpass', 2500, 0.3), hissG = mkGain(0.06);
  whiteSrc.connect(seaHiss); seaHiss.connect(hissG); hissG.connect(swell);
  brownSrc.connect(seaLp); seaLp.connect(swell); swell.connect(seaG);
  if (seaPan) { seaG.connect(seaPan); seaPan.connect(sfxBus); } else seaG.connect(sfxBus);
  // city hum
  const humLp = mkFilter('lowpass', 210, 0.5), humG = mkGain(0);
  brownSrc.connect(humLp); humLp.connect(humG); humG.connect(sfxBus);
  // crowd loop (buffer attached when loaded)
  const crowdG = mkGain(0); crowdG.connect(sfxBus);
  amb = { seaG, seaPan, humG, crowdG, crowdSrc: null };
}

// ------------------------------------------------------------------ buffers
function loadBuffer(url) {
  const c = buffers.get(url);
  if (c !== undefined) return c instanceof Promise ? c : Promise.resolve(c);
  if (!ctx) return Promise.resolve(null);
  const p = fetch(url).then((r) => (r.ok ? r.arrayBuffer() : null))
    .then((ab) => (ab ? new Promise((res) => { try { const q = ctx.decodeAudioData(ab, res, () => res(null)); if (q && q.catch) q.catch(() => res(null)); } catch { res(null); } }) : null))
    .then((buf) => { buffers.set(url, buf || null); return buf || null; })
    .catch(() => { buffers.set(url, null); return null; });
  buffers.set(url, p);
  return p;
}
function urlsFor(name) {
  const out = [];
  if (VARIANTS[name]) for (let i = 0; i < VARIANTS[name]; i++) out.push(SFX + name + '_0' + i + '.ogg');
  else if (WEAPONS[name]) for (let i = 1; i <= WEAPONS[name]; i++) out.push(SFX + name + '_v' + i + '.ogg');
  else out.push(SFX + name + '.ogg');
  return out;
}
function preload(names) { if (!ctx) return; for (const n of names) for (const u of urlsFor(ALIAS[n] || n)) loadBuffer(u); }
function pickUrl(name) {
  if (VARIANTS[name]) return SFX + name + '_0' + ((Math.random() * VARIANTS[name]) | 0) + '.ogg';
  if (WEAPONS[name]) return SFX + name + '_v' + (1 + ((Math.random() * WEAPONS[name]) | 0)) + '.ogg';
  if (SINGLES[name] || /_\d\d$|_v\d$/.test(name)) return SFX + name + '.ogg';
  return null;
}

// ------------------------------------------------------------------ spatial
function updateListener() {
  const cam = G.camera, p = G.player;
  const e = cam && cam.matrixWorld && cam.matrixWorld.elements;
  if (e) {
    const l = Math.hypot(e[0], e[2]);
    if (l > 1e-4) { Rx = e[0] / l; Rz = e[2] / l; Fx = Rz; Fz = -Rx; }
  }
  const src = (p && p.inVehicle && p.inVehicle.pos) || (p && p.pos);
  if (src && src.x === src.x && src.z === src.z) { Lx = src.x; Lz = src.z; } else if (e) { Lx = e[12]; Lz = e[14]; }
}
function spatial(x, z, maxDist) {
  const dx = x - Lx, dz = z - Lz, d = Math.hypot(dx, dz);
  sp.d = d;
  const a = clamp(1 - d / maxDist, 0, 1);
  let g = a * a;
  let pan = 0;
  if (d > 0.5) {
    const r = (dx * Rx + dz * Rz) / d, f = (dx * Fx + dz * Fz) / d;
    pan = clamp(r * 0.85, -1, 1) * clamp(d / 3, 0, 1);
    if (f < 0) g *= 0.82;
  }
  sp.gain = g; sp.pan = pan;
  return sp;
}
function dirWord(x, z) {
  const dx = x - Lx, dz = z - Lz, d = Math.hypot(dx, dz);
  if (d < 5) return '';
  const r = (dx * Rx + dz * Rz) / d, f = (dx * Fx + dz * Fz) / d;
  if (r > 0.42) return ' מימין';
  if (r < -0.42) return ' משמאל';
  return f < 0 ? ' מאחור' : ' מלפנים';
}

// ------------------------------------------------------------------ captions
function caption(text) {
  try { if (text && G.settings?.subtitles !== false) G.hud?.caption?.(String(text)); } catch { /* ignore */ }
}
function autoCaption(key, text, gap = 3) {
  if (G.settings?.subtitles === false) return;
  const t = nowMs() / 1000;
  if (t - (capLast[key] || -99) < gap) return;
  capLast[key] = t;
  caption(text);
}

// ------------------------------------------------------------------ one-shots
function outNode(vol, pan, dur, bus) {
  const g = ctx.createGain(); g.gain.value = vol;
  let last = g;
  const p = pan ? mkPan() : null;
  if (p) { p.pan.value = pan; g.connect(p); last = p; }
  last.connect(bus || sfxBus);
  setTimeout(() => { try { g.disconnect(); if (p) p.disconnect(); } catch { /* ignore */ } }, (dur + 0.4) * 1000);
  return g;
}
function playBuffer(buf, vol, pan, rate) {
  if (voices.length >= MAX_VOICES) { const old = voices.shift(); try { old.src.onended = null; old.src.stop(); old.g.disconnect(); if (old.p) old.p.disconnect(); } catch { /* ignore */ } }
  const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
  const g = ctx.createGain(); g.gain.value = vol; src.connect(g);
  const p = pan ? mkPan() : null;
  if (p) { p.pan.value = pan; g.connect(p); p.connect(sfxBus); } else g.connect(sfxBus);
  const v = { src, g, p };
  voices.push(v);
  src.onended = () => { const i = voices.indexOf(v); if (i >= 0) voices.splice(i, 1); try { g.disconnect(); if (p) p.disconnect(); } catch { /* ignore */ } };
  src.start();
}

function synthHorn(vol, pan, pitch) {
  const t = ctx.currentTime, dur = 0.42;
  const out = outNode(1, pan, dur);
  const env = ctx.createGain(); env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(vol * 0.5, t + 0.015); env.gain.setValueAtTime(vol * 0.5, t + dur - 0.04); env.gain.linearRampToValueAtTime(0, t + dur);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400 * pitch;
  for (const f of [415, 523]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * pitch; o.connect(lp); o.start(t); o.stop(t + dur + 0.05); }
  lp.connect(env); env.connect(out);
}
function synthBell(vol, pan) {
  const t = ctx.currentTime;
  const out = outNode(1, pan, 0.7);
  for (let k = 0; k < 2; k++) for (const [f, a] of [[2093, 1], [3140, 0.5], [4710, 0.22]]) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const g = ctx.createGain(), t0 = t + k * 0.17;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol * 0.4 * a, t0 + 0.004); g.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.38);
    o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + 0.42);
  }
}
function synthNoise(vol, pan, dur, f0, f1, f2, q, bus) {
  const t = ctx.currentTime;
  const out = outNode(1, pan, dur, bus);
  const s = ctx.createBufferSource(); s.buffer = whiteBuf; s.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q;
  bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.5); bp.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + dur * 0.25); g.gain.linearRampToValueAtTime(0, t + dur);
  s.connect(bp); bp.connect(g); g.connect(out); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
}
function synthCash(vol, pan) {
  const t = ctx.currentTime;
  const out = outNode(1, pan, 0.6);
  [1318, 1760, 2637].forEach((f, i) => {
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const g = ctx.createGain(), t0 = t + i * 0.06;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol * 0.35, t0 + 0.005); g.gain.exponentialRampToValueAtTime(0.0008, t0 + (i === 2 ? 0.4 : 0.14));
    o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + 0.45);
  });
}
function synthGull(vol, pan) {
  const t = ctx.currentTime, n = 2 + ((Math.random() * 3) | 0), base = 1300 + Math.random() * 500;
  const out = outNode(1, pan, n * 0.3 + 0.2);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2300; bp.Q.value = 2.5; bp.connect(out);
  for (let i = 0; i < n; i++) {
    const t0 = t + i * (0.24 + Math.random() * 0.06);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(base, t0); o.frequency.exponentialRampToValueAtTime(base * 1.75, t0 + 0.06); o.frequency.exponentialRampToValueAtTime(base * 1.15, t0 + 0.2);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.03); g.gain.linearRampToValueAtTime(0, t0 + 0.21);
    o.connect(g); g.connect(bp); o.start(t0); o.stop(t0 + 0.24);
  }
}
function staticBurst() {
  if (!ctx || !running) return;
  try {
    synthNoise(0.28, 0, 0.34, 700 + Math.random() * 600, 3600, 1200, 1.2, musicBus);
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(2400, t); o.frequency.exponentialRampToValueAtTime(500, t + 0.25);
    g.gain.setValueAtTime(0.03, t); g.gain.linearRampToValueAtTime(0, t + 0.26);
    o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + 0.3);
    setTimeout(() => { try { g.disconnect(); } catch { /* ignore */ } }, 600);
  } catch { /* ignore */ }
}

const MIN_GAP = { crash: 110, crash_big: 140, bump: 110, explosion: 90, horn: 160, hurt: 120, door: 90, cash: 80, loot: 80 };

function play(name, opts) {
  try {
    if (typeof name !== 'string' || !name) return;
    name = ALIAS[name] || name;
    let o = opts || {};
    if (typeof o === 'number') o = { volume: o };
    else if (o.pos === undefined && typeof o.x === 'number' && typeof o.z === 'number') o = { pos: o };
    const pos = o.pos && typeof o.pos.x === 'number' && typeof o.pos.z === 'number' ? o.pos : null;
    const px = pos ? pos.x : 0, pz = pos ? pos.z : 0;
    const t = nowMs();
    if (t - (lastPlayed[name] || -1e9) < (MIN_GAP[name] || 35)) return;
    lastPlayed[name] = t;

    if (name === 'siren') { sirenBoostUntil = t + 2600; sirenBoostPos = !!pos; sirenBoostX = px; sirenBoostZ = pz; return; }

    const cap = CAPTIONS[name];
    if (cap) autoCaption(CAPTION_KEY[name] || name, '[' + cap + (pos ? dirWord(px, pz) : '') + ']', name === 'horn' ? 2 : 3);

    if (!ctx || !running || ctx.state !== 'running') return;
    const prof = PROFILE[name] || (name.startsWith('step') ? [0.32, 26] : [0.7, 70]);
    let vol = prof[0] * (typeof o.volume === 'number' && o.volume === o.volume ? clamp(o.volume, 0, 3) : 1);
    let pan = 0;
    if (pos) { const s = spatial(px, pz, prof[1]); vol *= s.gain; pan = s.pan; if (vol < 0.004) return; }
    const pitch = typeof o.pitch === 'number' && o.pitch > 0 ? clamp(o.pitch, 0.25, 4) : 1;

    switch (name) {
      case 'horn': synthHorn(vol, pan, pitch); return;
      case 'scooter_bell': synthBell(vol, pan); return;
      case 'whoosh': synthNoise(vol * 0.6, pan, 0.3, 350 * pitch, 2400 * pitch, 600 * pitch, 1.4); return;
      case 'screech': synthNoise(vol * 0.5, pan, 0.45, 2300, 2000, 1700, 7); return;
      case 'cash': synthCash(vol, pan); return;
      default: break;
    }
    const url = pickUrl(name) || (SFX + name + '.ogg');
    const rate = pitch * (NO_PITCH_VAR[name] ? 1 : 0.94 + Math.random() * 0.12);
    const c = buffers.get(url);
    if (c && !(c instanceof Promise)) { playBuffer(c, vol, pan, rate); return; }
    if (c === null) return;
    loadBuffer(url).then((buf) => {
      if (!buf || nowMs() - t > 700) return;
      try { playBuffer(buf, vol, pan, rate); } catch { /* ignore */ }
    }).catch(() => {});
  } catch (e) { warn('play', e); }
}

// play `name` only if nobody else played one of `group` around this moment (other modules usually do it themselves)
function fallback(group, name, opts, delay = 90) {
  const snap = opts && opts.pos && typeof opts.pos.x === 'number' ? { ...opts, pos: { x: opts.pos.x, z: opts.pos.z } } : opts;
  setTimeout(() => {
    const t = nowMs();
    for (const g of group) if (t - (lastPlayed[g] || -1e9) < 380) return;
    play(name, snap);
  }, delay);
}

// ------------------------------------------------------------------ radio
const radio = {
  stations: STATIONS, index: 0, isOff: false,
  get current() { return radio.isOff ? null : (STATIONS[radio.index] || null); },
  next() { step(1); }, prev() { step(-1); },
  off() {
    try { radio.isOff = true; radioPause(); G.hud?.toast?.('📻 הרדיו כבוי'); autoCaption('radio', '[רדיו: כבוי]', 0.5); } catch { /* ignore */ }
  },
  on() { try { radio.isOff = false; tune(radio.index, true); } catch { /* ignore */ } },
};
function step(dir) {
  try {
    const t = nowMs();
    if (t - lastNextAt < 250) return;
    lastNextAt = t;
    const n = STATIONS.length; if (!n) return;
    const idx = radio.isOff ? clamp(radio.index, 0, n - 1) : ((radio.index + dir) % n + n) % n;
    radio.isOff = false;
    tune(idx, true);
  } catch (e) { warn('radio.step', e); }
}
function announce(st) {
  if (!st) return;
  try { G.hud?.toast?.('📻 ' + st.name + (st.tagline ? ' · ' + st.tagline : '')); } catch { /* ignore */ }
  autoCaption('radio', '[רדיו: ' + st.name + ']', 0.5);
}
function buildRadio() {
  radioEl = new Audio(); radioEl.preload = 'auto'; radioEl.loop = false;
  radioNode = ctx.createMediaElementSource(radioEl);
  radioFilter = mkFilter('lowpass', 18000, 0.6); radioGain = mkGain(0);
  radioNode.connect(radioFilter); radioFilter.connect(radioGain); radioGain.connect(musicBus);
  radioEl.addEventListener('loadedmetadata', () => {
    try { const d = radioEl.duration; if (pendingSeek > 0 && isFinite(d) && d > 2) radioEl.currentTime = pendingSeek % d; } catch { /* ignore */ }
    pendingSeek = 0;
  });
  radioEl.addEventListener('playing', () => { radioErr = 0; });
  radioEl.addEventListener('ended', () => { const st = radio.current; if (!st || !radioActive) return; st.ti = (st.ti + 1) % st.tracks.length; st.savedTime = -1; loadTrack(st, false); });
  radioEl.addEventListener('error', () => { const st = radio.current; if (!st || !radioActive || ++radioErr > 5) return; st.ti = (st.ti + 1) % st.tracks.length; st.savedTime = -1; setTimeout(() => { if (radioActive) loadTrack(st, false); }, 200); });
}
function savePos() {
  const st = STATIONS[radio.index];
  if (!st || !radioEl || !radioActive) return;
  try { st.savedTime = radioEl.currentTime || 0; st.savedAt = nowMs(); } catch { /* ignore */ }
}
function loadTrack(st, resume) {
  if (!radioEl || !st || !st.tracks.length) return;
  try {
    pendingSeek = resume ? (st.savedTime >= 0 ? st.savedTime + (nowMs() - st.savedAt) / 1000 : 4 + Math.random() * 40) : 0;
    radioEl.src = st.tracks[st.ti % st.tracks.length];
    const p = radioEl.play(); if (p && p.catch) p.catch(() => {});
  } catch (e) { warn('radio.load', e); }
}
function tune(idx, withToast) {
  savePos();
  radio.index = idx;
  const st = STATIONS[idx];
  if (withToast) announce(st);
  if (!ctx || !radioEl || !st) return;
  radioActive = true; radioSilentT = 0;
  if (!radioVeh) radioVeh = G.player?.inVehicle || null;
  staticBurst();
  loadTrack(st, true);
}
function radioPause() {
  if (!radioEl || !radioActive) { radioActive = false; return; }
  savePos(); radioActive = false;
  try { radioEl.pause(); } catch { /* ignore */ }
  if (radioGain) ramp(radioGain.gain, 0, 0.05);
}
function updateRadio(dt, paused) {
  const veh = G.player?.inVehicle || null;
  if (veh !== prevVeh) {
    if (veh) {
      radioVeh = veh;
      if (!radio.isOff && G.started) { if (!radioActive) tune(radio.index, true); else announce(radio.current); }
    }
    prevVeh = veh;
  }
  if (!radioEl || !radioGain) return;
  if (!radioActive) { ramp(radioGain.gain, 0, 0.1); return; }
  let g = 0, cut = 18000;
  const duck = scoreName === 'pursuit' ? 0.14 : 1;
  if (!G.started) g = 0;
  else if (veh) g = 0.9 * duck;
  else {
    const rv = radioVeh, ok = rv && !rv.destroyed && rv.pos;
    const d = ok ? Math.hypot(rv.pos.x - Lx, rv.pos.z - Lz) : 999;
    g = 0.55 * clamp(1 - d / 26, 0, 1) * duck; cut = 620;
    if (g <= 0.001) { radioSilentT += dt; if (radioSilentT > 2.5) { radioPause(); return; } } else radioSilentT = 0;
  }
  if (paused && G.started) { g *= 0.45; cut = Math.min(cut, 900); }
  ramp(radioGain.gain, g, 0.18);
  ramp(radioFilter.frequency, cut, 0.12);
  if (radioEl.paused && g > 0 && !radioEl.ended && radioErr <= 5 && radioEl.readyState >= 2) { try { const p = radioEl.play(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ } }
}

// ------------------------------------------------------------------ score music
function music(name) {
  try { scoreOverride = (typeof name === 'string' && name) ? name : undefined; wantedZeroT = 0; } catch { /* ignore */ }
}
function scoreEntry(name) {
  let e = scores.get(name);
  if (e) return e;
  const el = new Audio(); el.preload = 'auto'; el.loop = true; el.src = MUS + name + '.ogg';
  const node = ctx.createMediaElementSource(el), gain = mkGain(0);
  node.connect(gain); gain.connect(musicBus);
  e = { name, el, gain, bad: false, stopAt: 0 };
  el.addEventListener('error', () => { e.bad = true; });
  scores.set(name, e);
  return e;
}
function updateScore(dt, paused) {
  const veh = G.player?.inVehicle || null, lvl = G.wanted?.level || 0;
  if (scoreOverride === 'pursuit' && G.wanted) { if (lvl <= 0) { wantedZeroT += dt; if (wantedZeroT > 5) scoreOverride = undefined; } else wantedZeroT = 0; }
  let want, vol;
  if (!G.started) { want = 'venue_warm'; vol = 0.5; }
  else if (scoreOverride) { want = scoreOverride; vol = want === 'pursuit' ? 0.85 : 0.6; }
  else if (lvl >= 2) { want = 'pursuit'; vol = 0.85; }
  else if (veh && radioActive && !radio.isOff) { want = null; vol = 0; }
  else { want = G.sky?.isNight ? 'night' : 'street'; vol = 0.4; }
  if (paused && G.started) vol *= 0.5;
  if (want !== scoreName) {
    if (scoreCur) { ramp(scoreCur.gain.gain, 0, 0.45); scoreCur.stopAt = nowMs() + 2500; }
    scoreName = want; scoreCur = null;
    if (want) {
      try {
        const e = scoreEntry(want);
        if (!e.bad) { e.stopAt = 0; scoreCur = e; const p = e.el.play(); if (p && p.catch) p.catch(() => {}); }
      } catch (e) { warn('score', e); }
    }
  }
  if (scoreCur) {
    if (scoreCur.bad && want === 'venue_warm') { scoreCur = null; try { const e = scoreEntry('street'); if (!e.bad) { scoreCur = e; e.el.play()?.catch?.(() => {}); } } catch { /* ignore */ } }
    if (scoreCur) ramp(scoreCur.gain.gain, vol, 0.5);
  }
  const t = nowMs();
  for (const e of scores.values()) if (e.stopAt && e !== scoreCur && t > e.stopAt) { e.stopAt = 0; try { e.el.pause(); } catch { /* ignore */ } }
}

// ------------------------------------------------------------------ engine
const ENGINE = {
  taxi: [52, 36, 1], roadster: [64, 48, 1.15], van: [42, 30, 1.05], pickup: [44, 32, 1.1], police: [58, 44, 1.1],
  sportbike: [92, 46, 0.9], policebike: [86, 44, 0.9], courier: [48, 30, 1], scooter: [80, 20, 0.7],
};
const GEARS = [0, 0.16, 0.34, 0.55, 0.78, 1.08];
function isElectric(v) { const ty = String(v.type || ''); return !!(v.isBike && (ty === 'scooter' || ty.includes('scooter') || ty.includes('ebike'))) || v.electric === true; }
function updateEngine(dt, paused) {
  if (!eng) return;
  const veh = (!paused && G.started) ? (G.player ? G.player.inVehicle : engHint) : null;
  if (!veh || veh.destroyed) {
    ramp(eng.bus.gain, 0, 0.14); ramp(eng.screechG.gain, 0, 0.08); ramp(eng.windG.gain, 0, 0.2);
    return;
  }
  ramp(eng.bus.gain, 1, 0.2);
  const sv = +veh.speed || 0, v = Math.abs(sv);
  const thr = clamp(Math.abs(G.input?.axis?.y || 0) + (G.input?.padDown?.(7) ? 1 : 0), 0, 1);
  if (isElectric(veh)) {
    const f = Math.min(150 + v * 46 + thr * 40, 2600);
    ramp(eng.e1.frequency, f, 0.07); ramp(eng.e2.frequency, f * 1.503, 0.07);
    ramp(eng.elecG.gain, Math.min(0.018 + v * 0.0055, 0.085) + thr * 0.02, 0.1);
    ramp(eng.combG.gain, 0, 0.1);
  } else {
    const pr = ENGINE[veh.type] || ENGINE.taxi, top = pr[1];
    let gear = 0;
    while (gear < 4 && v > GEARS[gear + 1] * top) gear++;
    if (gear !== lastGear) { if (v > 2) shiftT = 0.16; lastGear = gear; }
    if (shiftT > 0) shiftT -= dt;
    const lo = GEARS[gear] * top * 0.55, hi = GEARS[gear + 1] * top;
    const frac = clamp((v - lo) / (hi - lo), 0, 1.15);
    const f = pr[0] * (1 + frac * 1.7 + thr * 0.12) * (sv < -0.5 ? 1.15 : 1);
    ramp(eng.o1.frequency, f, 0.06); ramp(eng.o2.frequency, f * 1.006, 0.06); ramp(eng.o3.frequency, f * 0.5, 0.06);
    ramp(eng.lp.frequency, 320 + frac * 1300 + thr * 900, 0.08);
    ramp(eng.nBp.frequency, 180 + frac * 500, 0.1);
    ramp(eng.combG.gain, (0.085 + frac * 0.06 + thr * 0.075) * pr[2] * (shiftT > 0 ? 0.5 : 1), 0.05);
    ramp(eng.elecG.gain, 0, 0.1);
  }
  // tyre screech
  let slip = 0;
  if (typeof veh.slip === 'number') slip = clamp(Math.abs(veh.slip), 0, 1);
  else if (veh.drifting !== undefined) slip = veh.drifting ? 1 : 0;
  else if (veh.vel) { const h = +veh.heading || 0; const lat = Math.abs(veh.vel.x * Math.cos(h) - veh.vel.z * Math.sin(h)); slip = clamp((lat - 2.5) / 6, 0, 1); }
  if (veh.drifting && slip < 0.6) slip = 0.6;
  if (v < 3) slip = 0;
  ramp(eng.screechG.gain, slip * (veh.isBike ? 0.05 : 0.11), 0.06);
  ramp(eng.sBp.frequency, 1900 + v * 14, 0.1);
  // wind
  const w = clamp((v - 10) / 30, 0, 1);
  ramp(eng.windG.gain, w * w * 0.22 + (veh.isBike ? clamp(v / 25, 0, 1) * 0.06 : 0), 0.25);
  ramp(eng.wBp.frequency, 420 + v * 14, 0.3);
}

// ------------------------------------------------------------------ sirens + traffic + ambience
function scanVehicles() {
  sirenPrevD = sirenD; sirenD = 1e9; trafD = 1e9;
  const list = G.vehicles?.list, pv = G.player?.inVehicle || null;
  if (list && list.length) {
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      if (!v || v.destroyed || !v.pos) continue;
      const d = Math.hypot(v.pos.x - Lx, v.pos.z - Lz);
      if (v.sirenOn && d < sirenD) { sirenD = d; sirenX = v.pos.x; sirenZ = v.pos.z; }
      if (v !== pv && d < trafD && Math.abs(v.speed || 0) > 3) { trafD = d; trafX = v.pos.x; trafZ = v.pos.z; trafSpeed = Math.abs(v.speed || 0); }
    }
  }
  if (nowMs() < sirenBoostUntil) {
    const d = sirenBoostPos ? Math.hypot(sirenBoostX - Lx, sirenBoostZ - Lz) : 30;
    if (d < sirenD) { sirenD = d; sirenX = sirenBoostPos ? sirenBoostX : Lx; sirenZ = sirenBoostPos ? sirenBoostZ : Lz; }
  }
  sirenApproach = sirenD < sirenPrevD - 0.15;
  if (sirenD < 130 && G.started) {
    const w = dirWord(sirenX, sirenZ);
    const txt = '[סירנות' + (sirenApproach && sirenD > 12 ? ' מתקרבות' : '') + w + ']';
    if (w !== sirenDirWord) { sirenDirWord = w; autoCaption('siren', txt, 2.5); } else autoCaption('siren', txt, 7);
  }
}
function scanPeds() {
  const list = G.npcs?.list;
  let n = 0;
  if (list && list.length) for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (!p || p.alive === false || !p.pos) continue;
    const dx = p.pos.x - Lx, dz = p.pos.z - Lz;
    if (dx * dx + dz * dz < 28 * 28) n++;
  }
  crowdVol = clamp(n / 7, 0, 1) * 0.3;
}
function updateSiren(paused) {
  if (sir) {
    let g = 0;
    if (!paused && G.started && sirenD < 180) {
      const s = spatial(sirenX, sirenZ, 180);
      g = (sirenD < 3 ? 0.16 : 0.26) * s.gain;
      if (sir.pan) ramp(sir.pan.pan, s.pan, 0.1);
      ramp(sir.bp.frequency, 700 + clamp(1 - sirenD / 180, 0, 1) * 2600, 0.2);
      ramp(sir.lfo.frequency, (G.wanted?.level || 0) >= 3 ? 2.6 : 0.42, 0.3);
    }
    ramp(sir.g.gain, g, 0.15);
  }
  if (traf) {
    let g = 0;
    if (!paused && G.started && trafD < 34) {
      const s = spatial(trafX, trafZ, 34);
      g = 0.16 * s.gain * clamp(trafSpeed / 12, 0.3, 1);
      if (traf.pan) ramp(traf.pan.pan, s.pan, 0.12);
      ramp(traf.o.frequency, 48 + trafSpeed * 3.2, 0.15);
      ramp(traf.lp.frequency, 200 + trafSpeed * 22, 0.2);
    }
    ramp(traf.g.gain, g, 0.2);
  }
}
function updateAmbience(dt, paused) {
  if (!amb) return;
  const on = G.started && !paused;
  const seaX = G.world?.seaX;
  let prox = 0;
  if (typeof seaX === 'number') prox = clamp(1 - (Lx - seaX) / 170, 0, 1);
  const inCar = !!G.player?.inVehicle;
  const k = on ? (inCar ? 0.55 : 1) : (G.started ? 0.25 : 0);
  ramp(amb.seaG.gain, Math.pow(prox, 1.6) * 0.5 * k, 0.4);
  if (amb.seaPan) ramp(amb.seaPan.pan, clamp(-Rx * 0.8, -1, 1) * (prox < 0.98 ? 1 : 0.3), 0.3);   // the sea is to the west (-X)
  ramp(amb.humG.gain, (G.sky?.isNight ? 0.05 : 0.085) * (1 - prox * 0.6) * k, 0.5);
  ramp(amb.crowdG.gain, crowdVol * k * (G.sky?.isNight ? 0.7 : 1), 0.6);
  if (on && prox > 0.35 && !G.sky?.isNight) {
    gullT -= dt;
    if (gullT <= 0) { gullT = 4 + Math.random() * 9; try { synthGull(0.035 * prox * (inCar ? 0.5 : 1), Math.random() * 1.6 - 0.8); } catch { /* ignore */ } }
  }
}

// ------------------------------------------------------------------ frame
function handleKeys() {
  const inp = G.input, veh = G.player?.inVehicle;
  if (!inp || !veh) return;
  try {
    if (inp.pressed('KeyR')) radio.next();
    if (inp.pressed('KeyH') && nowMs() - (lastPlayed.horn || -1e9) > 200 && nowMs() - (lastPlayed.scooter_bell || -1e9) > 200) {
      if (isElectric(veh)) play('scooter_bell'); else play('horn', { pitch: veh.isBike ? 1.45 : (veh.type === 'van' || veh.type === 'pickup') ? 0.82 : 1 });
    }
  } catch { /* ignore */ }
}
function tick(dt, paused) {
  try {
    if (!(dt > 0)) dt = 0.016;
    updateListener();
    scanT -= dt;
    if (scanT <= 0) { scanT = 0.15; scanVehicles(); }
    pedT -= dt;
    if (pedT <= 0) { pedT = 0.5; scanPeds(); }
    if (!paused) handleKeys();
    if (!ctx) return;
    if (ctx.state !== 'running') { running = false; return; }
    if (!running) onRunning();
    updateScore(dt, paused);
    updateRadio(dt, paused);
    updateEngine(dt, paused);
    updateSiren(paused);
    updateAmbience(dt, paused);
  } catch (e) { warn('tick', e); }
}

export function update(dt) { tick(dt, false); }
export function updatePaused(dt) { tick(dt, true); }

async function addGenStations() {
  const defs = [
    ['radio_mizrahit', 'מזרחית בלי הפסקה 88.8', 'סלסולים עד הבוקר, בלי פרסומות'],
    ['radio_tlv_techno', 'טכנו נמל 99.9', 'בס מהמחסנים של הנמל'],
    ['radio_med_funk', 'פאנק ים תיכוני 94.2', 'גרוב עם ריח של מלח ואבטיח'],
  ];
  for (const [file, name, tagline] of defs) {
    try {
      const url = GEN + file + '.ogg';
      if (await G.assets?.exists?.(url)) STATIONS.push({ name, tagline, tracks: [url], ti: 0, savedTime: -1, savedAt: 0 });
    } catch { /* ignore */ }
  }
}

export async function init(G_) {
  const api = {
    play, music, radio, caption,
    engine(v) { engHint = v || null; },
    preload, unlock,
    get ctx() { return ctx; },
    get musicName() { return scoreName; },
  };
  G.audio = api;
  if (G_ && G_ !== G) { try { G_.audio = api; } catch { /* ignore */ } }

  const gesture = () => { unlock(); if (ctx && ctx.state === 'running') { for (const ev of ['keydown', 'mousedown', 'pointerdown', 'touchstart']) window.removeEventListener(ev, gesture, true); } };
  for (const ev of ['keydown', 'mousedown', 'pointerdown', 'touchstart']) window.addEventListener(ev, gesture, true);
  document.addEventListener('visibilitychange', () => {
    try { if (!ctx) return; if (document.hidden) ctx.suspend?.(); else ctx.resume?.(); } catch { /* ignore */ }
  });

  const ev = G.events;
  ev.on('game:start', () => unlock());
  ev.on('settings:change', () => applyVolumes(false));
  // Safety nets: other modules normally call G.audio.play themselves; these only fire if nobody did.
  ev.on('vehicle:crash', (d) => { const s = Math.abs(d?.speed || 0); fallback(['crash', 'crash_big', 'bump'], s > 14 ? 'crash_big' : s > 5 ? 'crash' : 'bump', { pos: d?.pos, volume: clamp(s / 12, 0.35, 1) }); });
  ev.on('vehicle:destroyed', (d) => fallback(['explosion'], 'explosion', { pos: d?.pos }));
  ev.on('player:damage', (d) => { if ((d?.amount || 0) >= 2 && nowMs() - (lastPlayed.hurt || -1e9) > 600) fallback(['hurt'], 'hurt', {}); });
  ev.on('player:died', () => fallback(['death_m'], 'death_m', {}));
  ev.on('npc:killed', (d) => fallback(['death_m', 'ped_scream_f', 'ped_hurt_f', 'hurt'], 'death_m', { pos: d?.actor?.pos, volume: 0.8 }));
  ev.on('money', (d) => { if ((d?.amount || 0) > 0) fallback(['cash', 'loot'], 'cash', {}); });
  ev.on('mission:complete', () => fallback(['chime'], 'chime', {}, 140));
  ev.on('mission:fail', () => fallback(['ui_error'], 'ui_error', {}, 140));
  ev.on('mission:start', () => fallback(['ui_select', 'chime'], 'ui_select', {}, 140));
  ev.on('player:enterVehicle', () => fallback(['door'], 'door', {}));
  ev.on('player:exitVehicle', () => fallback(['door'], 'door', {}));

  addGenStations().catch(() => {});
}
