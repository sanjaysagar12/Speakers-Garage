import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

const params = new URLSearchParams(window.location.search);
// ?shots (view-angle test scene for `npm run shots`) exists in dev builds only
const Shots = import.meta.env.DEV && params.has('shots') ? lazy(() => import('./dev/ShotsScene')) : null;
const Root = Shots ?? App;

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
