import { createStore } from 'zustand/vanilla';
import type { AvatarConfig, DialogContent, NearbyInteraction } from '../types';
import { DEFAULT_AVATAR, sanitizeAvatar } from '@shoreline/shared';
import { DEFAULT_MAP, isMapId } from '@shoreline/shared';
import { QUALITY_ORDER, type Quality, type QualityMode } from '../game/config';


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
}

const STORAGE_KEY = 'shoreline.profile.v2';
const LEGACY_KEY = 'vinland.profile.v1';

interface Saved {
  name: string;
  avatar: AvatarConfig;
  mapId: string;
  qualityMode: QualityMode;
  fpsCap: 30 | 60;
}

const detectTouch = (): boolean => {
  try {
    return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  } catch {
    return false;
  }
};

function loadProfile(): Saved {
  const fallback: Saved = { name: '', avatar: { ...DEFAULT_AVATAR }, mapId: DEFAULT_MAP, qualityMode: 'auto', fpsCap: 60 };
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (!raw) return fallback;
    // older saves stored an automatic default under `quality` (there was no setting); they start on auto
    const p = JSON.parse(raw) as Partial<{ name: string; avatar: Record<string, unknown>; mapId: string; qualityMode: string; fpsCap: number }>;
    return {
      name: typeof p.name === 'string' ? p.name.slice(0, 18) : '',
      avatar: sanitizeAvatar(p.avatar as Partial<AvatarConfig>),
      mapId: isMapId(p.mapId) ? p.mapId : DEFAULT_MAP,
      qualityMode: p.qualityMode === 'auto' || QUALITY_ORDER.includes(p.qualityMode as Quality) ? (p.qualityMode as QualityMode) : 'auto',
      fpsCap: p.fpsCap === 30 ? 30 : 60,
    };
  } catch {
    return fallback;
  }
}

function persist(s: Pick<GameState, 'name' | 'avatar' | 'mapId'> & { qualityMode: QualityMode; fpsCap: 30 | 60 }): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ name: s.name, avatar: s.avatar, mapId: s.mapId, qualityMode: s.qualityMode, fpsCap: s.fpsCap }));
  } catch {
    /* storage unavailable */
  }
}

const initial = loadProfile();

export const gameStore = createStore<GameState>((set, get) => {
  const save = () => {
    const s = get();
    persist({ name: s.name, avatar: s.avatar, mapId: s.mapId, qualityMode: s.ui.qualityMode, fpsCap: s.ui.fpsCap });
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
    leaveWorld: () => set({ phase: 'landing', nearby: null, dialog: null, ui: { ...get().ui, wardrobeOpen: false } }),
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
  };
});
