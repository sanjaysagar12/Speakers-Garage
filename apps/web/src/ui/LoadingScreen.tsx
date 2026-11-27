import { Brand } from './Brand';

/** Lightweight loading screen (no three.js): the brand, a label and a progress bar. */
export function LoadingScreen({ stage, progress }: { stage: string; progress: number }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#2E4A35] text-white" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="flex w-64 flex-col items-center gap-3">
        <Brand size={40} tone="light" className="mb-2" />
        <div className="text-lg font-bold">{stage}</div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-white/20">
          <div className="h-full rounded-full bg-white/85 transition-[width] duration-300" style={{ width: `${Math.round(Math.max(0.04, Math.min(1, progress)) * 100)}%` }} />
        </div>
      </div>
    </div>
  );
}
