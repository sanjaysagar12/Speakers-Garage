import { memo, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { NET, type Emote } from '@speakersgarage/shared';
import { useGameStore } from '../store/useGameStore';
import { gameStore } from '../store/gameStore';
import { session } from '../game/net/session';
import { setLocalEmote } from '../game/net/emotes';

const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
};

const STATUS_TEXT: Record<string, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  online: 'Online',
  offline: 'Offline',
  full: 'Server full',
  version: 'Version mismatch',
  error: 'Disconnected',
};

/** Connection status + who is here (click to open the list). */
export const NetBadge = memo(function NetBadge() {
  const net = useGameStore(useShallow((s) => ({ status: s.net.status, message: s.net.message, rtt: s.net.rtt, room: s.net.room, count: s.net.players.length })));
  const players = useGameStore((s) => s.net.players);
  const [open, setOpen] = useState(false);
  const dot = net.status === 'online' ? 'bg-emerald-500' : net.status === 'connecting' || net.status === 'reconnecting' ? 'animate-pulse bg-amber-400' : 'bg-slate-400';
  return (
    <div className="relative">
      <button
        className="glass flex items-center gap-2 rounded-full px-3 py-2 text-sm font-bold text-pine shadow-lg"
        onClick={() => setOpen((o) => !o)}
        title={net.message ?? (net.status === 'online' ? `Room ${net.room} · ${Math.round(net.rtt)} ms` : STATUS_TEXT[net.status])}
        aria-label="Players and connection"
        aria-expanded={open}
      >
        <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
        {net.status === 'online' ? `${net.count} here` : STATUS_TEXT[net.status]}
      </button>
      {open && (
        <div className="glass absolute left-0 top-12 w-60 rounded-2xl p-3 text-sm text-bark shadow-xl">
          <div className="mb-2 font-bold text-pine">
            {net.status === 'online' ? `Room “${net.room}”` : STATUS_TEXT[net.status]}
            {net.status === 'online' && <span className="ml-2 font-normal text-bark/60">{Math.round(net.rtt)} ms</span>}
          </div>
          {net.message && <p className="mb-2 text-xs text-bark/70">{net.message}</p>}
          <ul className="max-h-60 space-y-1 overflow-y-auto">
            {players.map((p) => (
              <li
                key={p.id}
                className={`flex items-center gap-2 ${p.self ? '' : 'cursor-pointer rounded hover:bg-moss/10'}`}
                onClick={(e) => !p.self && gameStore.getState().setVoice({ menu: { id: p.id, x: e.clientX, y: e.clientY } })}
              >
                <span className={`h-2 w-2 rounded-full ${p.speaking ? 'bg-emerald-500' : p.voice ? 'bg-sky-400' : 'bg-transparent'}`} title={p.voice ? (p.muted ? 'In voice (muted)' : 'In voice') : ''} />
                <span className="truncate">{p.name}</span>
                {p.self && <span className="text-xs text-bark/50">(you)</span>}
                {p.voice && p.muted && <span title="Muted">🔇</span>}
              </li>
            ))}
            {players.length === 0 && <li className="text-bark/60">Just you.</li>}
          </ul>
        </div>
      )}
    </div>
  );
});

/** Recent messages + an input (T or the 💬 button to open, Enter to send, Esc to close). Online only. */
export const ChatPanel = memo(function ChatPanel() {
  const chat = useGameStore((s) => s.chat);
  const online = useGameStore((s) => s.net.status === 'online');
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [, tick] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (isTyping(e) || !online) return;
      if (e.key === 't' || e.key === 'T' || e.key === '/') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [online]);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  // fade old lines (re-render every 2 s while there is something to fade)
  useEffect(() => {
    if (!chat.length) return;
    const t = window.setInterval(() => tick((n) => n + 1), 2000);
    return () => window.clearInterval(t);
  }, [chat.length]);

  if (!online) return null;
  const now = Date.now();
  const lines = open ? chat.slice(-10) : chat.slice(-5).filter((l) => now - l.at < 15_000);
  const send = () => {
    const t = text.trim();
    if (t) session.adapter.sendChat?.(t.slice(0, NET.chatMaxLength));
    setText('');
    setOpen(false);
  };
  return (
    <div className="pointer-events-auto flex w-72 max-w-[70vw] flex-col gap-1">
      <ul className="space-y-1" aria-live="polite" aria-label="Chat">
        {lines.map((l) => (
          <li key={l.key} className="glass w-fit max-w-full break-words rounded-xl px-2 py-1 text-sm text-bark shadow" style={{ opacity: open ? 1 : Math.max(0.35, 1 - (now - l.at) / 15_000) }}>
            <b className="text-pine">{l.name}</b> {l.text}
          </li>
        ))}
      </ul>
      {open ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input
            ref={input}
            value={text}
            maxLength={NET.chatMaxLength}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
            onBlur={() => !text && setOpen(false)}
            placeholder="Say something (Enter to send)"
            aria-label="Chat message"
            className="w-full rounded-xl border-2 border-moss/50 bg-white/95 px-3 py-1.5 text-sm text-bark outline-none focus:border-moss"
          />
        </form>
      ) : (
        <button className="glass w-fit rounded-full px-3 py-1 text-sm font-bold text-pine shadow" onClick={() => setOpen(true)} aria-label="Open chat">
          💬 <span className="hidden sm:inline">Chat (T)</span>
        </button>
      )}
    </div>
  );
});

const EMOTE_BUTTONS: Array<[Emote, string, string]> = [
  ['wave', '👋', '1'],
  ['dance', '💃', '2'],
  ['sit', '🪑', '3'],
];

/** Wave / dance / sit (keys 1-3). Works offline too (others see it when online). */
export const EmoteBar = memo(function EmoteBar() {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (isTyping(e) || e.repeat) return;
      const hit = EMOTE_BUTTONS.find((b) => b[2] === e.key);
      if (hit) setLocalEmote(hit[0]);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  return (
    <div className="pointer-events-auto flex gap-1">
      {EMOTE_BUTTONS.map(([e, icon, k]) => (
        <button key={e} className="glass flex h-9 w-9 items-center justify-center rounded-full text-lg shadow" title={`${e} (${k})`} aria-label={e} onClick={() => setLocalEmote(e)}>
          {icon}
        </button>
      ))}
    </div>
  );
});
