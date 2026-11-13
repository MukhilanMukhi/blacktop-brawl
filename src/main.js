// Blacktop Brawl - game loop, riders, traffic, combat, camera, HUD, solo and online modes.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildWorld, disposeWorld, LOCATIONS, trackToWorld, mulberry32, roadDX, roadDDX, roadDY, ROAD_HALF, TRACK_LEN, START_Z, FINISH_Z } from './world.js';
import { createCar, fitModel } from './models.js';
import { createBike } from './bike.js';
import { GameAudio } from './audio.js';
import { Net } from './net.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BIKES, ITEMS, drawMinimap, createPowerups } from './extras.js';

const $ = id => document.getElementById(id);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const params = new URLSearchParams(location.search);
const AUTO = params.get('auto'); // ?auto=1 : self-driving demo / test mode
const saved = k => { try { return localStorage.getItem(k); } catch { return null; } };
const NO_RENDER = params.get('norender'); // test mode: simulate without drawing

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ canvas: $('game'), antialias: window.devicePixelRatio < 2, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.6;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 6000);
// Final image pass (medium and high quality): sharpen, then a touch more contrast and colour.
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new OutputPass());
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, px: { value: new THREE.Vector2(1, 1) } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 px; varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      vec3 n = texture2D(tDiffuse, vUv + vec2(0.0, px.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, px.y)).rgb
             + texture2D(tDiffuse, vUv + vec2(px.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(px.x, 0.0)).rgb;
      vec3 s = clamp(c + (c - n * 0.25) * 0.7, 0.0, 1.0);      // unsharp mask
      s = (s - 0.5) * 1.08 + 0.5;                              // contrast
      s = mix(vec3(dot(s, vec3(0.299, 0.587, 0.114))), s, 1.12); // saturation
      gl_FragColor = vec4(clamp(s, 0.0, 1.0), 1.0);
    }`,
});
composer.addPass(grade);
function setRatio(r) {
  renderer.setPixelRatio(r); composer.setPixelRatio(r);
  grade.uniforms.px.value.set(1 / (window.innerWidth * r), 1 / (window.innerHeight * r));
}
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  composer.setSize(window.innerWidth, window.innerHeight);
  grade.uniforms.px.value.set(1 / (window.innerWidth * renderer.getPixelRatio()), 1 / (window.innerHeight * renderer.getPixelRatio()));
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize); resize();

const audio = new GameAudio();
let curLoc = params.get('loc') || saved('bb_loc');
if (!LOCATIONS.some(l => l.id === curLoc)) curLoc = 'valley';
let myBike = params.get('bike') || saved('bb_bike');
if (!BIKES.some(b => b.id === myBike)) myBike = 'arrow';
// Graphics quality. Macs default to medium: a Retina screen has four times the pixels to fill.
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const QUALITY = { low: { cap: 1, shadow: 1024, plants: 0.3 }, medium: { cap: 1.25, shadow: 2048, plants: 0.65 }, high: { cap: 2, shadow: 4096, plants: 1 } };
let quality = QUALITY[params.get('gfx')] ? params.get('gfx') : QUALITY[saved('bb_gfx')] ? saved('bb_gfx') : IS_MAC ? 'medium' : 'high';
const progress = p => { $('barFill').style.width = Math.round(p * 100) + '%'; };
let world = await buildWorld(scene, renderer, curLoc, progress, QUALITY[quality].plants);
renderer.toneMappingExposure = world.loc.exposure;

let pxCap = 1, pxRatio = 1;
function applyQuality() {
  const q = QUALITY[quality], sh = world.sun.shadow;
  pxCap = Math.min(window.devicePixelRatio, q.cap); pxRatio = pxCap;
  setRatio(pxRatio);
  const type = quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  if (renderer.shadowMap.type !== type) {
    renderer.shadowMap.type = type;
    scene.traverse(o => { for (const m of [].concat(o.material || [])) m.needsUpdate = true; });
  }
  if (sh.mapSize.x !== q.shadow) { sh.mapSize.set(q.shadow, q.shadow); if (sh.map) { sh.map.dispose(); sh.map = null; } }
  camera.far = world.loc.fog[1] + 150; camera.updateProjectionMatrix();   // nothing is visible beyond the haze
}
applyQuality();

// Keep the frame rate up by lowering the render resolution when frames run slow, and raising it again when there is headroom.
let fpsT = 0, fpsN = 0, lastRaise = -1e9, warm = 0;
function autoScale(raw) {
  if (NO_RENDER || AUTO || document.hidden || screen === 'load' || raw > 1) { fpsT = fpsN = 0; return; }
  fpsT += raw; fpsN++;
  if (fpsT < 1) return;
  const fps = fpsN / fpsT, now = performance.now();
  fpsT = fpsN = 0;
  if (++warm < 3) return;
  if (fps < 48 && pxRatio > 0.6) {
    pxRatio = Math.max(0.6, pxRatio - 0.15);
    if (now - lastRaise < 4000) pxCap = pxRatio;   // the last step up was too much: don't try it again
    setRatio(pxRatio);
  } else if (fps > 57 && pxRatio < pxCap - 0.01 && now - lastRaise > 5000) {
    pxRatio = Math.min(pxCap, pxRatio + 0.1); lastRaise = now;
    setRatio(pxRatio);
  }
}

// Optional drop-in models: assets/models/custom.json  { "bike": { "file": "bike.glb", "rotateY": 0, "rider": true }, "car": {...} }
const custom = {};
try {
  const res = await fetch('./assets/models/custom.json');
  if (res.ok) {
    const cfg = await res.json(), loader = new GLTFLoader();
    for (const key of ['bike', 'car']) {
      if (!cfg[key]) continue;
      const length = cfg[key].length || (key === 'bike' ? 2.1 : 4.5);
      const g = await loader.loadAsync('./assets/models/' + cfg[key].file);
      custom[key] = { object: fitModel(g.scene, { length, rotateY: cfg[key].rotateY || 0 }), rider: cfg[key].rider, length };
    }
  }
} catch (e) { console.warn('custom models not loaded:', e); }

// ---------------------------------------------------------------- riders
const TOP = 70, GRID = 10; // m/s, riders per race
// bike colour, jacket, helmet per grid slot
const SLOTS = [
  [0xb8141f, 0x2a2a2e, 0xb8141f], [0x1d4fd0, 0x1d2f55, 0xf0f0f0], [0xdfa512, 0x3b2f1c, 0x202020],
  [0x8b9199, 0x55585e, 0x8b9199], [0x7d2bd6, 0x1b1b1f, 0xe9d8ff], [0xa9441c, 0x5a2a16, 0xd9d2c5],
  [0x0e9c79, 0x10231e, 0x0e9c79], [0x1c1c1f, 0x1c1c1f, 0xc9a227], [0x1b93cf, 0x23323d, 0x1b93cf],
  [0xe8451a, 0x18181b, 0xf4f4f4],
];
const BOT_NAMES = ['Viper', 'Rook', 'Dozer', 'Ash', 'Juno', 'Brick', 'Slick', 'Hex', 'Mako'];

function makeLabel() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  sprite.scale.set(2.2, 0.55, 1); sprite.position.y = 2.25; sprite.visible = false;
  sprite.setText = text => {
    const g = c.getContext('2d'); g.clearRect(0, 0, 256, 64);
    g.font = '700 34px "Segoe UI", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.8)'; g.strokeText(text, 128, 34);
    g.fillStyle = '#fff'; g.fillText(text, 128, 34); tex.needsUpdate = true;
  };
  return sprite;
}

const riders = SLOTS.map((_, i) => {
  return {
    slot: i, model: null, label: makeLabel(), active: true, id: 'b' + i, name: BOT_NAMES[i] || 'You', kind: 'bot',
    botTop: 62 + ((i * 7) % 9) * 0.6,         // 62 .. 66.8 m/s; human riders get TOP
    skill: ((i * 4) % 9) / 8,                 // 0 .. 1: cornering and traffic awareness
    aggr: 0.25 + ((i * 5) % 9) / 11,          // 0.25 .. 0.98
    prefLat: -4.3 + ((i * 4) % 9) * 0.65,     // spread across the road
  };
});
let player = riders[GRID - 1];

// ---------------------------------------------------------------- traffic (deterministic, so every player sees the same cars)
const CAR_COLORS = [0xb9bcc2, 0x23262b, 0x7c1d1d, 0xe9e7e1, 0x1f3f63, 0x58606a, 0x2d5a3c, 0xb98a2e];
const LOOP = TRACK_LEN + 600, N_SAME = 12, N_ONCOMING = 16;
const cars = [];
for (let i = 0; i < N_SAME + N_ONCOMING; i++) {
  const model = createCar(CAR_COLORS[i % CAR_COLORS.length], i % 5 === 4 ? 'van' : 'sedan', custom.car);
  scene.add(model.root);
  const dir = i < N_SAME ? 1 : -1;
  cars.push({ model, dir, v: dir > 0 ? 24 : -27, lat: dir > 0 ? -3 : 3, base: 0, z: 0 });
}
function setupTraffic(seed) {
  const rng = mulberry32(seed);
  cars.forEach((c, i) => {
    const n = c.dir > 0 ? N_SAME : N_ONCOMING, k = c.dir > 0 ? i : i - N_SAME;
    c.base = 710 + (k + 0.15 + rng() * 0.7) * ((LOOP - 560) / n);   // nothing on the start grid at t = 0
  });
}
const carZ = (c, t) => -250 + (((c.base + c.v * t) % LOOP) + LOOP) % LOOP;

// ---------------------------------------------------------------- state
let mode = 'solo';          // 'solo' | 'online'
let raceLive = false;       // a race is being simulated
let clock = -3, prevClock = -3, startAt = 0;   // seconds since GO (negative during the countdown)
let paused = false, resultsT = 0, camSnap = true, flash = 0, sendT = 0, resultsRefresh = 0;
let screen = 'load';
const keys = {}, hudCache = {};
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

const mine = r => r.kind === 'me' || (r.kind === 'bot' && (mode === 'solo' || net.isHost));

function startRace(grid, seed) {
  const myId = mode === 'online' ? net.id : 'me';
  riders.forEach((r, i) => {
    const g = grid[i];
    Object.assign(r, {
      active: !!g, v: 0, push: 0, steer: 0, steerVel: 0, health: 100, state: 'ride', crashT: 0, crashDir: 1, spin: 0, invuln: 0,
      attack: null, cooldown: 0, finished: false, finishTime: 0, thinkT: Math.random() * 0.3, brakeAI: false, leanV: 0,
      boost: 1, throttle: 0, net: null, lastHitByMe: -1e9,
    });
    r.z = START_Z - 6 - Math.floor(i / 3) * 6; r.lat = [3.5, 0, -3.5][i % 3]; r.targetLat = r.lat;
    setBike(r, g ? g.bike || BIKES[i % BIKES.length].id : r.bikeId);
    r.model.root.visible = !!g;
    if (!g) return;
    r.id = g.id; r.name = g.name; r.kind = g.bot ? 'bot' : g.id === myId ? 'me' : 'human';
    const own = r.kind === 'me';   // bike stats apply to the rider you control
    r.top = r.kind === 'bot' ? r.botTop : r.bike.top; r.accel = own ? r.bike.accel : 18;
    r.handling = own ? r.bike.handling : 1; r.armor = r.kind === 'bot' ? 1 : r.bike.armor; r.lapse = 0;
    if (r.kind === 'me') player = r;
    r.label.visible = r.kind === 'human';
    if (r.kind === 'human') r.label.setText(g.name);
  });
  setupTraffic(seed);
  powerups.reset(seed);
  raceLive = true; paused = false; camSnap = true; resultsT = 0; flash = 0;
  if (mode === 'solo') clock = AUTO ? -0.5 : -3.2;
  else clock = (net.now() - startAt) / 1000;
  prevClock = clock;
  $('toast').style.opacity = 0; hudCache.place = null;
  show('race');
}

function startSolo() {
  net.close(); mode = 'solo';
  const grid = BOT_NAMES.map((name, i) => ({ id: 'b' + i, name, bot: true }));
  grid.push({ id: 'me', name: myName(), bike: myBike });
  startRace(grid, (Math.random() * 2 ** 31) | 0);
}

function setBike(r, bikeId) {
  const bike = BIKES.find(b => b.id === bikeId) || BIKES[0];
  if (r.model && r.bikeId === bike.id) return;
  if (r.model) {
    r.model.root.remove(r.label); scene.remove(r.model.root);
    r.model.root.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  }
  const [c, j, h] = SLOTS[r.slot];
  r.bikeId = bike.id; r.bike = bike;
  r.model = createBike(c, j, h, custom.bike, bike.style);
  r.model.root.add(r.label); powerups.attach(r); scene.add(r.model.root);
}

// Switch location: unload the current world, load the new one.
let locBusy = Promise.resolve();
function setLocation(id) {
  locBusy = locBusy.then(async () => {
    if (id === curLoc || !LOCATIONS.some(l => l.id === id)) return;
    show('load'); progress(0);
    disposeWorld(scene, world); curLoc = id;
    world = await buildWorld(scene, renderer, id, progress, QUALITY[quality].plants);
    renderer.toneMappingExposure = world.loc.exposure;
    applyQuality(); warm = 0;
    camSnap = true; renderPickers();
    if (screen === 'load') { if (net.connected) { show('lobby'); renderLobby(); } else show('menu'); }
  });
  return locBusy;
}

const HITS = {   // damage, sideways shove, speed kept
  punch: { dmg: 20, push: 2.5, slow: 0.97 }, kick: { dmg: 12, push: 7, slow: 0.97 },
  bolt: { dmg: 28, push: 3, slow: 0.55 }, pulse: { dmg: 15, push: 9, slow: 0.9 },
};

// ---------------------------------------------------------------- helpers
let toastTimer = 0;
function toast(text, secs = 1.6) { const t = $('toast'); t.textContent = text; t.style.opacity = 1; toastTimer = secs; }
const ordinal = n => n + (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'th');
const fmtTime = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const nearPlayer = r => Math.abs(r.z - player.z) < 60;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function startCrash(r, dir) {
  if (r.state !== 'ride' || r.invuln > 0) return;
  r.state = 'crash'; r.crashT = 2.4; r.crashDir = dir || (Math.random() < 0.5 ? -1 : 1); r.attack = null;
  if (nearPlayer(r)) audio.crash();
  if (r === player) { toast('WIPEOUT!', 1.8); flash = 1; }
}

function startAttack(r, side, kind) {
  if (r.attack || r.cooldown > 0 || r.state !== 'ride' || r.finished) return;
  r.attack = { side, kind, t: 0, hit: false };
  r.cooldown = kind === 'kick' ? 0.75 : 0.5;
}

// Damage is always applied by whoever owns the rider that got hit.
function applyHit(o, side, kind) {
  if (o.state !== 'ride' || o.invuln > 0 || o.shield > 0) return;
  const H = HITS[kind] || HITS.punch;
  o.health -= H.dmg / (o.armor || 1);
  o.push += side * H.push;
  o.v *= H.slow;
  if (o === player) { audio.hit(); flash = 0.7; }
  if (o.health <= 0) startCrash(o, side);
}

function resolveHit(r, a) {
  for (const o of riders) {
    if (o === r || !o.active || o.state !== 'ride' || o.invuln > 0) continue;
    const dl = (o.lat - r.lat) * a.side;
    if (Math.abs(o.z - r.z) < 2.1 && dl > 0.25 && dl < 2.2) {
      if (r === player) { audio.hit(); o.lastHitByMe = performance.now(); }
      if (mine(o)) {
        applyHit(o, a.side, a.kind);
        if (r === player && o.state === 'crash') toast(`${o.name.toUpperCase()} IS DOWN!`);
      } else net.send({ t: 'hit', to: o.slot, side: a.side, kind: a.kind });
      return;
    }
  }
}

// ---------------------------------------------------------------- AI
const CAND = [-4.6, -3.1, -1.6, 0, 1.6, 3.1, 4.6];
function blockedAt(r, lat) {
  if (r.lapse > 0) return false;   // momentary lapse of attention
  for (const c of cars) {
    if (Math.abs(c.lat - lat) > 1.9) continue;
    const gap = c.z - r.z, closing = r.v - c.v;
    if (gap > -4 && (gap < 10 || (closing > 0 && gap / closing < 2.4))) return true;
  }
  return false;
}
function think(r) {
  if (r.kind === 'bot' && r.lapse <= 0 && Math.random() < (1 - r.skill) * 0.02) r.lapse = 0.7;
  let pref = r.prefLat;
  // aggressive bots pull alongside the nearest human
  if (r.kind === 'bot' && r.aggr > 0.45) {
    let target = null, best = 9;
    for (const o of riders) if (o.active && o.kind !== 'bot' && o.state === 'ride' && !o.finished && Math.abs(o.z - r.z) < best) { best = Math.abs(o.z - r.z); target = o; }
    if (target) pref = target.lat + (r.lat >= target.lat ? 1.25 : -1.25);
  }
  pref = clamp(pref, -4.8, 4.8);
  let best = r.lat, bestCost = 1e9, bestBlocked = true;
  for (const c of [...CAND, pref]) {
    const blocked = blockedAt(r, c);
    const cost = Math.abs(c - pref) * 0.5 + Math.abs(c - r.lat) * 0.2 + (blocked ? 100 : 0);
    if (cost < bestCost) { bestCost = cost; best = c; bestBlocked = blocked; }
  }
  r.targetLat = best; r.brakeAI = bestBlocked;
}

// ---------------------------------------------------------------- simulation
function stepRider(r, throttle, brake, steerIn, dt, drift) {
  r.cooldown = Math.max(0, r.cooldown - dt);
  r.invuln = Math.max(0, r.invuln - dt);
  r.health = Math.min(100, r.health + 1.5 * dt);
  const slope = Math.hypot(1, roadDX(r.z), roadDY(r.z));

  if (r.state === 'crash') {
    r.crashT -= dt;
    r.v *= Math.exp(-1.8 * dt);
    r.spin += r.crashDir * 5 * dt * Math.min(1, r.v / 15);
    r.z += (r.v * dt) / slope;
    r.lat = clamp(r.lat + r.push * dt, -14, 14);
    r.push *= Math.exp(-3 * dt);
    if (r.crashT <= 0) {
      r.state = 'ride'; r.lat = clamp(r.lat, -4.5, 4.5); r.v = 0; r.push = 0; r.spin = 0;
      r.health = Math.max(r.health, 60); r.invuln = 2.5;
    }
    return;
  }

  r.steer += (steerIn - r.steer) * Math.min(1, dt * 8);
  const offroad = Math.abs(r.lat) > ROAD_HALF + 0.3;
  const top = r.top * r.boost * (offroad ? 0.4 : 1) * (r.nitro > 0 ? 1.3 : 1);
  let a = throttle * (r.accel + (r.nitro > 0 ? 14 : 0)) * (1 - r.v / top) - brake * 16 - (throttle > 0 ? 0 : 2.5);
  if (r.v > top) a -= offroad ? 16 : 4;
  r.v = Math.max(0, r.v + a * dt);

  const auth = Math.min(11, 2.5 + r.v * 0.22) * Math.min(1, r.v / 5) * r.handling;
  r.steerVel = -r.steer * auth;
  r.lat += (r.steerVel + r.push) * dt - (drift / r.handling) * roadDDX(r.z) * r.v * r.v * dt;
  r.push *= Math.exp(-4 * dt);
  r.z += (r.v * dt) / slope;

  if (Math.abs(r.lat) > 12.5) startCrash(r, Math.sign(r.lat));

  if (r.attack) {
    const at = r.attack;
    at.t += dt / 0.32;
    if (!at.hit && at.t >= 0.45) { at.hit = true; resolveHit(r, at); }
    if (at.t >= 1) r.attack = null;
  }
}

// Riders owned by another player (or the host's bots): follow the latest network state smoothly.
function stepRemote(r, dt) {
  const n = r.net;
  if (!n) return;
  const slope = Math.hypot(1, roadDX(r.z), roadDY(r.z));
  r.v = n.v; r.push = n.push; r.steerVel = n.steerVel; r.health = n.health;
  r.steer += (n.steer - r.steer) * Math.min(1, dt * 10);
  const st = n.flags & 1 ? 'crash' : 'ride';
  if (st !== r.state) {
    r.state = st; r.spin = 0; r.crashDir = n.crashDir;
    if (st === 'crash') {
      if (nearPlayer(r)) audio.crash();
      if (performance.now() - r.lastHitByMe < 900) toast(`${r.name.toUpperCase()} IS DOWN!`);
    }
  }
  r.finished = !!(n.flags & 2); r.finishTime = n.ft; r.invuln = n.flags & 4 ? 1 : 0;
  r.shield = n.flags & 8 ? 1 : 0; r.nitro = n.flags & 16 ? 1 : 0;
  if (r.state === 'crash') r.spin += r.crashDir * 5 * dt * Math.min(1, r.v / 15);
  const age = Math.min(0.5, (performance.now() - n.at) / 1000), target = n.z + (n.v * age) / slope;
  r.z += (r.v * dt) / slope;
  r.z = Math.abs(target - r.z) > 30 ? target : r.z + (target - r.z) * Math.min(1, dt * 8);
  r.lat += (n.lat - r.lat) * Math.min(1, dt * 10);
  if (!n.atk) r.attack = null;
  else if (!r.attack) r.attack = { side: Math.sign(n.atk), kind: Math.abs(n.atk) === 1 ? 'punch' : 'kick', t: n.atkT, hit: true };
  else r.attack.t = Math.min(1, r.attack.t + dt / 0.32);
}

function simulate(dt, t) {
  for (const c of cars) c.z = carZ(c, t);
  let humanZ = 0, humans = 0;
  for (const r of riders) if (r.active && r.kind !== 'bot' && !r.finished) { humanZ += r.z; humans++; }
  humanZ = humans ? humanZ / humans : player.z;

  for (const r of riders) {
    if (!r.active) continue;
    if (!mine(r)) { stepRemote(r, dt); continue; }
    const ai = r.kind === 'bot' || AUTO;
    let throttle = 0, brake = 0, steerIn = 0;
    if (r.finished) {
      brake = 0.45; steerIn = clamp((r.lat - r.targetLat) * 0.9, -1, 1);
    } else if (ai) {
      if ((r.thinkT -= dt) <= 0) { r.thinkT = 0.2; think(r); }
      if (r.kind === 'bot') {
        r.lapse -= dt;
        const gap = r.z - humanZ;
        r.boost = gap > 260 ? 0.88 : gap > 120 ? 0.94 : gap < -300 ? 1.08 : gap < -120 ? 1.04 : 1;
        r.boost *= 1 - Math.min(0.14, Math.abs(roadDDX(r.z)) * 60 * (1.2 - r.skill));
        for (const o of riders) {
          if (!o.active || o.kind === 'bot' || o.state !== 'ride' || o.finished) continue;
          const dz = o.z - r.z, dl = o.lat - r.lat;
          if (Math.abs(dz) < 1.9 && Math.abs(dl) > 0.45 && Math.abs(dl) < 2.0 && t > 6 && Math.random() < r.aggr * dt * 0.9) {
            startAttack(r, Math.sign(dl), Math.random() < 0.7 ? 'punch' : 'kick');
          }
        }
      }
      throttle = r.brakeAI ? 0 : 1; brake = r.brakeAI ? 0.7 : 0;
      steerIn = clamp((r.lat - r.targetLat) * 0.9, -1, 1);
    } else {
      throttle = keys.ArrowUp || keys.KeyW ? 1 : 0;
      brake = keys.ArrowDown || keys.KeyS ? 1 : 0;
      steerIn = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0);
    }
    r.throttle = throttle;
    stepRider(r, throttle, brake, steerIn, dt, ai ? 0 : 0.45);
    if (!r.finished && r.z >= FINISH_Z) {
      r.finished = true; r.finishTime = t; r.targetLat = r.lat;
      if (r === player) { resultsT = 1.5; audio.beep(true); }
    }
  }

  // rider vs rider: each owner moves only their own riders
  for (let i = 0; i < riders.length; i++) for (let j = i + 1; j < riders.length; j++) {
    const a = riders[i], b = riders[j];
    if (!a.active || !b.active || a.state !== 'ride' || b.state !== 'ride') continue;
    const dl = b.lat - a.lat;
    if (Math.abs(b.z - a.z) < 1.7 && Math.abs(dl) < 0.7) {
      const p = (0.7 - Math.abs(dl)) / 2 * (dl >= 0 ? 1 : -1);
      if (mine(a)) { a.lat -= p; a.push -= Math.sign(p) * 0.8; }
      if (mine(b)) { b.lat += p; b.push += Math.sign(p) * 0.8; }
    }
  }

  // traffic vs my riders (short grace period off the line)
  if (t > 2.5) for (const c of cars) for (const r of riders) {
    if (!r.active || !mine(r) || r.state !== 'ride' || r.invuln > 0) continue;
    const dz = c.z - r.z;
    if (Math.abs(dz) < c.model.halfLen + 0.5 && Math.abs(c.lat - r.lat) < 1.25) {
      if (Math.abs(r.v - c.v) > 7) {
        startCrash(r, Math.sign(r.lat - c.lat) || 1);
        r.push = Math.sign(r.lat - c.lat) * 5; r.v = Math.max(0, c.v) * 0.6 + r.v * 0.15;
      } else {
        r.lat += Math.sign(r.lat - c.lat || 1) * 4 * dt;
        if (dz * c.dir > 0) r.v = Math.min(r.v, Math.max(0, c.v - 1));
      }
    }
  }
}

function tick(dt) {
  if (toastTimer > 0 && (toastTimer -= dt) <= 0 && !paused) $('toast').style.opacity = 0;
  flash = Math.max(0, flash - dt * 2);

  if (raceLive) {
    prevClock = clock;
    clock = mode === 'online' ? (net.now() - startAt) / 1000 : clock + dt;
    // countdown
    if (clock < 1.2) {
      const label = clock < 0 ? String(Math.min(3, Math.ceil(-clock))) : clock < 1 ? 'GO!' : '';
      if ($('count').textContent !== label) {
        $('count').textContent = label;
        if (label) audio.beep(label === 'GO!');
      }
    }
    if (clock > 0) {
      const simDt = Math.min(dt, clock), steps = Math.max(1, Math.ceil(simDt / (1 / 30)));
      for (let i = 1; i <= steps; i++) simulate(simDt / steps, clock - simDt + (simDt * i) / steps);
    } else for (const c of cars) c.z = carZ(c, 0);
    powerups.update(dt, clock);

    if (mode === 'online' && (sendT -= dt) <= 0) {
      sendT = 1 / 15;
      const out = [];
      for (const r of riders) if (r.active && mine(r)) out.push(pack(r));
      if (out.length) net.send({ t: 's', ts: net.now(), r: out });
    }
    if (resultsT > 0 && (resultsT -= dt) <= 0) showResults();
    if (screen === 'results' && (resultsRefresh -= dt) <= 0) { resultsRefresh = 0.5; renderResults(); }
  }

  updateVisuals(dt);
  updateCamera(dt);
  updateHud();
}

const r2 = x => Math.round(x * 100) / 100;
function pack(r) {
  const flags = (r.state === 'crash' ? 1 : 0) | (r.finished ? 2 : 0) | (r.invuln > 0 ? 4 : 0) | (r.shield > 0 ? 8 : 0) | (r.nitro > 0 ? 16 : 0);
  const a = r.attack;
  return [r.slot, r2(r.z), r2(r.lat), r2(r.v), r2(r.steer), r2(r.push), flags, Math.round(r.health),
    a ? a.side * (a.kind === 'punch' ? 1 : 2) : 0, a ? r2(a.t) : 0, r2(r.finishTime), r.crashDir, r2(r.steerVel)];
}

function standings() {
  return riders.filter(r => r.active).sort((a, b) => (b.finished ? 1e7 - b.finishTime : b.z) - (a.finished ? 1e7 - a.finishTime : a.z));
}

// ---------------------------------------------------------------- visuals
function updateVisuals(dt) {
  const t = performance.now() / 1000;
  for (const r of riders) {
    if (!r.active) continue;
    const m = r.model;
    trackToWorld(r.z, r.lat, tmp);
    m.root.position.copy(tmp);
    const crash = r.state === 'crash';
    const side = crash ? 0 : r.steerVel + r.push;
    m.root.rotation.y = Math.atan2(roadDX(r.z), 1) + Math.atan2(side, Math.max(r.v, 10)) * 0.8 + r.spin;
    m.root.rotation.x = -Math.atan(roadDY(tmp.z));
    let leanT;
    if (crash) leanT = -r.crashDir * 1.5;
    else leanT = clamp(r.steer * 0.55 * Math.min(1, r.v / 20) - roadDDX(r.z) * r.v * r.v * 0.06 - r.push * 0.04, -0.8, 0.8);
    r.leanV += (leanT - r.leanV) * Math.min(1, dt * (crash ? 9 : 6));
    m.lean.rotation.z = r.leanV;
    for (const w of m.wheels) w.rotation.x += (r.v * dt) / 0.325;
    m.root.visible = r.invuln > 0 ? Math.floor(t * 12) % 2 === 0 : true;

    const a = r.attack;
    for (const tag of ['L', 'R']) {
      const on = a && (a.side > 0) === (tag === 'L');
      const punch = !!on && a.kind === 'punch', kick = !!on && a.kind === 'kick';
      m['strike' + tag].visible = punch; m['arm' + tag].visible = !punch;
      m['kick' + tag].visible = kick; m['leg' + tag].visible = !kick;
      if (on) (punch ? m['strike' + tag] : m['kick' + tag]).scale.setScalar(0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, a.t)));
    }
  }
  for (const c of cars) {
    trackToWorld(c.z, c.lat, tmp);
    c.model.root.position.copy(tmp);
    c.model.root.rotation.y = Math.atan2(roadDX(c.z), 1) + (c.dir < 0 ? Math.PI : 0);
    c.model.root.rotation.x = -Math.atan(roadDY(tmp.z)) * c.dir;
  }
  // sun + shadow frustum follow the player
  trackToWorld(player.z + 18, player.lat, tmp);
  world.sun.target.position.copy(tmp);
  world.sun.position.copy(tmp).addScaledVector(world.sunDir, 160);

  // engine note
  const gearSpan = TOP / 6, gear = Math.min(5, Math.floor(player.v / gearSpan));
  const rpm = 0.3 + 0.7 * clamp((player.v - gear * gearSpan) / gearSpan, 0, 1);
  player.gear = gear + 1;
  audio.update(raceLive ? rpm : 0.1, player.throttle || 0, player.v / TOP, raceLive && player.state === 'ride' && !paused);
}

let camLat = 0, camLean = 0;
function updateCamera(dt) {
  camLat += (player.lat * 0.85 - camLat) * (camSnap ? 1 : Math.min(1, dt * 5));
  camLean += (player.leanV - camLean) * Math.min(1, dt * 4);
  const sp = player.v / TOP;
  trackToWorld(player.z - 6.4 - sp * 1.2, camLat, tmp); tmp.y += 2.45;
  if (Math.abs(player.lat) > ROAD_HALF + 0.3 && player.v > 5) { tmp.x += (Math.random() - 0.5) * 0.08; tmp.y += (Math.random() - 0.5) * 0.08; }
  camera.position.copy(tmp);
  trackToWorld(player.z + 14, player.lat * 0.75, tmp2); tmp2.y += 1.1;
  camera.lookAt(tmp2);
  camera.rotateZ(-clamp(camLean, -0.8, 0.8) * 0.22);
  const fov = 58 + 14 * sp * sp;
  if (Math.abs(fov - camera.fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
  camSnap = false;
}

function setW(id, pct) { const v = pct.toFixed(1) + '%'; if (hudCache['w' + id] !== v) { hudCache['w' + id] = v; $(id).style.width = v; } }
function setOp(id, v) { if (hudCache['o' + id] !== v) { hudCache['o' + id] = v; $(id).style.opacity = v; } }
let hudTick = 0;
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
function updateHud() {
  setText('speed', Math.round(player.v * 3.6));
  setText('gear', player.v < 0.5 ? 'N' : 'GEAR ' + player.gear);
  setText('time', fmtTime(player.finished ? player.finishTime : Math.max(0, clock)));
  const order = standings(), place = order.indexOf(player) + 1, key = place + '/' + order.length;
  if (hudCache.place !== key) { hudCache.place = key; $('pos').innerHTML = `${ordinal(place)}<small> / ${order.length}</small>`; }
  setW('health', clamp(player.health, 0, 100));
  setW('prog', clamp((player.z - START_Z) / (FINISH_Z - START_Z), 0, 1) * 100);
  setOp('flash', Math.round(flash * 20) / 20);
  const items = player.items || [];
  setText('item0', items[0] ? ITEMS[items[0]].name : '—'); setText('item1', items[1] ? ITEMS[items[1]].name : '—');
  if (!NO_RENDER && (hudTick++ & 1) === 0) drawMinimap($('minimap'), G);
  let near = null, nd = 15;
  for (const r of riders) if (r.active && r !== player && Math.abs(r.z - player.z) < nd) { nd = Math.abs(r.z - player.z); near = r; }
  setOp('rival', near ? 1 : 0);
  if (near) { setText('rivalName', near.name); setW('rivalHealth', clamp(near.health, 0, 100)); }
}

// ---------------------------------------------------------------- screens
function show(name) {
  screen = name;
  for (const s of ['load', 'menu', 'lobby', 'results', 'pause']) $('scr-' + s).classList.toggle('hidden', s !== name);
  $('overlay').classList.toggle('hidden', name === 'race');
  $('hud').classList.toggle('hidden', name !== 'race');
  if (name === 'menu' || name === 'lobby') $('sub').textContent = 'Six kilometres of open highway. Ten riders. No rules.';
}
// In-race menu. Solo: the race freezes. Online: the race carries on for everyone else.
function pauseLabels() {
  $('btnGfx').textContent = 'Graphics: ' + quality;
  $('btnSound').textContent = 'Sound: ' + (audio.muted ? 'off' : 'on');
}
function openPause() {
  if (screen !== 'race' || !raceLive) return;
  if (mode === 'solo') { paused = true; audio.update(0.1, 0, 0, false); }
  $('sub').textContent = mode === 'solo' ? 'Paused' : 'Menu — the race is still running';
  $('btnRestart').classList.toggle('hidden', mode !== 'solo');
  $('btnQuit').textContent = mode === 'solo' ? 'Quit to main menu' : 'Leave the race and room';
  pauseLabels(); show('pause');
}
function closePause() { if (screen !== 'pause') return; paused = false; show('race'); }
function quitRace() { net.close(); mode = 'solo'; paused = false; raceLive = false; show('menu'); }
function cycleQuality() {
  quality = { low: 'medium', medium: 'high', high: 'low' }[quality];
  try { localStorage.setItem('bb_gfx', quality); } catch {}
  applyQuality(); warm = 0;
}
function myName() { return ($('name').value.trim() || 'Rider').slice(0, 14); }

function showResults() {
  $('btnAgain').textContent = mode === 'online' ? 'Back to lobby' : 'Race again';
  renderResults(); show('results');
}
function renderResults() {
  const order = standings(), place = order.indexOf(player) + 1;
  $('sub').textContent = `You finished ${ordinal(place)} of ${order.length} in ${fmtTime(player.finishTime)}`;
  $('resultsBody').innerHTML = '<table>' + order.map((r, i) =>
    `<tr${r === player ? ' style="color:#ffd166;font-weight:700"' : ''}><td>${i + 1}</td><td>${esc(r.name)}${r.kind === 'bot' ? '' : ' ●'}</td><td>${r.finished ? fmtTime(r.finishTime) : 'still riding'}</td></tr>`).join('') + '</table>';
}

function renderLobby() {
  $('roomCode').textContent = net.room;
  $('shareLink').value = `${location.origin}${location.pathname}?room=${net.room}`;
  $('lobbyLoc').textContent = (LOCATIONS.find(l => l.id === net.loc) || LOCATIONS[0]).name;
  $('btnLoc').classList.toggle('hidden', !net.isHost);
  $('playerList').innerHTML = net.players.map(p =>
    `<li>${esc(p.name)} <small>${esc((BIKES.find(b => b.id === p.bike) || BIKES[0]).name)}</small>${p.id === net.id ? '<small>you</small>' : ''}${p.id === net.hostId ? '<small>host</small>' : ''}</li>`).join('');
  $('btnStart').classList.toggle('hidden', !net.isHost);
  const bots = Math.max(0, GRID - net.players.length);
  $('lobbyMsg').textContent = net.isHost
    ? `${net.players.length} rider${net.players.length > 1 ? 's' : ''} here. ${bots ? bots + ' computer riders fill the grid. ' : ''}Start when everyone is in.`
    : 'Waiting for the host to start the race…';
  if (AUTO && net.isHost && net.players.length >= (+params.get('autostart') || 1e9)) net.send({ t: 'start' });
}

// ---------------------------------------------------------------- online
const net = new Net({
  players(m) {
    if (wantLoc) {   // the first rider into a room brings the location they picked on the menu
      const w = wantLoc; wantLoc = null;
      if (net.isHost && m.loc !== w) { net.send({ t: 'cfg', loc: w }); return; }
    }
    if (m.loc !== curLoc && !raceLive) setLocation(m.loc).then(() => { if (screen === 'lobby') renderLobby(); });
    if (screen === 'lobby') renderLobby(); else if (screen === 'results') renderResults();
  },
  start(m) {
    mode = 'online'; raceLive = false;
    setLocation(m.loc || curLoc).then(() => { startAt = m.startAt; startRace(m.grid, m.seed); });
  },
  ev(m) { if (raceLive && m && typeof m.e === 'string') powerups.onEvent(m, clock); },
  state(m) {
    if (!raceLive || !Array.isArray(m.r)) return;
    // how long the update spent in transit (both ends share the server's clock), so riders are drawn where they are now
    const transit = typeof m.ts === 'number' ? clamp(net.now() - m.ts, 0, 400) : 0;
    for (const a of m.r) {
      const r = riders[a[0]];
      if (!r || !r.active || mine(r)) continue;
      r.net = { z: a[1], lat: a[2], v: a[3], steer: a[4], push: a[5], flags: a[6], health: a[7], atk: a[8], atkT: a[9], ft: a[10], crashDir: a[11], steerVel: a[12], at: performance.now() - transit };
    }
  },
  hit(m) { const r = riders[m.to]; if (raceLive && r && r.active && mine(r)) applyHit(r, m.side > 0 ? 1 : -1, HITS[m.kind] ? m.kind : 'punch'); },
  left(m) { for (const r of riders) if (r.kind === 'human' && r.id === m.id) { r.active = false; r.model.root.visible = false; } },
  closed() { if (mode === 'online') { raceLive = false; mode = 'solo'; show('menu'); $('menuMsg').textContent = 'Lost connection to the game server.'; } },
});

let wantLoc = null;
async function goOnline() {
  $('menuMsg').textContent = 'Connecting…';
  wantLoc = curLoc;
  $('btnOnline').disabled = true;
  try {
    await net.connect(myName(), $('room').value, myBike);
    mode = 'online'; raceLive = false; $('menuMsg').textContent = '';
    if (screen !== 'load') { show('lobby'); renderLobby(); }
  } catch (e) { $('menuMsg').textContent = e.message; }
  $('btnOnline').disabled = false;
}

$('btnSolo').onclick = () => { audio.start(); startSolo(); };
$('btnOnline').onclick = () => { audio.start(); goOnline(); };
$('btnStart').onclick = () => net.send({ t: 'start' });
$('btnLoc').onclick = () => { const i = LOCATIONS.findIndex(l => l.id === net.loc); net.send({ t: 'cfg', loc: LOCATIONS[(i + 1) % LOCATIONS.length].id }); };
$('btnLeave').onclick = () => { net.close(); mode = 'solo'; raceLive = false; show('menu'); };
$('btnCopy').onclick = () => { $('shareLink').select(); navigator.clipboard?.writeText($('shareLink').value); $('btnCopy').textContent = 'Copied'; setTimeout(() => ($('btnCopy').textContent = 'Copy'), 1200); };
$('btnAgain').onclick = () => { if (mode === 'online') { show('lobby'); renderLobby(); } else startSolo(); };
$('btnPause').onclick = openPause;
$('btnResume').onclick = closePause;
$('btnRestart').onclick = () => { paused = false; startSolo(); };
$('btnGfx').onclick = () => { cycleQuality(); pauseLabels(); };
$('btnSound').onclick = () => { audio.toggleMute(); pauseLabels(); };
$('btnQuit').onclick = quitRace;
$('btnMenu').onclick = () => { net.close(); mode = 'solo'; raceLive = false; show('menu'); };
$('name').onchange = () => { try { localStorage.setItem('bb_name', myName()); } catch {} };

// ---------------------------------------------------------------- input
window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') { if (e.code === 'Enter' && screen === 'menu') (e.target.id === 'room' ? goOnline : startSolo)(); return; }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys[e.code] = true;
  audio.start();
  const racing = screen === 'race' && raceLive && clock > 0 && !player.finished;
  switch (e.code) {
    case 'Enter':
      if (screen === 'menu') startSolo();
      else if (screen === 'results') $('btnAgain').click();
      else if (screen === 'pause') closePause();
      else if (screen === 'lobby' && net.isHost) net.send({ t: 'start' });
      break;
    case 'KeyR': if (mode === 'solo' && raceLive) startSolo(); break;
    case 'KeyG': cycleQuality(); pauseLabels(); toast('GRAPHICS: ' + quality.toUpperCase(), 1.2); break;
    case 'KeyM': toast(audio.toggleMute() ? 'SOUND OFF' : 'SOUND ON', 0.8); pauseLabels(); break;
    case 'KeyP': case 'Escape': if (screen === 'race') openPause(); else closePause(); break;
    case 'Space': if (racing) powerups.use(player, clock); break;
    case 'ShiftLeft': case 'ShiftRight': if (racing && player.items.length > 1) player.items.reverse(); break;
    case 'KeyZ': case 'KeyJ': if (racing) startAttack(player, 1, 'punch'); break;
    case 'KeyC': case 'KeyL': if (racing) startAttack(player, -1, 'punch'); break;
    case 'KeyX': case 'KeyK': {
      if (!racing) break;
      let side = -1, best = 3;
      for (const r of riders) if (r.active && r !== player && Math.abs(r.z - player.z) < best) { best = Math.abs(r.z - player.z); side = r.lat >= player.lat ? 1 : -1; }
      startAttack(player, side, 'kick'); break;
    }
  }
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (mode === 'solo' && !AUTO) openPause(); });

// ---------------------------------------------------------------- power-ups, bikes, menu pickers
const G = {
  scene, riders, cars, net, audio, mine, applyHit, startCrash, auto: !!AUTO,
  player: () => player, clock: () => clock, slotCss: i => '#' + SLOTS[i][0].toString(16).padStart(6, '0'),
};
const powerups = G.powerups = createPowerups(G);
riders.forEach((r, i) => setBike(r, i === GRID - 1 ? myBike : BIKES[i % BIKES.length].id));
powerups.reset(1);

function renderPickers() {
  $('locPick').innerHTML = LOCATIONS.map(l =>
    `<button class="card${l.id === curLoc ? ' sel' : ''}" data-loc="${l.id}"><b>${l.name}</b><small>${l.blurb}</small></button>`).join('');
  const bar = (label, v) => `<div class="stat">${label}<i><u style="width:${Math.round(clamp(v, 0.08, 1) * 100)}%"></u></i></div>`;
  $('bikePick').innerHTML = BIKES.map(b =>
    `<button class="card${b.id === myBike ? ' sel' : ''}" data-bike="${b.id}"><b>${b.name}</b><small>${b.blurb}</small>` +
    bar('Speed', (b.top - 64) / 9) + bar('Accel', (b.accel - 14) / 10) + bar('Handling', (b.handling - 0.7) / 0.6) + bar('Toughness', (b.armor - 0.6) / 1) + '</button>').join('');
}
$('locPick').onclick = e => {
  const id = e.target.closest('[data-loc]')?.dataset.loc;
  if (!id || screen !== 'menu') return;
  try { localStorage.setItem('bb_loc', id); } catch {}
  setLocation(id);
};
$('bikePick').onclick = e => {
  const id = e.target.closest('[data-bike]')?.dataset.bike;
  if (!id) return;
  myBike = id; try { localStorage.setItem('bb_bike', id); } catch {}
  if (!raceLive) { setBike(player, id); camSnap = true; }
  renderPickers();
};
renderPickers();

// ---------------------------------------------------------------- boot
try { $('name').value = localStorage.getItem('bb_name') || ''; } catch {}
if (params.get('name')) $('name').value = params.get('name');
$('room').value = (params.get('room') || Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('')).toUpperCase();
for (const r of riders) {
  r.z = START_Z - 6 - Math.floor(r.slot / 3) * 6; r.lat = [3.5, 0, -3.5][r.slot % 3];
  Object.assign(r, { v: 0, push: 0, steer: 0, steerVel: 0, leanV: 0, spin: 0, state: 'ride', invuln: 0, attack: null, health: 100 });
}
setupTraffic(1);
for (const c of cars) c.z = carZ(c, 0);
show('menu');
if (params.get('room') && !AUTO) $('menuMsg').textContent = `You were invited to room ${$('room').value}. Enter your name and press "Play online".`;
if (AUTO) {
  if (params.get('room')) goOnline();
  else {
    startSolo();
    const warp = +params.get('warp') || 0; // debug: pre-simulate N seconds
    for (let i = 0; i < warp * 30; i++) tick(1 / 30);
  }
}

let last = performance.now();
function frame(now) {
  const raw = (now - last) / 1000, dt = clamp(raw, 0, 0.25); last = now;
  autoScale(raw);
  if (!paused) tick(dt);
  if (!NO_RENDER) { if (quality === 'low') renderer.render(scene, camera); else composer.render(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__game = { riders, cars, net, powerups, renderer, get player() { return player; }, get clock() { return clock; }, get screen() { return screen; }, get mode() { return mode; } };
