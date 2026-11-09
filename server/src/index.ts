// Sunlight multiplayer server: plain `ws` WebSocket server with rooms (see DECISIONS.md D10).
import http from 'node:http';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { Lobby, loadLifts } from './rooms';
import { loadGuestWorld, type GuestResort } from '../../client/src/world/mountainGuestWorld';
import { ClientMsg, ServerMsg, TICK_HZ } from '../../shared/protocol';

// --port wins (dev script), then $PORT (hosting platforms), then 8787
const argPort = process.argv.indexOf('--port');
const PORT = Number(argPort > 0 ? process.argv[argPort + 1] : process.env.PORT ?? 8787);
const worldRoot = new URL('../../client/public/world/', import.meta.url);
const readWorld = async (path: string) => {
  const data = await readFile(new URL(path.replace(/^world\//, ''), worldRoot));
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
};
const resort: GuestResort = JSON.parse(new TextDecoder().decode(await readWorld('world/resort.json')));
const guestWorld = await loadGuestWorld('world', resort, readWorld);

const stateFile = process.env.GUEST_STATE_FILE;
const savedGuests = new Map<string, unknown>();
if (stateFile) {
  try {
    const data = JSON.parse(await readFile(stateFile, 'utf8')) as [string, unknown][];
    for (const [room, state] of data.slice(-128)) if (/^[A-Z0-9]{1,8}$/.test(room)) savedGuests.set(room, state);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Could not restore mountain guest', err);
  }
}
const lobby = new Lobby(loadLifts(), guestWorld, savedGuests);
if (stateFile) {
  let write = Promise.resolve();
  const save = () => {
    const data = JSON.stringify([...lobby.saveGuests()]);
    write = write.then(async () => {
      await mkdir(dirname(stateFile), { recursive: true });
      await writeFile(`${stateFile}.tmp`, data);
      await rename(`${stateFile}.tmp`, stateFile);
    }).catch(err => console.warn('Could not save mountain guest', err));
    return write;
  };
  setInterval(save, 15000).unref();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void save().then(() => process.exit(0)); });
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url?.startsWith('/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, release:process.env.RELEASE_SHA ?? 'development', droneOnly:true, liftSpeed:true, chairFalls:true, manualUnload:true, mountainGuest:true, rooms: lobby.rooms.size, players: [...lobby.rooms.values()].reduce((a, r) => a + r.size, 0) }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Sunlight Mountain multiplayer server. Connect with WebSocket.\n');
});

const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });

wss.on('connection', (ws: WebSocket) => {
  let room: string | null = null;
  let id: string | null = null;
  const joinDeadline=setTimeout(() => { if(!room)ws.close(1008,'Join a room first'); },15000);
  ws.on('error', () => ws.close());
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
      if (r) { clearTimeout(joinDeadline); room = r.room.code; id = r.id; console.log(`join ${room} ${id}`); }
      return;
    }
    if (!room || !id) return;
    lobby.rooms.get(room)?.handle(id, msg);
  });
  ws.on('close', () => {
    clearTimeout(joinDeadline);
    if (room && id) { lobby.leave(room, id); console.log(`leave ${room} ${id}`); }
  });
});

setInterval(() => lobby.tick(), 1000 / TICK_HZ);

server.listen(PORT, () => console.log(`Sunlight multiplayer server on :${PORT} (ws)`));
