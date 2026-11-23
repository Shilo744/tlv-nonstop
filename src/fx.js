// fx.js - pooled particles, explosions, tracers, decals, camera shake, money pops, screen flash.
// One instanced draw call for every particle (additive + alpha blended in the same pass through
// premultiplied output), zero allocations per frame.
import * as THREE from 'three';
import { G } from './core.js';

// ------------------------------------------------------------------ helpers
const X = (p) => (p && +p.x) || 0;
const Y = (p) => (p && +p.y) || 0;
const Z = (p) => (p && +p.z) || 0;
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const _d = { x: 0, y: 1, z: 0 };
function randDir() {
  const u = Math.random() * 2 - 1, a = Math.random() * 6.2832, q = Math.sqrt(1 - u * u);
  _d.x = q * Math.cos(a); _d.y = u; _d.z = q * Math.sin(a);
  return _d;
}
function groundY(x, z) {
  try { const g = G.world && G.world.groundY ? G.world.groundY(x, z) : 0; return Number.isFinite(g) ? g : 0; } catch { return 0; }
}
function mult() {
  const s = G.settings || {};
  let m = s.quality === 'low' ? 0.5 : s.quality === 'medium' ? 0.75 : 1;
  if (s.reducedMotion) m *= 0.5;
  return m;
}
const _c = new THREE.Color();

// ------------------------------------------------------------------ particle pool
const N = 3000;
const f32 = () => new Float32Array(N);
const PX = f32(), PY = f32(), PZ = f32(), VX = f32(), VY = f32(), VZ = f32();
const LF = f32(), ML = f32(), S0 = f32(), S1 = f32(), RT = f32(), RV = f32();
const R0 = f32(), G0 = f32(), B0 = f32(), R1 = f32(), G1 = f32(), B1 = f32();
const AL = f32(), AD = f32(), SP = f32(), GR = f32(), DR = f32(), ST = f32(), FI = f32();
const BN = new Uint8Array(N);
let cursor = 0, anyAlive = false;

const bPos = new Float32Array(N * 3), bPar = new Float32Array(N * 4), bCol = new Float32Array(N * 4), bVel = new Float32Array(N * 4);
let aPos = null, aPar = null, aCol = null, aVel = null, pGeo = null, pMesh = null, pMat = null;

// Sprites: 0 soft glow, 1 smoke puff, 2 chunk, 3 streak.
function emit(x, y, z, vx, vy, vz, life, s0, s1) {
  const i = cursor; cursor = cursor + 1 === N ? 0 : cursor + 1;
  if (!(life > 0)) life = 0.1;
  PX[i] = x; PY[i] = y; PZ[i] = z; VX[i] = vx; VY[i] = vy; VZ[i] = vz;
  LF[i] = life; ML[i] = life; S0[i] = s0; S1[i] = s1; RT[i] = Math.random() * 6.2832; RV[i] = 0;
  R0[i] = G0[i] = B0[i] = 1; R1[i] = G1[i] = B1[i] = 1;
  AL[i] = 1; AD[i] = 1; SP[i] = 0; GR[i] = 0; DR[i] = 0; ST[i] = 0; FI[i] = 0; BN[i] = 0;
  anyAlive = true;
  return i;
}
function col(i, r, g, b, r1, g1, b1) { R0[i] = r; G0[i] = g; B0[i] = b; R1[i] = r1; G1[i] = g1; B1[i] = b1; }

function makeAtlas() {
  const S = 128, cv = document.createElement('canvas');
  cv.width = S * 4; cv.height = S;
  const c = cv.getContext('2d');
  c.fillStyle = '#000'; c.fillRect(0, 0, cv.width, cv.height);
  const blob = (cx, cy, r, a) => {
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(0.3, `rgba(255,255,255,${a * 0.7})`);
    g.addColorStop(0.65, `rgba(255,255,255,${a * 0.22})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.beginPath(); c.arc(cx, cy, r, 0, 6.2832); c.fill();
  };
  // 0: glow
  blob(S * 0.5, S * 0.5, S * 0.5 - 2, 1);
  // 1: smoke puff (lumpy)
  c.save(); c.beginPath(); c.rect(S, 0, S, S); c.clip();
  blob(S * 1.5, S * 0.5, 44, 0.6);
  for (let k = 0; k < 11; k++) {
    const a = (k / 11) * 6.2832 + Math.random() * 0.5, r = 15 + Math.random() * 13, dd = 10 + Math.random() * 20;
    blob(S * 1.5 + Math.cos(a) * dd, S * 0.5 + Math.sin(a) * dd, r, 0.4);
  }
  c.restore();
  // 2: chunk
  c.fillStyle = '#fff'; c.beginPath();
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * 6.2832, r = 26 + Math.random() * 22;
    const px = S * 2.5 + Math.cos(a) * r, py = S * 0.5 + Math.sin(a) * r;
    if (k === 0) c.moveTo(px, py); else c.lineTo(px, py);
  }
  c.closePath(); c.fill();
  // 3: streak
  c.save(); c.translate(S * 3.5, S * 0.5); c.scale(0.3, 1); blob(0, 0, S * 0.5 - 3, 1); c.restore();
  const t = new THREE.CanvasTexture(cv);
  t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
  return t;
}

function buildParticles() {
  const quad = new THREE.PlaneGeometry(1, 1);
  pGeo = new THREE.InstancedBufferGeometry();
  pGeo.index = quad.index;
  pGeo.setAttribute('position', quad.attributes.position);
  pGeo.setAttribute('uv', quad.attributes.uv);
  aPos = new THREE.InstancedBufferAttribute(bPos, 3); aPar = new THREE.InstancedBufferAttribute(bPar, 4);
  aCol = new THREE.InstancedBufferAttribute(bCol, 4); aVel = new THREE.InstancedBufferAttribute(bVel, 4);
  for (const a of [aPos, aPar, aCol, aVel]) a.setUsage(THREE.DynamicDrawUsage);
  pGeo.setAttribute('aPos', aPos); pGeo.setAttribute('aPar', aPar); pGeo.setAttribute('aCol', aCol); pGeo.setAttribute('aVel', aVel);
  pGeo.instanceCount = 0;
  pMat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: makeAtlas() }, uLight: { value: 1 } },
    vertexShader: /* glsl */`
      attribute vec3 aPos; attribute vec4 aPar; attribute vec4 aCol; attribute vec4 aVel;
      uniform float uLight;
      varying vec2 vUv; varying vec4 vCol; varying float vAdd;
      void main() {
        vec4 mv = viewMatrix * vec4(aPos, 1.0);
        vec2 c = position.xy;
        float size = aPar.x;
        vec2 off;
        if (aVel.w > 0.0) {
          vec3 vv = (viewMatrix * vec4(aVel.xyz, 0.0)).xyz;
          float l = length(vv.xy);
          vec2 d = l > 0.0001 ? vv.xy / l : vec2(0.0, 1.0);
          off = vec2(-d.y, d.x) * c.x * size + d * c.y * (size + l * aVel.w);
        } else {
          float cs = cos(aPar.y), sn = sin(aPar.y);
          off = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * size;
        }
        mv.xy += off;
        gl_Position = projectionMatrix * mv;
        vUv = vec2((uv.x + aCol.w) * 0.25, uv.y);
        vAdd = aPar.w;
        vCol = vec4(aCol.rgb * mix(uLight, 1.0, aPar.w), aPar.z);
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap;
      varying vec2 vUv; varying vec4 vCol; varying float vAdd;
      void main() {
        float a = texture2D(uMap, vUv).r * vCol.a;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vCol.rgb, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        gl_FragColor = vec4(gl_FragColor.rgb * a, a * (1.0 - vAdd));
      }`,
    transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  pMesh = new THREE.Mesh(pGeo, pMat);
  pMesh.frustumCulled = false; pMesh.renderOrder = 10; pMesh.visible = false;
  pMesh.matrixAutoUpdate = false;
  G.scene.add(pMesh);
}

function updateParticles(dt) {
  if (!pMesh) return;
  if (!anyAlive) { if (pMesh.visible) { pMesh.visible = false; pGeo.instanceCount = 0; } return; }
  let n = 0;
  for (let k = 0; k < N; k++) {
    let i = cursor + k; if (i >= N) i -= N;      // oldest first so newer particles draw on top
    let life = LF[i];
    if (life <= 0) continue;
    life -= dt;
    if (life <= 0) { LF[i] = 0; continue; }
    LF[i] = life;
    const t = 1 - life / ML[i];
    const dr = DR[i];
    let vx = VX[i], vy = VY[i], vz = VZ[i];
    if (dr > 0) { const q = Math.max(0, 1 - dr * dt); vx *= q; vy *= q; vz *= q; }
    vy -= GR[i] * dt;
    let py = PY[i] + vy * dt;
    if (BN[i] && py < 0.04 && vy < 0) { py = 0.04; vy = -vy * 0.35; vx *= 0.6; vz *= 0.6; RV[i] *= 0.5; }
    VX[i] = vx; VY[i] = vy; VZ[i] = vz;
    PX[i] += vx * dt; PY[i] = py; PZ[i] += vz * dt;
    RT[i] += RV[i] * dt;
    const add = AD[i], e = 1 - (1 - t) * (1 - t), fi = FI[i];
    let a = AL[i] * (add > 0.5 ? 1 - t * t : 1 - t);
    if (fi > 0 && t < fi) a *= t / fi;
    const n3 = n * 3, n4 = n * 4;
    bPos[n3] = PX[i]; bPos[n3 + 1] = py; bPos[n3 + 2] = PZ[i];
    bPar[n4] = S0[i] + (S1[i] - S0[i]) * e; bPar[n4 + 1] = RT[i]; bPar[n4 + 2] = a; bPar[n4 + 3] = add;
    bCol[n4] = R0[i] + (R1[i] - R0[i]) * t; bCol[n4 + 1] = G0[i] + (G1[i] - G0[i]) * t; bCol[n4 + 2] = B0[i] + (B1[i] - B0[i]) * t; bCol[n4 + 3] = SP[i];
    bVel[n4] = vx; bVel[n4 + 1] = vy; bVel[n4 + 2] = vz; bVel[n4 + 3] = ST[i];
    n++;
  }
  anyAlive = n > 0;
  pGeo.instanceCount = n;
  pMesh.visible = n > 0;
  if (n > 0) {
    markRange(aPos, n * 3); markRange(aPar, n * 4); markRange(aCol, n * 4); markRange(aVel, n * 4);
  }
}
function markRange(attr, count) {
  if (attr.clearUpdateRanges && attr.addUpdateRange) { attr.clearUpdateRanges(); attr.addUpdateRange(0, count); }
  attr.needsUpdate = true;
}

// ------------------------------------------------------------------ quad pools (tracers, skid marks, scorch decals)
function makeQuadPool(count, material, opts) {
  const pos = new Float32Array(count * 12);
  const geo = new THREE.BufferGeometry();
  const pa = new THREE.BufferAttribute(pos, 3); pa.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', pa);
  const idx = new Uint16Array(count * 6);
  for (let q = 0; q < count; q++) { const v = q * 4, o = q * 6; idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2; idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3; }
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  let colArr = null, ca = null;
  if (opts && opts.color) {
    colArr = new Float32Array(count * 12);
    ca = new THREE.BufferAttribute(colArr, 3); ca.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('color', ca);
  }
  if (opts && opts.uv) {
    const uv = new Float32Array(count * 8);
    for (let q = 0; q < count; q++) { const o = q * 8; uv[o] = 0; uv[o + 1] = 0; uv[o + 2] = 1; uv[o + 3] = 0; uv[o + 4] = 1; uv[o + 5] = 1; uv[o + 6] = 0; uv[o + 7] = 1; }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
  mesh.renderOrder = (opts && opts.renderOrder) || 1;
  G.scene.add(mesh);
  return { pos, pa, colArr, ca, mesh, count, next: 0 };
}

// --- tracers
const TR = 32, TDUR = 0.085;
const TL = new Float32Array(TR), TF = new Float32Array(TR * 3), TT = new Float32Array(TR * 3);
let trPool = null, trNext = 0, trActive = false;
function updateTracers(dt) {
  if (!trPool || !trActive) return;
  const cam = G.camera ? G.camera.position : null;
  const cx = cam ? cam.x : 0, cy = cam ? cam.y : 0, cz = cam ? cam.z : 0;
  const pos = trPool.pos, colA = trPool.colArr;
  let alive = false;
  for (let t = 0; t < TR; t++) {
    if (TL[t] <= 0) continue;
    TL[t] -= dt;
    const o = t * 12;
    if (TL[t] <= 0) { TL[t] = 0; for (let k = 0; k < 12; k++) pos[o + k] = 0; continue; }
    alive = true;
    const k = TL[t] / TDUR, u0 = (1 - k) * 0.7, t3 = t * 3;
    const tx = TT[t3], ty = TT[t3 + 1], tz = TT[t3 + 2];
    const fx = TF[t3] + (tx - TF[t3]) * u0, fy = TF[t3 + 1] + (ty - TF[t3 + 1]) * u0, fz = TF[t3 + 2] + (tz - TF[t3 + 2]) * u0;
    const dx = tx - fx, dy = ty - fy, dz = tz - fz;
    const mx = (fx + tx) * 0.5 - cx, my = (fy + ty) * 0.5 - cy, mz = (fz + tz) * 0.5 - cz;
    let sx = dy * mz - dz * my, sy = dz * mx - dx * mz, sz = dx * my - dy * mx;
    const sl = Math.hypot(sx, sy, sz);
    const w = Math.max(0.02, Math.hypot(mx, my, mz) * 0.0026);
    if (sl > 1e-6) { const q = w / sl; sx *= q; sy *= q; sz *= q; } else { sx = 0; sy = w; sz = 0; }
    pos[o] = fx + sx; pos[o + 1] = fy + sy; pos[o + 2] = fz + sz;
    pos[o + 3] = fx - sx; pos[o + 4] = fy - sy; pos[o + 5] = fz - sz;
    pos[o + 6] = tx - sx; pos[o + 7] = ty - sy; pos[o + 8] = tz - sz;
    pos[o + 9] = tx + sx; pos[o + 10] = ty + sy; pos[o + 11] = tz + sz;
    const r = 3.2 * k, g = 2.5 * k, b = 1.1 * k;
    colA[o] = r * 0.3; colA[o + 1] = g * 0.3; colA[o + 2] = b * 0.3;
    colA[o + 3] = r * 0.3; colA[o + 4] = g * 0.3; colA[o + 5] = b * 0.3;
    colA[o + 6] = r; colA[o + 7] = g; colA[o + 8] = b;
    colA[o + 9] = r; colA[o + 10] = g; colA[o + 11] = b;
  }
  trPool.pa.needsUpdate = true; trPool.ca.needsUpdate = true;
  trActive = alive;
  trPool.mesh.visible = alive;
}

// --- skid marks (ring buffer) : continuous strips joined to the previous mark of the same wheel
const SKIDS = 300;
let skidPool = null;
const skX = new Float32Array(4), skZ = new Float32Array(4), skT = new Float32Array(4).fill(-99);
function skidMark(pos, heading) {
  if (!skidPool) return;
  const x = X(pos), z = Z(pos), now = G.time || 0;
  let best = -1, bd = 9, oldest = 0;
  for (let s = 0; s < 4; s++) {
    if (skT[s] < skT[oldest]) oldest = s;
    if (now - skT[s] > 0.35 || now < skT[s]) continue;
    const d = (skX[s] - x) * (skX[s] - x) + (skZ[s] - z) * (skZ[s] - z);
    if (d < bd) { bd = d; best = s; }
  }
  let x0, z0;
  if (best >= 0) {
    if (bd < 0.2) { skT[best] = now; return; }      // moved < ~0.45 m: wait
    x0 = skX[best]; z0 = skZ[best];
    skX[best] = x; skZ[best] = z; skT[best] = now;
  } else {
    const h = +heading || 0;
    x0 = x - Math.sin(h) * 0.5; z0 = z - Math.cos(h) * 0.5;
    skX[oldest] = x; skZ[oldest] = z; skT[oldest] = now;
  }
  let dx = x - x0, dz = z - z0;
  const l = Math.hypot(dx, dz); if (l < 1e-4) return;
  dx /= l; dz /= l;
  const px = dz * 0.11, pz = -dx * 0.11, y = groundY(x, z) + 0.05;
  const o = skidPool.next * 12, p = skidPool.pos;
  skidPool.next = (skidPool.next + 1) % SKIDS;
  p[o] = x0 + px; p[o + 1] = y; p[o + 2] = z0 + pz;
  p[o + 3] = x0 - px; p[o + 4] = y; p[o + 5] = z0 - pz;
  p[o + 6] = x - px; p[o + 7] = y; p[o + 8] = z - pz;
  p[o + 9] = x + px; p[o + 10] = y; p[o + 11] = z + pz;
  skidPool.pa.needsUpdate = true;
}

// --- scorch decals
const SCORCH = 24;
let scorchPool = null;
function makeScorchTex() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  const blob = (cx, cy, r, a) => {
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(0.5, `rgba(0,0,0,${a * 0.6})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.beginPath(); c.arc(cx, cy, r, 0, 6.2832); c.fill();
  };
  blob(64, 64, 58, 0.8);
  for (let k = 0; k < 14; k++) { const a = Math.random() * 6.2832, dd = 14 + Math.random() * 26; blob(64 + Math.cos(a) * dd, 64 + Math.sin(a) * dd, 8 + Math.random() * 12, 0.5); }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function scorch(x, z, r) {
  if (!scorchPool) return;
  const a = Math.random() * 6.2832, cs = Math.cos(a) * r, sn = Math.sin(a) * r, y = groundY(x, z) + 0.065;
  const o = scorchPool.next * 12, p = scorchPool.pos;
  scorchPool.next = (scorchPool.next + 1) % SCORCH;
  // corners (-1,-1) (1,-1) (1,1) (-1,1) rotated
  p[o] = x - cs + sn; p[o + 1] = y; p[o + 2] = z - sn - cs;
  p[o + 3] = x + cs + sn; p[o + 4] = y; p[o + 5] = z + sn - cs;
  p[o + 6] = x + cs - sn; p[o + 7] = y; p[o + 8] = z + sn + cs;
  p[o + 9] = x - cs - sn; p[o + 10] = y; p[o + 11] = z - sn + cs;
  scorchPool.pa.needsUpdate = true;
}

// ------------------------------------------------------------------ shockwave rings
const RINGS = 6;
const rings = [];
let ringNext = 0;
function ring(x, y, z, maxR, dur, r, g, b) {
  if (!rings.length) return;
  const rg = rings[ringNext]; ringNext = (ringNext + 1) % RINGS;
  rg.mesh.position.set(x, y, z);
  rg.mesh.material.color.setRGB(r, g, b);
  rg.life = dur; rg.dur = dur; rg.maxR = maxR;
  rg.mesh.scale.setScalar(0.3); rg.mesh.visible = true;
}
function updateRings(dt) {
  for (let i = 0; i < rings.length; i++) {
    const rg = rings[i];
    if (rg.life <= 0) continue;
    rg.life -= dt;
    if (rg.life <= 0) { rg.life = 0; rg.mesh.visible = false; continue; }
    const t = 1 - rg.life / rg.dur, e = 1 - (1 - t) * (1 - t);
    rg.mesh.scale.setScalar(0.3 + (rg.maxR - 0.3) * e);
    rg.mesh.material.opacity = (1 - t) * (1 - t) * 0.85;
  }
}

// ------------------------------------------------------------------ the single flash light
let light = null, lightT = 0, lightDur = 1, lightPeak = 0;
function setLight(x, y, z, hex, intensity, dist, dur) {
  if (!light) return;
  if (G.settings && G.settings.reducedMotion) intensity *= 0.35;
  if (lightT > 0) { const k = lightT / lightDur; if (lightPeak * k * k > intensity) return; }
  light.position.set(x, y, z); light.color.setHex(hex); light.distance = dist;
  lightPeak = intensity; lightDur = dur; lightT = dur; light.intensity = intensity;
}
function updateLight(dt) {
  if (!light || lightT <= 0) return;
  lightT -= dt;
  if (lightT <= 0) { lightT = 0; light.intensity = 0; return; }
  const k = lightT / lightDur; light.intensity = lightPeak * k * k;
}

// ------------------------------------------------------------------ camera shake
const shakeOffset = new THREE.Vector3();
let trauma = 0, shakeClock = 0;
function shake(intensity) {
  if (G.settings && G.settings.reducedMotion) { trauma = 0; return; }
  const i = clamp(+intensity || 0, 0, 1);
  trauma = Math.min(1, Math.max(i, trauma + i * 0.5));
}
function updateShake(dt) {
  if (trauma <= 0 || (G.settings && G.settings.reducedMotion)) { trauma = 0; shakeOffset.set(0, 0, 0); return; }
  trauma = Math.max(0, trauma - dt * 1.7);
  shakeClock += dt;
  const s = trauma * trauma * 0.42, t = shakeClock;
  shakeOffset.set(
    (Math.sin(t * 47.3) + Math.sin(t * 83.1 + 1.7) * 0.5) * s * 0.66,
    (Math.sin(t * 61.7 + 1.3) + Math.sin(t * 97.9 + 0.4) * 0.5) * s * 0.66,
    (Math.sin(t * 53.1 + 4.1) + Math.sin(t * 71.3 + 2.9) * 0.5) * s * 0.4,
  );
}

// ------------------------------------------------------------------ money pops
const POPS = 10, POP_DUR = 1.5;
const pops = [];
let popNext = 0;
function moneyPop(pos, amount) {
  if (!pops.length) return;
  const p = pops[popNext]; popNext = (popNext + 1) % POPS;
  const n = Math.round(+amount || 0), c = p.ctx, hc = G.settings && G.settings.highContrast;
  const txt = (n < 0 ? '-' : '+') + '₪' + Math.abs(n).toLocaleString('en-US');
  c.clearRect(0, 0, 256, 96);
  c.direction = 'ltr'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = '900 58px "Arial Black", "Segoe UI", Arial, sans-serif';
  c.lineJoin = 'round'; c.lineWidth = 12; c.strokeStyle = hc ? '#000' : 'rgba(6,20,12,0.92)';
  c.strokeText(txt, 128, 50, 240);
  c.fillStyle = hc ? '#ffe600' : (n < 0 ? '#ff6f61' : '#63ff8f');
  c.fillText(txt, 128, 50, 240);
  p.tex.needsUpdate = true;
  p.sprite.position.set(X(pos), Y(pos) + 1.9, Z(pos));
  p.baseY = p.sprite.position.y; p.life = POP_DUR;
  p.sprite.material.opacity = 1; p.sprite.visible = true;
}
function updatePops(dt) {
  const cam = G.camera ? G.camera.position : null;
  for (let i = 0; i < pops.length; i++) {
    const p = pops[i];
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) { p.life = 0; p.sprite.visible = false; continue; }
    const t = 1 - p.life / POP_DUR, s = p.sprite;
    const rm = G.settings && G.settings.reducedMotion;
    s.position.y = p.baseY + (rm ? 0.4 : 1.7) * (1 - (1 - t) * (1 - t));
    s.material.opacity = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
    const d = cam ? Math.hypot(cam.x - s.position.x, cam.y - s.position.y, cam.z - s.position.z) : 10;
    const pop = rm ? 1 : 1 + 0.35 * Math.max(0, 1 - t * 6);
    const h = clamp(d * 0.05, 0.45, 6) * pop;
    s.scale.set(h * 2.6667, h, 1);
  }
}

// ------------------------------------------------------------------ screen flash (DOM)
let flashEl = null, lastFlash = -1e9;
function cssColor(c) {
  if (typeof c === 'number') return '#' + (c & 0xffffff).toString(16).padStart(6, '0');
  if (typeof c === 'string' && c) return c;
  if (c && c.isColor) return '#' + c.getHexString();
  return '#ffffff';
}
function flash(color, ms) {
  if (!flashEl || (G.settings && G.settings.reducedMotion)) return;
  const now = performance.now();
  if (now - lastFlash < 220) return;            // never strobe (photosensitivity)
  lastFlash = now;
  const dur = clamp(+ms || 250, 60, 3000);
  flashEl.style.transition = 'none';
  flashEl.style.background = cssColor(color);
  flashEl.style.opacity = '0.42';
  void flashEl.offsetWidth;
  flashEl.style.transition = `opacity ${dur}ms ease-out`;
  flashEl.style.opacity = '0';
}

// ------------------------------------------------------------------ effects
function debrisAt(x, y, z, count, s) {
  for (let k = 0; k < count; k++) {
    const d = randDir(), sp = rnd(3, 11) * Math.sqrt(s);
    const i = emit(x + d.x * 0.3, y + 0.2, z + d.z * 0.3, d.x * sp, Math.abs(d.y) * sp + 3, d.z * sp, rnd(1.2, 2.4), rnd(0.1, 0.3) * Math.sqrt(s), rnd(0.08, 0.2));
    const c = rnd(0.02, 0.12);
    col(i, c * 1.1, c, c * 0.9, c, c, c);
    AD[i] = 0; SP[i] = 2; GR[i] = 15; DR[i] = 0.2; BN[i] = 1; RV[i] = rnd(-12, 12);
  }
}
function debris(pos, count) {
  const n = Math.round(clamp(+count || 8, 1, 60) * mult());
  debrisAt(X(pos), Math.max(Y(pos), 0.1), Z(pos), Math.max(1, n), 1);
}

function sparksAt(x, y, z, dx, dy, dz, hasDir, count, speed) {
  for (let k = 0; k < count; k++) {
    const d = randDir();
    let vx = d.x, vy = d.y, vz = d.z;
    if (hasDir) { vx = dx + d.x * 0.6; vy = dy + d.y * 0.6; vz = dz + d.z * 0.6; }
    else vy = Math.abs(vy) + 0.2;
    const sp = rnd(0.35, 1) * speed;
    const i = emit(x, y, z, vx * sp, vy * sp, vz * sp, rnd(0.3, 0.8), rnd(0.05, 0.085), 0.025);
    col(i, 5, 3.1, 1.1, 2.4, 0.55, 0.1);
    SP[i] = 3; ST[i] = 0.05; GR[i] = 13; DR[i] = 0.5; BN[i] = 1;
  }
}
function sparks(pos, dir) {
  let dx = X(dir), dy = Y(dir), dz = Z(dir);
  const l = Math.hypot(dx, dy, dz), has = l > 1e-4;
  if (has) { dx /= l; dy /= l; dz /= l; }
  sparksAt(X(pos), Y(pos), Z(pos), dx, dy, dz, has, Math.max(3, Math.round(11 * mult())), 8);
}

function smoke(pos, opts) {
  const o = opts && typeof opts === 'object' ? opts : null;
  const size = clamp(typeof opts === 'number' ? opts : (o && +o.size) || 1, 0.05, 20);
  const count = Math.max(1, Math.round(clamp((o && +o.count) || 1, 1, 40) * (o && o.count > 2 ? mult() : 1)));
  const life = (o && +o.life) || 2.2, rise = o && o.rise !== undefined ? +o.rise || 0 : 1.6, spread = o && o.spread !== undefined ? +o.spread || 0 : 0.4;
  const alpha = clamp((o && +o.alpha) || 0.55, 0.02, 1);
  let r = 0.24, g = 0.24, b = 0.25;
  if (o && o.dark) { r = 0.045; g = 0.042; b = 0.04; }
  if (o && o.color !== undefined && o.color !== null) { try { _c.set(o.color); r = _c.r; g = _c.g; b = _c.b; } catch { /* keep default */ } }
  const x = X(pos), y = Y(pos), z = Z(pos);
  for (let k = 0; k < count; k++) {
    const i = emit(x + rnd(-spread, spread) * size * 0.5, y + rnd(0, 0.2) * size, z + rnd(-spread, spread) * size * 0.5,
      rnd(-spread, spread), rise * rnd(0.7, 1.2), rnd(-spread, spread), life * rnd(0.75, 1.25), rnd(0.45, 0.7) * size, rnd(1.8, 2.8) * size);
    col(i, r, g, b, r * 1.5 + 0.03, g * 1.5 + 0.03, b * 1.5 + 0.03);
    AL[i] = alpha; AD[i] = 0; SP[i] = 1; DR[i] = 0.7; GR[i] = -0.3; FI[i] = 0.1; RV[i] = rnd(-0.7, 0.7);
  }
}

function tireSmoke(pos) {
  const m = mult();
  if (m < 1 && Math.random() > m) return;
  const i = emit(X(pos) + rnd(-0.15, 0.15), Y(pos) + 0.15, Z(pos) + rnd(-0.15, 0.15), rnd(-0.5, 0.5), rnd(0.4, 1), rnd(-0.5, 0.5), rnd(0.7, 1.2), rnd(0.35, 0.55), rnd(1.5, 2.3));
  col(i, 0.72, 0.72, 0.74, 0.85, 0.85, 0.86);
  AL[i] = 0.26; AD[i] = 0; SP[i] = 1; DR[i] = 1.4; FI[i] = 0.12; RV[i] = rnd(-1, 1);
}

function hitPuff(pos) {
  const x = X(pos), y = Y(pos), z = Z(pos), n = Math.max(2, Math.round(4 * mult()));
  for (let k = 0; k < n; k++) {
    const d = randDir();
    const i = emit(x, y, z, d.x * rnd(0.4, 1.6), Math.abs(d.y) * rnd(0.4, 1.6), d.z * rnd(0.4, 1.6), rnd(0.3, 0.6), rnd(0.1, 0.18), rnd(0.5, 0.85));
    const c = rnd(0.42, 0.6);
    col(i, c, c * 0.96, c * 0.9, c, c, c);
    AL[i] = 0.5; AD[i] = 0; SP[i] = 1; DR[i] = 2.5; RV[i] = rnd(-1.5, 1.5);
  }
  sparksAt(x, y, z, 0, 0, 0, false, 3, 4);
  const i = emit(x, y, z, 0, 0, 0, 0.07, 0.18, 0.4); col(i, 3, 2.2, 1.1, 2, 1, 0.3);
}

function blood(pos) {
  const x = X(pos), y = Y(pos), z = Z(pos), n = Math.max(2, Math.round(6 * mult()));
  for (let k = 0; k < n; k++) {
    const d = randDir();
    const i = emit(x, y, z, d.x * rnd(0.5, 2.2), Math.abs(d.y) * rnd(0.5, 2.5), d.z * rnd(0.5, 2.2), rnd(0.3, 0.55), rnd(0.06, 0.12), rnd(0.2, 0.4));
    col(i, 0.5, 0.02, 0.02, 0.25, 0.01, 0.01);
    AL[i] = 0.8; AD[i] = 0; SP[i] = 0; GR[i] = 8; DR[i] = 1.5;
  }
}

function splash(pos) {
  const x = X(pos), z = Z(pos), y = Math.max(Y(pos), -0.3), m = mult();
  let n = Math.max(4, Math.round(16 * m));
  for (let k = 0; k < n; k++) {
    const d = randDir(), sp = rnd(1, 3.2);
    const i = emit(x + d.x * 0.3, y + 0.1, z + d.z * 0.3, d.x * sp, rnd(3, 7.5), d.z * sp, rnd(0.6, 1.1), rnd(0.1, 0.2), 0.05);
    col(i, 0.82, 0.92, 1, 0.7, 0.85, 1);
    AL[i] = 0.85; AD[i] = 0; SP[i] = 3; ST[i] = 0.04; GR[i] = 12; DR[i] = 0.3;
  }
  n = Math.max(2, Math.round(5 * m));
  for (let k = 0; k < n; k++) {
    const i = emit(x + rnd(-0.4, 0.4), y + 0.2, z + rnd(-0.4, 0.4), rnd(-0.8, 0.8), rnd(0.8, 2.2), rnd(-0.8, 0.8), rnd(0.6, 1), rnd(0.5, 0.8), rnd(1.6, 2.6));
    col(i, 0.85, 0.93, 1, 0.9, 0.95, 1);
    AL[i] = 0.4; AD[i] = 0; SP[i] = 1; DR[i] = 1.5; GR[i] = 2; FI[i] = 0.1;
  }
  ring(x, y + 0.08, z, 3.2, 0.7, 0.35, 0.5, 0.6);
}

function muzzleFlash(pos, dir) {
  let dx = X(dir), dy = Y(dir), dz = Z(dir);
  const l = Math.hypot(dx, dy, dz);
  if (l > 1e-4) { dx /= l; dy /= l; dz /= l; } else { dx = 0; dy = 0; dz = 1; }
  const x = X(pos), y = Y(pos), z = Z(pos);
  let i = emit(x + dx * 0.12, y + dy * 0.12, z + dz * 0.12, dx * 2, dy * 2, dz * 2, 0.055, 0.22, 0.5);
  col(i, 5, 3.6, 1.6, 3, 1.4, 0.4);
  i = emit(x + dx * 0.3, y + dy * 0.3, z + dz * 0.3, dx * 14, dy * 14, dz * 14, 0.05, 0.16, 0.1);
  col(i, 4.5, 3.2, 1.4, 3, 1.2, 0.3); SP[i] = 3; ST[i] = 0.035;
  if (!(G.settings && G.settings.reducedMotion)) {
    i = emit(x + dx * 0.2, y + dy * 0.2, z + dz * 0.2, dx * 1.2, dy * 1.2 + 0.4, dz * 1.2, 0.5, 0.1, 0.5);
    col(i, 0.6, 0.6, 0.62, 0.7, 0.7, 0.7); AL[i] = 0.18; AD[i] = 0; SP[i] = 1; DR[i] = 2; FI[i] = 0.1;
  }
  setLight(x + dx * 0.4, y + dy * 0.4 + 0.1, z + dz * 0.4, 0xffc070, 40, 14, 0.07);
}

function tracer(from, to) {
  if (!trPool) return;
  const t = trNext; trNext = (trNext + 1) % TR;
  const o = t * 3;
  TF[o] = X(from); TF[o + 1] = Y(from); TF[o + 2] = Z(from);
  TT[o] = X(to); TT[o + 1] = Y(to); TT[o + 2] = Z(to);
  TL[t] = TDUR; trActive = true; trPool.mesh.visible = true;
}

function explosion(pos, scale) {
  const s = clamp(+scale || 1, 0.2, 6), rs = Math.sqrt(s), m = mult();
  const x = X(pos), z = Z(pos), g = groundY(x, z);
  let y = Y(pos); if (y < g + 0.4) y = g + 0.5 * rs;
  let n, i;
  // dark smoke column (emitted first so the fire draws over it)
  n = Math.max(6, Math.round(22 * m));
  for (let k = 0; k < n; k++) {
    const d = randDir(), sp = rnd(0.6, 2.8) * rs;
    i = emit(x + d.x * 0.7 * s, y + Math.abs(d.y) * 0.9 * s, z + d.z * 0.7 * s, d.x * sp, rnd(1.6, 5.2) * rs, d.z * sp, rnd(2.2, 4.4), rnd(1, 1.8) * s, rnd(4, 6.5) * s);
    const c = rnd(0.03, 0.075);
    col(i, c, c * 0.95, c * 0.9, 0.19, 0.19, 0.2);
    AL[i] = rnd(0.55, 0.8); AD[i] = 0; SP[i] = 1; GR[i] = -0.5; DR[i] = 0.9; FI[i] = 0.12; RV[i] = rnd(-0.6, 0.6);
  }
  // fireball
  n = Math.max(8, Math.round(26 * m));
  for (let k = 0; k < n; k++) {
    const d = randDir(), sp = rnd(2, 8) * rs;
    i = emit(x + d.x * 0.3 * s, y + Math.abs(d.y) * 0.3 * s, z + d.z * 0.3 * s, d.x * sp, Math.abs(d.y) * sp * 0.8 + 1.5, d.z * sp, rnd(0.4, 0.95), rnd(0.6, 1.2) * s, rnd(2.2, 3.6) * s);
    col(i, 3.2, 1.7, 0.45, 0.9, 0.12, 0.0);
    SP[i] = k & 1; DR[i] = 3; GR[i] = -1.5; RV[i] = rnd(-2, 2); AL[i] = 0.9;
  }
  // bright core flash (HDR so bloom catches it)
  i = emit(x, y, z, 0, 0, 0, 0.16, 1.5 * s, 7 * s); col(i, 6, 4.5, 2.5, 3, 1.2, 0.3);
  i = emit(x, y, z, 0, 0.5, 0, 0.32, 2 * s, 4.5 * s); col(i, 3.5, 2.2, 0.9, 1.2, 0.3, 0.05);
  // sparks + debris
  n = Math.max(8, Math.round(34 * m));
  for (let k = 0; k < n; k++) {
    const d = randDir(), sp = rnd(6, 18) * rs;
    i = emit(x, y, z, d.x * sp, Math.abs(d.y) * sp + 2, d.z * sp, rnd(0.5, 1.3), rnd(0.06, 0.1), 0.03);
    col(i, 5, 3, 1, 2.5, 0.6, 0.1);
    SP[i] = 3; ST[i] = 0.045; GR[i] = 14; DR[i] = 0.4; BN[i] = 1;
  }
  debrisAt(x, y, z, Math.max(3, Math.round(10 * m)), s);
  if (y - g < 4) { scorch(x, z, 2.7 * s); ring(x, g + 0.2, z, 13 * s, 0.5, 2.6, 1.7, 0.8); }
  setLight(x, y + 1.5, z, 0xffa040, 900 * s, 50 * rs, 0.5);
  const cam = G.camera ? G.camera.position : null;
  const dist = cam ? Math.hypot(cam.x - x, cam.y - y, cam.z - z) : 20;
  shake(clamp(0.95 * rs, 0, 1) * clamp(1.15 - dist / (75 * rs), 0, 1));
}

// ------------------------------------------------------------------ public API (never throws)
const guard1 = (fn) => (a) => { try { return fn(a); } catch (e) { /* fx must never break the game */ } };
const guard2 = (fn) => (a, b) => { try { return fn(a, b); } catch (e) { /* fx must never break the game */ } };
const api = {
  explosion: guard2(explosion), sparks: guard2(sparks), smoke: guard2(smoke), muzzleFlash: guard2(muzzleFlash),
  tracer: guard2(tracer), hitPuff: guard1(hitPuff), tireSmoke: guard1(tireSmoke), splash: guard1(splash),
  shake: guard1(shake), shakeOffset, moneyPop: guard2(moneyPop), flash: guard2(flash),
  skidMark: guard2(skidMark), debris: guard2(debris), blood: guard1(blood),
};

export async function init(G_) {
  G.fx = api;       // usable even if one sub-system below fails to build
  const scene = G.scene;
  const step = (name, fn) => { try { fn(); } catch (e) { console.warn('[fx] ' + name + ' unavailable', e); } };

  step('particles', buildParticles);

  step('tracers', () => {
    trPool = makeQuadPool(TR, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    }), { color: true, renderOrder: 11 });
    trPool.mesh.visible = false;
  });

  step('skids', () => {
    skidPool = makeQuadPool(SKIDS, new THREE.MeshBasicMaterial({
      color: 0x050505, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }), { renderOrder: 1 });
  });

  step('scorch', () => {
    scorchPool = makeQuadPool(SCORCH, new THREE.MeshBasicMaterial({
      map: makeScorchTex(), color: 0x000000, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }), { uv: true, renderOrder: 2 });
  });

  step('rings', () => {
    const geo = new THREE.RingGeometry(0.84, 1, 48); geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < RINGS; i++) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
      }));
      mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 5;
      scene.add(mesh);
      rings.push({ mesh, life: 0, dur: 1, maxR: 1 });
    }
  });

  step('light', () => {
    light = new THREE.PointLight(0xffa040, 0, 50, 2);
    light.castShadow = false;
    scene.add(light);       // stays in the scene at intensity 0 so the light count never changes (no shader recompiles)
  });

  step('moneyPops', () => {
    for (let i = 0; i < POPS; i++) {
      const cv = document.createElement('canvas'); cv.width = 256; cv.height = 96;
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
      sprite.visible = false; sprite.renderOrder = 30; sprite.frustumCulled = false;
      scene.add(sprite);
      pops.push({ sprite, tex, ctx: cv.getContext('2d'), life: 0, baseY: 0 });
    }
  });

  step('flash', () => {
    flashEl = document.createElement('div');
    flashEl.id = 'fx-flash';
    flashEl.setAttribute('aria-hidden', 'true');
    flashEl.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;pointer-events:none;opacity:0;z-index:4;background:#fff;will-change:opacity;';
    document.body.appendChild(flashEl);
  });

  G.events.on('settings:change', (e) => {
    if (e && e.key === 'reducedMotion' && e.value) { trauma = 0; shakeOffset.set(0, 0, 0); if (flashEl) flashEl.style.opacity = '0'; }
  });
}

let lightLevel = 1;
export function update(dt) {
  if (!(dt > 0)) return;
  if (pMat) {
    const target = G.sky && G.sky.isNight ? 0.3 : 1;
    lightLevel += (target - lightLevel) * Math.min(1, dt * 2);
    pMat.uniforms.uLight.value = lightLevel;
  }
  updateParticles(dt);
  updateTracers(dt);
  updateRings(dt);
  updateLight(dt);
  updateShake(dt);
  updatePops(dt);
}

export function updatePaused(dt) {
  // keep the camera still while a menu / the title screen is up
  if (trauma > 0 || shakeOffset.x !== 0 || shakeOffset.y !== 0 || shakeOffset.z !== 0) { trauma = 0; shakeOffset.set(0, 0, 0); }
}
