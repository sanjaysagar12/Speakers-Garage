import { ConeGeometry, Group, SphereGeometry, Vector3 } from 'three';
import { ModelBuilder } from './util/builder';
import { ellipsoid, ribbon, sweep } from './util/geo';
import { toon } from '../materials/toon';
import { PAL } from './palette';

/** Crab: body + claws in one mesh, legs in a second mesh so the world can jiggle them while it scuttles. */
export function buildCrab(color: string = '#E0563F'): Group {
  const body = new ModelBuilder();
  body.add(ellipsoid(0.13, 0.06, 0.1, 12, 8), { color, pos: [0, 0.08, 0] });
  for (const s of [-1, 1]) {
    body.add(sweep([new Vector3(s * 0.06, 0.1, 0.07), new Vector3(s * 0.08, 0.13, 0.11)], 0.008, 4, 2), { color });
    body.add(new SphereGeometry(0.018, 6, 5), { color: PAL.black, pos: [s * 0.08, 0.14, 0.11] });
    body.add(sweep([new Vector3(s * 0.1, 0.07, 0.06), new Vector3(s * 0.17, 0.07, 0.12), new Vector3(s * 0.16, 0.07, 0.18)], 0.018, 5, 4), { color });
    body.add(ellipsoid(0.045, 0.03, 0.06, 8, 6), { color: '#F07A5E', pos: [s * 0.15, 0.08, 0.2] });
  }
  const g = body.build('crab');
  const legs = new ModelBuilder();
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const z = -0.05 + i * 0.045;
      legs.add(sweep([new Vector3(s * 0.1, 0.07, z), new Vector3(s * 0.19, 0.1, z - 0.01), new Vector3(s * 0.24, 0.0, z - 0.03)], 0.009, 4, 4), { color });
    }
  }
  const lg = legs.build('legs');
  lg.name = 'legs';
  g.add(lg);
  return g;
}

/** Gull: body mesh plus two wing pivots named wingL / wingR that the world flaps. */
export function buildGull(): Group {
  const b = new ModelBuilder();
  b.add(ellipsoid(0.12, 0.1, 0.3, 12, 8), { color: PAL.white });
  b.add(new SphereGeometry(0.085, 10, 8), { color: PAL.white, pos: [0, 0.06, 0.28] });
  b.add(new ConeGeometry(0.025, 0.12, 6), { color: PAL.yellow, pos: [0, 0.05, 0.4], rot: [Math.PI / 2, 0, 0] });
  b.add(new ConeGeometry(0.08, 0.2, 4), { color: '#DCE3E6', pos: [0, 0, -0.33], rot: [-Math.PI / 2, 0, 0], scale: [1, 1, 0.35] });
  const g = b.build('gull');
  for (const s of [-1, 1]) {
    const pivot = new Group();
    pivot.name = s < 0 ? 'wingL' : 'wingR';
    pivot.position.set(s * 0.08, 0.04, 0.04);
    const w = new ModelBuilder();
    const pts = [new Vector3(0, 0, 0), new Vector3(s * 0.35, 0.04, -0.02), new Vector3(s * 0.7, 0.0, -0.12)];
    const geo = ribbon(pts, (t) => 0.15 * (1 - t * 0.6), { segs: 6, across: 1 });
    w.add(geo, { mat: toon({ double: true }), color: '#B8C4CA' });
    w.add(ribbon([pts[1].clone().multiplyScalar(1.45), pts[2].clone().multiplyScalar(1.05)], () => 0.07, { segs: 2, across: 1 }), {
      mat: toon({ double: true }),
      color: PAL.black,
    });
    const wm = w.build('wing');
    pivot.add(wm);
    g.add(pivot);
  }
  return g;
}
