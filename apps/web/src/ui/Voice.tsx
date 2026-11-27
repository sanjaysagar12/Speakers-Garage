import { memo, useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useGameStore } from '../store/useGameStore';
import { gameStore } from '../store/gameStore';
import { voice } from '../voice/voice';
import { remotes } from '../game/net/entities';

const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};

/**
 * Voice controls. Voice joins on its own when entering an online room (see voice.ts). A microphone
 * indicator is always shown (live / muted / unavailable), with mute (M), deafen, push-to-talk (hold V),
 * device choice and connection quality. Without a microphone: a non-blocking banner and "Retry microphone".
 */
export const VoicePanel = memo(function VoicePanel() {
  const online = useGameStore((s) => s.net.status === 'online');
  const v = useGameStore(
    useShallow((s) => ({
      joined: s.voice.joined,
      joining: s.voice.joining,
      muted: s.voice.muted,
      deafened: s.voice.deafened,
      ptt: s.voice.ptt,
      micLive: s.voice.micLive,
      mic: s.voice.mic,
      micError: s.voice.micError,
      soundBlocked: s.voice.soundBlocked,
      speaking: s.voice.speaking,
      error: s.voice.error,
      peers: s.voice.peers,
      inputs: s.voice.inputs,
      outputs: s.voice.outputs,
      canPickOutput: s.voice.canPickOutput,
    })),
  );
  const [open, setOpen] = useState(false);

  // M: mute, hold V: push-to-talk
  useEffect(() => {
    if (!v.joined) return;
    const down = (e: KeyboardEvent) => {
      if (isTyping(e) || e.repeat) return;
      if (e.key === 'm' || e.key === 'M') voice.toggleMute();
      if (e.key === 'v' || e.key === 'V') voice.setPttHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'v' || e.key === 'V') voice.setPttHeld(false);
    };
    const blur = () => voice.setPttHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [v.joined]);

  if (!online) return null;
  const btn = 'glass flex h-9 items-center gap-1 rounded-full px-3 text-sm font-bold text-pine shadow';
  if (!v.joined)
    return (
      <div className="pointer-events-auto flex flex-col items-start gap-1">
        <button className={btn} disabled={v.joining} onClick={() => void voice.join()} title="Talk to people near you">
          🎙 {v.joining ? 'Connecting voice…' : 'Join voice'}
        </button>
        {v.error && <p className="glass max-w-xs rounded-xl px-2 py-1 text-xs text-red-700" role="alert">{v.error}</p>}
      </div>
    );
  const poor = v.peers.some((p) => p.quality === 'poor');
  return (
    <div className="pointer-events-auto flex flex-col items-start gap-1">
      <div className="flex flex-wrap items-center gap-1">
        {/* the microphone indicator: always visible; red while the microphone sends */}
        <span
          className={`flex h-9 items-center gap-1 rounded-full px-3 text-sm font-bold shadow ${v.mic === 'live' ? 'bg-red-600 text-white' : v.mic === 'unavailable' ? 'glass text-amber-800' : 'glass text-bark/70'}`}
          role="status"
          aria-live="polite"
          data-mic={v.mic}
        >
          <span className={`h-2.5 w-2.5 rounded-full ${v.mic === 'live' ? (v.speaking ? 'animate-pulse bg-white' : 'bg-white/70') : v.mic === 'unavailable' ? 'bg-amber-600' : 'bg-bark/40'}`} />
          {v.mic === 'live' ? 'Mic live' : v.mic === 'unavailable' ? 'No mic · listening' : v.ptt ? 'Hold V to talk' : 'Muted'}
        </span>
        {v.mic !== 'unavailable' && (
          <button className={btn} onClick={() => voice.toggleMute()} aria-pressed={v.muted} title="Mute (M)">
            {v.muted ? '🔇 Unmute' : '🎙 Mute'} <kbd className="rounded bg-bark/10 px-1 text-[10px]">M</kbd>
          </button>
        )}
        <button className={btn} onClick={() => voice.toggleDeafen()} aria-pressed={v.deafened} title="Deafen: hear nobody (also mutes you)">
          {v.deafened ? '🔈 Undeafen' : '🎧 Deafen'}
        </button>
        <button className={btn} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Voice settings">
          ⋯
        </button>
        <span className="glass rounded-full px-2 py-1 text-xs text-bark" title="Voice connections (people within earshot)">
          {v.peers.length} nearby{poor ? ' · poor connection' : ''}
        </span>
      </div>
      {v.mic === 'unavailable' && (
        <div className="glass flex max-w-sm items-center gap-2 rounded-2xl px-3 py-2 text-xs text-bark shadow" role="alert" data-testid="mic-banner">
          <span className="flex-1">{v.micError ?? 'No microphone.'}</span>
          <button className="shrink-0 rounded-full bg-moss px-3 py-1 font-bold text-white" onClick={() => void voice.retryMic()}>
            Retry microphone
          </button>
        </div>
      )}
      {v.soundBlocked && (
        <button className="glass rounded-full px-3 py-1.5 text-sm font-bold text-pine shadow" onClick={() => void voice.unlockSound()} data-testid="enable-sound">
          🔈 Click to enable sound
        </button>
      )}
      {open && (
        <div className="glass w-72 space-y-2 rounded-2xl p-3 text-sm text-bark shadow-xl">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={v.ptt} onChange={(e) => voice.setPushToTalk(e.target.checked)} />
            Push to talk (hold <kbd className="rounded bg-bark/10 px-1">V</kbd>)
          </label>
          {v.inputs.length > 0 && (
            <label className="block">
              <span className="text-xs text-bark/70">Microphone</span>
              <select className="mt-0.5 w-full rounded-lg border border-moss/40 bg-white px-2 py-1" onChange={(e) => void voice.setInput(e.target.value)}>
                {v.inputs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {v.canPickOutput && v.outputs.length > 0 && (
            <label className="block">
              <span className="text-xs text-bark/70">Speaker</span>
              <select className="mt-0.5 w-full rounded-lg border border-moss/40 bg-white px-2 py-1" onChange={(e) => void voice.setOutput(e.target.value)}>
                {v.outputs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <ul className="space-y-0.5 text-xs">
            {v.peers.map((p) => (
              <li key={p.id} className="flex justify-between">
                <span>{remotes.roster.get(p.id)?.name ?? `#${p.id}`}</span>
                <span className={p.quality === 'poor' ? 'text-red-700' : p.quality === 'good' ? 'text-emerald-700' : 'text-bark/50'}>{p.quality}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-bark/60">Audio goes directly between players near you. Nothing is recorded or sent to the server.</p>
          <button className="w-full rounded-xl bg-bark/10 py-1 font-bold" onClick={() => voice.leave()}>
            Leave voice
          </button>
          {v.error && <p className="text-xs text-red-700">{v.error}</p>}
        </div>
      )}
    </div>
  );
});

/** Right-click (or click in the player list) on a player: volume, mute, block. */
export const PlayerMenu = memo(function PlayerMenu() {
  const menu = useGameStore((s) => s.voice.menu);
  const pv = useGameStore((s) => (menu ? s.voice.peerVolume[menu.id] : undefined));
  const blocked = useGameStore((s) => (menu ? s.voice.blocked.includes(menu.id) : false));
  useEffect(() => {
    if (!menu) return;
    const close = (e: KeyboardEvent) => e.key === 'Escape' && gameStore.getState().setVoice({ menu: null });
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [menu]);
  if (!menu) return null;
  const info = remotes.roster.get(menu.id);
  if (!info) return null;
  const volume = pv?.volume ?? 1;
  const muted = pv?.muted ?? false;
  return (
    <div className="pointer-events-auto fixed inset-0 z-30" onClick={() => gameStore.getState().setVoice({ menu: null })} onContextMenu={(e) => e.preventDefault()}>
      <div
        className="glass absolute w-56 rounded-2xl p-3 text-sm text-bark shadow-xl"
        style={{ left: Math.min(menu.x, window.innerWidth - 240), top: Math.min(menu.y, window.innerHeight - 200) }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Player ${info.name}`}
      >
        <div className="mb-2 font-bold text-pine">{info.name}</div>
        <label className="mb-2 block">
          <span className="text-xs text-bark/70">Volume {Math.round(volume * 100)}%</span>
          <input type="range" min={0} max={2} step={0.05} value={volume} onChange={(e) => voice.setPeerVolume(menu.id, Number(e.target.value), muted)} className="w-full" />
        </label>
        <div className="flex gap-2">
          <button className="flex-1 rounded-xl bg-bark/10 py-1 font-bold" onClick={() => voice.setPeerVolume(menu.id, volume, !muted)}>
            {muted ? 'Unmute' : 'Mute'}
          </button>
          <button className={`flex-1 rounded-xl py-1 font-bold ${blocked ? 'bg-bark/10' : 'bg-red-600 text-white'}`} onClick={() => voice.setBlocked(menu.id, !blocked)}>
            {blocked ? 'Unblock' : 'Block'}
          </button>
        </div>
        <p className="mt-2 text-xs text-bark/60">Block hides their chat and voice for this session.</p>
      </div>
    </div>
  );
});
