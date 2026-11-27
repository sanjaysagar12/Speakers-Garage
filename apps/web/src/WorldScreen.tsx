import { GameCanvas } from './game/GameCanvas';
import { Hud } from './ui/Hud';

/** Everything that needs three.js / the maps: loaded on "Enter" as its own chunk. */
export default function WorldScreen() {
  return (
    <div className="relative h-full w-full overflow-hidden">
      <GameCanvas />
      <Hud />
    </div>
  );
}
