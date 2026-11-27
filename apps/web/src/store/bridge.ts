import { gameStore } from './gameStore';
import { inputState } from './input';
import type { AvatarConfig, DialogContent, NearbyInteraction, PlayerProfile } from '../types';

type Unsub = () => void;

/**
 * Typed bridge between React UI and the 3D world. World code (src/game/engine) talks to this object for
 * anything UI-facing; UI components use the zustand hook plus the request* methods.
 */
export interface GameBridge {
  getProfile(): PlayerProfile;
  /** world -> UI */
  publishPosition(x: number, z: number, facing: number, yaw: number): void;
  publishTimeOfDay(t: number): void;
  setNearby(n: NearbyInteraction | null): void;
  openDialog(d: DialogContent): void;
  openLink(url: string): void;
  /** UI -> world */
  requestInteract(): void;
  onInteract(cb: () => void): Unsub;
  requestZoom(factor: number): void;
  onZoom(cb: (factor: number) => void): Unsub;
  requestCameraReset(): void;
  onCameraReset(cb: () => void): Unsub;
  isMuted(): boolean;
  onMuteChange(cb: (muted: boolean) => void): Unsub;
  onAvatarChange(cb: (a: AvatarConfig) => void): Unsub;
  input: typeof inputState;
}

function emitter<T extends unknown[]>() {
  const ls = new Set<(...a: T) => void>();
  return {
    emit: (...a: T) => ls.forEach((cb) => cb(...a)),
    on: (cb: (...a: T) => void): Unsub => {
      ls.add(cb);
      return () => ls.delete(cb);
    },
  };
}
const interact = emitter<[]>();
const zoom = emitter<[number]>();
const reset = emitter<[]>();

/** Subscribe to one slice of the store, firing only when it actually changes. */
function watch<T>(select: (s: ReturnType<typeof gameStore.getState>) => T, cb: (v: T) => void): Unsub {
  let prev = select(gameStore.getState());
  return gameStore.subscribe((s) => {
    const next = select(s);
    if (next !== prev) {
      prev = next;
      cb(next);
    }
  });
}

export const gameBridge: GameBridge = {
  getProfile: () => {
    const s = gameStore.getState();
    return { id: 'local', name: s.name, avatar: s.avatar };
  },
  publishPosition: (x, z, facing, yaw) => gameStore.getState().setPosition(x, z, facing, yaw),
  publishTimeOfDay: (t) => {
    const ui = gameStore.getState().ui;
    if (Math.abs(ui.timeOfDay - t) > 0.004) gameStore.getState().setUi({ timeOfDay: t });
  },
  setNearby: (n) => gameStore.getState().setNearby(n),
  openDialog: (d) => gameStore.getState().openDialog(d),
  openLink: (url) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  },
  requestInteract: () => interact.emit(),
  onInteract: interact.on,
  requestZoom: (f) => zoom.emit(f),
  onZoom: zoom.on,
  requestCameraReset: () => reset.emit(),
  onCameraReset: reset.on,
  isMuted: () => gameStore.getState().ui.muted,
  onMuteChange: (cb) => watch((s) => s.ui.muted, cb),
  onAvatarChange: (cb) => watch((s) => s.avatar, cb),
  input: inputState,
};
