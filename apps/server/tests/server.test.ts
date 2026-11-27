import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NET, PROTOCOL_VERSION, fromFixed } from '@shoreline/shared';
import { connect, joinMsg, sendCommands, sleep, startServer } from './helpers';

let srv: Awaited<ReturnType<typeof startServer>>;
interface RoomsResponse {
  rooms: Array<{ id: string; players: number; connected: number }>;
  capacity: number;
}
const getJson = async <T>(url: string): Promise<T> => (await fetch(url)).json() as Promise<T>;
beforeAll(async () => {
  srv = await startServer();
});
afterAll(async () => {
  await srv.app.close();
});

describe('HTTP', () => {
  it('serves /health and /rooms', async () => {
    const h = await getJson<{ ok: boolean; protocol: number }>(`${srv.http}/health`);
    expect(h.ok).toBe(true);
    expect(h.protocol).toBe(PROTOCOL_VERSION);
    const r = await getJson<RoomsResponse>(`${srv.http}/rooms`);
    expect(Array.isArray(r.rooms)).toBe(true);
  });

  it('rejects WebSocket upgrades from origins that are not allowed', async () => {
    await expect(connect(srv.url, 'https://evil.example')).rejects.toThrow();
    const ok = await connect(srv.url, 'http://localhost:5173');
    ok.close();
  });
});

describe('join, snapshots, leave', () => {
  it('welcomes, announces, spreads spawns and streams movement', async () => {
    const a = await connect(srv.url);
    a.send(joinMsg('Ana', 'join-test'));
    const wa = await a.waitFor('welcome');
    expect(wa.players.map((p) => p.name)).toEqual(['Ana']);
    expect(wa.tickRate).toBe(NET.tickRate);

    const b = await connect(srv.url);
    b.send(joinMsg('Ben', 'join-test'));
    const wb = await b.waitFor('welcome');
    expect(wb.players.map((p) => p.name).sort()).toEqual(['Ana', 'Ben']);
    await a.waitFor('joined', (m) => m.player.name === 'Ben');
    // spawns are spread out, not stacked
    expect(Math.hypot(wa.spawn.x - wb.spawn.x, wa.spawn.z - wb.spawn.z)).toBeGreaterThanOrEqual(1.2);

    // A learns that B is in view and gets B's state in snapshots
    await a.waitFor('spawn', (m) => m.id === wb.selfId);
    await a.waitSnap((s) => s.entities.some((e) => e.id === wb.selfId));

    // B walks for 1 s (60 commands); its own snapshots acknowledge them and show the movement
    await sendCommands(b, 0, 60, 0, 127);
    const sb = await b.waitSnap((s) => s.ackSeq === 59, 4000);
    const moved = Math.hypot(sb.self.x - wb.spawn.x, sb.self.z - wb.spawn.z);
    expect(moved).toBeGreaterThan(1.5);
    expect(moved).toBeLessThan(3.6);
    // A sees B where B is (quantized to 1 cm)
    const sa = await a.waitSnap((s) => s.entities.some((e) => e.id === wb.selfId && Math.abs(fromFixed(e.z) - sb.self.z) < 0.02));
    expect(sa).toBeTruthy();

    // B leaves: A is told after the reconnect window... unless B leaves for good. Closing = resumable.
    b.close();
    await sleep(200);
    const { rooms } = await getJson<RoomsResponse>(`${srv.http}/rooms`);
    const room = rooms.find((r) => r.id === 'join-test')!;
    expect(room.players).toBe(2);
    expect(room.connected).toBe(1);
    a.close();
  });

  it('rejects incompatible protocol versions with a clear message', async () => {
    const c = await connect(srv.url);
    c.send({ ...joinMsg('Old'), v: PROTOCOL_VERSION + 1 });
    const e = await c.waitFor('error');
    expect(e.code).toBe('version');
    expect(e.message).toMatch(/Reload/);
    await sleep(100);
    expect(c.closed?.code).toBe(4003);
  });

  it('rejects names that sanitize to nothing', async () => {
    const c = await connect(srv.url);
    c.send(joinMsg('<<<>>>'));
    expect((await c.waitFor('error')).code).toBe('name');
  });

  it('enforces room capacity', async () => {
    const s2 = await startServer({ MAX_PLAYERS_PER_ROOM: '2' });
    const cs = await Promise.all([0, 1, 2].map(() => connect(s2.url)));
    cs[0].send(joinMsg('A', 'cap'));
    await cs[0].waitFor('welcome');
    cs[1].send(joinMsg('B', 'cap'));
    await cs[1].waitFor('welcome');
    cs[2].send(joinMsg('C', 'cap'));
    expect((await cs[2].waitFor('error')).code).toBe('full');
    cs.forEach((c) => c.close());
    await s2.app.close();
  });
});

describe('abuse handling', () => {
  it('rate-limits chat and drops junk', async () => {
    const a = await connect(srv.url);
    a.send(joinMsg('Chatty', 'chat'));
    await a.waitFor('welcome');
    const b = await connect(srv.url);
    b.send(joinMsg('Reader', 'chat'));
    await b.waitFor('welcome');
    for (let i = 0; i < 20; i++) a.send({ t: 'chat', text: `msg ${i} <b>x</b>` });
    await sleep(400);
    const got = b.json.filter((m) => m.t === 'chat');
    expect(got.length).toBeGreaterThanOrEqual(3);
    expect(got.length).toBeLessThanOrEqual(5); // burst of 4 (+ refill)
    expect(got[0]).toMatchObject({ t: 'chat', name: 'Chatty', text: 'msg 0 bx/b' });
    a.close();
    b.close();
  });

  it('disconnects a client that keeps sending garbage', async () => {
    const c = await connect(srv.url);
    c.send(joinMsg('Spam', 'spam'));
    await c.waitFor('welcome');
    for (let i = 0; i < 80; i++) c.ws.send('{"t":"nope"}');
    await sleep(500);
    expect(c.closed).not.toBeNull();
  });

  it('closes oversized messages', async () => {
    const c = await connect(srv.url);
    c.send(joinMsg('Big', 'big'));
    await c.waitFor('welcome');
    c.ws.send('x'.repeat(NET.maxMessageBytes + 100));
    await sleep(300);
    expect(c.closed?.code).toBe(1009);
  });
});

describe('reconnection', () => {
  it('resumes the same player id and position within the window', async () => {
    const a = await connect(srv.url);
    a.send(joinMsg('Rey', 'resume'));
    const w1 = await a.waitFor('welcome');
    await sendCommands(a, 0, 45, 127, 0);
    const s1 = await a.waitSnap((s) => s.ackSeq === 44);
    a.close();
    await sleep(300);
    const a2 = await connect(srv.url);
    a2.send(joinMsg('Rey', 'resume', { resume: w1.resume }));
    const w2 = await a2.waitFor('welcome');
    expect(w2.selfId).toBe(w1.selfId);
    expect(w2.spawn.x).toBeCloseTo(s1.self.x, 6);
    expect(w2.spawn.z).toBeCloseTo(s1.self.z, 6);
    // sequence numbering restarts with the new session
    await sendCommands(a2, 0, 3, 0, 0);
    await a2.waitSnap((s) => s.ackSeq === 2);
    a2.close();
  });

  it('a second tab with the same token takes over; the first is told why', async () => {
    const a = await connect(srv.url);
    a.send(joinMsg('Twin', 'tabs'));
    const w = await a.waitFor('welcome');
    const b = await connect(srv.url);
    b.send(joinMsg('Twin', 'tabs', { resume: w.resume }));
    const wb = await b.waitFor('welcome');
    expect(wb.selfId).toBe(w.selfId);
    expect((await a.waitFor('error')).code).toBe('replaced');
    await sleep(100);
    expect(a.closed?.code).toBe(4001);
    b.close();
  });
});
