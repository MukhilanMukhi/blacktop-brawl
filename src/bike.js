// Motorcycle and rider models, sculpted in code: lofted bodywork, alloy wheels, fork, frame, exhaust,
// painted liveries, and a rider with a shaped helmet, two-tone suit and tapered limbs.
// Everything faces +z with the origin on the ground between the wheels. The rider's left is +x.
import * as THREE from 'three';
import { mergeMeshes } from './models.js';

const Z = new THREE.Vector3(0, 0, 1);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Smooth skin through cross-sections along z. Section: [z, centreY, halfWidth, heightUp, heightDown, squareness].
function loft(secs, n = 20) {
  const pos = [], uv = [], idx = [], m = secs.length;
  secs.forEach((s, i) => {
    const [z, cy, w, ht, hb = ht, e = 2.5] = s;
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI * 2 - Math.PI / 2, c = Math.cos(a), si = Math.sin(a);
      pos.push(w * Math.sign(c) * Math.pow(Math.abs(c), 2 / e), cy + (si >= 0 ? ht : hb) * Math.sign(si) * Math.pow(Math.abs(si), 2 / e), z);
      uv.push(k / n, i / (m - 1));
    }
  });
  for (let i = 0; i < m - 1; i++) for (let k = 0; k < n; k++) {
    const a = i * (n + 1) + k, b = a + 1, c = a + n + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  for (const [i, flip] of [[0, true], [m - 1, false]]) {   // end caps
    const base = pos.length / 3, s = secs[i];
    pos.push(0, s[1], s[0]); uv.push(0.5, i ? 1 : 0);
    for (let k = 0; k < n; k++) { const a = i * (n + 1) + k; flip ? idx.push(base, a + 1, a) : idx.push(base, a, a + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// Tapered limb / tube from a to b. radii are spread evenly along it; `flat` squashes it front-to-back.
function tube(a, b, radii, mat, flat = 1, n = 12) {
  const len = a.distanceTo(b), k = radii.length - 1;
  const secs = [[-radii[0] * 0.5, 0, radii[0] * 0.5, radii[0] * 0.5 * flat]];
  radii.forEach((r, i) => secs.push([(i / k) * len, 0, r, r * flat]));
  secs.push([len + radii[k] * 0.5, 0, radii[k] * 0.5, radii[k] * 0.5 * flat]);
  const g = loft(secs, n);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Z, b.clone().sub(a).normalize()));
  g.translate(a.x, a.y, a.z);
  return new THREE.Mesh(g, mat);
}
const ball = (p, r, mat, sx = 1, sy = 1, sz = 1) => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), mat); m.position.copy(p); m.scale.set(sx, sy, sz); return m;
};
const box = (p, w, h, d, mat, rx = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.copy(p); m.rotation.x = rx; return m; };
const css = c => '#' + new THREE.Color(c).getHexString();

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

// shared materials
const rubber = new THREE.MeshStandardMaterial({ color: 0x0d0d0e, roughness: 0.92 });
const alloy = new THREE.MeshStandardMaterial({ color: 0x8d9299, metalness: 1, roughness: 0.38 });
const darkAlloy = new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.9, roughness: 0.45, side: THREE.DoubleSide });
const rimMat = new THREE.MeshStandardMaterial({ color: 0xa9aeb5, metalness: 1, roughness: 0.3, side: THREE.DoubleSide });
const chrome = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 1, roughness: 0.12 });
const steel = new THREE.MeshStandardMaterial({ color: 0xb9bcc0, metalness: 1, roughness: 0.3, side: THREE.DoubleSide });
const gold = new THREE.MeshStandardMaterial({ color: 0xb8892b, metalness: 1, roughness: 0.3 });
const plastic = new THREE.MeshStandardMaterial({ color: 0x121214, roughness: 0.6 });
const engineMat = new THREE.MeshStandardMaterial({ color: 0x3a3c40, metalness: 0.8, roughness: 0.5 });
const glass = new THREE.MeshPhysicalMaterial({ color: 0x0b0e12, metalness: 0.5, roughness: 0.04, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
const lens = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2cc, emissiveIntensity: 2.6 });
const tailLens = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1a10, emissiveIntensity: 2.2 });
const leather = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.55 });
const seatMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.8 });
const plateMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.5 });

// ---------------------------------------------------------------- styles
const SPORT_BODY = [
  [-0.98, 0.93, 0.02, 0.015], [-0.86, 0.925, 0.09, 0.05, 0.04], [-0.62, 0.87, 0.13, 0.06, 0.07], [-0.38, 0.80, 0.15, 0.04, 0.10],
  [-0.12, 0.82, 0.16, 0.06, 0.14], [0.0, 0.87, 0.17, 0.11, 0.18], [0.18, 0.90, 0.19, 0.14, 0.20], [0.36, 0.89, 0.17, 0.12, 0.18], [0.5, 0.86, 0.09, 0.07, 0.11],
];
const SPORT_SEAT = [[-0.72, 0.935, 0.05, 0.015], [-0.58, 0.915, 0.11, 0.022], [-0.38, 0.838, 0.13, 0.022], [-0.14, 0.872, 0.13, 0.026], [-0.05, 0.9, 0.05, 0.015]];
export const BIKE_STYLES = {
  sport: {
    body: SPORT_BODY, seat: SPORT_SEAT, fairing: 'full', bars: [0.3, 0.97, 0.44], headY: 0.8, rear: 1,
    lean: [0, 1.36, 0.14], head: [0, 0.16, 0.12, 0.5], knee: [0.25, 0.75, 0.2], foot: [0.2, 0.42, -0.12], rider: [0, 0, 0],
  },
  street: {
    body: SPORT_BODY.map(([z, cy, w, a, b]) => [z < -0.5 ? z * 0.9 : z, cy, w, a, b ?? a]), seat: SPORT_SEAT.map(([z, cy, w, a]) => [z < -0.5 ? z * 0.9 : z, cy, w, a]),
    fairing: 'none', bars: [0.34, 1.07, 0.36], headY: 0.92, rear: 1.1,
    lean: [0, 1.45, 0.02], head: [0, 0.17, 0.06, 0.2], knee: [0.25, 0.75, 0.2], foot: [0.2, 0.42, -0.12], rider: [0, 0, 0],
  },
  cruiser: {
    body: [[-0.56, 0.70, 0.02, 0.02], [-0.46, 0.70, 0.15, 0.05, 0.05], [-0.2, 0.69, 0.17, 0.05, 0.08], [-0.05, 0.74, 0.15, 0.07, 0.12],
      [0.1, 0.84, 0.17, 0.10, 0.16], [0.3, 0.88, 0.18, 0.11, 0.16], [0.48, 0.86, 0.12, 0.08, 0.12], [0.57, 0.84, 0.03, 0.03]],
    seat: [[-0.52, 0.752, 0.08, 0.02], [-0.32, 0.745, 0.15, 0.03], [-0.08, 0.775, 0.13, 0.03], [0.0, 0.8, 0.05, 0.02]],
    fairing: 'none', bars: [0.36, 1.12, 0.16], headY: 0.9, rear: 1.25, fender: true, twin: true,
    lean: [0, 1.47, -0.12], head: [0, 0.17, 0.04, 0.1], knee: [0.28, 0.73, 0.16], foot: [0.25, 0.4, 0.34], rider: [0, -0.13, -0.08],
  },
  moto: {
    body: SPORT_BODY.map(([z, cy, w, a, b]) => [z, cy + 0.13 - (z > 0 ? 0.04 : 0), w * 0.78, a * 0.8, (b ?? a) * 0.85]),
    seat: SPORT_SEAT.map(([z, cy, w, a]) => [z, cy + 0.125, w * 0.8, a]),
    fairing: 'board', bars: [0.36, 1.2, 0.36], headY: 1.02, rear: 0.95, highExhaust: true,
    lean: [0, 1.46, 0.0], head: [0, 0.17, 0.06, 0.2], knee: [0.24, 0.8, 0.22], foot: [0.2, 0.42, -0.08], rider: [0, 0.11, 0],
  },
};

function wheel(front, wide) {
  const g = new THREE.Group(), tw = front ? 1.15 : 1.45 * wide;
  const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.085, 14, 36).rotateY(Math.PI / 2), rubber); tyre.scale.x = tw; g.add(tyre);
  const half = 0.05 * tw;
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, half * 2, 28, 1, true).rotateZ(Math.PI / 2), rimMat));
  for (const s of [1, -1]) {   // rim lips
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.012, 6, 28).rotateY(Math.PI / 2), rimMat); lip.position.x = s * half; g.add(lip);
  }
  for (let i = 0; i < 5; i++) {   // five twin spokes
    for (const off of [-0.09, 0.09]) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.19, 0.022).translate(0, 0.105, 0), rimMat);
      sp.rotation.x = (i / 5) * Math.PI * 2 + off; g.add(sp);
    }
  }
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, half * 2 + 0.04, 16).rotateZ(Math.PI / 2), alloy));
  for (const s of front ? [1, -1] : [-1]) {   // brake discs
    const disc = new THREE.Mesh(new THREE.RingGeometry(front ? 0.09 : 0.07, front ? 0.16 : 0.12, 28).rotateY(Math.PI / 2), steel);
    disc.position.x = s * (half + 0.012); g.add(disc);
  }
  g.position.set(0, 0.325, front ? 0.8 : -0.7);
  return g;
}

function livery(base, accent) {
  // u runs around the body (0 = underside, 0.5 = top centre), v runs tail to nose
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = css(base); g.fillRect(0, 0, w, h);
    g.fillStyle = '#0c0c0e'; g.fillRect(0, 0, w * 0.13, h); g.fillRect(w * 0.87, 0, w * 0.13, h);       // dark belly
    g.fillStyle = css(accent); g.fillRect(w * 0.455, 0, w * 0.09, h);                                     // centre stripe
    g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(w * 0.44, 0, w * 0.012, h); g.fillRect(w * 0.548, 0, w * 0.012, h);
    for (const u of [0.2, 0.8]) {                                                                        // flank flashes
      g.fillStyle = css(accent); g.beginPath();
      g.moveTo((u - 0.035) * w, h * 0.25); g.lineTo((u + 0.035) * w, h * 0.4); g.lineTo((u + 0.035) * w, h * 0.95); g.lineTo((u - 0.035) * w, h * 0.8); g.closePath(); g.fill();
    }
  });
}

// custom: optional { object, rider } - a loaded bike model that replaces the built-in one.
export function createBike(color, jacketColor, helmetColor, custom, style = 'sport') {
  const S = BIKE_STYLES[style] || BIKE_STYLES.sport;
  const root = new THREE.Group(); root.rotation.order = 'YXZ';
  const lean = new THREE.Group(); root.add(lean);
  const accent = new THREE.Color(color).getHSL({}).l > 0.45 ? 0x111114 : 0xf2f2f2;
  const paint = new THREE.MeshPhysicalMaterial({ map: livery(color, accent), metalness: 0.3, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.06 });
  const solid = new THREE.MeshPhysicalMaterial({ color, metalness: 0.3, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.06 });
  const add = (...m) => lean.add(...m);
  const wheels = [];

  if (custom) lean.add(custom.object.clone(true));
  else {
    wheels.push(wheel(true, 1), wheel(false, S.rear)); add(...wheels);
    const [bx, by, bz] = S.bars;

    // bodywork: tail + seat + tank as one skin, seat pad on top
    add(new THREE.Mesh(loft(S.body, 24), paint), new THREE.Mesh(loft(S.seat, 14), seatMat));
    if (S.fairing === 'full') {
      add(new THREE.Mesh(loft([[0.28, 0.80, 0.21, 0.19, 0.30, 3.2], [0.5, 0.84, 0.2, 0.17, 0.30, 3.2], [0.66, 0.84, 0.15, 0.12, 0.2, 2.6], [0.78, 0.8, 0.08, 0.07, 0.1], [0.845, 0.78, 0.02, 0.02]], 24), paint));
      add(new THREE.Mesh(loft([[-0.32, 0.42, 0.09, 0.07, 0.1], [-0.1, 0.44, 0.17, 0.16, 0.16, 3.2], [0.15, 0.5, 0.2, 0.24, 0.22, 3.2], [0.36, 0.56, 0.19, 0.24, 0.24, 3.2], [0.45, 0.6, 0.11, 0.2, 0.2]], 24), paint));
      const screen = new THREE.Mesh(new THREE.SphereGeometry(0.19, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), glass);
      screen.scale.set(0.8, 0.85, 1.45); screen.position.set(0, 0.965, 0.5); screen.rotation.x = 0.25; add(screen);
      for (const s of [1, -1]) {
        add(ball(V(s * 0.062, S.headY, 0.792), 0.042, lens, 1, 0.7, 0.45));
        add(tube(V(s * 0.17, 0.95, 0.6), V(s * 0.31, 1.03, 0.62), [0.012, 0.01], plastic));
        add(ball(V(s * 0.33, 1.04, 0.62), 0.05, solid, 1.1, 0.6, 0.45));
      }
    } else {
      // naked: round headlight, exposed radiator and engine fins
      add(ball(V(0, S.headY, 0.62), 0.095, chrome, 1, 1, 0.85), ball(V(0, S.headY, 0.675), 0.078, lens, 1, 1, 0.3));
      add(box(V(0, 0.62, 0.36), 0.3, 0.26, 0.04, plastic, -0.2));
      for (let i = 0; i < 5; i++) add(box(V(0, 0.6 + i * 0.035, 0.12), 0.34, 0.012, 0.3, engineMat, -0.25));
      for (const s of [1, -1]) {
        add(tube(V(s * 0.1, by - 0.03, 0.47), V(s * 0.2, by + 0.1, 0.5), [0.009, 0.008], chrome));
        add(ball(V(s * 0.22, by + 0.12, 0.5), 0.05, chrome, 1, 0.75, 0.3));
      }
      if (S.fairing === 'board') {   // number board and high front mudguard
        add(box(V(0, S.headY + 0.04, 0.66), 0.26, 0.24, 0.02, plateMat, -0.2));
        add(new THREE.Mesh(loft([[0.45, 0.79, 0.07, 0.015], [0.62, 0.8, 0.09, 0.02], [0.9, 0.78, 0.085, 0.02], [1.08, 0.74, 0.05, 0.012]], 12), solid));
      }
    }

    // frame, engine, swingarm
    add(box(V(0, 0.5, 0.06), 0.3, 0.32, 0.5, engineMat), box(V(0, 0.36, 0.0), 0.26, 0.1, 0.44, engineMat));
    for (const s of [1, -1]) {
      add(tube(V(s * 0.12, 0.93, 0.5), V(s * 0.145, 0.5, -0.15), [0.03, 0.038, 0.034], alloy, 1.6));
      add(tube(V(s * 0.115, 0.47, -0.15), V(s * 0.125, 0.325, -0.7), [0.042, 0.036, 0.03], alloy, 1.5));
      add(tube(V(s * 0.1, 0.84, -0.1), V(s * 0.09, S.body[1][1] - 0.02, -0.75 * (S.fender ? 0.6 : 1)), [0.014, 0.014], darkAlloy));
      add(tube(V(s * 0.13, 0.39, -0.08), V(s * 0.25, 0.39, -0.08), [0.014, 0.014], alloy));   // foot pegs
    }
    add(tube(V(0, 0.5, -0.3), V(0, 0.82, -0.2), [0.03, 0.035, 0.03], gold));                  // rear shock
    add(tube(V(0.135, 0.33, -0.7), V(0.135, 0.46, -0.12), [0.011, 0.011], darkAlloy));        // chain run
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.012, 20).rotateZ(Math.PI / 2).translate(0.135, 0.325, -0.7), steel));

    // front end: fork, yokes, mudguard, bars, levers, clocks
    const axle = V(0.1, 0.325, 0.8), top = V(0.1, 0.99, 0.5), mid = axle.clone().lerp(top, 0.5);
    for (const s of [1, -1]) {
      const m = v => V(v.x * s, v.y, v.z);
      add(tube(m(axle), m(mid), [0.03, 0.03], S.fairing === 'board' ? chrome : darkAlloy), tube(m(mid), m(top), [0.024, 0.024], S.fairing === 'board' ? darkAlloy : gold));
      add(box(V(s * 0.1, 0.4, 0.86), 0.05, 0.1, 0.06, gold));                                  // caliper
      add(tube(V(s * 0.09, by, bz + 0.06), V(s * bx, by, bz), [0.014, 0.014], darkAlloy));     // bar
      add(tube(V(s * (bx - 0.11), by, bz), V(s * bx, by, bz), [0.02, 0.02], rubber));          // grip
      add(tube(V(s * (bx - 0.12), by + 0.005, bz + 0.03), V(s * (bx - 0.01), by, bz + 0.065), [0.007, 0.006], alloy)); // lever
    }
    add(box(V(0, 0.99, 0.5), 0.27, 0.03, 0.08, darkAlloy), box(V(0, 0.83, 0.572), 0.27, 0.035, 0.07, darkAlloy));
    add(tube(V(0, 0.99, 0.5), V(0, by, bz + 0.06), [0.022, 0.02], darkAlloy));
    add(box(V(0, by + 0.03, bz + 0.12), 0.16, 0.06, 0.03, plastic, -0.6));
    if (S.fairing !== 'board') {
      const guard = new THREE.Mesh(new THREE.TorusGeometry(0.345, 0.05, 8, 14, Math.PI * 0.55).rotateZ(Math.PI * 0.3).rotateY(Math.PI / 2), solid);
      guard.scale.x = 2.3; guard.position.set(0, 0.325, 0.8); add(guard);
    }
    const hug = new THREE.Mesh(new THREE.TorusGeometry(0.35, S.fender ? 0.07 : 0.045, 8, 14, Math.PI * (S.fender ? 0.7 : 0.4)).rotateZ(S.fender ? 0.05 : 0.5).rotateY(Math.PI / 2), S.fender ? solid : plastic);
    hug.scale.x = S.fender ? 2.6 : 2.4; hug.position.set(0, 0.325, -0.7); add(hug);

    // exhaust (rider's right)
    if (S.twin) {
      for (const y of [0.3, 0.4]) {
        add(tube(V(-0.19, y + 0.1, 0.3), V(-0.22, y, -0.1), [0.028, 0.03], chrome), tube(V(-0.22, y, -0.1), V(-0.25, y, -1.0), [0.03, 0.045, 0.05, 0.05], chrome));
      }
    } else {
      const path = new THREE.CatmullRomCurve3([V(-0.08, 0.5, 0.33), V(-0.13, 0.32, 0.2), V(-0.16, 0.28, -0.2), V(-0.19, 0.34, -0.45)]);
      add(new THREE.Mesh(new THREE.TubeGeometry(path, 20, 0.028, 10), steel));
      const a = S.highExhaust ? V(-0.17, 0.72, -0.35) : V(-0.19, 0.36, -0.42), b = S.highExhaust ? V(-0.2, 0.93, -0.98) : V(-0.23, 0.6, -0.98);
      if (S.highExhaust) add(tube(V(-0.19, 0.34, -0.45), a, [0.028, 0.028], steel));
      add(tube(a, b, [0.04, 0.062, 0.068, 0.066, 0.055], steel), ball(b, 0.045, plastic, 1, 1, 0.5));
    }

    // tail light, plate
    const tail = S.body[0];
    add(box(V(0, tail[1] - 0.005, tail[0] + 0.02), 0.13, 0.035, 0.03, tailLens));
    add(tube(V(0, tail[1] - 0.04, tail[0] + 0.1), V(0, tail[1] - 0.2, tail[0] - 0.06), [0.012, 0.012], plastic));
    add(box(V(0, tail[1] - 0.22, tail[0] - 0.07), 0.19, 0.12, 0.012, plateMat, 0.3));
  }

  // ------------------------------------------------------------ rider
  const suit = new THREE.MeshStandardMaterial({ color: jacketColor, roughness: 0.5 });
  const trim = new THREE.MeshStandardMaterial({ color, roughness: 0.45 });
  const hAccent = new THREE.Color(helmetColor).getHSL({}).l > 0.5 ? color : 0xf2f2f2;
  const helmetMat = new THREE.MeshPhysicalMaterial({
    roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05,
    map: canvasTex(256, 64, (g, w, h) => {
      g.fillStyle = css(helmetColor); g.fillRect(0, 0, w, h);
      g.fillStyle = css(hAccent);
      for (const u of [0, 0.5, 1]) g.fillRect((u - 0.045) * w, 0, 0.09 * w, h);
      g.fillStyle = 'rgba(0,0,0,.75)';
      for (const u of [0.05, 0.45, 0.55, 0.95]) g.fillRect(u * w - 1, 0, 2, h);
    }),
  });
  const rider = new THREE.Group(); lean.add(rider);
  rider.position.set(...S.rider);
  rider.visible = !(custom && custom.rider === false);
  const R = V(...S.rider), hip = V(0, 0.95, -0.3), neck = V(...S.lean);
  const grip = V(S.bars[0] - 0.05, S.bars[1] + 0.02, S.bars[2]).sub(R);

  // torso: hips, waist, chest, shoulders
  const tl = hip.distanceTo(neck);
  const torso = new THREE.Mesh(loft([[-0.06, 0, 0.1, 0.08], [0, 0, 0.18, 0.135], [tl * 0.3, 0, 0.165, 0.125], [tl * 0.62, 0, 0.215, 0.155], [tl * 0.88, 0, 0.235, 0.14], [tl, 0, 0.1, 0.085], [tl + 0.03, 0, 0.055, 0.045]], 18), suit);
  torso.geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Z, neck.clone().sub(hip).normalize())).translate(hip.x, hip.y, hip.z);
  rider.add(torso, ball(hip, 0.165, leather, 1.12, 0.85, 1.05));
  const spine = neck.clone().sub(hip).normalize(), backDir = V(0, spine.z, -spine.y);   // points out of the rider's back
  rider.add(ball(hip.clone().lerp(neck, 0.8).addScaledVector(backDir, 0.11), 0.1, trim, 0.9, 0.55, 1.5));   // aero hump
  rider.add(tube(neck, neck.clone().add(V(0, 0.09, 0.05)), [0.055, 0.052], leather));

  // helmet
  const head = new THREE.Group(); head.position.copy(neck).add(V(S.head[0], S.head[1], S.head[2])); head.rotation.x = S.head[3];
  const shell = new THREE.Mesh(new THREE.LatheGeometry(
    [[0, -0.155], [0.085, -0.155], [0.118, -0.115], [0.142, -0.04], [0.15, 0.03], [0.142, 0.095], [0.115, 0.145], [0.065, 0.172], [0, 0.18]].map(p => new THREE.Vector2(p[0], p[1])), 28), helmetMat);
  shell.scale.set(0.97, 1, 1.17);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.153, 24, 10, Math.PI / 2 - 1.0, 2.0, 1.12, 0.62), glass); visor.scale.set(0.97, 1, 1.19); visor.position.y = 0.01;
  const vent = box(V(0, -0.1, 0.165), 0.07, 0.025, 0.02, plastic);
  head.add(shell, visor, vent); rider.add(head);

  const part = {};
  for (const [tag, s] of [['L', 1], ['R', -1]]) {
    const sh = neck.clone().add(V(s * 0.235, -0.045, -0.03)), wrist = V(s * grip.x, grip.y, grip.z);
    const elbow = sh.clone().lerp(wrist, 0.52).add(V(s * 0.07, -0.07, -0.03));
    const arm = new THREE.Group();
    arm.add(tube(sh, elbow, [0.074, 0.08, 0.07, 0.06], suit), tube(elbow, wrist, [0.06, 0.066, 0.055, 0.045], leather));
    arm.add(ball(sh, 0.086, trim, 1.05, 0.8, 1.1), ball(elbow, 0.062, plastic), ball(wrist.clone().add(V(0, -0.025, 0.02)), 0.058, leather, 1.15, 0.85, 1.3));
    rider.add(arm); part['arm' + tag] = arm;

    const hp = V(s * 0.12, 0.93, -0.28), knee = V(s * S.knee[0], S.knee[1], S.knee[2]).sub(R), ankle = V(s * S.foot[0], S.foot[1], S.foot[2]).sub(R);
    const leg = new THREE.Group();
    leg.add(tube(hp, knee, [0.108, 0.115, 0.098, 0.08], suit), tube(knee, ankle, [0.078, 0.088, 0.07, 0.056], leather));
    leg.add(ball(knee.clone().add(V(s * 0.02, 0.0, 0.03)), 0.078, trim, 0.9, 1.1, 0.9));
    leg.add(tube(ankle.clone().add(V(0, -0.03, -0.05)), ankle.clone().add(V(s * 0.01, -0.09, 0.19)), [0.062, 0.068, 0.058, 0.04], plastic, 0.8));
    rider.add(leg); part['leg' + tag] = leg;

    const strike = new THREE.Group(); strike.position.copy(sh);
    strike.add(tube(V(0, 0, 0), V(s * 0.36, -0.01, 0.07), [0.062, 0.06, 0.054], suit), tube(V(s * 0.36, -0.01, 0.07), V(s * 0.66, 0, 0.12), [0.052, 0.048, 0.042], leather));
    strike.add(ball(V(s * 0.72, 0, 0.13), 0.065, leather, 1.2, 0.9, 0.95));
    strike.visible = false; rider.add(strike); part['strike' + tag] = strike;

    const kick = new THREE.Group(); kick.position.copy(hp);
    kick.add(tube(V(0, 0, 0), V(s * 0.42, -0.1, 0.1), [0.1, 0.095, 0.08], suit), tube(V(s * 0.42, -0.1, 0.1), V(s * 0.8, -0.22, 0.18), [0.072, 0.07, 0.055], leather));
    kick.add(tube(V(s * 0.8, -0.3, 0.16), V(s * 0.84, -0.08, 0.2), [0.05, 0.058, 0.05], plastic));
    kick.visible = false; rider.add(kick); part['kick' + tag] = kick;
  }

  for (const g of [lean, rider, head, ...wheels, ...Object.values(part)]) mergeMeshes(g);
  root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { root, lean, wheels, rider, ...part };
}
