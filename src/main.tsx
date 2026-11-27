import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

const params = new URLSearchParams(window.location.search);
// ?shots opens the view-angle test scene used by `npm run shots`; it is code-split out of the game bundle
// ?shots (view-angle test scene for `npm run shots`) exists in dev builds only
const Root = import.meta.env.DEV && params.has('shots') ? lazy(() => import('./dev/ShotsScene')) : lazy(() => import('./App'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Root />
    </Suspense>
  </StrictMode>,
);

if (import.meta.env.DEV || import.meta.env.VITE_PERF_HOOKS) {
  void import('./store/gameStore').then((m) => {
    (window as unknown as { __store: typeof m.gameStore }).__store = m.gameStore;
  });
}
