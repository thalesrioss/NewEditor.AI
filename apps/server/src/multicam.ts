/**
 * Duas câmeras sincronizadas pelo áudio (ADR-007 N-9): a 2ª câmera é alinhada à fala pela correlação dos
 * envelopes de energia (10 ms), vira `role: 'cam'` com `syncOffset`, e cada clipe pode escolher a câmera.
 * O áudio continua sempre o da fala (A1); só a imagem troca. `autoMulticam` alterna as câmeras nos cortes.
 */
import path from 'node:path';
import { clipDuration, clipStarts, type MediaAsset, type Project } from '@neweditor/core';
import { readEnvelope } from './media.ts';
import { store } from './store.ts';

const HOP = 0.01;

/** Correlação cruzada normalizada entre dois envelopes (dBFS/10 ms). Devolve o atraso de `b` em relação a `a`. */
function bestLag(a: Float32Array, b: Float32Array, maxLagS: number): { lag: number; score: number } {
  const ds = 5; // 50 ms para a busca grossa
  const down = (x: Float32Array) => {
    const n = Math.floor(x.length / ds);
    const y = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = 0; k < ds; k++) s += x[i * ds + k]!;
      y[i] = s / ds;
    }
    const m = y.reduce((p, q) => p + q, 0) / Math.max(1, n);
    for (let i = 0; i < n; i++) y[i] = Math.max(-40, y[i]! - m); // tira a média, limita o piso
    return y;
  };
  const A = down(a);
  const B = down(b);
  const corr = (lag: number, x: Float32Array, y: Float32Array) => {
    let s = 0;
    let n = 0;
    for (let i = 0; i < x.length; i++) {
      const j = i + lag;
      if (j < 0 || j >= y.length) continue;
      s += x[i]! * y[j]!;
      n++;
    }
    return n > 200 ? s / n : -Infinity;
  };
  const maxLag = Math.round(maxLagS / (HOP * ds));
  let best = { lag: 0, score: -Infinity };
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const sc = corr(lag, A, B);
    if (sc > best.score) best = { lag, score: sc };
  }
  // Refina em 10 ms em volta do melhor.
  const center = best.lag * ds;
  const am = a.reduce((p, q) => p + q, 0) / a.length;
  const bm = b.reduce((p, q) => p + q, 0) / b.length;
  const fine = (lag: number) => {
    let s = 0;
    let n = 0;
    for (let i = 0; i < a.length; i += 2) {
      const j = i + lag;
      if (j < 0 || j >= b.length) continue;
      s += Math.max(-40, a[i]! - am) * Math.max(-40, b[j]! - bm);
      n++;
    }
    return n ? s / n : -Infinity;
  };
  let fb = { lag: center, score: -Infinity };
  for (let lag = center - ds * 2; lag <= center + ds * 2; lag++) {
    const sc = fine(lag);
    if (sc > fb.score) fb = { lag, score: sc };
  }
  return { lag: fb.lag * HOP, score: fb.score };
}

/** Sincroniza `camId` com a fala do projeto. Devolve o deslocamento (s): tempo na câmera = tempo na fala + offset. */
export async function syncCamera(projectId: string, camId: string): Promise<{ offset: number; confianca: number }> {
  const p = store.get(projectId);
  const fala = p.assets.find((a) => a.role === 'fala');
  const cam = p.assets.find((a) => a.id === camId);
  if (!fala?.envelope || !cam?.envelope) throw new Error('as duas gravações precisam estar com o áudio analisado');
  const ea = await readEnvelope(path.join(store.dir(projectId), fala.envelope));
  const eb = await readEnvelope(path.join(store.dir(projectId), cam.envelope));
  const { lag, score } = bestLag(ea, eb, 180);
  // `lag` é o quanto o evento aparece deslocado na câmera: tempo na câmera = tempo na fala + lag.
  const offset = lag;
  const confianca = Math.max(0, Math.min(1, score / 60));
  store.upsertAsset(projectId, { ...cam, role: 'cam', syncOffset: Math.round(offset * 1000) / 1000 });
  store.log(projectId, 'agent', `2ª câmera: ${cam.name} alinhada pelo áudio (${offset >= 0 ? '+' : ''}${offset.toFixed(2)} s, confiança ${Math.round(confianca * 100)}%).`);
  return { offset, confianca };
}

/** Alterna as câmeras nos cortes: troca a cada ~6 s de uma câmera só, sem duas trocas em menos de 2 s. */
export async function autoMulticam(projectId: string): Promise<number> {
  const p = store.get(projectId);
  const cams = p.assets.filter((a) => a.role === 'cam' && a.syncOffset !== undefined);
  if (!cams.length) throw new Error('nenhuma 2ª câmera sincronizada (aba Mídia → "2ª câmera")');
  const tl = p.timeline;
  const starts = clipStarts(tl);
  let cur: string | null = null; // null = câmera principal
  let since = 0;
  let lastSwitch = -9;
  let n = 0;
  const order: (string | null)[] = [null, ...cams.map((c) => c.id)];
  await store.transaction(projectId, 'Alternância de câmeras', async () => {
    tl.main.forEach((c, i) => {
      const s = starts[i]!;
      const d = clipDuration(c);
      // A câmera só serve para o mesmo arquivo de fala (as câmeras estão alinhadas a ele).
      const camsOk = cams.filter((cam) => sourceOk(cam, c));
      if (!camsOk.length) return;
      since += d;
      if (since >= 6 && s - lastSwitch >= 2) {
        const k = (order.indexOf(cur) + 1) % order.length;
        cur = order[k]!;
        if (cur && !camsOk.some((x) => x.id === cur)) cur = null;
        since = 0;
        lastSwitch = s;
      }
      if ((c.cam ?? null) !== cur) {
        store.apply(projectId, { by: 'agent', op: { type: 'set_cam', clipId: c.id, assetId: cur }, note: cur ? `Câmera 2 a partir de ${fmt(s)}` : `Volta para a câmera 1 em ${fmt(s)}` });
        n++;
      }
    });
  });
  return n;
}

/** A câmera cobre o trecho do clipe (depois do deslocamento)? */
function sourceOk(cam: MediaAsset, c: { in: number; out: number }): boolean {
  const off = cam.syncOffset ?? 0;
  return c.in + off >= 0 && c.out + off <= cam.duration;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export type { Project };
