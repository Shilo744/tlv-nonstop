// main.js - boot + main loop. OWNED BY THE LEAD.
import * as THREE from 'three';
import { G, reportError } from './core.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, G.settings.quality === 'low' ? 1 : 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = G.settings.quality !== 'low';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b5e0);
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.15, 4000);
camera.position.set(0, 30, 60);
camera.lookAt(0, 0, 0);
G.scene = scene; G.camera = camera; G.renderer = renderer;

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  G.events.emit('resize', { w: window.innerWidth, h: window.innerHeight });
});

// Module load order matters: later modules may use earlier ones inside init().
const ORDER = ['sky', 'world', 'fx', 'vehicles', 'player', 'npcs', 'life', 'police', 'missions', 'audio', 'hud', 'ai'];
const modules = [];
const bootText = document.getElementById('boottext'), bootFill = document.getElementById('bootfill');
const errBox = document.getElementById('errors');
const showErrors = new URLSearchParams(location.search).has('debug');

async function boot() {
  let i = 0;
  for (const name of ORDER) {
    bootText.textContent = `טוען: ${name}...`;
    bootFill.style.width = `${(i++ / ORDER.length) * 100}%`;
    try {
      const mod = await import(`./${name}.js`);
      if (mod.init) await mod.init(G);
      modules.push({ name, mod });
    } catch (e) {
      reportError('init:' + name, e);
      if ((name === 'world' && !G.world) || (name === 'vehicles' && !G.vehicles)) {
        try { const mod = await import(`./${name}_lite.js`); await mod.init(G); modules.push({ name: name + '_lite', mod }); } catch (e2) { reportError('init:world_lite', e2); }
      }
    }
  }
  bootFill.style.width = '100%';
  // Fallback light so a missing sky module never leaves the world black.
  if (!G.sky) { scene.add(new THREE.HemisphereLight(0xffffff, 0x556677, 1.6)); const d = new THREE.DirectionalLight(0xfff0d0, 2); d.position.set(50, 100, 30); scene.add(d); }
  G.events.emit('ready');
  const b = document.getElementById('boot'); b.style.opacity = '0'; setTimeout(() => b.remove(), 700);
  if (!G.hud) G.started = true;   // no title screen available -> start immediately
  renderer.setAnimationLoop(tick);
}

const clock = new THREE.Clock();
let dynN = 0, dynT = 0, dynLast = performance.now();
function tick() {
  let dt = Math.min(clock.getDelta(), 0.05);
  G.input._poll();
  const running = G.started && !G.paused;
  const sdt = dt * (G.settings.gameSpeed || 1);
  G.dt = running ? sdt : 0;
  if (running) { G.time += sdt; G.frame++; }
  for (const { name, mod } of modules) {
    try {
      if (running) { if (mod.update) mod.update(sdt); }
      else if (mod.updatePaused) mod.updatePaused(dt);   // title screen / pause: sky, hud, audio can keep animating
    } catch (e) { reportError('update:' + name, e); }
  }
  try { if (G.renderFrame) G.renderFrame(dt); else renderer.render(scene, camera); }
  catch (e) { reportError('render', e); G.renderFrame = null; }
  G.input._endFrame();
  // Dynamic resolution: keep the game smooth on any computer (integrated GPUs included).
  const nowMs = performance.now(); dynN++; dynT += Math.min(1, (nowMs - dynLast) / 1000); dynLast = nowMs;
  if (dynT >= 1) {
    const fps = dynN / dynT; dynN = 0; dynT = 0; G.fps = fps;
    let pr = renderer.getPixelRatio();
    const top = Math.min(window.devicePixelRatio, 1.5);
    if (fps < 34 && pr > 0.45) pr = Math.max(0.45, pr * (fps < 18 ? 0.7 : 0.85));
    else if (fps > 57 && pr < top) pr = Math.min(top, pr + 0.08);
    if (pr !== renderer.getPixelRatio()) { renderer.setPixelRatio(pr); renderer.setSize(window.innerWidth, window.innerHeight); G.events.emit('resize', { w: window.innerWidth, h: window.innerHeight }); }
  }
  if (showErrors && G.errors.length) { errBox.style.display = 'block'; errBox.textContent = G.errors.slice(-8).join('\n'); }
}

boot();
