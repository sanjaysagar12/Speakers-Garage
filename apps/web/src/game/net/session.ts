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
    const store = gameStore.getState();
    if (!opts.online) {
      store.setNet({ status: 'offline', message: undefined, players: [], selfId: -1 });
      return { map: opts.map, offline: true };
    }
    const a = new WebSocketAdapter(serverUrl(), { room: opts.room, map: opts.map });
    offs.push(a.onStatus(({ status, message }) => gameStore.getState().setNet({ status, message, room: opts.room })));
    offs.push(
      a.onEvent((m) => {
        if (m.t === 'chat') gameStore.getState().addChat({ id: m.id, name: m.name, text: m.text });
        if (m.t === 'welcome') gameStore.getState().setNet({ selfId: m.selfId });
      }),
    );
    const s = gameStore.getState();
    try {
      await a.join({ id: '', name: s.name, avatar: s.avatar });
    } catch (e) {
      const status = (e as { status?: NetStatus }).status;
      offs.splice(0).forEach((o) => o());
      if (status === 'full' || status === 'version') throw e;
      devLog('[net] server unreachable, playing offline:', (e as Error).message);
      gameStore.getState().setNet({ status: 'offline', message: 'The server is unreachable: you are playing offline.' });
      return { map: opts.map, offline: true, notice: 'The server is unreachable: you are playing offline.' };
    }
    adapter = a;
    ws = a;
    rosterTimer = window.setInterval(publishRoster, 250);
    publishRoster();
    return { map: a.welcome?.map ?? opts.map, offline: false };
  },

  stop(): void {
    window.clearInterval(rosterTimer);
    offs.splice(0).forEach((o) => o());
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
