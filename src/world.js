// World: road layout, terrain, scenery, sky and lighting.
// Sky, ground/road textures, rocks and trees come from CC0 scanned assets in /assets (see CREDITS.md).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const TRACK_LEN = 6000;
export const ROAD_HALF = 6;      // half road width in metres
export const START_Z = 100;
export const FINISH_Z = 5800;

// Each location has its own road shape, terrain, sky, ground and vegetation.
export const LOCATIONS = [
  { id: 'valley', name: 'Green Valley', blurb: 'Rolling hills and steady bends',
    road: { a1: 80, f1: 0.003, a2: 30, f2: 0.008, h1: 14, g1: 0.0025, h2: 5, g2: 0.007 }, hills: 90, mountains: 220,
    ground: 'leafy_grass', macro: 'aerial_grass_rock', tint: [0.62, 0.86, 0.5], gravel: [0.78, 0.66, 0.52],
    trees: { conifer: 330, leaf: 2400 }, plants: { grass: 9000, shrub: 300, fern: 500, tint: [0.78, 1, 0.58] }, rocks: 9, buildings: 14, fog: [420, 3600], sun: 2.6, exposure: 0.6 },
  { id: 'desert', name: 'Dust Flats', blurb: 'Long, fast sweepers in open desert',
    road: { a1: 120, f1: 0.0018, a2: 18, f2: 0.006, h1: 6, g1: 0.002, h2: 2, g2: 0.006 }, hills: 35, mountains: 260,
    ground: 'dry_ground_01', macro: 'aerial_sand', tint: [1, 0.9, 0.75], gravel: [0.95, 0.85, 0.7],
    trees: { conifer: 0, leaf: 260 }, plants: { grass: 2500, shrub: 1800, fern: 0, tint: [1, 0.95, 0.8] }, rocks: 16, buildings: 5, fog: [500, 4200], sun: 3.0, exposure: 0.55 },
  { id: 'ridge', name: 'Pine Ridge', blurb: 'A tight mountain road at sunset',
    road: { a1: 70, f1: 0.0035, a2: 34, f2: 0.0095, h1: 26, g1: 0.0022, h2: 8, g2: 0.008 }, hills: 120, mountains: 300,
    ground: 'forrest_ground_01', macro: 'aerial_grass_rock', tint: [0.45, 0.62, 0.36], gravel: [0.7, 0.6, 0.5],
    trees: { conifer: 700, leaf: 900 }, plants: { grass: 6000, shrub: 500, fern: 2600, tint: [0.72, 0.9, 0.55] }, rocks: 12, buildings: 6, fog: [300, 3000], sun: 2.4, exposure: 0.75 },
];
let P = LOCATIONS[0], R = P.road;

// The road is a function of z: centreline x and height.
export const roadX = z => R.a1 * Math.sin(z * R.f1) + R.a2 * Math.sin(z * R.f2 + 1.3);
export const roadDX = z => R.a1 * R.f1 * Math.cos(z * R.f1) + R.a2 * R.f2 * Math.cos(z * R.f2 + 1.3);
export const roadDDX = z => -R.a1 * R.f1 * R.f1 * Math.sin(z * R.f1) - R.a2 * R.f2 * R.f2 * Math.sin(z * R.f2 + 1.3);
export const roadY = z => 20 + R.h1 * Math.sin(z * R.g1) + R.h2 * Math.sin(z * R.g2 + 2);
export const roadDY = z => R.h1 * R.g1 * Math.cos(z * R.g1) + R.h2 * R.g2 * Math.cos(z * R.g2 + 2);

// Track coordinates (distance z, lateral offset lat; +lat is the left side when riding) -> world.
export function trackToWorld(z, lat, out) {
  const dx = roadDX(z), n = 1 / Math.hypot(dx, 1);
  out.x = roadX(z) + lat * n;
  out.z = z - lat * dx * n;
  out.y = roadY(out.z);
  return out;
}

export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

function hash(ix, iz) { const n = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453; return n - Math.floor(n); }
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  return mix(mix(hash(ix, iz), hash(ix + 1, iz), ux), mix(hash(ix, iz + 1), hash(ix + 1, iz + 1), ux), uz);
}
function fbm(x, z) {
  let a = 0.5, s = 0;
  for (let i = 0; i < 4; i++) { s += a * vnoise(x, z); x *= 2.03; z *= 2.03; a *= 0.5; }
  return s;
}

export function terrainY(x, z) {
  const d = Math.abs(x - roadX(z));
  const t = smooth(ROAD_HALF + 4, ROAD_HALF + 80, d);
  const hills = (fbm(x * 0.004, z * 0.004) - 0.42) * P.hills;
  const mountains = smooth(150, 520, d) * fbm(x * 0.0015 + 50, z * 0.0015) * P.mountains;
  return roadY(z) - 0.08 + t * hills + mountains;
}

function tint(geo, r, g, b) {
  const n = geo.attributes.position.count, a = new Float32Array(n * 3);
  const c = new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const texLoader = new THREE.TextureLoader();
async function loadTex(url, srgb, repeat) {
  const t = await texLoader.loadAsync(url);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------------------------------------------------------------- terrain
function buildTerrain(scene, tex, aniso) {
  // Built as strips along the road so strips behind the camera or beyond the haze are not drawn.
  const x0 = -640, x1 = 640, z0 = -320, z1 = TRACK_LEN + 400, step = 8, CH = 480, e = 4;
  const nx = (x1 - x0) / step;
  for (const t of [tex.grass, tex.grassN]) { t.repeat.set((x1 - x0) / 5, CH / 5); t.anisotropy = aniso; }
  const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, map: tex.grass, normalMap: tex.grassN, normalScale: new THREE.Vector2(1.5, 1.5), roughness: 1, metalness: 0, specularIntensity: 0.1 });
  // Close up: grass detail texture. Far away: an aerial photo texture, so hills don't look tiled.
  mat.onBeforeCompile = sh => {
    sh.uniforms.uMacro = { value: tex.macro };
    sh.uniforms.uTint = { value: new THREE.Vector3(...P.tint) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWorldXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uMacro;\nuniform vec3 uTint;\nvarying vec2 vWorldXZ;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 macro = texture2D(uMacro, vWorldXZ * 0.0045).rgb;
        float farMix = smoothstep(60.0, 450.0, length(vViewPosition));
        macro *= uTint;                                       // per-location colour cast
        float lum = dot(macro, vec3(0.3, 0.6, 0.1));
        vec3 nearCol = diffuseColor.rgb * (0.55 + lum * 1.6);
        diffuseColor.rgb = mix(nearCol, macro, farMix * 0.9);`);
  };
  for (let zc = z0; zc < z1; zc += CH) {
    const geo = new THREE.PlaneGeometry(x1 - x0, CH, nx, CH / step);
    geo.rotateX(-Math.PI / 2);
    geo.translate((x0 + x1) / 2, 0, zc + CH / 2);
    const pos = geo.attributes.position, nor = geo.attributes.normal, col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, terrainY(x, z));
      // normals from the height function itself, so neighbouring strips shade seamlessly
      const gx = (terrainY(x + e, z) - terrainY(x - e, z)) / (2 * e), gz = (terrainY(x, z + e) - terrainY(x, z - e)) / (2 * e);
      const l = 1 / Math.hypot(gx, 1, gz);
      nor.setXYZ(i, -gx * l, l, -gz * l);
      // vertex colour only tints the photo textures: roadside gravel and patchy variation
      const d = Math.abs(x - roadX(z));
      const gravel = 1 - smooth(ROAD_HALF + 0.5, ROAD_HALF + 6, d);
      const v = 0.85 + 0.3 * fbm(x * 0.02, z * 0.02);
      col[i * 3] = mix(v, P.gravel[0], gravel); col[i * 3 + 1] = mix(v, P.gravel[1], gravel); col[i * 3 + 2] = mix(v, P.gravel[2], gravel);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

// ---------------------------------------------------------------- road
function buildRoad(scene, tex, aniso) {
  const pos = [], uv = [], idx = [];
  let i = 0;
  for (let z = -300; z <= TRACK_LEN + 380; z += 4, i++) {
    const dx = roadDX(z), n = 1 / Math.hypot(dx, 1);
    for (const s of [1, -1]) {
      const px = roadX(z) + s * ROAD_HALF * n, pz = z - s * ROAD_HALF * dx * n;
      pos.push(px, roadY(pz) + 0.05, pz);
      uv.push(s > 0 ? 0 : 1, z / 12);
    }
    if (i > 0) { const a = (i - 1) * 2, b = a + 1, c = i * 2, d = c + 1; idx.push(a, b, c, b, d, c); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  // Photo asphalt (tiled 3x across the 12 m road) with painted markings and wear drawn on top.
  const map = canvasTex(2048, 2048, (g, w, h) => {
    const img = tex.asphalt.image, t = w / 3;
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) g.drawImage(img, x * t, y * t, t, t);
    for (const cx of [0.17, 0.33, 0.67, 0.83]) {
      const gr = g.createLinearGradient((cx - 0.06) * w, 0, (cx + 0.06) * w, 0);
      gr.addColorStop(0, 'rgba(10,10,12,0)'); gr.addColorStop(0.5, 'rgba(10,10,12,0.28)'); gr.addColorStop(1, 'rgba(10,10,12,0)');
      g.fillStyle = gr; g.fillRect((cx - 0.06) * w, 0, 0.12 * w, h);
    }
    g.fillStyle = 'rgba(226,226,216,0.92)'; g.fillRect(88, 0, 34, h); g.fillRect(w - 122, 0, 34, h);
    g.fillStyle = 'rgba(214,166,30,0.92)'; g.fillRect(w / 2 - 18, 0, 36, h * 0.4);
    // worn paint: punch asphalt-coloured specks back through the lines
    g.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 9000; k++) {
      const lane = [88, w - 122, w / 2 - 18][k % 3];
      g.fillStyle = `rgba(0,0,0,${0.3 + Math.random() * 0.5})`;
      g.fillRect(lane + Math.random() * 36, Math.random() * h, 1 + Math.random() * 5, 1 + Math.random() * 7);
    }
    g.globalCompositeOperation = 'destination-over';
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) g.drawImage(img, x * t, y * t, t, t);
    g.globalCompositeOperation = 'source-over';
  });
  map.wrapT = THREE.RepeatWrapping; map.anisotropy = aniso;
  for (const t of [tex.asphaltN, tex.asphaltR]) { t.repeat.set(3, 3); t.anisotropy = aniso; }
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    map, color: 0x7d7d80, normalMap: tex.asphaltN, roughnessMap: tex.asphaltR, roughness: 1, metalness: 0,
    normalScale: new THREE.Vector2(1.6, 1.6), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  mesh.receiveShadow = true;
  scene.add(mesh);
}

// ---------------------------------------------------------------- scenery
// Instanced scenery is split into 500 m sections along the road, each with its own bounds,
// so only the sections in view (and in range of the shadow map) are drawn.
const SECTION = 500, WHITE = [1, 1, 1];
function instanced(scene, geo, mat, items, shadow = true, setup) {
  const buckets = new Map();
  for (const it of items) { const k = Math.floor(it.z / SECTION); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(it); }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const c = new THREE.Color();
  for (const list of buckets.values()) {
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, i) => {
      e.set(it.rx || 0, it.ry || 0, 0); q.setFromEuler(e);
      p.set(it.x, it.y, it.z); s.setScalar(it.s || 1);
      mesh.setMatrixAt(i, m.compose(p, q, s));
      const v = it.shade ?? 1, tn = it.tint || WHITE; mesh.setColorAt(i, c.setRGB(v * tn[0], v * (it.hue ?? 1) * tn[1], v * tn[2]));
    });
    mesh.castShadow = shadow; mesh.receiveShadow = false;
    mesh.computeBoundingSphere();
    if (setup) setup(mesh);
    scene.add(mesh);
  }
}

// Tree billboards: upright photo cards of real scanned trees, lit as if facing the sky.
// The cards are shaded as if they wrapped a rounded crown (normals point outwards from the middle),
// so the sunny side is bright and the far side dark - they read as solid volumes, not flat cut-outs.
function billboardGeo(aspect, angles, round = 0.6, seg = 2) {
  const planes = angles.map(a => new THREE.PlaneGeometry(aspect, 1, seg, seg).translate(0, 0.5, 0).rotateY(a));
  const geo = mergeGeometries(planes), n = geo.attributes.normal, p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < n.count; i++) {
    v.set((p.getX(i) / (aspect * 0.5)) * round, 0.5 + (p.getY(i) - 0.5) * 0.9, (p.getZ(i) / (aspect * 0.5)) * round).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  return geo;
}
function treeMesh(scene, tex, geo, items, shadow = true) {
  if (!items.length) return null;
  const mat = new THREE.MeshPhysicalMaterial({ map: tex, alphaTest: 0.4, roughness: 1, metalness: 0, specularIntensity: 0 });
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.4 });
  instanced(scene, geo, mat, items, shadow, mesh => { mesh.customDepthMaterial = depth; });
}

function buildScenery(scene, assets) {
  const rng = mulberry32(20261113 + LOCATIONS.indexOf(P) * 7919);
  const matV = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const v = new THREE.Vector3();

  // trees
  const scatter = (n, minD, maxD, sMin, sMax) => {
    const list = [];
    for (let i = 0; i < n; i++) {
      const z = rng() * (TRACK_LEN + 560) - 280, side = rng() < 0.5 ? -1 : 1;
      const d = minD + Math.pow(rng(), 1.7) * (maxD - minD), x = roadX(z) + side * d;
      list.push({ x, y: terrainY(x, z) - 0.15, z, ry: rng() * 6.28, s: sMin + rng() * (sMax - sMin), shade: 0.8 + rng() * 0.3, hue: 0.94 + rng() * 0.12 });
    }
    return list;
  };
  const QUAD = [0, 1, 2, 3, 4, 5].map(i => (i * Math.PI) / 3);   // three crossing cards, both faces
  for (const name of ['fir_0', 'fir_1', 'fir_2', 'pine_0', 'pine_1', 'pine_2']) {
    const t = assets.trees[name];
    treeMesh(scene, t.tex, billboardGeo(t.aspect, QUAD), scatter(P.trees.conifer, 16, 420, 4, 9));
  }
  const leafs = scatter(P.trees.leaf, 16, 460, 6, 12);
  treeMesh(scene, assets.trees.leaf_0.tex, billboardGeo(assets.trees.leaf_0.aspect, [0, Math.PI, 1.05, 1.05 + Math.PI]), leafs);
  treeMesh(scene, assets.trees.leaf_1.tex, billboardGeo(assets.trees.leaf_1.aspect, [2.1, 2.1 + Math.PI]), leafs);

  // grass tufts, shrubs and ferns close to the road: real scanned plants as small crossed cards
  const CROSS = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
  const sow = (n, sMin, sMax, maxD) => {
    const list = [];
    for (let i = 0; i < n; i++) {
      const z = rng() * (TRACK_LEN + 300) - 150, side = rng() < 0.5 ? -1 : 1;
      const d = ROAD_HALF + 1.7 + rng() * rng() * maxD, x = roadX(z) + side * d;
      list.push({ x, y: terrainY(x, z) - 0.04, z, ry: rng() * 6.28, s: sMin + rng() * (sMax - sMin), shade: 0.75 + rng() * 0.35, tint: P.plants.tint });
    }
    return list;
  };
  const plant = (names, n, sMin, sMax, maxD) => {
    for (const name of names) {
      const t = assets.plants[name], count = Math.round((n * assets.density) / names.length);
      if (count > 0) treeMesh(scene, t.tex, billboardGeo(t.aspect, CROSS, 0.4, 1), sow(count, sMin, sMax, maxD), false);
    }
  };
  plant(['grass_0', 'grass_1', 'grass_2'], P.plants.grass, 0.4, 0.95, 55);
  plant(['shrub_0', 'shrub_1'], P.plants.shrub, 0.8, 1.9, 120);
  plant(['fern_0', 'fern_1'], P.plants.fern, 0.45, 0.85, 70);

  // scanned rocks along the verges
  for (const gltf of assets.rocks) {
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(o => {
      if (!o.isMesh) return;
      const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
      geo.computeBoundingBox();
      const b = geo.boundingBox, h = b.max.y - b.min.y;
      geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y - h * 0.18, -(b.min.z + b.max.z) / 2);
      const size = Math.max(b.max.x - b.min.x, b.max.z - b.min.z, 0.01), items = [];
      for (let i = 0; i < P.rocks; i++) {
        const z = rng() * TRACK_LEN, side = rng() < 0.5 ? -1 : 1, d = 15 + rng() * rng() * 60, x = roadX(z) + side * d;
        items.push({ x, y: terrainY(x, z), z, ry: rng() * 6.28, s: (0.9 + rng() * 2.4) / size, shade: 0.9 + rng() * 0.2 });
      }
      instanced(scene, geo, o.material, items, false, mesh => { mesh.receiveShadow = true; });   // dense scans: too costly to redraw into the shadow map
    });
  }

  // roadside marker posts and power poles
  const posts = [], poles = [], wireA = [], wireB = [];
  for (let z = -200; z < TRACK_LEN + 300; z += 50) {
    const yaw = Math.atan2(roadDX(z), 1);
    for (const s of [1, -1]) { trackToWorld(z, s * (ROAD_HALF + 1.3), v); posts.push({ x: v.x, y: v.y - 0.1, z: v.z, ry: yaw }); }
  }
  for (let z = -200; z < TRACK_LEN + 300; z += 70) {
    const yaw = Math.atan2(roadDX(z), 1);
    trackToWorld(z, ROAD_HALF + 8, v);
    const y = terrainY(v.x, v.z) - 0.3;
    poles.push({ x: v.x, y, z: v.z, ry: yaw });
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (const [arr, off] of [[wireA, 1.05], [wireB, -1.05]]) {
      const px = v.x + off * c, pz = v.z - off * s;
      if (arr.length) { const l = arr[arr.length - 1]; arr.push(new THREE.Vector3((l.x + px) / 2, (l.y + y + 8.45) / 2 - 0.9, (l.z + pz) / 2)); }
      arr.push(new THREE.Vector3(px, y + 8.45, pz));
    }
  }
  const postGeo = mergeGeometries([
    tint(new THREE.BoxGeometry(0.12, 1.1, 0.06).translate(0, 0.55, 0), 0.9, 0.9, 0.88),
    tint(new THREE.BoxGeometry(0.13, 0.16, 0.07).translate(0, 0.9, 0), 0.8, 0.1, 0.08),
  ]);
  instanced(scene, postGeo, matV, posts, false);
  const poleGeo = mergeGeometries([
    tint(new THREE.CylinderGeometry(0.11, 0.17, 9, 8).translate(0, 4.5, 0), 0.33, 0.26, 0.2),
    tint(new THREE.BoxGeometry(2.5, 0.14, 0.14).translate(0, 8.3, 0), 0.3, 0.24, 0.19),
  ]);
  instanced(scene, poleGeo, matV, poles);
  const wireMat = new THREE.LineBasicMaterial({ color: 0x15151a });
  for (const arr of [wireA, wireB]) {
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(arr), wireMat);
    line.frustumCulled = false; scene.add(line);
  }

  // farm buildings
  const wallMats = [0x8d2f25, 0xd9d4c7, 0x6f7b85].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }));
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.6, metalness: 0.3 });
  for (let i = 0; i < P.buildings; i++) {
    const z = 300 + rng() * (TRACK_LEN - 400), side = rng() < 0.5 ? -1 : 1, d = 45 + rng() * 90;
    const x = roadX(z) + side * d, w = 7 + rng() * 6, h = 3.5 + rng() * 2.5, l = 9 + rng() * 8;
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h + 2, l), wallMats[i % 3]); body.position.y = h / 2 - 1;
    const roofShape = new THREE.Shape(); roofShape.moveTo(-w / 2 - 0.4, 0); roofShape.lineTo(0, w * 0.32); roofShape.lineTo(w / 2 + 0.4, 0); roofShape.closePath();
    const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(roofShape, { depth: l + 0.8, bevelEnabled: false }), roofMat);
    roof.position.set(0, h, -l / 2 - 0.4);
    g.add(body, roof);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.position.set(x, terrainY(x, z), z); g.rotation.y = rng() * 3.14;
    scene.add(g);
  }

  // billboards (all brands are invented)
  const ads = [
    ['NITRO FIZZ', 'stay wide open', '#c21f2b', '#fff3d6'],
    ['COPPER CANYON MOTORS', 'next exit · open late', '#16324f', '#ffd166'],
    ['TALONGRIP TYRES', 'grip happens', '#111111', '#f2f2f2'],
    ["BIG SAL'S DINER", 'pie worth braking for', '#f4e9cd', '#7a1f1f'],
    ['IRONJAW HELMETS', 'keep your head', '#2b2d42', '#ef8354'],
    ['OCTANE 99', 'fuel · coffee · maps', '#0b6e4f', '#f6f7eb'],
  ];
  const steel = new THREE.MeshStandardMaterial({ color: 0x4a4d52, roughness: 0.6, metalness: 0.6 });
  ads.forEach((ad, i) => {
    const z = 600 + i * 900 + rng() * 200;
    trackToWorld(z, -(ROAD_HALF + 11), v);
    const tex = canvasTex(1024, 448, (g, w, h) => {
      g.fillStyle = ad[2]; g.fillRect(0, 0, w, h);
      g.strokeStyle = ad[3]; g.lineWidth = 10; g.strokeRect(18, 18, w - 36, h - 36);
      g.fillStyle = ad[3]; g.textAlign = 'center'; g.textBaseline = 'middle';
      let size = 150; g.font = `900 ${size}px Impact, "Arial Black", sans-serif`;
      while (g.measureText(ad[0]).width > w - 110) { size -= 6; g.font = `900 ${size}px Impact, "Arial Black", sans-serif`; }
      g.fillText(ad[0], w / 2, h * 0.42);
      g.font = 'italic 600 54px Georgia, serif'; g.fillText(ad[1], w / 2, h * 0.76);
    });
    const g = new THREE.Group();
    const face = new THREE.Mesh(new THREE.PlaneGeometry(10, 4.4), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 }));
    face.position.set(0, 7.2, 0.08);
    const back = new THREE.Mesh(new THREE.BoxGeometry(10.2, 4.6, 0.14), steel); back.position.y = 7.2;
    g.add(face, back);
    for (const px of [-3.4, 3.4]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 6, 8), steel); leg.position.set(px, 2.5, -0.1); g.add(leg); }
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    g.position.set(v.x, terrainY(v.x, v.z), v.z);
    g.rotation.y = Math.PI + Math.atan2(roadDX(z), 1) - 0.25;
    scene.add(g);
  });

  // start / finish gantries
  const gantry = (z, text) => {
    const g = new THREE.Group(), span = ROAD_HALF * 2 + 4;
    for (const px of [-span / 2, span / 2]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.35, 7.4, 0.35), steel); leg.position.set(px, 3.7, 0); g.add(leg); }
    const tex = canvasTex(1024, 128, (c, w, h) => {
      const sq = h / 4;
      for (let y = 0; y < 4; y++) for (let x = 0; x < w / sq; x++) { c.fillStyle = (x + y) % 2 ? '#111' : '#f2f2f2'; c.fillRect(x * sq, y * sq, sq, sq); }
      c.fillStyle = '#b3121d'; c.fillRect(w * 0.3, 0, w * 0.4, h);
      c.fillStyle = '#fff'; c.font = '900 96px Impact, "Arial Black", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(text, w / 2, h / 2 + 6);
    });
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span + 0.35, 1.5, 0.3), [steel, steel, steel, steel, mat, mat]);
    beam.position.y = 6.9; g.add(beam);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    trackToWorld(z, 0, v);
    g.position.copy(v); g.rotation.y = Math.PI + Math.atan2(roadDX(z), 1);
    scene.add(g);
  };
  gantry(START_Z, 'START');
  gantry(FINISH_Z, 'FINISH');
}

// ---------------------------------------------------------------- sky + light
// The photographed sky lights the scene; the sun's position is read from the image so shadows match it.
function buildSky(scene, group, hdr) {
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = hdr;
  scene.environment = hdr;

  const { data, width: w, height: h } = hdr.image;
  const f = hdr.type === THREE.HalfFloatType ? THREE.DataUtils.fromHalfFloat : x => x;
  let best = -1, bx = 0, by = 0;
  for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) {
    const i = (y * w + x) * 4, L = f(data[i]) + f(data[i + 1]) + f(data[i + 2]);
    if (L > best) { best = L; bx = x; by = y; }
  }
  const lat = Math.abs(0.5 - (by + 0.5) / h) * Math.PI, phi = ((bx + 0.5) / w - 0.5) * Math.PI * 2;
  const latL = Math.max(lat, 0.2);   // keep the light a little above the horizon so sunset shadows stay usable
  const sunDir = new THREE.Vector3(Math.cos(phi) * Math.cos(latL), Math.sin(latL), Math.sin(phi) * Math.cos(latL));
  // haze colour = average of the band just above the horizon (on the sun's half of the image)
  const y0 = by < h / 2 ? Math.floor(h * 0.47) : Math.floor(h * 0.5), y1 = y0 + Math.floor(h * 0.03);
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y1; y += 2) for (let x = 0; x < w; x += 8) {
    const i = (y * w + x) * 4; r += Math.min(0.9, f(data[i])); g += Math.min(0.9, f(data[i + 1])); b += Math.min(0.9, f(data[i + 2])); n++;   // clamp: a sun on the horizon must not turn the haze white
  }
  const haze = new THREE.Color(r / n, g / n, b / n);
  scene.fog = new THREE.Fog(haze, P.fog[0], P.fog[1]);

  // sunlight takes on some of the sky's colour (warm at sunset)
  const hm = Math.max(haze.r, haze.g, haze.b, 0.001);
  const sunCol = new THREE.Color(0xfff2e0).lerp(new THREE.Color(haze.r / hm, haze.g / hm, haze.b / hm), lat < 0.35 ? 0.6 : 0.15);
  const sun = new THREE.DirectionalLight(sunCol, P.sun);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera; sc.left = -50; sc.right = 50; sc.top = 50; sc.bottom = -50; sc.near = 10; sc.far = 400;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.06;
  group.add(sun, sun.target);
  return { sun, sunDir };
}

export async function buildWorld(scene, renderer, locId, onProgress = () => {}, density = 1) {
  P = LOCATIONS.find(l => l.id === locId) || LOCATIONS[0]; R = P.road;
  const A = './assets/';
  let done = 0, total = 0;
  const track = p => { total++; return p.then(x => { onProgress(++done / total); return x; }); };
  const treeNames = ['fir_0', 'fir_1', 'fir_2', 'pine_0', 'pine_1', 'pine_2', 'leaf_0', 'leaf_1'];
  const gltf = new GLTFLoader();
  const plantNames = ['grass_0', 'grass_1', 'grass_2', 'shrub_0', 'shrub_1', 'fern_0', 'fern_1'];
  const [hdr, asphalt, asphaltN, asphaltR, grass, grassN, macro, meta, treeTex, rocks, plantMeta, plantTex] = await Promise.all([
    track(new RGBELoader().loadAsync(`${A}sky/${P.id}_4k.hdr`)),
    track(loadTex(A + 'textures/asphalt_04_diffuse.jpg', true)),
    track(loadTex(A + 'textures/asphalt_04_nor_gl.jpg', false, true)),
    track(loadTex(A + 'textures/asphalt_04_rough.jpg', false, true)),
    track(loadTex(`${A}textures/${P.ground}_diffuse.jpg`, true, true)),
    track(loadTex(`${A}textures/${P.ground}_nor_gl.jpg`, false, true)),
    track(loadTex(`${A}textures/${P.macro}_diffuse.jpg`, true, true)),
    track(fetch(A + 'trees/meta.json').then(r => r.json())),
    track(Promise.all(treeNames.map(n => loadTex(`${A}trees/${n}.png`, true)))),
    track(Promise.all(['rock_07', 'rock_09', 'rock_moss_set_01'].map(n => gltf.loadAsync(`${A}models/${n}/${n}.gltf`)))),
    track(fetch(A + 'plants/meta.json').then(r => r.json())),
    track(Promise.all(plantNames.map(n => loadTex(`${A}plants/${n}.png`, true)))),
  ]);
  const plants = {};
  plantNames.forEach((n, i) => { plants[n] = { tex: plantTex[i], aspect: plantMeta[n].aspect }; });
  const trees = {};
  treeNames.forEach((n, i) => { trees[n] = { tex: treeTex[i], aspect: meta[n].aspect }; });
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const group = new THREE.Group();
  scene.add(group);
  buildTerrain(group, { grass, grassN, macro }, aniso);
  buildRoad(group, { asphalt, asphaltN, asphaltR }, aniso);
  buildScenery(group, { trees, rocks, plants, density });
  return { ...buildSky(scene, group, hdr), group, hdr, loc: P };
}

// Remove a location and free its GPU memory before loading another.
export function disposeWorld(scene, world) {
  scene.remove(world.group);
  scene.background = null; scene.environment = null;
  world.group.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    for (const m of [].concat(o.material || [], o.customDepthMaterial || [])) {
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) if (m[k]) m[k].dispose();
      m.dispose();
    }
  });
  world.hdr.dispose();
}
