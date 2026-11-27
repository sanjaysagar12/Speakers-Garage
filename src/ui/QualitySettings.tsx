import { useGameStore } from '../store/useGameStore';
import { QUALITY, QUALITY_ORDER, type QualityMode } from '../game/config';
import { cachedDetection, clearDetection } from '../game/perf/detect';

/** Quality and frame-cap settings (persisted). 'Auto' = detected tier + adaptive governor. */
export function QualitySettings() {
  const open = useGameStore((s) => s.ui.settingsOpen);
  const mode = useGameStore((s) => s.ui.qualityMode);
  const tier = useGameStore((s) => s.ui.quality);
  const cap = useGameStore((s) => s.ui.fpsCap);
  const setUi = useGameStore((s) => s.setUi);
  if (!open) return null;
  const det = cachedDetection();
  const opt = (on: boolean) => `rounded-full px-3 py-1 text-sm font-semibold transition ${on ? 'bg-bark text-white shadow' : 'bg-white/70 text-bark hover:bg-white'}`;
  return (
    <div className="glass pointer-events-auto absolute left-3 top-16 z-20 w-72 rounded-2xl p-4 text-sm text-bark shadow-xl">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-lg font-extrabold text-pine">Settings</div>
        <button className="text-bark/60" aria-label="Close settings" onClick={() => setUi({ settingsOpen: false })}>
          ✕
        </button>
      </div>
      <div className="mb-1 text-xs font-bold uppercase tracking-wide text-bark/70">Quality</div>
      <div className="flex flex-wrap gap-1">
        {(['auto', ...QUALITY_ORDER] as QualityMode[]).map((m) => (
          <button key={m} className={opt(mode === m)} onClick={() => setUi({ qualityMode: m, ...(m === 'auto' ? {} : { quality: m }) })}>
            {m === 'auto' ? 'Auto' : QUALITY[m].label}
          </button>
        ))}
      </div>
      <div className="mt-1 text-xs text-bark/70">
        Now: <b>{QUALITY[tier].label}</b>
        {mode === 'auto' && det ? ` (detected ${QUALITY[det.tier].label}; adapts to frame rate)` : ''}
      </div>
      {mode === 'auto' && det && (
        <button className="mt-1 text-xs text-bark/60 underline" onClick={() => clearDetection()}>
          re-test this device next time
        </button>
      )}
      <div className="mb-1 mt-3 text-xs font-bold uppercase tracking-wide text-bark/70">Frame rate</div>
      <div className="flex gap-1">
        {([60, 30] as const).map((c) => (
          <button key={c} className={opt(cap === c)} onClick={() => setUi({ fpsCap: c })}>
            {c === 60 ? '60 FPS' : '30 FPS (battery saver)'}
          </button>
        ))}
      </div>
    </div>
  );
}
