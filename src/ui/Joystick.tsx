import { useRef } from 'react';
import { inputState } from '../store/input';

const R = 56;

/** Virtual joystick. Writes to the hot `inputState` object (no React renders while dragging). */
export function Joystick() {
  const knob = useRef<HTMLDivElement>(null);
  const id = useRef<number | null>(null);
  const base = useRef<HTMLDivElement>(null);

  const apply = (e: React.PointerEvent) => {
    const r = base.current!.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy);
    if (d > R) {
      dx = (dx / d) * R;
      dy = (dy / d) * R;
    }
    knob.current!.style.transform = `translate(${dx}px, ${dy}px)`;
    const m = Math.min(1, d / R);
    const active = m >= 0.15;
    inputState.joyX = active ? dx / R : 0;
    inputState.joyY = active ? dy / R : 0;
    inputState.joyActive = active;
    inputState.joyRun = m > 0.92;
  };
  const end = () => {
    id.current = null;
    knob.current!.style.transform = 'translate(0,0)';
    inputState.joyX = inputState.joyY = 0;
    inputState.joyActive = inputState.joyRun = false;
  };

  return (
    <div
      ref={base}
      className="absolute bottom-8 left-6 h-32 w-32 touch-none select-none"
      onPointerDown={(e) => {
        id.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        apply(e);
      }}
      onPointerMove={(e) => id.current === e.pointerId && apply(e)}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div className="pointer-events-none h-full w-full rounded-full border-4 border-white/70 bg-black/15 shadow-inner" />
      <div ref={knob} className="pointer-events-none absolute left-1/2 top-1/2 -ml-7 -mt-7 h-14 w-14 rounded-full border-2 border-white bg-white/80 shadow-lg" />
    </div>
  );
}
