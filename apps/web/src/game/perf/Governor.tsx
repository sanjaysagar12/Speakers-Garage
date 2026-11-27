import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { GOVERNOR, QUALITY, QUALITY_ORDER } from '../config';
import { gameStore } from '../../store/gameStore';
import { devLog } from '../../util/devlog';

/** Live numbers for the F2 stats overlay (dev) and the perf script. */
export const governorStats = { fps: 0, dpr: 1, tier: '', flips: 0 };

/**
 * Adaptive quality governor. Measures FPS over a sliding second:
 *  - below GOVERNOR.down for downSeconds: lower DPR by 20% (down to the tier's minimum), then drop one tier
 *  - above GOVERNOR.up for upSeconds: raise DPR, then (auto mode only) climb at most one tier
 * After any change it waits cooldownSeconds; after maxFlips direction reversals it stops changing tiers.
 * Manual tiers keep their tier and only get the DPR adjustment.
 */
export function Governor() {
  const setDpr = useThree((s) => s.setDpr);
  const st = useRef({ acc: 0, frames: 0, below: 0, above: 0, cool: 2, lastDir: 0, flips: 0, dpr: 0 });

  useEffect(() => {
    const { quality } = gameStore.getState().ui;
    const max = Math.min(QUALITY[quality].dpr[1], window.devicePixelRatio || 1);
    st.current.dpr = max;
    setDpr(max);
    // a tier change resets the measurement and gives the new settings a moment
    return gameStore.subscribe((s, prev) => {
      if (s.ui.quality === prev.ui.quality) return;
      const m = Math.min(QUALITY[s.ui.quality].dpr[1], window.devicePixelRatio || 1);
      st.current.dpr = m;
      st.current.cool = GOVERNOR.cooldownSeconds;
      st.current.below = st.current.above = 0;
      setDpr(m);
    });
  }, [setDpr]);

  useFrame((_, dt) => {
    const g = st.current;
    g.acc += dt;
    g.frames++;
    if (g.acc < 1) return;
    const fps = g.frames / g.acc;
    g.acc = 0;
    g.frames = 0;
    const ui = gameStore.getState().ui;
    governorStats.fps = Math.round(fps);
    governorStats.dpr = g.dpr;
    governorStats.tier = ui.quality;
    governorStats.flips = g.flips;
    // a 30 fps cap is intentional: judge against the cap
    const cap = ui.fpsCap === 30 ? 0.55 : 1;
    if (g.cool > 0) {
      g.cool -= 1;
      return;
    }
    g.below = fps < GOVERNOR.down * cap ? g.below + 1 : 0;
    g.above = fps > GOVERNOR.up * cap ? g.above + 1 : 0;
    const prof = QUALITY[ui.quality];
    const idx = QUALITY_ORDER.indexOf(ui.quality);
    const auto = ui.qualityMode === 'auto';
    const change = (dir: number) => {
      if (g.lastDir && dir !== g.lastDir) g.flips++;
      g.lastDir = dir;
      g.below = g.above = 0;
      g.cool = GOVERNOR.cooldownSeconds;
    };
    if (g.below >= GOVERNOR.downSeconds) {
      const minDpr = prof.dpr[0];
      if (g.dpr > minDpr + 0.01) {
        g.dpr = Math.max(minDpr, +(g.dpr * 0.8).toFixed(2));
        setDpr(g.dpr);
        devLog(`[governor] ${fps.toFixed(0)} fps -> dpr ${g.dpr}`);
        change(-1);
      } else if (auto && idx > 0 && g.flips < GOVERNOR.maxFlips) {
        devLog(`[governor] ${fps.toFixed(0)} fps -> tier ${QUALITY_ORDER[idx - 1]}`);
        change(-1);
        gameStore.getState().setUi({ quality: QUALITY_ORDER[idx - 1] });
      }
    } else if (g.above >= GOVERNOR.upSeconds) {
      const maxDpr = Math.min(prof.dpr[1], window.devicePixelRatio || 1);
      if (g.dpr < maxDpr - 0.01) {
        g.dpr = Math.min(maxDpr, +(g.dpr * 1.25).toFixed(2));
        setDpr(g.dpr);
        change(1);
      } else if (auto && idx < QUALITY_ORDER.length - 1 && g.flips < GOVERNOR.maxFlips) {
        devLog(`[governor] ${fps.toFixed(0)} fps -> tier ${QUALITY_ORDER[idx + 1]}`);
        change(1);
        gameStore.getState().setUi({ quality: QUALITY_ORDER[idx + 1] });
      }
    }
  });
  return null;
}
