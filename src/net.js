// Multiplayer client: joins a room on the game server and exchanges rider state.
export class Net {
  constructor(handlers) {
    this.h = handlers;       // { players, start, state, hit, left, closed }
    this.ws = null; this.id = null; this.hostId = null; this.room = null; this.players = [];
    this.offset = 0; this.bestRtt = Infinity;
  }

  get connected() { return !!this.ws && this.ws.readyState === 1 && this.id !== null; }
  get isHost() { return this.id !== null && this.id === this.hostId; }
  now() { return Date.now() + this.offset; }   // server clock

  connect(name, room, bike) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = msg => { if (!settled) { settled = true; reject(new Error(msg)); } };
      let ws;
      try { ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`); }
      catch { fail('Could not open a connection.'); return; }
      this.ws = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({ t: 'join', name, room, bike }));
        for (let i = 0; i < 5; i++) setTimeout(() => this.send({ t: 'ping', c: Date.now() }), i * 250);
      };
      ws.onerror = () => fail('Online play needs the game server. Start it with "npm start" and open the address it prints.');
      ws.onclose = () => {
        fail('Could not reach the game server.');
        const was = this.id !== null; this.id = null; this.ws = null;
        if (was) this.h.closed?.();
      };
      ws.onmessage = e => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        switch (m.t) {
          case 'welcome': this.id = m.id; this.room = m.room; settled = true; resolve(m); break;
          case 'error': fail(m.msg); ws.close(); break;
          case 'pong': {
            const rtt = Date.now() - m.c;
            if (rtt < this.bestRtt) { this.bestRtt = rtt; this.offset = m.now - (m.c + rtt / 2); }
            break;
          }
          case 'players': this.hostId = m.hostId; this.players = m.players; this.loc = m.loc; this.h.players?.(m); break;
          case 'start': this.h.start?.(m); break;
          case 's': this.h.state?.(m); break;
          case 'hit': this.h.hit?.(m); break;
          case 'ev': this.h.ev?.(m); break;
          case 'left': this.h.left?.(m); break;
        }
      };
    });
  }

  send(msg) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg)); }
  close() { if (this.ws) { const ws = this.ws; this.id = null; this.ws = null; ws.onclose = null; ws.close(); } }
}
