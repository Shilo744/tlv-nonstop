// sky.js - atmosphere and the final image for TLV NONSTOP.
// Owns: day/night clock, sky dome shader (gradient, sun, moon, stars, clouds), sun/moon + ambient lights,
// shadows, fog, environment map (PMREM), the Mediterranean sea and post-processing (G.renderFrame).
import * as THREE from 'three';
import { G } from './core.js';

// ------------------------------------------------------------------ constants
const START_HOUR = 17.6;            // golden hour, sun low over the sea (west = -X)
const RISE = 6.0, SET = 18.6;       // sun crosses the horizon at these hours
const TILT = 0.42;                  // sun arc leans to the south (+Z)
const SHADOW_HALF = 60;             // 120 m shadow box
const SHADOW_MAP = 2048;
const SHADOW_DIST = 300;
const WATER_Y = -0.4, WATER_W = 4200, WATER_L = 9000, WATER_OVERLAP = 10;
const DEFAULT_SEA_X = -420;
const UP = new THREE.Vector3(0, 1, 0);
const MOON_COLOR = new THREE.Color(0x9db8ff);

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const C = (hex) => new THREE.Color(hex);

// ------------------------------------------------------------------ palette, keyed by sun height (sunDir.y)
// zen/hor: sky gradient, glow: horizon colour on the sun side, anti: horizon colour opposite the sun,
// cl/cd: lit/shaded cloud, sc/si: sun light colour/intensity, hs/hg/hemi: hemisphere light, ac/amb: ambient light.
const KEYS = [
  { y: -0.30, zen: 0x04061c, hor: 0x2a2258, glow: 0x40285e, anti: 0x1c1a48, glowAmt: 0.45, antiAmt: 0.0, cl: 0x3a3058, cd: 0x0c0b1a,
    sc: 0xff4a18, si: 0.0, hs: 0x8090dc, hg: 0x8a6a56, hemi: 2.3, ac: 0x7880c8, amb: 1.25, exp: 1.3, fog: 0.0012, bloom: 0.72, env: 1.6 },
  { y: -0.14, zen: 0x0a1238, hor: 0x40306a, glow: 0xa23c54, anti: 0x26265a, glowAmt: 0.8, antiAmt: 0.2, cl: 0x60406a, cd: 0x15142e,
    sc: 0xff4a18, si: 0.0, hs: 0x7c88d4, hg: 0x8a6650, hemi: 2.1, ac: 0x8078c0, amb: 1.0, exp: 1.25, fog: 0.0013, bloom: 0.62, env: 1.4 },
  { y: -0.05, zen: 0x1d3478, hor: 0xd26a4c, glow: 0xff6a2a, anti: 0x7a5c9c, glowAmt: 1.0, antiAmt: 0.55, cl: 0xff8068, cd: 0x34305c,
    sc: 0xff4a18, si: 0.0, hs: 0x8a8cd0, hg: 0x8a5e48, hemi: 1.9, ac: 0xb08898, amb: 0.7, exp: 1.18, fog: 0.0015, bloom: 0.5, env: 1.2 },
  { y: 0.03, zen: 0x31569e, hor: 0xf59a5c, glow: 0xffa23c, anti: 0xb48cae, glowAmt: 1.0, antiAmt: 0.5, cl: 0xffae70, cd: 0x584868,
    sc: 0xff7032, si: 1.7, hs: 0x9a98d0, hg: 0x8a6044, hemi: 1.6, ac: 0xd0a090, amb: 0.45, exp: 1.1, fog: 0.0016, bloom: 0.42, env: 1.1 },
  { y: 0.20, zen: 0x3c72c2, hor: 0xf3c48c, glow: 0xffc468, anti: 0xbfb6c8, glowAmt: 0.92, antiAmt: 0.3, cl: 0xf2d6aa, cd: 0x86768a,
    sc: 0xffac68, si: 3.1, hs: 0xa8b4e0, hg: 0x8e6c4c, hemi: 1.5, ac: 0xe0c8b0, amb: 0.3, exp: 1.05, fog: 0.0015, bloom: 0.36, env: 1.0 },
  { y: 0.45, zen: 0x2e78da, hor: 0xb6d6f0, glow: 0xfff0d2, anti: 0xb0d0ee, glowAmt: 0.35, antiAmt: 0.0, cl: 0xeef0f2, cd: 0xa6b2c8,
    sc: 0xffe0b8, si: 3.4, hs: 0xbcd4ff, hg: 0x8c7a60, hemi: 1.6, ac: 0xffffff, amb: 0.25, exp: 1.0, fog: 0.0011, bloom: 0.24, env: 1.0 },
  { y: 0.92, zen: 0x1e68d6, hor: 0xa6cef2, glow: 0xffffff, anti: 0xa6cef2, glowAmt: 0.2, antiAmt: 0.0, cl: 0xeef0f2, cd: 0xb0bccc,
    sc: 0xfff3e2, si: 3.6, hs: 0xc4dcff, hg: 0x90806a, hemi: 1.7, ac: 0xffffff, amb: 0.25, exp: 1.0, fog: 0.0010, bloom: 0.2, env: 1.0 },
];
const COLOR_FIELDS = ['zen', 'hor', 'glow', 'anti', 'cl', 'cd', 'sc', 'hs', 'hg', 'ac'];
for (const k of KEYS) for (const f of COLOR_FIELDS) k[f] = C(k[f]);

// ------------------------------------------------------------------ shared uniforms (sky dome + water)
const U = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(-0.97, 0.22, 0.1) },
  uMoonDir: { value: new THREE.Vector3(-0.72, 0.4, 0.5).normalize() },
  uZenith: { value: C(0x3c72c2) }, uHorizon: { value: C(0xf3c48c) },
  uGlow: { value: C(0xffc468) }, uAnti: { value: C(0xbfb6c8) },
  uGlowAmt: { value: 0.9 }, uAntiAmt: { value: 0.3 },
  uSunCol: { value: C(0xffac68) }, uSunVis: { value: 1 }, uNight: { value: 0 },
};
const SKY_U = {
  uCloudLit: { value: C(0xf2d6aa) }, uCloudDark: { value: C(0x86768a) }, uCover: { value: 0.5 },
  uEnv: { value: 0 }, uGround: { value: C(0x2a2622) }, uMoonVis: { value: 0 },
};
const WATER_U = {
  uDeep: { value: C(0x0a3a5e) }, uShallow: { value: C(0x2a9aa0) }, uSeaX: { value: DEFAULT_SEA_X },
  uSpecDir: { value: new THREE.Vector3(-0.97, 0.22, 0.1) }, uSpecCol: { value: C(0xffac68) },
  uFoamCol: { value: C(0xffffff) }, uFogDensity: { value: 0.0015 }, uChop: { value: 1.0 }, uCityGlow: { value: 0 },
};

const GLSL_COMMON = /* glsl */`
uniform float uTime;
uniform vec3 uSunDir; uniform vec3 uMoonDir;
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGlow; uniform vec3 uAnti;
uniform float uGlowAmt; uniform float uAntiAmt;
uniform vec3 uSunCol; uniform float uSunVis; uniform float uNight;
float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
// Sky gradient without sun disc / clouds: used by the dome and for water reflections + horizon haze.
vec3 skyBase(vec3 d){
  float h = clamp(d.y, 0.0, 1.0);
  float k = 1.0 - h;
  vec3 col = mix(uZenith, uHorizon, pow(k, 3.5));
  vec2 a = d.xz / max(length(d.xz), 1e-4);
  vec2 s = uSunDir.xz / max(length(uSunDir.xz), 1e-4);
  float az = clamp(dot(a, s) * 0.5 + 0.5, 0.0, 1.0);
  float band = pow(k, 6.0);
  col = mix(col, uGlow, clamp(pow(az, 3.0) * band * uGlowAmt, 0.0, 1.0));
  col += uGlow * pow(az, 6.0) * pow(k, 2.5) * 0.22 * uGlowAmt;
  col = mix(col, uAnti, clamp(pow(1.0 - az, 3.0) * band * uAntiAmt, 0.0, 1.0));
  return col;
}
`;

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = position;
  vec3 p = mat3(viewMatrix) * position * 50.0;   // rotation only: the dome is always centred on the camera
  gl_Position = projectionMatrix * vec4(p, 1.0);
}`;

const SKY_FRAG = /* glsl */`
${GLSL_COMMON}
uniform vec3 uCloudLit; uniform vec3 uCloudDark; uniform vec3 uGround;
uniform float uCover; uniform float uEnv; uniform float uMoonVis;
varying vec3 vDir;
float hash31(vec3 p){ p = fract(p * vec3(443.897, 441.423, 437.195)); p += dot(p, p.yzx + 19.19); return fract((p.x + p.y) * p.z); }
float fbm(vec2 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.3, 9.1); a *= 0.5; }
  return s;
}
float stars(vec3 d){
  vec3 p = d * 180.0;
  vec3 ip = floor(p); vec3 fp = fract(p) - 0.5;
  float r = hash31(ip);
  float tw = 0.7 + 0.3 * sin(uTime * 2.5 + r * 90.0);
  return step(0.988, r) * (1.0 - smoothstep(0.02, 0.32, length(fp))) * tw * (0.5 + 2.5 * fract(r * 57.0));
}
void main(){
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  vec3 col = skyBase(d);

  // clouds (projected on a plane, lit from the sun side)
  vec2 s2 = uSunDir.xz / max(length(uSunDir.xz), 1e-4);
  vec2 cuv = d.xz / (h + 0.16) * 2.2 + uTime * vec2(0.010, 0.004);
  float n = fbm(cuv);
  float n2 = fbm(cuv + s2 * 0.28);
  float dens = smoothstep(uCover, uCover + 0.28, n) * smoothstep(0.012, 0.17, d.y);
  float lit = clamp(0.5 + (n - n2) * 3.2, 0.0, 1.0);
  float sd = dot(d, uSunDir);
  float sdc = max(sd, 0.0);

  // stars + moon (behind clouds)
  float nightSky = uNight * uNight * (1.0 - uEnv);
  col += vec3(0.85, 0.92, 1.0) * stars(d) * nightSky * smoothstep(0.02, 0.3, d.y) * 1.6;
  float md = dot(d, uMoonDir);
  vec3 mr = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
  vec3 mu = cross(mr, uMoonDir);
  vec2 mp = vec2(dot(d, mr), dot(d, mu)) / 0.034;
  vec2 sp = vec2(dot(uSunDir, mr), dot(uSunDir, mu));
  sp /= max(length(sp), 1e-4);
  float mdisc = (1.0 - smoothstep(0.9, 1.0, length(mp))) * step(0.9, md);
  float mshadow = (1.0 - smoothstep(0.85, 1.05, length(mp + sp * 0.55)));
  float mtex = 0.8 + 0.2 * vnoise(mp * 3.0 + 7.0);
  float mdc = max(md, 0.0);
  col += vec3(0.86, 0.91, 1.0) * uMoonVis * (mdisc * (1.0 - mshadow * 0.94) * mtex * 3.0 + pow(mdc, 400.0) * 0.22 + pow(mdc, 40.0) * 0.05);

  // cloud colour: sunset light on the sun side, silver lining on thin edges
  vec3 ccol = mix(uCloudDark, uCloudLit, lit);
  ccol += uSunCol * pow(sdc, 5.0) * 0.55 * uSunVis;
  ccol += uSunCol * pow(sdc, 28.0) * (1.0 - dens) * dens * 3.0 * uSunVis;
  col = mix(col, ccol, dens * 0.88);

  // sun disc + glow
  float disc = smoothstep(0.99955, 0.99976, sd) * smoothstep(-0.012, 0.004, d.y);
  float glow = pow(sdc, 900.0) * 1.4 + pow(sdc, 90.0) * 0.45 + pow(sdc, 10.0) * 0.16;
  col += uSunCol * (disc * mix(14.0, 1.5, uEnv) + glow) * uSunVis * (1.0 - dens * 0.55);

  // below the horizon: haze colour on screen, dark ground in the reflection probe
  col = mix(col, uGround, (1.0 - smoothstep(-0.22, 0.0, d.y)) * uEnv);
  col *= 1.0 + (hash21(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) * 0.035 * (1.0 - uEnv);   // dither against banding
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const WATER_VERT = /* glsl */`
varying vec3 vWorld;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const WATER_FRAG = /* glsl */`
${GLSL_COMMON}
uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uSpecDir; uniform vec3 uSpecCol; uniform vec3 uFoamCol;
uniform float uSeaX; uniform float uFogDensity; uniform float uChop; uniform float uCityGlow;
varying vec3 vWorld;
float waveH(vec2 p){
  float t = uTime;
  float hgt = sin(p.x * 0.085 + p.y * 0.021 - t * 0.9) * 0.5;       // swell rolling toward the shore (+X)
  hgt += sin(p.x * 0.05 - p.y * 0.11 - t * 0.7) * 0.3;
  hgt += vnoise(p * 0.12 + vec2(-t * 0.25, t * 0.1)) * 1.2;
  hgt += vnoise(p * 0.31 + vec2(-t * 0.35, -t * 0.22)) * 0.55;
  hgt += vnoise(p * 0.83 + vec2(-t * 0.5, t * 0.4)) * 0.22;
  return hgt;
}
void main(){
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / max(dist, 1e-3);
  vec2 p = vWorld.xz;
  float e = 0.4 + dist * 0.002;
  float h0 = waveH(p), hx = waveH(p + vec2(e, 0.0)), hz = waveH(p + vec2(0.0, e));
  float str = uChop * mix(1.0, 0.42, smoothstep(40.0, 900.0, dist));
  vec3 N = normalize(vec3(-(hx - h0) / e * str, 1.0, -(hz - h0) / e * str));
  vec3 R = reflect(-V, N); R.y = abs(R.y); R = normalize(R);
  float fres = clamp(0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0), 0.0, 1.0);

  float dShore = uSeaX - vWorld.x;                 // > 0 in the sea
  float shallow = (1.0 - smoothstep(0.0, 95.0, dShore));
  vec3 body = mix(uDeep, uShallow, shallow * 0.85);
  body += uShallow * 0.22 * smoothstep(1.0, 2.3, h0);
  vec3 refl = skyBase(R) + uSunCol * pow(max(dot(R, uSunDir), 0.0), 20.0) * 0.12 * uSunVis;
  vec3 col = mix(body, refl, fres);

  // sun / moon glitter path
  float sd = max(dot(R, uSpecDir), 0.0);
  vec3 spec = uSpecCol * (pow(sd, 420.0) * 24.0 + pow(sd, 46.0) * 1.1);

  // city lights smeared on the water at night
  float cg = (1.0 - smoothstep(0.0, 260.0, dShore)) * uCityGlow;
  col += vec3(1.0, 0.55, 0.28) * cg * (0.05 + 0.22 * vnoise(vec2(vWorld.z * 0.09, dShore * 0.012 + uTime * 0.15)) * vnoise(p * 0.7 + uTime * 0.4));

  // foam: rollers near the beach + the lapping edge
  float fn = vnoise(p * 0.9 + uTime * 0.2);
  float roll = sin(dShore * 0.42 + uTime * 1.3 + vnoise(vec2(vWorld.z * 0.04, uTime * 0.1)) * 5.0);
  float foam = smoothstep(0.55, 1.0, roll) * (1.0 - smoothstep(3.0, 36.0, dShore)) * smoothstep(-1.0, 1.5, dShore) * (0.4 + 0.6 * fn);
  foam += (1.0 - smoothstep(0.3, 3.2, abs(dShore - 0.8 - sin(uTime * 0.7 + vWorld.z * 0.05) * 1.2))) * (0.55 + 0.45 * fn);
  foam += smoothstep(0.8, 0.95, fn * vnoise(p * 0.07 - uTime * 0.05) * 1.6) * 0.35 * (1.0 - smoothstep(60.0, 420.0, dist));   // sparse whitecaps
  foam = clamp(foam, 0.0, 1.0);
  col = mix(col, uFoamCol, foam * 0.9);

  // haze toward the horizon uses the sky colour of that direction -> seamless horizon line
  vec2 hv = -V.xz / max(length(V.xz), 1e-4);
  vec3 hcol = skyBase(vec3(hv.x, 0.0, hv.y));
  float fd = uFogDensity * 0.55 * dist;
  float f = 1.0 - exp(-fd * fd);
  col = mix(col, hcol, f) + spec * (1.0 - f * 0.85);

  float alpha = smoothstep(-10.0, -5.0, dShore) * mix(0.86, 1.0, smoothstep(0.0, 12.0, dShore));
  gl_FragColor = vec4(max(col, vec3(0.0)), alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const GradeShader = {
  name: 'TlvGradeShader',
  uniforms: { tDiffuse: { value: null }, uVig: { value: 0.3 }, uSat: { value: 1.1 }, uTint: { value: new THREE.Vector3(1, 1, 1) } },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uVig; uniform float uSat; uniform vec3 uTint; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = max(mix(vec3(l), c.rgb, uSat), vec3(0.0)) * uTint;
      vec2 q = vUv - 0.5;
      c.rgb *= 1.0 - uVig * smoothstep(0.25, 1.0, dot(q, q) * 2.2);
      gl_FragColor = c;
    }`,
};

// ------------------------------------------------------------------ module state
let sun = null, hemi = null, ambient = null;
let dome = null, water = null, waterSeaX = NaN, waterZ = NaN;
let pmrem = null, cubeRT = null, cubeCam = null, envScene = null, envRT = null, envOK = false;
let envTimer = 0, lastEnvHour = -99;
let PP = null, composer = null, renderPass = null, bloom = null, grade = null, outPass = null;
let lastW = 0, lastH = 0, bloomKey = 0.36;
let animT = 0, wasNight = null;
const sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3(-0.72, 0.4, 0.5).normalize(), lightDir = new THREE.Vector3(0, 1, 0);
const fogColor = new THREE.Color(0xf3c48c);
const _c = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();
const _size = new THREE.Vector2();

function hourRate(h) {                 // game hours per real second (before timeScale)
  if (h >= 17 && h < 21) return 1 / 40;
  if (h >= 21 || h < 5) return 1 / 75;
  return 1 / 90;
}

function computeSunDir(h, out) {
  let a;
  if (h >= RISE && h <= SET) a = Math.PI * (h - RISE) / (SET - RISE);
  else { const hn = h > SET ? h - SET : h + 24 - SET; a = Math.PI + Math.PI * hn / (24 - (SET - RISE)); }
  return out.set(Math.cos(a), Math.sin(a) * Math.cos(TILT), Math.sin(a) * Math.sin(TILT)).normalize();
}

// ------------------------------------------------------------------ apply the clock to everything
function applyHour(hour) {
  const S = G.sky;
  computeSunDir(hour, sunDir);
  const y = sunDir.y;

  let i = 0;
  while (i < KEYS.length - 2 && y > KEYS[i + 1].y) i++;
  const A = KEYS[i], B = KEYS[i + 1];
  const t = clamp01((y - A.y) / (B.y - A.y));
  const num = (f) => lerp(A[f], B[f], t);

  const night = 1 - smooth(-0.2, 0.05, y);
  const sunFade = smooth(-0.03, 0.06, y);
  const moonFade = smooth(-0.06, -0.2, y);
  S.nightFactor = night;
  S.isNight = night > 0.45;
  S.sunDir.copy(sunDir);

  // sky uniforms
  U.uSunDir.value.copy(sunDir);
  U.uMoonDir.value.copy(moonDir);
  U.uZenith.value.lerpColors(A.zen, B.zen, t);
  U.uHorizon.value.lerpColors(A.hor, B.hor, t);
  U.uGlow.value.lerpColors(A.glow, B.glow, t);
  U.uAnti.value.lerpColors(A.anti, B.anti, t);
  U.uGlowAmt.value = num('glowAmt');
  U.uAntiAmt.value = num('antiAmt');
  U.uSunCol.value.lerpColors(A.sc, B.sc, t);
  U.uSunVis.value = smooth(-0.14, 0.02, y);
  U.uNight.value = night;
  SKY_U.uCloudLit.value.lerpColors(A.cl, B.cl, t);
  SKY_U.uCloudDark.value.lerpColors(A.cd, B.cd, t);
  SKY_U.uCover.value = Number.isFinite(S.cloudCover) ? S.cloudCover : 0.5;
  SKY_U.uMoonVis.value = smooth(-0.02, -0.16, y);
  SKY_U.uGround.value.copy(U.uHorizon.value).multiplyScalar(0.28);

  // lights: one directional (sun by day, moon by night), hemisphere + ambient city glow
  if (sun) {
    if (sunFade > 0.001) {
      lightDir.copy(sunDir); if (lightDir.y < 0.13) lightDir.y = 0.13; lightDir.normalize();
      sun.color.lerpColors(A.sc, B.sc, t);
      sun.intensity = num('si') * sunFade;
      WATER_U.uSpecDir.value.copy(sunDir);
      WATER_U.uSpecCol.value.copy(sun.color).multiplyScalar(sunFade);
    } else {
      lightDir.copy(moonDir); if (lightDir.y < 0.4) lightDir.y = 0.4; lightDir.normalize();
      sun.color.copy(MOON_COLOR);
      sun.intensity = 1.15 * moonFade;
      WATER_U.uSpecDir.value.copy(moonDir);
      WATER_U.uSpecCol.value.copy(MOON_COLOR).multiplyScalar(0.32 * moonFade);
    }
  }
  if (hemi) { hemi.color.lerpColors(A.hs, B.hs, t); hemi.groundColor.lerpColors(A.hg, B.hg, t); hemi.intensity = num('hemi'); }
  if (ambient) { ambient.color.lerpColors(A.ac, B.ac, t); ambient.intensity = num('amb'); }

  // fog + background follow the horizon
  fogColor.copy(U.uHorizon.value).lerp(U.uGlow.value, 0.18 * U.uGlowAmt.value);
  const fogD = num('fog');
  const scene = G.scene;
  if (scene) {
    if (scene.fog && scene.fog.color) { scene.fog.color.copy(fogColor); if (scene.fog.isFogExp2) scene.fog.density = fogD; }
    if (scene.background && scene.background.isColor) scene.background.copy(fogColor);
    scene.environmentIntensity = num('env');
  }

  // water
  const daylight = 0.07 + 0.93 * smooth(-0.16, 0.25, y);
  WATER_U.uDeep.value.setRGB(0.012, 0.085, 0.16).multiplyScalar(daylight).lerp(U.uZenith.value, 0.25);
  WATER_U.uShallow.value.setRGB(0.05, 0.36, 0.38).multiplyScalar(daylight);
  WATER_U.uFoamCol.value.setRGB(1, 1, 1).lerp(U.uHorizon.value, 0.35).multiplyScalar(0.12 + 0.88 * daylight);
  WATER_U.uFogDensity.value = fogD;
  WATER_U.uCityGlow.value = night;

  // exposure, bloom, grade
  if (G.renderer) G.renderer.toneMappingExposure = num('exp');
  bloomKey = num('bloom');
  if (bloom) {
    bloom.strength = bloomKey * (G.settings.reducedMotion ? 0.45 : 1);
    bloom.threshold = lerp(0.95, 0.62, night);
    bloom.radius = lerp(0.5, 0.7, night);
  }
  if (grade) {
    const golden = smooth(0.45, 0.15, y) * (1 - night);
    grade.uniforms.uTint.value.set(lerp(1, 0.96, night) + 0.03 * golden, lerp(1, 0.99, night), lerp(1, 1.06, night) - 0.04 * golden);
    grade.uniforms.uVig.value = G.settings.reducedMotion ? 0.18 : lerp(0.28, 0.36, night);
  }

  if (wasNight !== S.isNight) {
    const first = wasNight === null;
    wasNight = S.isNight;
    if (!first) G.events.emit('sky:night', { isNight: S.isNight });
  }
}

// ------------------------------------------------------------------ shadows follow the player
function updateShadowRig() {
  if (!sun) return;
  const cam = G.camera;
  const pp = G.player?.pos;
  const p = (pp && Number.isFinite(pp.x) && Number.isFinite(pp.z)) ? pp : cam.position;
  _c.set(p.x, 0, p.z);
  cam.getWorldDirection(_f); _f.y = 0;
  if (_f.lengthSq() > 1e-6) _c.addScaledVector(_f.normalize(), 26);   // push the box toward what the camera sees
  // snap to shadow texels (in light space) so shadow edges do not crawl when the player moves
  const texel = (SHADOW_HALF * 2) / SHADOW_MAP;
  _r.crossVectors(UP, lightDir);
  if (_r.lengthSq() < 1e-6) _r.set(1, 0, 0);
  _r.normalize();
  _u.crossVectors(lightDir, _r).normalize();
  const rr = Math.round(_c.dot(_r) / texel) * texel, uu = Math.round(_c.dot(_u) / texel) * texel, ll = _c.dot(lightDir);
  _c.set(0, 0, 0).addScaledVector(_r, rr).addScaledVector(_u, uu).addScaledVector(lightDir, ll);
  sun.target.position.copy(_c);
  sun.position.copy(_c).addScaledVector(lightDir, SHADOW_DIST);
  sun.target.updateMatrixWorld();
}

// ------------------------------------------------------------------ water placement (seaX is read lazily)
function placeWater() {
  if (!water) return;
  const sx = G.world?.seaX;
  const seaX = Number.isFinite(sx) ? sx : DEFAULT_SEA_X;
  const b = G.world?.bounds;
  const cz = (b && Number.isFinite(b.minZ) && Number.isFinite(b.maxZ)) ? (b.minZ + b.maxZ) * 0.5 : 0;
  if (seaX === waterSeaX && cz === waterZ) return;
  waterSeaX = seaX; waterZ = cz;
  water.position.set(seaX + WATER_OVERLAP - WATER_W * 0.5, WATER_Y, cz);
  water.updateMatrixWorld();
  WATER_U.uSeaX.value = seaX;
}

// ------------------------------------------------------------------ environment map (reflections)
function setupEnv() {
  pmrem = new THREE.PMREMGenerator(G.renderer);
  cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: false });
  cubeCam = new THREE.CubeCamera(1, 200, cubeRT);
  envScene = new THREE.Scene();
  const envDome = new THREE.Mesh(dome.geometry, dome.material);
  envDome.frustumCulled = false;
  envScene.add(envDome);
  envOK = true;
}
function regenEnv() {
  if (!envOK) return;
  try {
    SKY_U.uEnv.value = 1;
    cubeCam.update(G.renderer, envScene);
    SKY_U.uEnv.value = 0;
    envRT = pmrem.fromCubemap(cubeRT.texture, envRT || null);
    if (G.scene.environment !== envRT.texture) G.scene.environment = envRT.texture;
    lastEnvHour = G.sky.hour;
  } catch (e) {
    SKY_U.uEnv.value = 0;
    envOK = false;
    console.warn('[sky] environment map disabled:', e);
  }
}

// ------------------------------------------------------------------ post-processing
async function loadPost() {
  const [a, b, c, d, e] = await Promise.all([
    import('three/addons/postprocessing/EffectComposer.js'),
    import('three/addons/postprocessing/RenderPass.js'),
    import('three/addons/postprocessing/UnrealBloomPass.js'),
    import('three/addons/postprocessing/OutputPass.js'),
    import('three/addons/postprocessing/ShaderPass.js'),
  ]);
  PP = { EffectComposer: a.EffectComposer, RenderPass: b.RenderPass, UnrealBloomPass: c.UnrealBloomPass, OutputPass: d.OutputPass, ShaderPass: e.ShaderPass };
}
function disposeComposer() {
  try { if (bloom && bloom.dispose) bloom.dispose(); } catch { /* ignore */ }
  try { if (grade && grade.dispose) grade.dispose(); } catch { /* ignore */ }
  try { if (outPass && outPass.dispose) outPass.dispose(); } catch { /* ignore */ }
  try { if (composer && composer.dispose) composer.dispose(); } catch { /* ignore */ }
  composer = renderPass = bloom = grade = outPass = null;
}
function syncComposerSize() {
  if (!composer) return;
  const r = G.renderer, pr = r.getPixelRatio();
  r.getSize(_size);
  const w = Math.max(1, _size.x), h = Math.max(1, _size.y);
  composer.setPixelRatio(pr);
  composer.setSize(w, h);
  if (bloom && G.settings.quality === 'medium') bloom.setSize(Math.max(2, w * pr * 0.5), Math.max(2, h * pr * 0.5));   // half-res bloom
  lastW = r.domElement.width; lastH = r.domElement.height;
}
function buildComposer() {
  disposeComposer();
  const q = G.settings.quality;
  if (q === 'low' || !PP) return;
  const r = G.renderer, pr = r.getPixelRatio();
  r.getSize(_size);
  const w = Math.max(1, Math.floor(_size.x * pr)), h = Math.max(1, Math.floor(_size.y * pr));
  const samples = q === 'high' ? (pr > 1.25 ? 2 : 4) : 0;       // MSAA on the HDR target (canvas AA is bypassed by the composer)
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples });
  composer = new PP.EffectComposer(r, rt);
  renderPass = new PP.RenderPass(G.scene, G.camera);
  bloom = new PP.UnrealBloomPass(new THREE.Vector2(w, h), 0.36, 0.55, 0.95);
  grade = new PP.ShaderPass(GradeShader);
  outPass = new PP.OutputPass();          // tone mapping (renderer.toneMapping + exposure) and sRGB happen here, exactly once
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(grade);
  composer.addPass(outPass);
  syncComposerSize();
}
function renderFrame(dt) {
  const r = G.renderer, c = r.domElement;
  if (c.width !== lastW || c.height !== lastH) syncComposerSize();
  renderPass.scene = G.scene; renderPass.camera = G.camera;
  composer.render(dt);
}
function applyQuality() {
  const low = G.settings.quality === 'low';
  try {
    G.renderer.shadowMap.enabled = !low;
    if (sun) sun.castShadow = !low;
  } catch { /* ignore */ }
  try { buildComposer(); } catch (e) { console.warn('[sky] post-processing disabled:', e); disposeComposer(); }
  G.renderFrame = composer ? renderFrame : null;
  if (G.sky) { G.sky.composer = composer; G.sky.bloom = bloom; }
}

// ------------------------------------------------------------------ frame
function step(dt, advance) {
  const S = G.sky;
  if (!S) return;
  if (!Number.isFinite(dt) || dt < 0) dt = 0;
  animT += dt;
  U.uTime.value = animT;
  if (!Number.isFinite(S.hour)) S.hour = START_HOUR;
  if (advance) {
    const ts = Number.isFinite(S.timeScale) ? S.timeScale : 1;
    S.hour += dt * hourRate(S.hour) * ts;
  }
  S.hour = ((S.hour % 24) + 24) % 24;
  applyHour(S.hour);
  updateShadowRig();
  placeWater();

  if (envOK) {
    envTimer -= dt;
    let dh = Math.abs(S.hour - lastEnvHour); if (dh > 12) dh = 24 - dh;
    if (envTimer <= 0 && dh > 0.012) {
      regenEnv();
      envTimer = G.settings.quality === 'low' ? 6 : 2.2;
    }
  }
}

export function update(dt) { step(dt, true); }
export function updatePaused(dt) { step(dt, false); }   // title / pause: water + clouds keep moving, the clock waits

// ------------------------------------------------------------------ init
export async function init() {
  const scene = G.scene, renderer = G.renderer;

  // lights first: even if everything else fails the world is lit
  sun = new THREE.DirectionalLight(0xffac68, 3);
  sun.castShadow = G.settings.quality !== 'low';
  sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
  const sc = sun.shadow.camera;
  sc.left = -SHADOW_HALF; sc.right = SHADOW_HALF; sc.top = SHADOW_HALF; sc.bottom = -SHADOW_HALF;
  sc.near = 5; sc.far = SHADOW_DIST + 260;
  sc.updateProjectionMatrix();
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.08;
  sun.shadow.radius = 2.5;
  hemi = new THREE.HemisphereLight(0xa8b4e0, 0x8e6c4c, 1.5);
  ambient = new THREE.AmbientLight(0xe0c8b0, 0.3);
  scene.add(sun, sun.target, hemi, ambient);

  scene.fog = new THREE.FogExp2(fogColor.getHex(), 0.0015);
  if (!scene.background || !scene.background.isColor) scene.background = new THREE.Color();
  scene.background.copy(fogColor);

  G.sky = {
    hour: START_HOUR,
    isNight: false,
    nightFactor: 0,
    sunDir: new THREE.Vector3(),
    moonDir,
    lightDir,                 // direction TO the active light (sun or moon)
    timeScale: 1,             // 1 = default pace (1 game hour per 40 s between 17:00 and 21:00, slower otherwise)
    cloudCover: 0.5,          // lower = more clouds
    setHour(h) {
      h = Number(h);
      if (!Number.isFinite(h)) return;
      this.hour = ((h % 24) + 24) % 24;
      try { applyHour(this.hour); updateShadowRig(); envTimer = 0; lastEnvHour = -99; } catch (e) { console.warn('[sky] setHour', e); }
    },
    sun, hemi, ambient,
    water: null, dome: null, composer: null, bloom: null,
  };

  // sky dome
  try {
    const mat = new THREE.ShaderMaterial({
      name: 'TlvSky', uniforms: { ...U, ...SKY_U }, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      side: THREE.DoubleSide, depthTest: false, depthWrite: false, fog: false,
    });
    dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
    dome.name = 'skyDome';
    dome.frustumCulled = false;
    dome.renderOrder = -1000;
    dome.matrixAutoUpdate = false;
    scene.add(dome);
    G.sky.dome = dome;
  } catch (e) { console.warn('[sky] dome failed:', e); dome = null; }

  // sea
  try {
    const geo = new THREE.PlaneGeometry(WATER_W, WATER_L, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      name: 'TlvSea', uniforms: { ...U, ...WATER_U }, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG,
      transparent: true, depthWrite: false, fog: false,
    });
    water = new THREE.Mesh(geo, mat);
    water.name = 'sea';
    water.frustumCulled = false;
    water.renderOrder = -10;
    water.matrixAutoUpdate = false;
    scene.add(water);
    G.sky.water = water;
    placeWater();
  } catch (e) { console.warn('[sky] sea failed:', e); water = null; }

  applyHour(G.sky.hour);
  updateShadowRig();

  // reflections
  try { if (dome) { setupEnv(); regenEnv(); envTimer = 2.2; } }
  catch (e) { console.warn('[sky] env setup failed:', e); envOK = false; }

  // post-processing (falls back to plain rendering: G.renderFrame stays null)
  try { await loadPost(); } catch (e) { console.warn('[sky] post-processing modules missing:', e); PP = null; }
  applyQuality();

  G.events.on('resize', () => { try { syncComposerSize(); } catch (e) { console.warn('[sky] resize', e); } });
  G.events.on('settings:change', (ev) => {
    if (!ev) return;
    if (ev.key === 'quality') applyQuality();
    if (ev.key === 'reducedMotion') { try { applyHour(G.sky.hour); } catch { /* ignore */ } }
  });
}
