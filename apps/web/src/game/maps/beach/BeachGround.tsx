import { useEffect, useMemo } from 'react';
import { DataTexture, DataUtils, HalfFloatType, LinearFilter, Mesh, PlaneGeometry, RGBAFormat, ClampToEdgeWrapping } from 'three';
import { makeBeachGroundMaterial } from './groundMaterial';
import { QUALITY } from '../../config';
import { useGameStore } from '../../../store/useGameStore';
import type { GameMap } from '../types';
import type { BeachData } from './index';

/** Packs the shore field into a half-float RGBA texture: d, s, grass, rock. */
function fieldTexture(data: BeachData): DataTexture {
  const f = data.field;
  const arr = new Uint16Array(f.nx * f.nz * 4);
  for (let k = 0; k < f.nx * f.nz; k++) {
    arr[k * 4] = DataUtils.toHalfFloat(f.d[k]);
    arr[k * 4 + 1] = DataUtils.toHalfFloat(f.s[k]);
    arr[k * 4 + 2] = DataUtils.toHalfFloat(f.grass[k]);
    arr[k * 4 + 3] = DataUtils.toHalfFloat(f.rock[k]);
  }
  const tex = new DataTexture(arr, f.nx, f.nz, RGBAFormat, HalfFloatType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** Terrain + water as one shaded surface, plus an outer ocean apron so the world edge never shows. */
export function createBeachGround(map: GameMap & { data?: BeachData }) {
  return function BeachGround() {
    const tier = QUALITY[useGameStore((s) => s.ui.quality)];
    const detail = tier.waterDetail;
    const res = tier.groundRes;
    const built = useMemo(() => {
      const data = map.data!;
      const [x0, z0, w, h] = data.domain;
      const tex = fieldTexture(data);
      const rect: [number, number, number, number] = [x0, z0, w, h];
      const mat = makeBeachGroundMaterial(tex, rect, detail);
      // fine terrain grid; the shader does the detail, the mesh only carries gentle dunes
      const geo = new PlaneGeometry(w, h, Math.round(w * res), Math.round(h * res));
      geo.rotateX(-Math.PI / 2);
      geo.translate(x0 + w / 2, 0, z0 + h / 2);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) p.setY(i, map.groundHeight(p.getX(i), p.getZ(i)));
      geo.computeVertexNormals();
      const ground = new Mesh(geo, mat);
      ground.receiveShadow = true;
      ground.name = 'ground';
      // outer apron, slightly lower; samples the clamped field edge = deep water on the sea side
      const apronGeo = new PlaneGeometry(1400, 1400, 1, 1);
      apronGeo.rotateX(-Math.PI / 2);
      apronGeo.translate(x0 + w / 2, -0.05, z0 + h / 2);
      const apron = new Mesh(apronGeo, mat);
      apron.receiveShadow = true;
      apron.name = 'apron';
      return { ground, apron, tex, mat, geo, apronGeo };
    }, [detail, res]);
    useEffect(
      () => () => {
        built.geo.dispose();
        built.apronGeo.dispose();
        built.mat.dispose();
        built.tex.dispose();
      },
      [built],
    );
    return (
      <>
        <primitive object={built.ground} dispose={null} />
        <primitive object={built.apron} dispose={null} />
      </>
    );
  };
}
