import type { AvatarConfig } from '@shoreline/shared';

/** What survives a disconnect (and, later, a server restart): enough to resume a session. */
export interface PlayerRecord {
  resumeToken: string;
  roomId: string;
  playerId: number;
  name: string;
  avatar: AvatarConfig;
  x: number;
  z: number;
  facing: number;
  updatedAt: number;
}

/**
 * Persistence seam. Only an in-memory implementation exists; a database (or Redis) implementation can plug
 * in later without touching the rooms. Methods are async so a networked store fits the same interface.
 */
export interface PlayerStore {
  get(resumeToken: string): Promise<PlayerRecord | null>;
  put(record: PlayerRecord): Promise<void>;
  delete(resumeToken: string): Promise<void>;
}

export class MemoryPlayerStore implements PlayerStore {
  private readonly map = new Map<string, PlayerRecord>();
  constructor(private readonly ttlMs = 60_000) {}
  async get(token: string): Promise<PlayerRecord | null> {
    const r = this.map.get(token);
    if (!r) return null;
    if (Date.now() - r.updatedAt > this.ttlMs) {
      this.map.delete(token);
      return null;
    }
    return r;
  }
  async put(record: PlayerRecord): Promise<void> {
    this.map.set(record.resumeToken, record);
    if (this.map.size > 10_000) this.sweep();
  }
  async delete(token: string): Promise<void> {
    this.map.delete(token);
  }
  private sweep(): void {
    const now = Date.now();
    for (const [k, r] of this.map) if (now - r.updatedAt > this.ttlMs) this.map.delete(k);
  }
}
