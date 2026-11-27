import { useEffect } from 'react';
import { useGameStore } from '../store/useGameStore';
import { gameBridge } from '../store/bridge';

export function Dialog() {
  const dialog = useGameStore((s) => s.dialog);
  const close = useGameStore((s) => s.closeDialog);
  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key.toLowerCase() === 'e') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, close]);
  if (!dialog) return null;
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={close} role="dialog" aria-modal="true">
      <div className="glass max-w-md rounded-3xl border-4 border-moss p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-2 text-3xl font-extrabold text-pine">{dialog.title}</h2>
        <p className="whitespace-pre-line text-lg text-bark">{dialog.text}</p>
        <div className="mt-5 flex justify-end gap-2">
          {dialog.link && (
            <button className="rounded-xl bg-moss px-4 py-2 font-bold text-white" onClick={() => gameBridge.openLink(dialog.link!)}>
              Open link
            </button>
          )}
          <button autoFocus className="rounded-xl bg-bark px-5 py-2 font-bold text-white" onClick={close}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
