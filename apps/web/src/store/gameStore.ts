import { createStore } from 'zustand/vanilla';
import { roomFromPath } from '../game/net/endpoints';
import { KEYS } from '../storage';
import type { AvatarConfig, DialogContent, NearbyInteraction } from '../types';
import { DEFAULT_AVATAR, sanitizeAvatar } from '@speakersgarage/shared';
import { DEFAULT_MAP, isMapId } from '@speakersgarage/shared';
import { QUALITY_ORDER, type Quality, type QualityMode } from '../game/config';
import type { NetStatus } from '../game/net/NetworkAdapter';

/** One player as the HUD shows it (updated a few times per second at most). */
export interface RosterEntry {
  id: number;
  name: string;
  self: boolean;
  voice: boolean;
  muted: boolean;
  speaking: boolean;
}

export interface VoiceUi {
  joined: boolean;
  joining: boolean;
  muted: boolean;
  deafened: boolean;
  ptt: boolean;
  /** the microphone is sending right now */
  micLive: boolean;
  /** HUD indicator: live, muted (open but silent, or not opened yet), unavailable (listen-only) */
  mic: 'live' | 'muted' | 'unavailable';
  /** why the microphone is unavailable (denied, no device, no HTTPS) */
  micError?: string;
  /** the browser blocked audio until another click (autoplay policy) */
  soundBlocked: boolean;
  speaking: boolean;
  error?: string;
  peers: Array<{ id: number; quality: 'good' | 'poor' | 'connecting' }>;
  inputs: Array<{ id: string; label: string }>;
  outputs: Array<{ id: string; label: string }>;
  canPickOutput: boolean;
  /** per-player volume (0..2) and mute, and blocked players (this session) */
  peerVolume: Record<number, { volume: number; muted: boolean }>;
  blocked: number[];
  /** right-click menu on a player */
  menu: { id: number; x: number; y: number } | null;
}

export interface ChatLine {
  key: number;
  id: number;
  name: string;
  text: string;
  at: number;
}


export type Phase = 'landing' | 'playing';

export interface GameState {
  phase: Phase;
  name: string;
  avatar: AvatarConfig;
  mapId: string;
  /** map plane position (y = world z), body facing and camera yaw, published ~12x/s */
  position: { x: number; y: number; facing: number; yaw: number };
  ui: {
    hintOpen: boolean;
    muted: boolean;
    isTouch: boolean;
    wardrobeOpen: boolean;
    /** golden hour -> sunset cycle (off = bright midday) */
    dayNight: boolean;
    /** 0..1 cycle phase, mirrored from the world for the HUD */
    timeOfDay: number;
    /** effective rendering tier (set by detection / the governor, or the manual choice) */
    quality: Quality;
    /** what the player picked in settings: 'auto' or a fixed tier (persisted) */
    qualityMode: QualityMode;
    /** frame-rate cap for battery saving (persisted) */
    fpsCap: 30 | 60;
    settingsOpen: boolean;
    /** F3 debug overlay */
    debug: boolean;
  };
  nearby: NearbyInteraction | null;
  dialog: DialogContent | null;
  /** multiplayer: play online (persisted), the room to join (persisted) */
  online: boolean;
  roomId: string;
  net: { status: NetStatus; message?: string; room?: string; rtt: number; players: RosterEntry[]; selfId: number };
  chat: ChatLine[];
  voice: VoiceUi;
  setVoice: (patch: Partial<VoiceUi>) => void;
  setName: (name: string) => void;
  setAvatar: (patch: Partial<AvatarConfig>) => void;
  replaceAvatar: (a: AvatarConfig) => void;
  setMap: (id: string) => void;
  enterWorld: () => void;
  leaveWorld: () => void;
  setPosition: (x: number, y: number, facing: number, yaw: number) => void;
  setNearby: (n: NearbyInteraction | null) => void;
  openDialog: (d: DialogContent) => void;
  closeDialog: () => void;
  setUi: (patch: Partial<GameState['ui']>) => void;
  setOnline: (online: boolean) => void;
  /** join voice with the microphone on (landing checkbox, remembered) */
  micOnJoin: boolean;
  setMicOnJoin: (on: boolean) => void;
  setRoom: (room: string) => void;
  setNet: (patch: Partial<GameState['net']>) => void;
  addChat: (line: Omit<ChatLine, 'key' | 'at'>) => void;
}

const STORAGE_KEY = KEYS.profile;

interface Saved {
  online: boolean;
  roomId: string;
  name: string;
  avatar: AvatarConfig;
  mapId: string;
  qualityMode: QualityMode;
  fpsCap: 30 | 60;
  micOnJoin: boolean;
}

const detectTouch = (): boolean => {
  try {
    return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  } catch {
    return false;
  }
};

function loadProfile(): Saved {
  const fallback: Saved = { online: true, roomId: 'beach', name: '', avatar: { ...DEFAULT_AVATAR }, mapId: DEFAULT_MAP, qualityMode: 'auto', fpsCap: 60, micOnJoin: true };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    // older saves stored an automatic default under `quality` (there was no setting); they start on auto
    const p = JSON.parse(raw) as Partial<{ online: boolean; roomId: string; name: string; avatar: Record<string, unknown>; mapId: string; qualityMode: string; fpsCap: number; micOnJoin: boolean }>;
    return {
      online: p.online !== false,
      roomId: typeof p.roomId === 'string' && /^[a-z0-9-]{1,24}$/.test(p.roomId) ? p.roomId : 'beach',
      name: typeof p.name === 'string' ? p.name.slice(0, 18) : '',
      avatar: sanitizeAvatar(p.avatar as Partial<AvatarConfig>),
      mapId: isMapId(p.mapId) ? p.mapId : DEFAULT_MAP,
      qualityMode: p.qualityMode === 'auto' || QUALITY_ORDER.includes(p.qualityMode as Quality) ? (p.qualityMode as QualityMode) : 'auto',
      fpsCap: p.fpsCap === 30 ? 30 : 60,
      micOnJoin: p.micOnJoin !== false,
    };
  } catch {
    return fallback;
  }
}

function persist(s: Pick<GameState, 'name' | 'avatar' | 'mapId' | 'online' | 'roomId' | 'micOnJoin'> & { qualityMode: QualityMode; fpsCap: 30 | 60 }): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ name: s.name, avatar: s.avatar, mapId: s.mapId, online: s.online, roomId: s.roomId, qualityMode: s.qualityMode, fpsCap: s.fpsCap, micOnJoin: s.micOnJoin }));
  } catch {
    /* storage unavailable */
  }
}

const initial = loadProfile();
// a deep link (/room/abc) chooses the room
{
  const linked = roomFromPath();
  if (linked) {
    initial.roomId = linked;
    initial.online = true;
  }
}

/** Blocked players last for the browser session (their ids are per room, so this is per tab). */
function loadBlocked(): number[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEYS.blocked) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x)) : [];
  } catch {
    return [];
  }
}
export function saveBlocked(ids: number[]): void {
  try {
    sessionStorage.setItem(KEYS.blocked, JSON.stringify(ids));
  } catch {
    /* storage blocked */
  }
}

export const gameStore = createStore<GameState>((set, get) => {
  const save = () => {
    const s = get();
    persist({ name: s.name, avatar: s.avatar, mapId: s.mapId, online: s.online, roomId: s.roomId, micOnJoin: s.micOnJoin, qualityMode: s.ui.qualityMode, fpsCap: s.ui.fpsCap });
  };
  return {
    phase: 'landing',
    name: initial.name,
    avatar: initial.avatar,
    mapId: initial.mapId,
    position: { x: 0, y: 0, facing: 0, yaw: 0 },
    ui: { hintOpen: true, muted: false, isTouch: detectTouch(), wardrobeOpen: false, dayNight: false, timeOfDay: 0, quality: initial.qualityMode === 'auto' ? (detectTouch() ? 'low' : 'med') : initial.qualityMode, qualityMode: initial.qualityMode, fpsCap: initial.fpsCap, settingsOpen: false, debug: false },
    nearby: null,
    dialog: null,
    online: initial.online,
    roomId: initial.roomId,
    micOnJoin: initial.micOnJoin,
    net: { status: 'offline', rtt: 0, players: [], selfId: -1 },
    chat: [],
    voice: {
      joined: false,
      joining: false,
      muted: false,
      deafened: false,
      ptt: false,
      micLive: false,
      mic: 'muted',
      soundBlocked: false,
      speaking: false,
      peers: [],
      inputs: [],
      outputs: [],
      canPickOutput: false,
      peerVolume: {},
      blocked: loadBlocked(),
      menu: null,
    },
    setVoice: (patch) => set((s) => ({ voice: { ...s.voice, ...patch } })),
    setName: (name) => set({ name: name.slice(0, 18) }),
    setAvatar: (patch) => {
      set((s) => ({ avatar: sanitizeAvatar({ ...s.avatar, ...patch }) }));
      save();
    },
    replaceAvatar: (avatar) => {
      set({ avatar: sanitizeAvatar(avatar) });
      save();
    },
    setMap: (id) => {
      if (!isMapId(id)) return;
      set({ mapId: id, nearby: null, dialog: null });
      save();
    },
    enterWorld: () => {
      const finalName = get().name.trim() || 'Beachgoer';
      set({ phase: 'playing', name: finalName, nearby: null, dialog: null });
      save();
    },
    leaveWorld: () => set({ phase: 'landing', nearby: null, dialog: null, chat: [], ui: { ...get().ui, wardrobeOpen: false } }),
    setPosition: (x, y, facing, yaw) => set({ position: { x, y, facing, yaw } }),
    setNearby: (nearby) => {
      if (get().nearby?.id === nearby?.id) return;
      set({ nearby });
    },
    openDialog: (dialog) => set({ dialog }),
    closeDialog: () => set({ dialog: null }),
    setUi: (patch) => {
      set((s) => ({ ui: { ...s.ui, ...patch } }));
      if (patch.qualityMode || patch.fpsCap) save();
    },
    setOnline: (online) => {
      set({ online });
      save();
    },
    setMicOnJoin: (micOnJoin) => {
      set({ micOnJoin });
      save();
    },
    setRoom: (room) => {
      const id = room
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '')
        .slice(0, 24);
      set({ roomId: id });
      save();
    },
    setNet: (patch) => set((s) => ({ net: { ...s.net, ...patch } })),
    addChat: (line) => set((s) => ({ chat: [...s.chat.slice(-49), { ...line, key: (s.chat[s.chat.length - 1]?.key ?? 0) + 1, at: Date.now() }] })),
  };
});
