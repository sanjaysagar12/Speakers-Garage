import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useGameStore } from '../../store/useGameStore';

/**
 * Render-loop policy: stops rendering while the tab is hidden, and implements the optional 30 FPS cap
 * (battery saving) by driving R3F manually at half rate.
 */
export function FrameDriver() {
  const cap = useGameStore((s) => s.ui.fpsCap);
  const setFrameloop = useThree((s) => s.setFrameloop);
  const advance = useThree((s) => s.advance);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const interval = 1000 / 30 - 1;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last >= interval) {
        last = t;
        advance(t);
      }
    };
    const apply = () => {
      cancelAnimationFrame(raf);
      if (document.hidden) {
        setFrameloop('never');
      } else if (cap === 30) {
        setFrameloop('never');
        raf = requestAnimationFrame(loop);
      } else setFrameloop('always');
    };
    apply();
    document.addEventListener('visibilitychange', apply);
    return () => {
      document.removeEventListener('visibilitychange', apply);
      cancelAnimationFrame(raf);
      setFrameloop('always');
    };
  }, [cap, setFrameloop, advance]);
  return null;
}
