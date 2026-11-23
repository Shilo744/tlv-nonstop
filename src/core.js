// core.js - shared game object G, input, events, settings, asset loading.
// OWNED BY THE LEAD. Other modules import { G } from './core.js' and never edit this file.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

export const G = {
  THREE,
  scene: null, camera: null, renderer: null,
  time: 0, dt: 0, frame: 0,
  started: false,      // false while the title screen is up
  paused: false,       // pause / menu open: modules' update() is not called
  actors: [],          // every AI humanoid: { pos:Vector3, radius, height, alive, kind:'ped'|'cop'|'gang', damage(amount, from) }
  // filled by modules:
  world: null, sky: null, fx: null, vehicles: null, player: null, npcs: null,
  wanted: null, missions: null, hud: null, audio: null,
  renderFrame: null,   // sky.js may set this (post-processing); else main renders directly
  errors: [],
};
window.G = G;

// ---------------------------------------------------------------- events
const listeners = new Map();
G.events = {
  on(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); return fn; },
  off(name, fn) { const a = listeners.get(name); if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } },
  emit(name, data) {
    const a = listeners.get(name); if (!a) return;
    for (const fn of a.slice()) { try { fn(data); } catch (e) { reportError('event:' + name, e); } }
  },
};

export function reportError(where, e) {
  const msg = `[${where}] ${e && e.stack ? e.stack : e}`;
  if (G.errors.length < 200) G.errors.push(msg);
  console.error(msg);
}

// ---------------------------------------------------------------- settings (accessibility first)
const DEFAULTS = {
  // accessibility
  highContrast: false,     // HUD: thick outlines, solid backgrounds, yellow-on-black
  colorblind: 'off',       // 'off' | 'protan' | 'deutan' | 'tritan'  -> HUD/minimap use shapes + safe palette
  textScale: 1,            // 1 | 1.25 | 1.5 | 2
  subtitles: true,         // dialogue + sound captions ("[sirens]")
  screenReader: false,     // announce HUD events through aria-live + speechSynthesis
  reducedMotion: false,    // no camera shake, no bloom flashes, gentle camera
  gameSpeed: 1,            // 1 | 0.75 | 0.5  (main.js scales dt)
  driveAssist: false,      // car steers itself toward the objective along roads; player only holds W
  aimAssist: true,         // lock-on to nearest target
  oneHanded: false,        // mouse-only: hold LMB = go, RMB = brake/reverse, cursor steers
  holdToToggle: true,      // sprint / aim are toggles instead of holds
  invincible: false,       // "story mode": no damage
  // audio / video
  masterVolume: 0.8, musicVolume: 0.6, sfxVolume: 0.9,
  quality: 'high',         // 'low' | 'medium' | 'high'
  language: 'he',          // 'he' | 'en'
};
let saved = {};
try { saved = JSON.parse(localStorage.getItem('tlv_settings') || '{}'); } catch { /* ignore */ }
G.settings = { ...DEFAULTS, ...saved };
G.setSetting = (key, value) => {
  G.settings[key] = value;
  try { localStorage.setItem('tlv_settings', JSON.stringify(G.settings)); } catch { /* ignore */ }
  G.events.emit('settings:change', { key, value });
};

// ---------------------------------------------------------------- input
const keys = new Set(), pressed = new Set(), released = new Set();
const mouse = { dx: 0, dy: 0, x: 0, y: 0, nx: 0, ny: 0, buttons: 0, pressedButtons: 0, wheel: 0, locked: false };
G.input = {
  mouse,
  enabled: true,                                  // hud.js sets false while a menu is open
  down: (code) => G.input.enabled && keys.has(code),
  pressed: (code) => G.input.enabled && pressed.has(code),   // true only on the frame the key went down
  released: (code) => released.has(code),
  mouseDown: (b = 0) => G.input.enabled && (mouse.buttons & (1 << b)) !== 0,
  mousePressed: (b = 0) => G.input.enabled && (mouse.pressedButtons & (1 << b)) !== 0,
  // movement axes in [-1,1]: x = right(+)/left(-), y = forward(+)/back(-). Keyboard + gamepad.
  axis: { x: 0, y: 0 },
  pad: null,                                       // first connected Gamepad (or null)
  padDown: (i) => !!(G.input.pad && G.input.pad.buttons[i] && G.input.pad.buttons[i].pressed),
  requestPointerLock() { const c = G.renderer && G.renderer.domElement; if (c && !mouse.locked && c.requestPointerLock) { try { const p = c.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ } } },
  exitPointerLock() { if (document.pointerLockElement) document.exitPointerLock(); },
  _endFrame() { pressed.clear(); released.clear(); mouse.dx = 0; mouse.dy = 0; mouse.wheel = 0; mouse.pressedButtons = 0; },
  _poll() {
    let x = 0, y = 0;
    if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) y += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) y -= 1;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    G.input.pad = null;
    for (const p of pads) if (p && p.connected) { G.input.pad = p; break; }
    if (G.input.pad) {
      const ax = G.input.pad.axes;
      if (Math.abs(ax[0]) > 0.18) x += ax[0];
      if (Math.abs(ax[1]) > 0.18) y -= ax[1];
      if (Math.abs(ax[2]) > 0.15) mouse.dx += ax[2] * 14;
      if (Math.abs(ax[3]) > 0.15) mouse.dy += ax[3] * 10;
    }
    G.input.axis.x = G.input.enabled ? Math.max(-1, Math.min(1, x)) : 0;
    G.input.axis.y = G.input.enabled ? Math.max(-1, Math.min(1, y)) : 0;
  },
};
window.addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  if (!keys.has(e.code)) pressed.add(e.code);
  keys.add(e.code);
});
window.addEventListener('keyup', (e) => { keys.delete(e.code); released.add(e.code); });
window.addEventListener('blur', () => { keys.clear(); mouse.buttons = 0; });
window.addEventListener('mousemove', (e) => {
  if (mouse.locked) { mouse.dx += e.movementX; mouse.dy += e.movementY; }
  mouse.x = e.clientX; mouse.y = e.clientY;
  mouse.nx = (e.clientX / window.innerWidth) * 2 - 1; mouse.ny = (e.clientY / window.innerHeight) * 2 - 1;
});
window.addEventListener('mousedown', (e) => { mouse.buttons |= (1 << e.button); mouse.pressedButtons |= (1 << e.button); });
window.addEventListener('mouseup', (e) => { mouse.buttons &= ~(1 << e.button); });
window.addEventListener('wheel', (e) => { mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
window.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('pointerlockchange', () => { mouse.locked = !!document.pointerLockElement; });

// ---------------------------------------------------------------- assets
const gltfLoader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();
const glbCache = new Map(), texCache = new Map();
G.assets = {
  // Promise<gltf>. Cached: never add gltf.scene to the scene directly if you need more than one copy - use clone().
  loadGLB(url) {
    if (!glbCache.has(url)) glbCache.set(url, new Promise((res, rej) => gltfLoader.load(url, res, undefined, rej)));
    return glbCache.get(url);
  },
  // Deep clone that keeps skinned meshes working (shares geometry + materials). Returns Object3D.
  clone(gltf) { return SkeletonUtils.clone(gltf.scene); },
  // Promise<Texture> (sRGB by default; pass { srgb:false } for normal/roughness maps; { repeat:[x,y] } sets wrapping).
  loadTexture(url, opts = {}) {
    const key = url + JSON.stringify(opts);
    if (!texCache.has(key)) texCache.set(key, new Promise((res, rej) => texLoader.load(url, (t) => {
      if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
      if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(opts.repeat[0], opts.repeat[1]); }
      t.anisotropy = 8; res(t);
    }, undefined, rej)));
    return texCache.get(key);
  },
  // Promise<boolean>: does a file exist (for optional generated assets in assets/gen/).
  async exists(url) { try { const r = await fetch(url, { method: 'HEAD' }); return r.ok; } catch { return false; } },
};

// ---------------------------------------------------------------- shared helpers
const _v = new THREE.Vector3();
// Nearest living actor hit by a ray (cylinder test). Returns { actor, dist, point } or null.
G.raycastActors = (origin, dir, maxDist = 120, ignore = null) => {
  let best = null;
  for (const a of G.actors) {
    if (!a.alive || a === ignore) continue;
    _v.copy(a.pos).sub(origin);
    const t = _v.x * dir.x + _v.z * dir.z + (_v.y + (a.height || 1.8) * 0.5) * dir.y;
    if (t < 0 || t > maxDist) continue;
    const px = origin.x + dir.x * t, py = origin.y + dir.y * t, pz = origin.z + dir.z * t;
    const dx = px - a.pos.x, dz = pz - a.pos.z;
    const r = (a.radius || 0.4) + 0.15;
    if (dx * dx + dz * dz > r * r) continue;
    if (py < a.pos.y - 0.2 || py > a.pos.y + (a.height || 1.8) + 0.2) continue;
    if (!best || t < best.dist) best = { actor: a, dist: t, point: new THREE.Vector3(px, py, pz) };
  }
  return best;
};
G.rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
G.pick = (arr) => arr[(Math.random() * arr.length) | 0];
G.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
G.lerp = (a, b, t) => a + (b - a) * t;
G.angleDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
G.dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
