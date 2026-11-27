import { useShallow } from 'zustand/react/shallow';
import { useGameStore } from '../store/useGameStore';
import { gameBridge } from '../store/bridge';
import { Minimap } from './Minimap';
import { Joystick } from './Joystick';
import { Dialog } from './Dialog';
import { Wardrobe } from './Wardrobe';
import { QualitySettings } from './QualitySettings';
import { Suspense, lazy } from 'react';
import { ChatPanel, EmoteBar, NetBadge } from './Social';

const clockLabel = (t: number): string => {
  const hours = (t * 24 + 6) % 24; // phase 0 is midnight-ish; shift so 0.3 reads as late morning
  const h = Math.floor(hours);
  const m = Math.floor((hours - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

/** F2 stats overlay: dev builds only */
const StatsOverlay = import.meta.env.DEV ? lazy(() => import('./StatsOverlay').then((m) => ({ default: m.StatsOverlay }))) : null;
/** F3 panel: dev builds only */
const DebugPanel = import.meta.env.DEV ? lazy(() => import('./DebugPanel').then((m) => ({ default: m.DebugPanel }))) : null;

export function Hud() {
  const name = useGameStore((s) => s.name);
  // only the fields the HUD shows (shallow compare): no re-render for unrelated ui changes
  const ui = useGameStore(
    useShallow((s) => ({
      muted: s.ui.muted,
      dayNight: s.ui.dayNight,
      timeOfDay: s.ui.dayNight ? s.ui.timeOfDay : 0,
      hintOpen: s.ui.hintOpen,
      isTouch: s.ui.isTouch,
      settingsOpen: s.ui.settingsOpen,
      debug: s.ui.debug,
    })),
  );
  const setUi = useGameStore((s) => s.setUi);
  const nearby = useGameStore((s) => s.nearby);
  const leave = useGameStore((s) => s.leaveWorld);
  const btn = 'glass flex h-11 w-11 items-center justify-center rounded-full text-xl shadow-lg transition active:scale-95';

  return (
    <div className="pointer-events-none absolute inset-0 z-10 font-display">
      <div className="pointer-events-auto absolute left-3 top-3 flex flex-wrap items-center gap-2">
        <div className="glass rounded-full px-4 py-2 text-lg font-bold text-pine shadow-lg">🌲 {name}</div>
        <NetBadge />
        <button className={btn} aria-label="Wardrobe" title="Wardrobe" onClick={() => setUi({ wardrobeOpen: true })}>
          👕
        </button>
        <button className={btn} aria-label={ui.muted ? 'Unmute' : 'Mute'} title="Sound" onClick={() => setUi({ muted: !ui.muted })}>
          {ui.muted ? '🔇' : '🔊'}
        </button>
        <button
          className={btn}
          aria-label="Toggle day and night"
          title={ui.dayNight ? `Day/night on — ${clockLabel(ui.timeOfDay)}` : 'Day/night off'}
          onClick={() => setUi({ dayNight: !ui.dayNight })}
        >
          {ui.dayNight ? (ui.timeOfDay > 0.84 || ui.timeOfDay < 0.17 ? '🌙' : '🌤') : '☀️'}
        </button>
        <button className={btn} aria-label="Settings" title="Quality and frame rate" onClick={() => setUi({ settingsOpen: !ui.settingsOpen })}>
          ⚙️
        </button>
        <button className={btn} aria-label="Leave world" title="Back to start" onClick={leave}>
          ⏏
        </button>
        {ui.dayNight && <div className="glass rounded-full px-3 py-1 text-sm font-bold text-pine shadow">{clockLabel(ui.timeOfDay)}</div>}
      </div>

      <div className="pointer-events-auto absolute right-3 top-3 rounded-2xl border-4 border-[#c8b48a] bg-white/70 p-1 shadow-xl backdrop-blur">
        <Minimap />
      </div>

      {ui.hintOpen && !ui.isTouch && (
        <div className="glass pointer-events-auto absolute bottom-3 right-3 max-w-xs rounded-2xl p-3 text-sm text-bark shadow-lg">
          <button className="absolute right-2 top-1 text-bark/50" aria-label="Dismiss hint" onClick={() => setUi({ hintOpen: false })}>
            ✕
          </button>
          <div className="mb-1 font-bold text-pine">Controls</div>
          <ul className="space-y-0.5">
            <li><b>WASD / arrows</b> move, <b>Shift</b> run</li>
            <li><b>Click</b> to walk there</li>
            <li><b>E</b> at a ✦ to look closer</li>
            <li><b>Scroll</b> to zoom</li>
            <li><b>T</b> chat, <b>1 2 3</b> wave / dance / sit</li>
          </ul>
        </div>
      )}
      {ui.hintOpen && ui.isTouch && (
        <div className="glass pointer-events-auto absolute right-3 top-[9.5rem] max-w-[11rem] rounded-2xl p-2 text-xs text-bark shadow-lg">
          <button className="absolute right-2 top-0.5 text-bark/50" aria-label="Dismiss hint" onClick={() => setUi({ hintOpen: false })}>✕</button>
          Drag the stick, tap the ground to walk, pinch to zoom.
        </div>
      )}

      <div className={`absolute left-3 flex flex-col gap-2 ${ui.isTouch ? 'top-16' : 'bottom-3'}`}>
        <ChatPanel />
        <EmoteBar />
      </div>

      {nearby && (
        <div className="pointer-events-auto absolute bottom-6 left-1/2 -translate-x-1/2">
          <button
            onClick={() => gameBridge.requestInteract()}
            className="flex items-center gap-2 rounded-full bg-gradient-to-b from-[#c8b45e] to-[#a8903c] px-5 py-2 text-lg font-extrabold text-white shadow-xl active:scale-95"
          >
            {!ui.isTouch && <kbd className="rounded bg-white/30 px-2">E</kbd>} {nearby.title}
          </button>
        </div>
      )}

      {ui.isTouch && (
        <div className="pointer-events-auto">
          <Joystick />
          <button
            aria-label="Interact"
            onClick={() => gameBridge.requestInteract()}
            className={`absolute bottom-10 right-8 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-b from-[#c8b45e] to-[#a8903c] text-3xl font-black text-white shadow-xl transition ${
              nearby ? 'scale-100 opacity-100' : 'scale-90 opacity-40'
            }`}
          >
            E
          </button>
          <div className="absolute bottom-40 right-4 flex flex-col gap-2">
            <button className={btn} aria-label="Zoom in" onClick={() => gameBridge.requestZoom(1.2)}>＋</button>
            <button className={btn} aria-label="Zoom out" onClick={() => gameBridge.requestZoom(1 / 1.2)}>－</button>
          </div>
        </div>
      )}
      {DebugPanel && ui.debug && (
        <Suspense fallback={null}>
          <DebugPanel />
        </Suspense>
      )}
      <QualitySettings />
      {StatsOverlay && (
        <Suspense fallback={null}>
          <StatsOverlay />
        </Suspense>
      )}
      <div className="pointer-events-auto">
        <Dialog />
        <Wardrobe />
      </div>
    </div>
  );
}
