import { isMapId } from '@shoreline/shared';
import { Room, JoinError, type RoomOptions, type RoomStats } from './Room';

type Shared = Omit<RoomOptions, 'id' | 'mapId' | 'onEmpty'>;

/**
 * Rooms are created on first join and destroyed when empty. Everything a room needs from outside is passed
 * in, so the same Room can later run behind a Redis-backed bus in several processes (see README, scaling).
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  constructor(
    private readonly shared: Shared,
    private readonly maxRooms: number,
    private readonly defaultMap: string,
  ) {}

  get(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  /** Existing room, or a new one on `mapId` (the room keeps the map it was created with). */
  getOrCreate(id: string, mapId?: string): Room {
    const hit = this.rooms.get(id);
    if (hit) return hit;
    if (this.rooms.size >= this.maxRooms) throw new JoinError('room', 'Too many rooms are open. Try an existing one.');
    const map = mapId && isMapId(mapId) ? mapId : this.defaultMap;
    const room = new Room({
      ...this.shared,
      id,
      mapId: map,
      onEmpty: (r) => {
        r.stop();
        this.rooms.delete(r.id);
        this.shared.log.info({ room: r.id }, 'room closed');
      },
    });
    this.rooms.set(id, room);
    room.start();
    this.shared.log.info({ room: id, map }, 'room opened');
    return room;
  }

  list(): RoomStats[] {
    return [...this.rooms.values()].map((r) => r.stats());
  }

  stopAll(): void {
    for (const r of this.rooms.values()) r.stop();
    this.rooms.clear();
  }
}
