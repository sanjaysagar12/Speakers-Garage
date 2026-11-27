import { useEffect } from 'react';
import { useGameStore } from '../store/useGameStore';
import { AvatarCustomizer } from './AvatarCustomizer';

/** The same customizer as the landing page, reachable in-game. Changes apply instantly. */
export function Wardrobe() {
  const open = useGameStore((s) => s.ui.wardrobeOpen);
  const setUi = useGameStore((s) => s.setUi);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setUi({ wardrobeOpen: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setUi]);
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/35 p-3" onClick={() => setUi({ wardrobeOpen: false })}>
      <div
        className="glass max-h-full w-full max-w-2xl overflow-y-auto rounded-3xl border-4 border-moss p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Wardrobe"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-2xl font-extrabold text-pine">Wardrobe</h2>
          <button className="rounded-full bg-white/80 px-3 py-1 font-bold text-bark" onClick={() => setUi({ wardrobeOpen: false })}>
            Done
          </button>
        </div>
        <AvatarCustomizer compact />
      </div>
    </div>
  );
}
