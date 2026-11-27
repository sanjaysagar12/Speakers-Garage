import { useGameStore } from './store/useGameStore';
import { Landing } from './ui/Landing';
import { Hud } from './ui/Hud';
import { GameCanvas } from './game/GameCanvas';

export default function App() {
  const phase = useGameStore((s) => s.phase);
  if (phase === 'landing') return <Landing />;
  return (
    <div className="relative h-full w-full overflow-hidden">
      <GameCanvas />
      <Hud />
    </div>
  );
}
