import { useGameStore } from '../store/useGameStore';
import { AvatarCustomizer } from './AvatarCustomizer';

export function Landing() {
  const name = useGameStore((s) => s.name);
  const setName = useGameStore((s) => s.setName);
  const enter = useGameStore((s) => s.enterWorld);
  return (
    <div className="valley-bg relative h-full w-full overflow-y-auto">
      <div className="ridge drift pointer-events-none absolute inset-x-0 top-[22%] h-[150px] opacity-50" />
      <div className="ridge pointer-events-none absolute inset-x-0 top-[30%] h-[150px] opacity-25 [background-size:720px_150px]" />
      <div className="relative flex min-h-full items-center justify-center p-4">
        <form
          className="glass my-auto w-full max-w-3xl rounded-[2rem] p-6 shadow-2xl sm:p-8"
          onSubmit={(e) => {
            e.preventDefault();
            enter();
          }}
        >
          <h1 className="text-center font-display text-5xl font-extrabold tracking-tight text-pine drop-shadow-sm sm:text-6xl">
            Vin<span className="text-moss">land</span>
          </h1>
          <p className="mb-5 text-center text-bark/80">A green valley, a lake, and a farm being built into the land.</p>
          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-semibold text-bark">Your name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Wanderer"
              maxLength={18}
              autoFocus
              className="w-full rounded-2xl border-2 border-moss/50 bg-white px-4 py-2 text-lg text-bark outline-none focus:border-moss"
            />
          </label>
          <AvatarCustomizer />
          <button
            type="submit"
            className="mt-6 w-full rounded-2xl bg-gradient-to-b from-[#6E9850] to-[#4F7A42] py-3 text-xl font-extrabold text-white shadow-lg transition hover:scale-[1.01] active:scale-95"
          >
            Enter the valley
          </button>
        </form>
      </div>
    </div>
  );
}
