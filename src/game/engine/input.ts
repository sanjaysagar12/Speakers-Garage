import { inputState } from '../../store/input';

/**
 * Keyboard + pointer input for the world canvas. Writes into plain fields that the frame loop reads;
 * nothing here triggers React renders.
 *  - WASD / arrows move (camera-relative), Shift runs
 *  - left click / tap: walk there
 *  - right-drag or Q/E: rotate the camera, R resets
 *  - wheel / pinch: zoom, two-finger twist: rotate
 *  - F / Space / Enter: interact
 */
export class InputController {
  private readonly keys = new Set<string>();
  /** accumulated camera yaw delta (radians) since last read */
  yawDelta = 0;
  /** multiplicative zoom since last read */
  zoom = 1;
  /** pending click in client px */
  click: { x: number; y: number } | null = null;
  private readonly queue: Array<'interact' | 'reset' | 'debug'> = [];
  private readonly pointers = new Map<number, { x: number; y: number; sx: number; sy: number; t: number; button: number }>();
  private pinch: { d: number; a: number } | null = null;
  private dragX: number | null = null;
  private readonly cleanups: Array<() => void> = [];

  constructor(el: HTMLElement) {
    const on = <K extends keyof WindowEventMap>(t: EventTarget, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, opts);
      this.cleanups.push(() => t.removeEventListener(type, fn as EventListener, opts));
    };
    const typing = (e: Event) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    };
    on(window, 'keydown', (e) => {
      if (typing(e)) return;
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'f3'].includes(k)) e.preventDefault();
      if (!e.repeat) {
        if (k === 'f' || k === ' ' || k === 'enter') this.queue.push('interact');
        if (k === 'r' || k === 'home') this.queue.push('reset');
        if (k === 'f3' && import.meta.env.DEV) this.queue.push('debug');
      }
      this.keys.add(k);
    });
    on(window, 'keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    on(window, 'blur', () => this.keys.clear());
    on(el, 'contextmenu', (e) => e.preventDefault());
    on(el, 'wheel', (e) => {
      e.preventDefault();
      this.zoom *= Math.exp(e.deltaY * 0.0012);
    }, { passive: false });
    on(el, 'pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), button: e.button });
      if (e.button === 2) this.dragX = e.clientX;
      if (this.pointers.size === 2) this.pinch = this.twoFinger();
    });
    on(el, 'pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.dragX !== null && p.button === 2) {
        this.yawDelta -= (e.clientX - this.dragX) * 0.006;
        this.dragX = e.clientX;
      }
      if (this.pointers.size === 2 && this.pinch) {
        const now = this.twoFinger();
        this.zoom *= this.pinch.d / Math.max(1, now.d);
        let da = now.a - this.pinch.a;
        if (da > Math.PI) da -= Math.PI * 2;
        if (da < -Math.PI) da += Math.PI * 2;
        this.yawDelta -= da;
        this.pinch = now;
      }
    });
    const end = (e: PointerEvent) => {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (p?.button === 2) this.dragX = null;
      if (!p || e.type === 'pointercancel') return;
      const moved = Math.hypot(e.clientX - p.sx, e.clientY - p.sy);
      if (p.button === 0 && moved < 8 && performance.now() - p.t < 450 && this.pointers.size === 0) this.click = { x: e.clientX, y: e.clientY };
    };
    on(el, 'pointerup', end);
    on(el, 'pointercancel', end);
  }

  private twoFinger(): { d: number; a: number } {
    const [a, b] = [...this.pointers.values()];
    return { d: Math.hypot(b.x - a.x, b.y - a.y), a: Math.atan2(b.y - a.y, b.x - a.x) };
  }

  private down(...k: string[]): boolean {
    return k.some((x) => this.keys.has(x));
  }

  /** x = right, y = forward (both -1..1), run flag. Keyboard and joystick combined. */
  move(): { x: number; y: number; run: boolean } {
    let x = (this.down('d', 'arrowright') ? 1 : 0) - (this.down('a', 'arrowleft') ? 1 : 0);
    let y = (this.down('w', 'arrowup') ? 1 : 0) - (this.down('s', 'arrowdown') ? 1 : 0);
    let run = this.down('shift');
    if (inputState.joyActive) {
      x = inputState.joyX;
      y = -inputState.joyY;
      run = inputState.joyRun;
    }
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    return { x, y, run };
  }

  /** camera keys: -1 (Q, turn left), +1 (E, turn right) */
  yawKeys(): number {
    return (this.down('e') ? 1 : 0) - (this.down('q') ? 1 : 0);
  }

  take(): Array<'interact' | 'reset' | 'debug'> {
    return this.queue.splice(0);
  }

  dispose(): void {
    this.cleanups.forEach((c) => c());
    this.keys.clear();
  }
}
