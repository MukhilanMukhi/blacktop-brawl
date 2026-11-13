// Bikes, the minimap and the power-up system.
import * as THREE from 'three';
import { trackToWorld, roadX, roadDX, mulberry32, START_Z, FINISH_Z } from './world.js';

// ---------------------------------------------------------------- bikes
// top: m/s, accel: m/s^2 off the line, handling: steering multiplier, armor: divides damage taken
export const BIKES = [
  { id: 'arrow', name: 'Arrow', style: 'sport', blurb: 'Highest top speed', top: 72, accel: 17, handling: 0.9, armor: 1.0 },
  { id: 'wasp', name: 'Wasp', style: 'moto', blurb: 'Fast off the line and nimble, but fragile', top: 66.5, accel: 23, handling: 1.25, armor: 0.8 },
  { id: 'brute', name: 'Brute', style: 'cruiser', blurb: 'Heavy and very hard to knock down', top: 68, accel: 16, handling: 0.85, armor: 1.5 },
  { id: 'nomad', name: 'Nomad', style: 'street', blurb: 'Balanced all-rounder', top: 69.5, accel: 19.5, handling: 1.05, armor: 1.1 },
];

// ---------------------------------------------------------------- minimap
// Round map centred on the player and turned so "up" is the direction of travel.
const mp = new THREE.Vector3(), mq = new THREE.Vector3();
export function drawMinimap(cv, G) {
  const g = cv.getContext('2d'), W = cv.width, c = W / 2, p = G.player(), scale = c / 380, cy = c * 1.3;
  const h = Math.atan2(roadDX(p.z), 1), sh = Math.sin(h), ch = Math.cos(h);
  trackToWorld(p.z, p.lat, mp);
  const X = (wx, wz) => c - ((wx - mp.x) * ch - (wz - mp.z) * sh) * scale;
  const Y = (wx, wz) => cy - ((wx - mp.x) * sh + (wz - mp.z) * ch) * scale;
  g.clearRect(0, 0, W, W);
  g.save();
  g.beginPath(); g.arc(c, c, c - 3, 0, Math.PI * 2); g.clip();
  g.fillStyle = 'rgba(12,16,22,.62)'; g.fillRect(0, 0, W, W);
  // road
  g.beginPath();
  for (let z = p.z - 320, i = 0; z <= p.z + 900; z += 15, i++) { const x = roadX(z); i ? g.lineTo(X(x, z), Y(x, z)) : g.moveTo(X(x, z), Y(x, z)); }
  g.lineJoin = g.lineCap = 'round';
  g.strokeStyle = 'rgba(255,255,255,.28)'; g.lineWidth = 11; g.stroke();
  g.strokeStyle = '#f2f2f2'; g.lineWidth = 3; g.stroke();
  // start / finish lines
  for (const z of [START_Z, FINISH_Z]) {
    if (Math.abs(z - p.z) > 900) continue;
    const x = roadX(z);
    g.fillStyle = z === FINISH_Z ? '#ffd166' : '#9aa3ad';
    g.beginPath(); g.arc(X(x, z), Y(x, z), 6, 0, Math.PI * 2); g.fill();
  }
  const dot = (z, lat, r, fill, ring) => {
    if (z < p.z - 340 || z > p.z + 920) return;
    trackToWorld(z, lat, mq);
    g.beginPath(); g.arc(X(mq.x, mq.z), Y(mq.x, mq.z), r, 0, Math.PI * 2);
    g.fillStyle = fill; g.fill();
    if (ring) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke(); }
  };
  for (const k of G.powerups.pickups) if (G.clock() >= k.until) dot(k.z, k.lat * 3, 2.2, '#5ad1ff');
  for (const car of G.cars) dot(car.z, car.lat * 3, 2.5, '#8a8f98');
  for (const r of G.riders) if (r.active && r !== p) dot(r.z, r.lat * 3, 4.2, G.slotCss(r.slot), r.kind === 'human');
  // player arrow
  g.fillStyle = '#fff'; g.strokeStyle = '#111'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(c, cy - 9); g.lineTo(c + 6.5, cy + 7); g.lineTo(c, cy + 3); g.lineTo(c - 6.5, cy + 7); g.closePath(); g.fill(); g.stroke();
  g.restore();
  g.beginPath(); g.arc(c, c, c - 3, 0, Math.PI * 2); g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 3; g.stroke();
}

// ---------------------------------------------------------------- power-ups
export const ITEMS = {
  nitro: { name: 'NITRO', icon: 'N', color: 0x29b6f6, help: 'burst of speed' },
  shield: { name: 'SHIELD', icon: 'S', color: 0x66ff99, help: 'blocks hits for a few seconds' },
  repair: { name: 'REPAIR', icon: '+', color: 0xffffff, help: 'restores health' },
  bolt: { name: 'BOLT', icon: 'B', color: 0xffd740, help: 'homes in on the rider ahead' },
  mine: { name: 'MINE', icon: 'M', color: 0xff5252, help: 'dropped behind you' },
  pulse: { name: 'PULSE', icon: 'P', color: 0xb388ff, help: 'blasts nearby riders aside' },
};
const TYPES = Object.keys(ITEMS);
const MAX_ITEMS = 2;

function iconSprite(text, color) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.font = '900 46px "Segoe UI", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 7; g.strokeStyle = '#000'; g.strokeText(text, 32, 35); g.fillStyle = color; g.fillText(text, 32, 35);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
}

export function createPowerups(G) {
  const group = new THREE.Group(); G.scene.add(group);
  const v = new THREE.Vector3();
  const gemGeo = new THREE.OctahedronGeometry(0.62), boltGeo = new THREE.SphereGeometry(0.28, 12, 10);
  const mineGeo = new THREE.CylinderGeometry(0.42, 0.5, 0.22, 14), ringGeo = new THREE.TorusGeometry(1, 0.08, 8, 40).rotateX(Math.PI / 2);
  const shieldGeo = new THREE.SphereGeometry(1.3, 20, 14), flameGeo = new THREE.ConeGeometry(0.16, 1.4, 10).rotateX(-Math.PI / 2);
  const mats = {}, icons = {};
  for (const t of TYPES) {
    const c = ITEMS[t].color;
    mats[t] = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.6, roughness: 0.25, metalness: 0.2, transparent: true, opacity: 0.85 });
    icons[t] = iconSprite(ITEMS[t].icon, '#fff');
  }
  const boltMat = new THREE.MeshBasicMaterial({ color: 0xffe066 }), mineMat = new THREE.MeshStandardMaterial({ color: 0x331111, emissive: 0xff2010, emissiveIntensity: 2 });
  const shieldMat = new THREE.MeshBasicMaterial({ color: 0x66ff99, transparent: true, opacity: 0.22, depthWrite: false });
  const flameMat = new THREE.MeshBasicMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.85, depthWrite: false });

  const P = { pickups: [], bolts: [], mines: [], rings: [] };
  let seq = 0;
  const put = (mesh, z, lat, up) => { trackToWorld(z, lat, v); mesh.position.set(v.x, v.y + up, v.z); };

  function ring(z, lat, color, size) {
    const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
    put(mesh, z, lat, 0.5); group.add(mesh);
    P.rings.push({ mesh, age: 0, size });
  }
  function addBolt(from, to, own) {
    const mesh = new THREE.Mesh(boltGeo, boltMat); group.add(mesh);
    P.bolts.push({ mesh, z: from.z + 2, lat: from.lat, v: from.v + 95, to, own, life: 0 });
  }
  function addMine(id, z, lat, owner, born) {
    const mesh = new THREE.Mesh(mineGeo, mineMat); put(mesh, z, lat, 0.12); group.add(mesh);
    P.mines.push({ id, mesh, z, lat, owner, born });
  }
  function removeMine(id, boom) {
    const i = P.mines.findIndex(m => m.id === id);
    if (i < 0) return;
    const m = P.mines[i];
    if (boom) { ring(m.z, m.lat, 0xff5252, 5); if (Math.abs(m.z - G.player().z) < 80) G.audio.crash(); }
    group.remove(m.mesh); P.mines.splice(i, 1);
  }

  P.reset = seed => {
    while (group.children.length) group.remove(group.children[0]);
    P.pickups.length = P.bolts.length = P.mines.length = P.rings.length = 0;
    const rng = mulberry32(seed ^ 0x5bd1e995);
    for (let z = START_Z + 350; z < FINISH_Z - 150; z += 240) for (const lat of [-3.6, 0, 3.6]) {
      const type = TYPES[Math.floor(rng() * TYPES.length)];
      const mesh = new THREE.Group();
      mesh.add(new THREE.Mesh(gemGeo, mats[type]));
      const s = new THREE.Sprite(icons[type]); s.scale.setScalar(0.85); mesh.add(s);
      put(mesh, z, lat, 1.05); group.add(mesh);
      P.pickups.push({ z, lat, type, mesh, until: -99 });
    }
    for (const r of G.riders) { r.items = []; r.nitro = 0; r.shield = 0; r.botItemT = 1 + Math.random(); }
  };

  // shield bubble and nitro flame, attached to a rider's bike model
  P.attach = r => {
    const shield = new THREE.Mesh(shieldGeo, shieldMat); shield.position.y = 0.95; shield.visible = false;
    const flame = new THREE.Mesh(flameGeo, flameMat); flame.position.set(0, 0.6, -1.5); flame.visible = false;
    r.model.root.add(shield, flame); r.fx = { shield, flame };
  };

  P.use = (r, t) => {
    if (!r.items.length || r.state !== 'ride' || r.finished) return;
    const type = r.items.shift(), me = r === G.player();
    switch (type) {
      case 'nitro': r.nitro = 3.5; if (me) G.audio.tone(200, 900, 0.5, 0.35, 'sawtooth'); break;
      case 'shield': r.shield = 6; if (me) G.audio.tone(500, 800, 0.3, 0.3); break;
      case 'repair': r.health = 100; if (me) G.audio.tone(600, 1200, 0.25, 0.3); break;
      case 'bolt': {
        let target = null, best = 190;
        for (const o of G.riders) { const dz = o.z - r.z; if (o !== r && o.active && o.state === 'ride' && dz > 2 && dz < best) { best = dz; target = o; } }
        addBolt(r, target ? target.slot : -1, true);
        G.net.send({ t: 'ev', e: 'bolt', from: r.slot, to: target ? target.slot : -1 });
        if (me) G.audio.tone(900, 300, 0.25, 0.3, 'square');
        break;
      }
      case 'mine': {
        const id = r.slot + '_' + ++seq;
        addMine(id, r.z - 3, r.lat, r.slot, t);
        G.net.send({ t: 'ev', e: 'mine', id, z: r.z - 3, lat: r.lat, owner: r.slot });
        break;
      }
      case 'pulse': {
        ring(r.z, r.lat, 0xb388ff, 12);
        G.net.send({ t: 'ev', e: 'pulse', from: r.slot });
        if (Math.abs(r.z - G.player().z) < 60) G.audio.tone(140, 40, 0.4, 0.6);
        for (const o of G.riders) {
          if (o === r || !o.active || Math.abs(o.z - r.z) > 12 || Math.abs(o.lat - r.lat) > 7) continue;
          const side = Math.sign(o.lat - r.lat) || 1;
          if (G.mine(o)) G.applyHit(o, side, 'pulse'); else G.net.send({ t: 'hit', to: o.slot, side, kind: 'pulse' });
        }
        break;
      }
    }
  };

  // events from other players: mirror what they did
  P.onEvent = (m, t) => {
    const r = G.riders[m.from];
    switch (m.e) {
      case 'pick': if (P.pickups[m.i]) P.pickups[m.i].until = t + 10; break;
      case 'bolt': if (r) addBolt(r, m.to, false); break;
      case 'mine': if (typeof m.z === 'number' && typeof m.lat === 'number') addMine(String(m.id), m.z, m.lat, m.owner, t); break;
      case 'boom': removeMine(String(m.id), true); break;
      case 'pulse': if (r) ring(r.z, r.lat, 0xb388ff, 12); break;
    }
  };

  function botUse(r, t) {
    const type = r.items[0], near = (lo, hi, dl) => G.riders.some(o => o !== r && o.active && o.state === 'ride' && o.z - r.z > lo && o.z - r.z < hi && Math.abs(o.lat - r.lat) < dl);
    const ok = type === 'nitro' ? !r.brakeAI
      : type === 'shield' ? near(-6, 6, 4)
      : type === 'repair' ? r.health < 75
      : type === 'bolt' ? near(3, 150, 99)
      : type === 'mine' ? near(-40, -4, 99)
      : near(-8, 8, 5);
    if (ok) P.use(r, t); else if (r.items.length > 1) r.items.reverse();
  }

  P.update = (dt, t) => {
    const player = G.player();
    for (const r of G.riders) {
      if (!r.active || !r.fx) continue;
      if (G.mine(r)) {
        r.nitro = Math.max(0, r.nitro - dt); r.shield = Math.max(0, r.shield - dt);
        if (t > 0 && r.state === 'ride' && !r.finished) {
          if (r.items.length < MAX_ITEMS) for (let i = 0; i < P.pickups.length; i++) {
            const k = P.pickups[i];
            if (t >= k.until && Math.abs(k.z - r.z) < 2.8 && Math.abs(k.lat - r.lat) < 1.4) {
              r.items.push(k.type); k.until = t + 10;
              G.net.send({ t: 'ev', e: 'pick', i });
              if (r === player) G.audio.tone(660, 1100, 0.14, 0.25);
              break;
            }
          }
          for (const m of P.mines) {
            if (Math.abs(m.z - r.z) < 1.9 && Math.abs(m.lat - r.lat) < 1.1 && (m.owner !== r.slot || t - m.born > 1.5)) {
              G.net.send({ t: 'ev', e: 'boom', id: m.id });
              removeMine(m.id, true);
              if (r.shield <= 0) { r.health -= 30 / (r.armor || 1); G.startCrash(r, Math.random() < 0.5 ? -1 : 1); }
              break;
            }
          }
          if ((r.kind === 'bot' || G.auto) && r.items.length && (r.botItemT -= dt) <= 0) { r.botItemT = 0.6 + Math.random(); botUse(r, t); }
        }
      }
      r.fx.shield.visible = r.shield > 0;
      r.fx.flame.visible = r.nitro > 0 && r.state === 'ride';
      if (r.fx.flame.visible) r.fx.flame.scale.set(1, 1, 0.7 + Math.random() * 0.6);
    }

    const spin = performance.now() / 600;
    for (const k of P.pickups) {
      k.mesh.visible = t >= k.until && Math.abs(k.z - player.z) < 900;
      if (k.mesh.visible) k.mesh.children[0].rotation.y = spin + k.z;
    }
    for (let i = P.bolts.length - 1; i >= 0; i--) {
      const b = P.bolts[i], tr = b.to >= 0 ? G.riders[b.to] : null;
      b.life += dt; b.z += b.v * dt;
      let done = b.life > 4 || (!tr && b.life > 1.2);
      if (tr && tr.active) {
        b.lat += (tr.lat - b.lat) * Math.min(1, dt * 6);
        if (b.z >= tr.z - 1.5) {
          done = true;
          ring(tr.z, tr.lat, 0xffd740, 3.5);
          if (b.own) {
            const side = Math.random() < 0.5 ? -1 : 1;
            if (G.mine(tr)) G.applyHit(tr, side, 'bolt'); else G.net.send({ t: 'hit', to: tr.slot, side, kind: 'bolt' });
          }
          if (tr === player || Math.abs(tr.z - player.z) < 40) G.audio.hit();
        }
      }
      if (done) { group.remove(b.mesh); P.bolts.splice(i, 1); } else put(b.mesh, b.z, b.lat, 0.9);
    }
    for (let i = P.mines.length - 1; i >= 0; i--) {
      const m = P.mines[i];
      if (t - m.born > 45) { group.remove(m.mesh); P.mines.splice(i, 1); continue; }
      m.mesh.scale.setScalar(1 + 0.15 * Math.sin(performance.now() / 120));
    }
    for (let i = P.rings.length - 1; i >= 0; i--) {
      const r = P.rings[i];
      r.age += dt;
      const k = r.age / 0.55;
      if (k >= 1) { group.remove(r.mesh); r.mesh.material.dispose(); P.rings.splice(i, 1); continue; }
      r.mesh.scale.setScalar(0.5 + k * r.size); r.mesh.material.opacity = 0.9 * (1 - k);
    }
  };

  return P;
}
