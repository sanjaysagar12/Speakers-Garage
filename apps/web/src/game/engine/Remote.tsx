import { useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { MathUtils, Vector3 } from 'three';
import { Character } from '../models/character/Character';
import { standHeight } from '@shoreline/shared';
import { useWorld } from './runtime';
import { GAME_CONFIG } from '../config';
import { gameBridge } from '../../store/bridge';
import { LocalAdapter, type NetworkAdapter } from '../net/NetworkAdapter';
import type { PlayerProfile, PlayerState } from '../../types';

interface Remote {
  profile: PlayerProfile;
  state: PlayerState;
}

function RemotePlayer({ r }: { r: Remote }) {
  const world = useWorld();
  const c = useMemo(() => new Character(r.profile.avatar), [r.profile.avatar]);
  useEffect(() => () => c.dispose(), [c]);
  const pos = useMemo(() => new Vector3(r.state.x, 0, r.state.y), [r]);
  const scratch = useMemo(() => ({ target: new Vector3(), before: new Vector3(), motion: { speed: 0, running: false, wade: 0, turnRate: 0, localVel: new Vector3() }, acc: 0 }), []);
  useFrame((_, dt) => {
    const sc = scratch;
    sc.before.copy(pos);
    sc.target.set(r.state.x, standHeight(world.map, r.state.x, r.state.y), r.state.y);
    pos.lerp(sc.target, 1 - Math.exp(-10 * dt));
    const sp = Math.hypot(pos.x - sc.before.x, pos.z - sc.before.z) / Math.max(dt, 1e-3);
    c.root.position.copy(pos);
    c.root.rotation.y = MathUtils.lerp(c.root.rotation.y, r.state.facing, 0.2);
    // distant players animate at a quarter of the frame rate
    const far = Math.abs(pos.x - world.player.pos.x) + Math.abs(pos.z - world.player.pos.z) > 35;
    sc.acc += dt;
    if (far && sc.acc < 0.066) return;
    const step = sc.acc;
    sc.acc = 0;
    sc.motion.speed = sp;
    sc.motion.running = r.state.running;
    sc.motion.wade = r.state.inWater ? 0.5 : 0;
    sc.motion.localVel.set(0, 0, sp);
    c.update(step, sc.motion);
  });
  return <primitive object={c.root} dispose={null} />;
}

/**
 * Multiplayer seam: joins through a NetworkAdapter, streams the local state at a fixed rate and renders
 * whoever else shows up. With LocalAdapter nobody does; a WebSocket adapter is a drop-in.
 */
export function RemotePlayers({ adapter }: { adapter?: NetworkAdapter }) {
  const world = useWorld();
  const net = useMemo(() => adapter ?? new LocalAdapter(), [adapter]);
  const [remotes, setRemotes] = useState<Record<string, Remote>>({});
  useEffect(() => {
    const P = world.player;
    const state = (): PlayerState => ({ x: P.pos.x, y: P.pos.z, facing: P.facing, moving: P.moving, running: P.running, inWater: P.wade > 0.05 });
    void net.join(gameBridge.getProfile(), state());
    const offs = [
      net.onPlayerJoined((profile, s) => setRemotes((m) => ({ ...m, [profile.id]: { profile, state: s } }))),
      net.onPlayerLeft((id) => setRemotes((m) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== id)))),
      net.onPlayerMoved((id, s) => setRemotes((m) => (m[id] ? { ...m, [id]: { ...m[id], state: s } } : m))),
    ];
    const timer = window.setInterval(() => net.sendMove(state()), GAME_CONFIG.net.sendIntervalMs);
    return () => {
      window.clearInterval(timer);
      offs.forEach((o) => o());
      net.leave();
    };
  }, [net, world]);
  return (
    <>
      {Object.values(remotes).map((r) => (
        <RemotePlayer key={r.profile.id} r={r} />
      ))}
    </>
  );
}
