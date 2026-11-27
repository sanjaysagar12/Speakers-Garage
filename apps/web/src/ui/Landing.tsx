import { useEffect, useState } from 'react';
import { useGameStore } from '../store/useGameStore';
import { micPermission, primeVoice } from '../voice/prime';
import { AvatarCustomizer } from './AvatarCustomizer';
import { RoomPicker } from './RoomPicker';

export function Landing() {
  const name = useGameStore((s) => s.name);
  const setName = useGameStore((s) => s.setName);
  const enter = useGameStore((s) => s.enterWorld);
  const online = useGameStore((s) => s.online);
  const micOn = useGameStore((s) => s.micOnJoin);
  const setMicOn = useGameStore((s) => s.setMicOnJoin);
  // only reads the permission state (no prompt): the hint is shown when the browser will ask
  const [perm, setPerm] = useState('unknown');
  useEffect(() => {
    void micPermission().then(setPerm);
  }, []);
  const willAsk = online && micOn && perm !== 'granted' && perm !== 'denied';
  return (
    <div className="valley-bg relative h-full w-full overflow-y-auto">
      <div className="ridge drift pointer-events-none absolute inset-x-0 top-[22%] h-[150px] opacity-50" />
      <div className="ridge pointer-events-none absolute inset-x-0 top-[30%] h-[150px] opacity-25 [background-size:720px_150px]" />
      <div className="relative flex min-h-full items-center justify-center p-4">
        <form
          className="glass my-auto w-full max-w-3xl rounded-[2rem] p-6 shadow-2xl sm:p-8"
          onSubmit={(e) => {
            e.preventDefault();
            // inside the click: start audio and ask for the microphone now (the world loads meanwhile)
            primeVoice({ online, micOn });
            enter();
          }}
        >
          <h1 className="flex items-center justify-center gap-3 text-center font-display text-4xl font-extrabold tracking-tight text-pine drop-shadow-sm sm:text-6xl">
            <img src="/favicon.svg" alt="" width={56} height={56} className="h-11 w-11 sm:h-14 sm:w-14" />
            <span>
              Speaker&apos;s <span className="text-moss">Garage</span>
            </span>
          </h1>
          <p className="mb-5 text-center text-bark/80">Hang out in a shared world and talk to whoever is nearby.</p>
          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-semibold text-bark">Your name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              maxLength={18}
              autoFocus
              className="w-full rounded-2xl border-2 border-moss/50 bg-white px-4 py-2 text-lg text-bark outline-none focus:border-moss"
            />
          </label>
          <RoomPicker />
          <AvatarCustomizer />
          {online && (
            <label className="mt-5 flex items-center gap-2 text-sm font-semibold text-bark">
              <input type="checkbox" checked={micOn} onChange={(e) => setMicOn(e.target.checked)} className="h-4 w-4 accent-moss" />
              Join with microphone on
              <span className="font-normal text-bark/60">(press M to mute any time)</span>
            </label>
          )}
          <button
            type="submit"
            aria-describedby={willAsk ? 'mic-hint' : undefined}
            className="mt-3 w-full rounded-2xl bg-gradient-to-b from-[#6E9850] to-[#4F7A42] py-3 text-xl font-extrabold text-white shadow-lg transition hover:scale-[1.01] active:scale-95"
          >
            Enter the garage
          </button>
          {willAsk && (
            <p id="mic-hint" className="mt-2 text-center text-xs text-bark/70">
              🎙 Your browser will ask to use your microphone. You can say no and still listen.
            </p>
          )}
          {online && micOn && perm === 'denied' && (
            <p className="mt-2 text-center text-xs text-bark/70">The microphone is blocked for this site: you will join listen-only.</p>
          )}
        </form>
      </div>
    </div>
  );
}
