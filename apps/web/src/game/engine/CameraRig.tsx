import { useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { MathUtils, Vector3, type PerspectiveCamera } from 'three';
import { GAME_CONFIG, DEG } from '../config';
import { useWorld } from './runtime';
import { gameBridge } from '../../store/bridge';
import { gameStore } from '../../store/gameStore';

const C = GAME_CONFIG.camera;
const look = new Vector3();
const want = new Vector3();

/**
 * "Eagle behind the player": perspective chase camera, pitch ~55° (45-65 with zoom), narrow FOV so it
 * reads almost like a poster, smooth follow with look-ahead, yaw limited to ±60° around map north.
 */
export function CameraRig() {
  const world = useWorld();
  const camera = useThree((s) => s.camera) as PerspectiveCamera;

  useEffect(() => {
    camera.fov = C.fov;
    camera.near = 0.5;
    camera.far = 500;
    camera.updateProjectionMatrix();
    const cam = world.camera;
    const offZoom = gameBridge.onZoom((f) => {
      cam.distTarget = MathUtils.clamp(cam.distTarget / f, C.distanceMin, C.distanceMax);
    });
    const offReset = gameBridge.onCameraReset(() => {
      cam.yawTarget = 0;
      cam.distTarget = C.distance;
    });
    return () => {
      offZoom();
      offReset();
    };
  }, [camera, world]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const cam = world.camera;
    const input = world.input;
    const lim = C.yawLimitDeg * DEG;
    if (input) {
      cam.yawTarget += input.yawDelta + input.yawKeys() * C.keyYawSpeedDeg * DEG * dt;
      input.yawDelta = 0;
      if (input.zoom !== 1) {
        cam.distTarget = MathUtils.clamp(cam.distTarget * input.zoom, C.distanceMin, C.distanceMax);
        input.zoom = 1;
      }
      for (const a of input.take()) {
        if (a === 'reset') {
          cam.yawTarget = 0;
          cam.distTarget = C.distance;
        } else if (a === 'debug') gameStore.getState().setUi({ debug: !gameStore.getState().ui.debug });
        else gameBridge.requestInteract();
      }
    }
    cam.yawTarget = MathUtils.clamp(cam.yawTarget, -lim, lim);
    cam.yaw = MathUtils.damp(cam.yaw, cam.yawTarget, C.rotateLerp, dt);
    cam.dist = MathUtils.damp(cam.dist, cam.distTarget, 7, dt);
    // closer = a little lower, further = a little steeper; always inside 45..65°
    const zt = (cam.dist - C.distanceMin) / (C.distanceMax - C.distanceMin);
    cam.pitch = MathUtils.clamp(MathUtils.lerp(C.pitchDeg - 6, C.pitchDeg + 6, zt), C.pitchMinDeg, C.pitchMaxDeg) * DEG;

    // follow with look-ahead in the direction of travel
    const P = world.player;
    const ahead = C.lookAhead / GAME_CONFIG.player.runSpeed;
    want.set(P.pos.x + P.vel.x * ahead, P.pos.y, P.pos.z + P.vel.z * ahead);
    const k = 1 - Math.exp(-C.followLerp * dt);
    cam.focus.lerp(want, k);

    const cp = Math.cos(cam.pitch);
    camera.position.set(
      cam.focus.x + Math.sin(cam.yaw) * cp * cam.dist,
      cam.focus.y + 0.9 + Math.sin(cam.pitch) * cam.dist,
      cam.focus.z + Math.cos(cam.yaw) * cp * cam.dist,
    );
    look.set(cam.focus.x, cam.focus.y + 0.9, cam.focus.z);
    camera.lookAt(look);
  });
  return null;
}
