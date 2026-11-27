import { useEffect, useState } from 'react';
import { useGameStore } from '../store/useGameStore';
import { AvatarPreview } from './AvatarPreview';
import { AVATAR_SLOTS, CLOTH_COLOURS, HAIR_COLOURS, SKIN_TONES, SLOT_FIELDS } from '../game/models/character/catalog';
import { renderThumb } from '../game/models/character/thumbs';
import type { AvatarConfig, Slot } from '../types';

const SLOTS: Array<{ id: Slot; label: string; icon: string }> = [
  { id: 'hair', label: 'Hair', icon: '💇' },
  { id: 'top', label: 'Top', icon: '👕' },
  { id: 'bottom', label: 'Legs', icon: '🩳' },
  { id: 'shoes', label: 'Feet', icon: '🩴' },
  { id: 'hat', label: 'Hat', icon: '👒' },
  { id: 'accessory', label: 'Extra', icon: '🕶️' },
];

function OptionThumb({ cfg, slot, optionId, selected, onPick, label }: {
  cfg: AvatarConfig;
  slot: Slot;
  optionId: string;
  selected: boolean;
  onPick: () => void;
  label: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    // debounce so dragging the colour picker does not queue dozens of renders
    const t = window.setTimeout(() => {
      void renderThumb(cfg, slot, optionId)
        .then((u) => !dead && setSrc(u))
        .catch(() => undefined);
    }, 120);
    return () => {
      dead = true;
      window.clearTimeout(t);
    };
  }, [cfg, slot, optionId]);
  return (
    <button
      type="button"
      onClick={onPick}
      title={label}
      aria-label={label}
      aria-pressed={selected}
      className={`relative flex h-[76px] w-[62px] shrink-0 items-end justify-center overflow-hidden rounded-xl border-2 transition ${
        selected ? 'border-moss bg-moss/15 ring-2 ring-moss/40' : 'border-black/10 bg-white/60 hover:border-moss/50'
      }`}
    >
      {src ? <img src={src} alt="" className="absolute inset-0 h-full w-full object-contain" draggable={false} /> : <span className="mb-6 text-xs text-bark/40">…</span>}
    </button>
  );
}

function Swatches({ colours, value, onPick }: { colours: string[]; value: string; onPick: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {colours.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Colour ${c}`}
          onClick={() => onPick(c)}
          className={`h-7 w-7 rounded-full border-2 transition ${
            value.toLowerCase() === c.toLowerCase() ? 'scale-110 border-bark ring-2 ring-white' : 'border-white/70 hover:scale-105'
          }`}
          style={{ background: c }}
        />
      ))}
      <label className="relative flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-2 border-dashed border-bark/50 text-[10px] font-bold text-bark">
        <span aria-hidden>＋</span>
        <input type="color" value={value} onChange={(e) => onPick(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Custom colour" />
      </label>
    </div>
  );
}

const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

export function AvatarCustomizer({ compact = false }: { compact?: boolean }) {
  const avatar = useGameStore((s) => s.avatar);
  const setAvatar = useGameStore((s) => s.setAvatar);
  const replaceAvatar = useGameStore((s) => s.replaceAvatar);
  const [slot, setSlot] = useState<Slot>('hair');
  const [yaw, setYaw] = useState(0.5);

  const field = SLOT_FIELDS[slot];
  const options = AVATAR_SLOTS[slot];
  const currentId = String(avatar[field.id]);
  const currentColour = String(avatar[field.colour]);
  const palette = slot === 'hair' ? HAIR_COLOURS : CLOTH_COLOURS;

  const randomize = () => {
    replaceAvatar({
      skin: pick(SKIN_TONES),
      hairStyle: pick(AVATAR_SLOTS.hair).id,
      hairColor: pick(HAIR_COLOURS),
      topId: pick(AVATAR_SLOTS.top).id,
      topColor: pick(CLOTH_COLOURS),
      bottomId: pick(AVATAR_SLOTS.bottom).id,
      bottomColor: pick(CLOTH_COLOURS),
      shoesId: pick(AVATAR_SLOTS.shoes).id,
      shoesColor: pick(CLOTH_COLOURS),
      hatId: Math.random() < 0.6 ? 'none' : pick(AVATAR_SLOTS.hat).id,
      hatColor: pick(CLOTH_COLOURS),
      accessoryId: Math.random() < 0.5 ? 'none' : pick(AVATAR_SLOTS.accessory).id,
      accessoryColor: pick(CLOTH_COLOURS),
    });
  };

  return (
    <div className={`flex flex-col gap-4 ${compact ? '' : 'sm:flex-row'}`}>
      <div className="flex shrink-0 flex-col items-center gap-2">
        <div className="rounded-3xl bg-gradient-to-b from-[#bfeee9] to-[#74DCD4] p-2 shadow-inner">
          <AvatarPreview avatar={avatar} yaw={yaw} />
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setYaw((y) => y + Math.PI / 2)} className="rounded-full bg-white/80 px-3 py-1 text-sm font-semibold text-bark shadow hover:bg-white">
            ⟳ Turn
          </button>
          <button type="button" onClick={randomize} className="rounded-full bg-white/80 px-3 py-1 text-sm font-semibold text-bark shadow hover:bg-white">
            🎲 Random
          </button>
        </div>
        <div className="text-[11px] text-bark/60">drag to look around</div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div>
          <div className="mb-1 text-xs font-bold uppercase tracking-wide text-bark/70">Skin</div>
          <Swatches colours={SKIN_TONES} value={avatar.skin} onPick={(c) => setAvatar({ skin: c })} />
        </div>
        <div className="flex flex-wrap gap-1">
          {SLOTS.map((s) => (
            <button
              key={s.id}
              type="button"
              title={s.label}
              onClick={() => setSlot(s.id)}
              className={`rounded-full px-3 py-1 text-sm font-semibold transition ${slot === s.id ? 'bg-bark text-white shadow' : 'bg-white/70 text-bark hover:bg-white'}`}
            >
              <span aria-hidden className="mr-1">{s.icon}</span>
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {options.map((o) => (
            <OptionThumb
              key={o.id}
              cfg={avatar}
              slot={slot}
              optionId={o.id}
              label={o.label}
              selected={currentId === o.id}
              onPick={() => setAvatar({ [field.id]: o.id } as Partial<AvatarConfig>)}
            />
          ))}
        </div>
        <div className="text-xs font-semibold text-bark/70">{options.find((o) => o.id === currentId)?.label ?? ''}</div>
        <Swatches colours={palette} value={currentColour} onPick={(c) => setAvatar({ [field.colour]: c } as Partial<AvatarConfig>)} />
      </div>
    </div>
  );
}
