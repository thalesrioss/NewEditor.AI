/** Looks (.cube) do CinePRO no preview: baixa o texto uma vez, lê com o mesmo parseCube do export. */
import { useEffect, useState } from 'react';
import { parseCube, type CubeLut } from '@neweditor/core';

const cubes = new Map<string, CubeLut>();
const pending = new Map<string, Promise<CubeLut>>();

export function loadCube(id: string): Promise<CubeLut> {
  const hit = cubes.get(id);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(id);
  if (!p) {
    p = fetch(`/api/cinepro/lut/${id}`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`look ${r.status}`))))
      .then((t) => {
        const c = parseCube(t);
        cubes.set(id, c);
        return c;
      })
      .finally(() => pending.delete(id));
    pending.set(id, p);
  }
  return p;
}

export const cubeOf = (id: string | undefined): CubeLut | null => (id ? (cubes.get(id) ?? null) : null);

/** O look de um grade, quando já carregado (dispara o download e re-renderiza ao chegar). */
export function useCube(id: string | undefined): CubeLut | null {
  const [c, setC] = useState<CubeLut | null>(() => cubeOf(id));
  useEffect(() => {
    if (!id) return setC(null);
    const hit = cubes.get(id);
    if (hit) return setC(hit);
    let alive = true;
    loadCube(id).then((x) => alive && setC(x)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [id]);
  return c;
}
