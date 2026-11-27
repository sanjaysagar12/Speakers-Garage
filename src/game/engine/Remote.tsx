import { useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { MathUtils, Vector3 } from 'three';
import { Character } from '../models/character/Character';
import { standHeight } from '../maps/deck';
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
  useFrame((_, dt) => {
    const target = new Vector3(r.state.x, standHeight(world.map, r.state.x, r.state.y), r.state.y);
    const before = pos.clone();
    pos.lerp(target, 1 - Math.exp(-10 * dt));
    const v = pos.clone().sub(before).divideScalar(Math.max(dt, 1e-3));
    c.root.position.copy(pos);
    c.root.rotation.y = MathUtils.lerp(c.root.rotation.y, r.state.facing, 0.2);
    c.update(dt, { speed: Math.hypot(v.x, v.z), running: r.state.running, wade: r.state.inWater ? 0.5 : 0, turnRate: 0, localVel: new Vector3(0, 0, Math.hypot(v.x, v.z)) });
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
