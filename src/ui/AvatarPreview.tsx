import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { CircleGeometry, Mesh, PCFShadowMap, Vector3 } from 'three';
import { Character } from '../game/models/character/Character';
import { Sun } from '../game/engine/Sun';
import { toon } from '../game/materials/toon';
import { PAL } from '../game/models/palette';
import type { AvatarConfig } from '../types';

function Model({ avatar, yaw }: { avatar: AvatarConfig; yaw: number }) {
  const c = useMemo(() => new Character(avatar), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => c.setConfig(avatar), [c, avatar]);
  useEffect(() => () => c.dispose(), [c]);
  const t0 = useRef(0);
  useFrame((_, dt) => {
    t0.current += dt;
    // 3 s idle, 3 s walking on the spot, repeat
    const walking = t0.current % 6 > 3;
    c.root.rotation.y += (yaw - c.root.rotation.y) * Math.min(1, dt * 8);
    c.update(Math.min(dt, 0.05), { speed: walking ? 2.6 : 0, running: false, wade: 0, turnRate: 0, localVel: new Vector3(0, 0, walking ? 2.6 : 0) });
  });
  return <primitive object={c.root} dispose={null} />;
}

function Pad() {
  const m = useMemo(() => {
    const geo = new CircleGeometry(0.75, 32).rotateX(-Math.PI / 2);
    const mesh = new Mesh(geo, toon({ color: PAL.sand }));
    mesh.receiveShadow = true;
    return mesh;
  }, []);
  useEffect(() => () => m.geometry.dispose(), [m]);
  return <primitive object={m} dispose={null} />;
}

/**
 * The same 3D character the world uses, in a small canvas. Drag to orbit (yaw only); `yaw` turns the
 * model itself (the Turn button).
 */
export function AvatarPreview({ avatar, yaw = 0.5, className }: { avatar: AvatarConfig; yaw?: number; className?: string }) {
  const target = useMemo(() => ({ current: new Vector3(0, 0.9, 0) }), []);
  return (
    <div className={className ?? 'h-[250px] w-[190px]'} aria-label="Avatar preview">
      <Canvas flat shadows={{ type: PCFShadowMap }} dpr={[1, 2]} camera={{ fov: 30, position: [0, 1.9, 3.6] }} gl={{ alpha: true }}>
        <Pad />
        <Model avatar={avatar} yaw={yaw} />
        <Sun target={target} extent={2} mapSize={512} />
        <OrbitControls target={[0, 0.95, 0]} enablePan={false} enableZoom={false} minPolarAngle={0.8} maxPolarAngle={1.35} />
      </Canvas>
    </div>
  );
}
