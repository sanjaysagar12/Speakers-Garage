import {
  Color,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Object3D,
  Quaternion,
  RingGeometry,
  CircleGeometry,
  ShaderMaterial,
  Vector3,
  NormalBlending,
} from 'three';
import { GAME_CONFIG } from '../config';
import { PAL } from '../models/palette';

/**
 * Pooled, instanced transient effects: footprints, ripple rings, and small particles (splashes, sand puffs).
 * One draw call per pool. Each instance carries an aFade attribute (alpha) and an instance colour.
 */
const fxMaterial = (flatRing = false) =>
  new ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute float aFade;
      varying float vFade;
      varying vec3 vCol;
      void main() {
        vFade = aFade;
        vCol = instanceColor;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vFade;
      varying vec3 vCol;
      void main() {
        if (vFade <= 0.002) discard;
        gl_FragColor = vec4(vCol, vFade);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    polygonOffset: flatRing,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

class Pool {
  readonly mesh: InstancedMesh;
  readonly fade: InstancedBufferAttribute;
  next = 0;
  constructor(geo: ConstructorParameters<typeof InstancedMesh>[0], count: number, flat: boolean) {
    this.mesh = new InstancedMesh(geo, fxMaterial(flat), count);
    this.fade = new InstancedBufferAttribute(new Float32Array(count), 1);
    this.mesh.geometry.setAttribute('aFade', this.fade);
    this.mesh.instanceMatrix.setUsage(35048);
    const white = new Color(1, 1, 1);
    for (let i = 0; i < count; i++) this.mesh.setColorAt(i, white);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }
  alloc(): number {
    const i = this.next;
    this.next = (this.next + 1) % this.mesh.count;
    return i;
  }
}

interface Print {
  age: number;
  life: number;
  alpha: number;
}
interface Ripple {
  age: number;
  life: number;
  size: number;
  x: number;
  y: number;
  z: number;
}
interface Particle {
  age: number;
  life: number;
  pos: Vector3;
  vel: Vector3;
  size: number;
  grav: number;
}

const m4 = new Matrix4();
const q = new Quaternion();
const s3 = new Vector3();
const up = new Vector3(0, 1, 0);
const dummy = new Object3D();

export class FxEmitter {
  readonly root = new Object3D();
  private readonly prints: Pool;
  private readonly ripples: Pool;
  private readonly parts: Pool;
  private readonly printState: Print[];
  private readonly rippleState: Ripple[];
  private readonly partState: Particle[];
  private readonly cDry = new Color(PAL.sandShadow).lerp(new Color(PAL.sand), 0.35);
  private readonly cWet = new Color(PAL.sandDamp).multiplyScalar(0.78);
  private readonly cFoam = new Color(PAL.foam);
  private readonly cSand = new Color(PAL.sandBand);

  constructor() {
    const fp = new CircleGeometry(0.07, 10);
    fp.rotateX(-Math.PI / 2);
    fp.scale(1, 1, 1.75);
    this.prints = new Pool(fp, GAME_CONFIG.effects.maxFootprints, true);
    const ring = new RingGeometry(0.85, 1, 28);
    ring.rotateX(-Math.PI / 2);
    this.ripples = new Pool(ring, GAME_CONFIG.effects.maxRipples, true);
    this.parts = new Pool(new IcosahedronGeometry(1, 0), GAME_CONFIG.effects.maxParticles, false);
    this.printState = Array.from({ length: this.prints.mesh.count }, () => ({ age: 1, life: 0, alpha: 0 }));
    this.rippleState = Array.from({ length: this.ripples.mesh.count }, () => ({ age: 1, life: 0, size: 1, x: 0, y: 0, z: 0 }));
    this.partState = Array.from({ length: this.parts.mesh.count }, () => ({ age: 1, life: 0, pos: new Vector3(), vel: new Vector3(), size: 0, grav: 0 }));
    this.root.add(this.prints.mesh, this.ripples.mesh, this.parts.mesh);
  }

  footprint(x: number, y: number, z: number, facing: number, wet: boolean): void {
    const i = this.prints.alloc();
    q.setFromAxisAngle(up, facing);
    m4.compose(s3.set(x, y + 0.012, z), q, new Vector3(1, 1, 1));
    this.prints.mesh.setMatrixAt(i, m4);
    this.prints.mesh.setColorAt(i, wet ? this.cWet : this.cDry);
    this.printState[i] = { age: 0, life: GAME_CONFIG.effects.footprintLife * (wet ? 0.7 : 1), alpha: wet ? 0.75 : 0.55 };
    this.prints.mesh.instanceMatrix.needsUpdate = true;
    if (this.prints.mesh.instanceColor) this.prints.mesh.instanceColor.needsUpdate = true;
  }

  ripple(x: number, y: number, z: number, size = 1): void {
    const i = this.ripples.alloc();
    this.rippleState[i] = { age: 0, life: 1.3, size, x, y: y + 0.02, z };
    this.ripples.mesh.setColorAt(i, this.cFoam);
    if (this.ripples.mesh.instanceColor) this.ripples.mesh.instanceColor.needsUpdate = true;
  }

  /** kind: splash (white droplets) or sand (tan puff) */
  burst(x: number, y: number, z: number, kind: 'splash' | 'sand', n = 6): void {
    for (let k = 0; k < n; k++) {
      const i = this.parts.alloc();
      const a = Math.random() * Math.PI * 2;
      const sp = kind === 'splash' ? 0.8 + Math.random() * 1.2 : 0.3 + Math.random() * 0.5;
      this.partState[i] = {
        age: 0,
        life: kind === 'splash' ? 0.55 : 0.7,
        pos: new Vector3(x + Math.cos(a) * 0.08, y + 0.05, z + Math.sin(a) * 0.08),
        vel: new Vector3(Math.cos(a) * sp * 0.6, kind === 'splash' ? 1.8 + Math.random() * 1.4 : 0.4 + Math.random() * 0.4, Math.sin(a) * sp * 0.6),
        size: kind === 'splash' ? 0.035 : 0.05,
        grav: kind === 'splash' ? 9 : 0.6,
      };
      this.parts.mesh.setColorAt(i, kind === 'splash' ? this.cFoam : this.cSand);
    }
    if (this.parts.mesh.instanceColor) this.parts.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number): void {
    // footprints fade out
    let touched = false;
    this.printState.forEach((p, i) => {
      if (p.age >= p.life) {
        if (this.prints.fade.array[i] !== 0) {
          this.prints.fade.array[i] = 0;
          touched = true;
        }
        return;
      }
      p.age += dt;
      const k = 1 - p.age / p.life;
      this.prints.fade.array[i] = p.alpha * Math.min(1, k * 3);
      touched = true;
    });
    if (touched) this.prints.fade.needsUpdate = true;

    let rTouched = false;
    this.rippleState.forEach((r, i) => {
      if (r.age >= r.life) {
        if (this.ripples.fade.array[i] !== 0) {
          this.ripples.fade.array[i] = 0;
          rTouched = true;
        }
        return;
      }
      r.age += dt;
      const t = r.age / r.life;
      const sc = (0.25 + t * 1.1) * r.size;
      dummy.position.set(r.x, r.y, r.z);
      dummy.scale.set(sc, 1, sc);
      dummy.updateMatrix();
      this.ripples.mesh.setMatrixAt(i, dummy.matrix);
      this.ripples.fade.array[i] = 0.85 * (1 - t);
      rTouched = true;
    });
    if (rTouched) {
      this.ripples.fade.needsUpdate = true;
      this.ripples.mesh.instanceMatrix.needsUpdate = true;
    }

    let pTouched = false;
    this.partState.forEach((p, i) => {
      if (p.age >= p.life) {
        if (this.parts.fade.array[i] !== 0) {
          this.parts.fade.array[i] = 0;
          pTouched = true;
        }
        return;
      }
      p.age += dt;
      p.vel.y -= p.grav * dt;
      p.vel.multiplyScalar(1 - 1.5 * dt);
      p.pos.addScaledVector(p.vel, dt);
      const t = p.age / p.life;
      const sc = p.size * (1 - t * 0.6);
      dummy.position.copy(p.pos);
      dummy.scale.set(sc, sc, sc);
      dummy.updateMatrix();
      this.parts.mesh.setMatrixAt(i, dummy.matrix);
      this.parts.fade.array[i] = 1 - t * t;
      pTouched = true;
    });
    if (pTouched) {
      this.parts.fade.needsUpdate = true;
      this.parts.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const p of [this.prints, this.ripples, this.parts]) {
      p.mesh.geometry.dispose();
      (p.mesh.material as ShaderMaterial).dispose();
      p.mesh.dispose();
    }
  }
}
