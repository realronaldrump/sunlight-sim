// Sunlight multiplayer server: plain `ws` WebSocket server with rooms (see DECISIONS.md D10).
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { Lobby } from './rooms';
import { ClientMsg, ServerMsg, TICK_HZ } from '../../shared/protocol';

// --port wins (dev script), then $PORT (hosting platforms), then 8787
const argPort = process.argv.indexOf('--port');
const PORT = Number(argPort > 0 ? process.argv[argPort + 1] : process.env.PORT ?? 8787);
const lobby = new Lobby();

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url?.startsWith('/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: lobby.rooms.size, players: [...lobby.rooms.values()].reduce((a, r) => a + r.size, 0) }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Sunlight Mountain multiplayer server. Connect with WebSocket.\n');
});

const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });

wss.on('connection', (ws: WebSocket) => {
  let room: string | null = null;
  let id: string | null = null;
  const conn = {
    send: (m: ServerMsg) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); },
    close: () => ws.close(),
  };
  ws.on('message', (data) => {
    let msg: ClientMsg;
    try { msg = JSON.parse(String(data)); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'join') {
      if (room) return;
      const r = lobby.join(conn, String(msg.room ?? ''), String(msg.name ?? ''), String(msg.color ?? ''), msg.controlMode === 'drone' ? 'drone' : 'skier');
      if (r) { room = r.room.code; id = r.id; console.log(`join ${room} ${id}`); }
      return;
    }
    if (!room || !id) return;
    lobby.rooms.get(room)?.handle(id, msg);
  });
  ws.on('close', () => {
    if (room && id) { lobby.leave(room, id); console.log(`leave ${room} ${id}`); }
  });
});

setInterval(() => lobby.tick(), 1000 / TICK_HZ);

server.listen(PORT, () => console.log(`Sunlight multiplayer server on :${PORT} (ws)`));
