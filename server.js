// Blacktop Brawl server: serves the game files and relays multiplayer messages between players in a room.
// Run with:  npm install && npm start     (PORT env var optional, default 8080)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = +process.env.PORT || 8080;
const MAX_PER_ROOM = 10, MAX_ROOMS = 200, GRID = 10;
const BOT_NAMES = ['Viper', 'Rook', 'Dozer', 'Ash', 'Juno', 'Brick', 'Slick', 'Hex', 'Mako'];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.hdr': 'application/octet-stream', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.md': 'text/plain; charset=utf-8',
};
const PUBLIC = ['index.html', 'src', 'vendor', 'assets', 'CREDITS.md']; // nothing else is served

const server = http.createServer((req, res) => {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  const top = path.relative(ROOT, file).split(path.sep)[0];
  if (!file.startsWith(ROOT + path.sep) || !PUBLIC.includes(top) || rel.includes('/.')) { res.writeHead(404).end('Not found'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': st.size,
      'Cache-Control': top === 'assets' || top === 'vendor' ? 'public, max-age=86400' : 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
});

// ---------------------------------------------------------------- rooms
const rooms = new Map(); // code -> { clients: Map<id, {ws, name}>, hostId }
let nextId = 1;
const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
const broadcast = (room, msg, exceptId) => {
  const s = JSON.stringify(msg);
  for (const [id, c] of room.clients) if (id !== exceptId && c.ws.readyState === 1) c.ws.send(s);
};
const roster = room => ({ t: 'players', hostId: room.hostId, loc: room.loc, players: [...room.clients].map(([id, c]) => ({ id, name: c.name, bike: c.bike })) });

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 });
wss.on('connection', ws => {
  let id = null, room = null, code = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'ping') { send(ws, { t: 'pong', c: m.c, now: Date.now() }); return; }

    if (m.t === 'join') {
      if (room) return;
      const name = String(m.name || '').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 14) || 'Rider';
      code = String(m.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'OPEN';
      let r = rooms.get(code);
      if (!r) {
        if (rooms.size >= MAX_ROOMS) { send(ws, { t: 'error', msg: 'Server is full, try again later.' }); return; }
        r = { clients: new Map(), hostId: null, loc: 'valley' }; rooms.set(code, r);
      }
      if (r.clients.size >= MAX_PER_ROOM) { send(ws, { t: 'error', msg: `Room ${code} is full (${MAX_PER_ROOM} riders).` }); return; }
      room = r; id = nextId++;
      const bike = /^[a-z]{1,10}$/.test(m.bike) ? m.bike : 'arrow';
      room.clients.set(id, { ws, name, bike });
      if (room.hostId === null) room.hostId = id;
      send(ws, { t: 'welcome', id, room: code });
      broadcast(room, roster(room));
      return;
    }
    if (!room) return;

    // the host picks the location; everyone in the room is told so they can load it
    if (m.t === 'cfg') {
      if (id !== room.hostId || !/^[a-z]{1,12}$/.test(m.loc)) return;
      room.loc = m.loc; broadcast(room, roster(room));
      return;
    }
    if (m.t === 'start') {
      if (id !== room.hostId) return;
      const humans = [...room.clients].map(([pid, c]) => ({ id: pid, name: c.name, bike: c.bike }));
      const bots = BOT_NAMES.slice(0, Math.max(0, GRID - humans.length)).map((name, i) => ({ id: 'b' + i, name, bot: true }));
      broadcast(room, { t: 'start', loc: room.loc, grid: [...bots, ...humans], startAt: Date.now() + 4500, seed: (Math.random() * 2 ** 31) | 0 });
      return;
    }
    // rider state, hits and power-up events are relayed as-is to everyone else in the room
    if (m.t === 's' || m.t === 'hit' || m.t === 'ev') { m.from = id; broadcast(room, m, id); }
  });

  ws.on('close', () => {
    if (!room) return;
    room.clients.delete(id);
    if (room.clients.size === 0) { rooms.delete(code); return; }
    if (room.hostId === id) room.hostId = room.clients.keys().next().value;
    broadcast(room, { t: 'left', id });
    broadcast(room, roster(room));
  });
});

// drop dead connections
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 30000);

server.listen(PORT, () => console.log(`Blacktop Brawl running at http://localhost:${PORT}`));
