import { gameStore, type RosterEntry } from '../../store/gameStore';
import { LocalAdapter, type NetworkAdapter, type NetStatus } from './NetworkAdapter';
import { WebSocketAdapter, serverUrl } from './WebSocketAdapter';
import { remotes } from './entities';
import { devLog } from '../../util/devlog';

/**
 * The network session for the world that is currently entered: which adapter is in use, and a low-rate
 * mirror of connection state + roster into the zustand store for the HUD. The 20 Hz data never goes
 * through React: the render loop reads net/entities.ts directly.
 */
let adapter: NetworkAdapter = new LocalAdapter();
let ws: WebSocketAdapter | null = null;
let rosterTimer = 0;

/** Resume token per tab (sessionStorage): a reload continues as the same player, a new tab is a new one. */
const RESUME_KEY = 'shoreline.resume.v1';
function loadToken(room: string): string | undefined {
  try {
    const r = JSON.parse(sessionStorage.getItem(RESUME_KEY) ?? 'null') as { room: string; token: string } | null;
    return r && r.room === room ? r.token : undefined;
  } catch {
    return undefined;
  }
}
function saveToken(room: string, token: string | undefined): void {
  try {
    if (token) sessionStorage.setItem(RESUME_KEY, JSON.stringify({ room, token }));
    else sessionStorage.removeItem(RESUME_KEY);
  } catch {
    /* storage blocked: no resume */
  }
}
/** bumped by every start/stop: a start that finishes after being superseded closes its connection */
let generation = 0;
/** room of the connected session (null when offline / not connected) */
let activeRoom: string | null = null;
const offs: Array<() => void> = [];

export const session = {
  get adapter(): NetworkAdapter {
    return adapter;
  },
  get ws(): WebSocketAdapter | null {
    return ws;
  },

  /**
   * Connect to the room (online) or stay local. Resolves with the map to load: a room keeps the map it was
   * created with, so the server's answer wins over the landing page choice. Throws only for outcomes the
   * player must see (room full, version mismatch, bad name); an unreachable server falls back to offline.
   */
  async start(opts: { online: boolean; room: string; map: string }): Promise<{ map: string; offline: boolean; notice?: string }> {
    this.stop();
    const my = generation;
    const store = gameStore.getState();
    opts = { ...opts, room: opts.room || 'beach' };
    if (!opts.online) {
      store.setNet({ status: 'offline', message: undefined, players: [], selfId: -1 });
      return { map: opts.map, offline: true };
    }
    const room = opts.room;
    const a = new WebSocketAdapter(serverUrl(), { room, map: opts.map, resume: loadToken(room) });
    // listeners belong to this attempt until it wins (an overlapping attempt must not remove them)
    const mine: Array<() => void> = [];
    const current = () => adapter === a;
    mine.push(a.onStatus(({ status, message }) => (current() || my === generation) && gameStore.getState().setNet({ status, message, room })));
    mine.push(
      a.onEvent((m) => {
        if (!current()) return;
        if (m.t === 'chat' && !gameStore.getState().voice.blocked.includes(m.id)) gameStore.getState().addChat({ id: m.id, name: m.name, text: m.text });
        if (m.t === 'welcome') {
          gameStore.getState().setNet({ selfId: m.selfId });
          saveToken(room, m.resume); // a reconnect may get a new token
        }
      }),
    );
    const s = gameStore.getState();
    try {
      await a.join({ id: '', name: s.name, avatar: s.avatar });
    } catch (e) {
      const status = (e as { status?: NetStatus }).status;
      mine.forEach((o) => o());
      if (my !== generation) return { map: opts.map, offline: true };
      if (status === 'full' || status === 'version') throw e;
      devLog('[net] server unreachable, playing offline:', (e as Error).message);
      gameStore.getState().setNet({ status: 'offline', message: 'The server is unreachable: you are playing offline.' });
      return { map: opts.map, offline: true, notice: 'The server is unreachable: you are playing offline.' };
    }
    if (my !== generation) {
      // the world was left while we were joining: leave this connection (no ghost on the server)
      mine.forEach((o) => o());
      a.abort();
      return { map: opts.map, offline: true };
    }
    adapter = a;
    ws = a;
    activeRoom = room;
    saveToken(room, a.resume);
    offs.push(...mine);
    // wardrobe changes reach everyone (the server re-validates them)
    let lastAvatar = gameStore.getState().avatar;
    offs.push(
      gameStore.subscribe((st) => {
        if (st.avatar !== lastAvatar) {
          lastAvatar = st.avatar;
          a.sendAvatar(st.avatar);
        }
      }),
    );
    rosterTimer = window.setInterval(publishRoster, 250);
    publishRoster();
    return { map: a.welcome?.map ?? opts.map, offline: false };
  },

  /** Leave the world: closes the connection (the server removes the player at once). */
  stop(): void {
    generation++;
    window.clearInterval(rosterTimer);
    offs.splice(0).forEach((o) => o());
    if (activeRoom !== null) saveToken(activeRoom, undefined);
    activeRoom = null;
    adapter.leave();
    adapter = new LocalAdapter();
    ws = null;
    remotes.clear();
    gameStore.getState().setNet({ status: 'offline', message: undefined, players: [], selfId: -1, rtt: 0 });
  },
};

let lastKey = '';
/** Roster for the HUD at 4 Hz, only when something visible changed. */
function publishRoster(): void {
  if (!ws) return;
  const s = gameStore.getState();
  const list: RosterEntry[] = [{ id: remotes.selfId, name: s.name, self: true, voice: false, muted: false, speaking: false }];
  for (const p of remotes.roster.values()) list.push({ id: p.id, name: p.name, self: false, voice: p.voice.joined, muted: p.voice.muted, speaking: p.voice.speaking });
  const rtt = Math.round(ws.rtt);
  const key = list.map((p) => `${p.id}:${p.name}:${+p.voice}${+p.muted}${+p.speaking}`).join('|') + `#${Math.round(rtt / 10)}`;
  if (key === lastKey) return;
  lastKey = key;
  s.setNet({ players: list, rtt });
}

/** For the voice layer: patch the local roster entry (self speaking / voice). */
export function patchSelfRoster(patch: Partial<RosterEntry>): void {
  const s = gameStore.getState();
  const players = s.net.players.map((p) => (p.self ? { ...p, ...patch } : p));
  s.setNet({ players });
  lastKey = '';
}
