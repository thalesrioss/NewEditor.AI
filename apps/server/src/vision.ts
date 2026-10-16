/**
 * Sinais visuais locais (ADR-007 I-7): rostos por amostra de tempo, pelo Vision do macOS (services/vision/faces).
 * Servem para: posição segura de legenda/lettering ("abaixo do queixo", nunca sobre o rosto), QC de lettering
 * sobre o rosto, reframe 16:9 → 9:16 seguindo o rosto e pista de tomada ruim (rosto fora do quadro).
 *
 * Roda no proxy (rápido: ~5 s para 13 min) e guarda <asset>/faces.json. Sem binário compilado, devolve null e
 * tudo que depende disso usa o padrão do perfil.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { MediaAsset, Project } from '@neweditor/core';
import { ROOT } from './config.ts';
import { run } from './media.ts';
import { store } from './store.ts';

const BIN = path.join(ROOT, 'services', 'vision', 'faces');

export interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
  yaw: number;
  roll: number;
  conf: number;
}
export interface FacesFile {
  width: number;
  height: number;
  step: number;
  duration: number;
  frames: { t: number; faces: FaceBox[] }[];
}

const cache = new Map<string, FacesFile | null>();

export async function visionAvailable(): Promise<boolean> {
  try {
    await fs.access(BIN);
    return true;
  } catch {
    return false;
  }
}

/** Rostos do asset (do cache, do arquivo, ou detectando agora). */
export async function facesOf(p: Project, a: MediaAsset, step = 0.5): Promise<FacesFile | null> {
  if (a.kind !== 'video' || !a.proxy) return null;
  const key = `${p.id}/${a.id}`;
  if (cache.has(key)) return cache.get(key)!;
  const file = path.join(store.dir(p.id), a.id, 'faces.json');
  try {
    const f = JSON.parse(await fs.readFile(file, 'utf8')) as FacesFile;
    cache.set(key, f);
    return f;
  } catch {
    /* ainda não detectado */
  }
  if (!(await visionAvailable())) {
    cache.set(key, null);
    return null;
  }
  try {
    const out = await run(BIN, [path.join(store.dir(p.id), a.proxy), String(step), '480']);
    const f = JSON.parse(out.toString()) as FacesFile;
    await fs.writeFile(file, JSON.stringify(f));
    cache.set(key, f);
    return f;
  } catch (e) {
    store.log(p.id, 'system', `Detecção de rosto falhou em ${a.name}: ${(e as Error).message}`);
    cache.set(key, null);
    return null;
  }
}

/** Maior rosto no instante `t` (ou o mais próximo no tempo). */
export function faceAt(f: FacesFile, t: number): FaceBox | null {
  const i = Math.max(0, Math.min(f.frames.length - 1, Math.round(t / f.step)));
  const fr = f.frames[i];
  if (!fr?.faces.length) return null;
  return [...fr.faces].sort((a, b) => b.w * b.h - a.w * a.h)[0]!;
}

/** Resumo do enquadramento: onde o queixo fica (mediana), quanto do tempo tem rosto, e a caixa típica. */
export function faceSummary(f: FacesFile, from = 0, to = Infinity): { chinY: number; eyesY: number; centerX: number; coverage: number; box: { x: number; y: number; w: number; h: number } } | null {
  const boxes = f.frames.filter((fr) => fr.t >= from && fr.t <= to && fr.faces.length).map((fr) => [...fr.faces].sort((a, b) => b.w * b.h - a.w * a.h)[0]!);
  const total = f.frames.filter((fr) => fr.t >= from && fr.t <= to).length;
  if (!boxes.length) return null;
  const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;
  const chinY = med(boxes.map((b) => b.y + b.h));
  const eyesY = med(boxes.map((b) => b.y + b.h * 0.4));
  const centerX = med(boxes.map((b) => b.x + b.w / 2));
  return { chinY, eyesY, centerX, coverage: boxes.length / Math.max(1, total), box: { x: med(boxes.map((b) => b.x)), y: med(boxes.map((b) => b.y)), w: med(boxes.map((b) => b.w)), h: med(boxes.map((b) => b.h)) } };
}

/**
 * Altura segura para legenda/lettering (0–1): logo abaixo do queixo, com folga; nunca sobre o rosto.
 * Se não há rosto, devolve o padrão do perfil.
 */
export async function safeTextY(p: Project, fallback: number): Promise<{ y: number; porque: string }> {
  const fala = p.assets.find((a) => a.role === 'fala' && a.kind === 'video');
  if (!fala) return { y: fallback, porque: 'sem vídeo de fala' };
  const f = await facesOf(p, fala);
  const s = f ? faceSummary(f) : null;
  if (!s || s.coverage < 0.3) return { y: fallback, porque: 'rosto não encontrado na maior parte do tempo' };
  // Queixo + ~6% do quadro; nunca acima de 0,5 nem abaixo de 0,82 (fora da área segura dos apps).
  const y = Math.min(0.82, Math.max(0.5, s.chinY + 0.06 + 0.04));
  return { y: Math.round(y * 100) / 100, porque: `queixo em ${Math.round(s.chinY * 100)}% do quadro (${Math.round(s.coverage * 100)}% do tempo com rosto)` };
}

/** Trechos (no tempo do asset) em que NÃO há rosto por ≥ `min` s — pista de tomada ruim / pessoa fora do quadro. */
export function noFaceRanges(f: FacesFile, min = 1.5): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let cur: { start: number; end: number } | null = null;
  for (const fr of f.frames) {
    if (!fr.faces.length) {
      if (cur) cur.end = fr.t + f.step;
      else cur = { start: fr.t, end: fr.t + f.step };
    } else if (cur) {
      if (cur.end - cur.start >= min) out.push(cur);
      cur = null;
    }
  }
  if (cur && cur.end - cur.start >= min) out.push(cur);
  return out;
}
