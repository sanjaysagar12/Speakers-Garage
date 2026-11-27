import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

const params = new URLSearchParams(window.location.search);
// ?shots opens the view-angle test scene used by `npm run shots`; it is code-split out of the game bundle
const Root = params.has('shots') ? lazy(() => import('./dev/ShotsScene')) : lazy(() => import('./App'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Root />
    </Suspense>
  </StrictMode>,
);

if (import.meta.env.DEV || params.has('debug')) {
  void import('./store/gameStore').then((m) => {
    (window as unknown as { __store: typeof m.gameStore }).__store = m.gameStore;
  });
}
