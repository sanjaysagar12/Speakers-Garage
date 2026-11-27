import { useEffect, useState } from 'react';
import { MAP_NAMES } from '@speakersgarage/shared';
import { useGameStore } from '../store/useGameStore';
import { serverHttp } from '../game/net/endpoints';

interface RoomInfo {
  id: string;
  map: string;
  players: number;
}

/**
 * Online / offline, and which room to join. Existing rooms come from the server's GET /rooms (polled while
 * the landing page is open); typing a new name creates that room on entry. Offline needs no server.
 */
export function RoomPicker() {
  const online = useGameStore((s) => s.online);
  const room = useGameStore((s) => s.roomId);
  const setOnline = useGameStore((s) => s.setOnline);
  const setRoom = useGameStore((s) => s.setRoom);
  const [rooms, setRooms] = useState<RoomInfo[] | null>(null);
  const [capacity, setCapacity] = useState(50);
  const [reachable, setReachable] = useState<boolean | null>(null);

  useEffect(() => {
    if (!online) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`${serverHttp()}/rooms`, { signal: AbortSignal.timeout(3000) });
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as { rooms: RoomInfo[]; capacity: number };
        if (!alive) return;
        setRooms(j.rooms);
        setCapacity(j.capacity);
        setReachable(true);
      } catch {
        if (alive) setReachable(false);
      }
    };
    void load();
    const t = window.setInterval(load, 5000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [online]);

  const chip = (on: boolean) => `rounded-full border-2 px-3 py-1 text-sm font-bold transition ${on ? 'border-moss bg-moss text-white' : 'border-moss/40 bg-white text-bark hover:border-moss'}`;

  return (
    <fieldset className="mb-4 rounded-2xl border-2 border-moss/30 bg-white/50 p-3">
      <legend className="px-1 text-sm font-semibold text-bark">Play</legend>
      <div className="mb-2 flex gap-2">
        <button type="button" className={chip(online)} aria-pressed={online} onClick={() => setOnline(true)}>
          🌐 Online
        </button>
        <button type="button" className={chip(!online)} aria-pressed={!online} onClick={() => setOnline(false)}>
          🏝 Offline
        </button>
      </div>
      {online && (
        <>
          <label className="mb-2 block">
            <span className="mb-1 block text-xs text-bark/70">Room: join one where people are talking, or type a new name to start your own</span>
            <input
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="beach"
              aria-label="Room name"
              className="w-full rounded-xl border-2 border-moss/40 bg-white px-3 py-1.5 text-bark outline-none focus:border-moss"
            />
          </label>
          {reachable === false && rooms === null && <p className="text-xs text-red-700">The server is not reachable right now: you will play offline.</p>}
          {rooms && rooms.length > 0 && (
            <div className="flex flex-wrap gap-2" role="list" aria-label="Open rooms">
              {rooms.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  role="listitem"
                  disabled={r.players >= capacity}
                  className={`${chip(r.id === room)} disabled:opacity-40`}
                  onClick={() => setRoom(r.id)}
                  title={MAP_NAMES[r.map] ?? r.map}
                >
                  {r.id} · {MAP_NAMES[r.map] ?? r.map} · {r.players}/{capacity}
                </button>
              ))}
            </div>
          )}
          {rooms && rooms.length === 0 && <p className="text-xs text-bark/60">Nobody is here yet. Step in and “{room}” opens for whoever comes next.</p>}
        </>
      )}
    </fieldset>
  );
}
