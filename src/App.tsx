import { Suspense, lazy } from 'react';
import { useGameStore } from './store/useGameStore';
import { Landing } from './ui/Landing';
import { LoadingScreen } from './ui/LoadingScreen';

// the 3D world (three.js, R3F, maps, models) is a separate chunk, fetched when the player enters
const WorldScreen = lazy(() => import('./WorldScreen'));

export default function App() {
  const phase = useGameStore((s) => s.phase);
  if (phase === 'landing') return <Landing />;
  return (
    <Suspense fallback={<LoadingScreen stage="Loading the world…" progress={0.2} />}>
      <WorldScreen />
    </Suspense>
  );
}
