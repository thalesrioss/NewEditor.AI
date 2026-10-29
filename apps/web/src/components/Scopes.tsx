import { useEffect, useRef, useState } from 'react';
import { computeScopes, SKIN_LINE_DEG, vectorCell, vectorImage, VECTOR_SIZE, waveformImage, SCOPE_LEVELS } from '@neweditor/core';
import { scopeFrame } from '../lib/scopeSource.ts';
import { useEditor } from '../lib/store.ts';

type Kind = 'waveform' | 'parade' | 'vector';
/** Lado maior do quadro reduzido que os scopes leem (480 em 1080p: 1 pixel de scope a cada 4 do quadro). */
const READ_MAX = 480;
/** Intervalo mínimo entre duas contas (o player pode desenhar 60 vezes por segundo). */
const MIN_GAP_MS = 33;

/**
 * Scopes do ColorPanel (BL-0159 C2): waveform de luma, parade RGB e vetorscópio com linha de pele, lidos do
 * canvas do player (o mesmo quadro pós-grade que aparece na tela). Atualizam enquanto as rodas mexem.
 */
export function Scopes() {
  const [kind, setKind] = useState<Kind>('waveform');
  const [empty, setEmpty] = useState(true);
  const out = useRef<HTMLCanvasElement>(null);
  const kindRef = useRef(kind);
  kindRef.current = kind;

  useEffect(() => {
    const read = document.createElement('canvas');
    const rctx = read.getContext('2d', { willReadFrequently: true })!;
    let raf = 0;
    let lastVersion = -1;
    let lastKind: Kind | null = null;
    let lastAt = 0;
    // Latência medida: da mudança da grade até o scope desenhado com um quadro novo (window.__scopeLatency no dev).
    let pending: { since: number; after: number } | null = null;
    const unsub = useEditor.subscribe((s, prev) => {
      if (s.gradeDraft !== prev.gradeDraft) pending ??= { since: performance.now(), after: scopeFrame()?.version ?? 0 };
    });
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const f = scopeFrame();
      const cv = out.current;
      const now = performance.now();
      if (!f || !cv) return setEmpty(true);
      if ((f.version === lastVersion && kindRef.current === lastKind) || now - lastAt < MIN_GAP_MS) return;
      const k = Math.min(1, READ_MAX / Math.max(f.canvas.width, f.canvas.height));
      const w = Math.max(1, Math.round(f.canvas.width * k));
      const h = Math.max(1, Math.round(f.canvas.height * k));
      if (read.width !== w || read.height !== h) [read.width, read.height] = [w, h];
      rctx.drawImage(f.canvas, 0, 0, w, h);
      const px = rctx.getImageData(0, 0, w, h).data;
      const rect = f.rect && { x: f.rect.x * k, y: f.rect.y * k, w: f.rect.w * k, h: f.rect.h * k };
      const s = computeScopes(px, w, h, { cols: 256, rect: rect ?? undefined });
      const img = kindRef.current === 'vector' ? vectorImage(s) : waveformImage(s, kindRef.current === 'parade' ? 'parade' : 'luma');
      paint(cv, img, kindRef.current);
      lastVersion = f.version;
      lastKind = kindRef.current;
      lastAt = now;
      setEmpty(false);
      if (pending && f.version > pending.after) {
        const ms = performance.now() - pending.since;
        pending = null;
        if (import.meta.env.DEV) ((window as unknown as { __scopeLatency?: number[] }).__scopeLatency ??= []).push(Math.round(ms));
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      unsub();
    };
  }, []);

  return (
    <section className="space-y-2">
      <div className="flex rounded-[var(--radius-ui-md)] border border-ink-700 p-0.5" role="radiogroup" aria-label="Scope">
        {(
          [
            ['waveform', 'Waveform'],
            ['parade', 'Parade RGB'],
            ['vector', 'Vetorscópio'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="radio" aria-checked={kind === id} onClick={() => setKind(id)} className={`flex-1 rounded-[var(--radius-ui-sm)] py-1 text-ui-2xs font-semibold ${kind === id ? 'bg-ink-700 text-white' : 'text-ink-400 hover:text-ink-200'}`}>
            {label}
          </button>
        ))}
      </div>
      <div className={`relative mx-auto overflow-hidden rounded-[var(--radius-ui-sm)] border border-ink-700 bg-black ${kind === 'vector' ? 'aspect-square w-3/4' : 'aspect-[2/1] w-full'}`}>
        <canvas ref={out} aria-label={`Scope: ${kind}`} className="absolute inset-0 h-full w-full" />
        {empty && <p className="absolute inset-0 flex items-center justify-center p-3 text-center text-ui-2xs text-ink-400">Sem quadro no player ainda. Dê play ou mova o cursor.</p>}
      </div>
      <p className="text-ui-2xs leading-snug text-ink-400">{kind === 'vector' ? 'Linha laranja: tom de pele. Pele boa fica em cima dela; os quadradinhos são as cores a 75%.' : 'Linhas a 0, 25, 50, 75 e 100%. Pele de rosto costuma ficar entre 50 e 70%.'}</p>
    </section>
  );
}

/** Desenha a imagem do scope no canvas de saída, com a retícula. */
function paint(cv: HTMLCanvasElement, img: { width: number; height: number; data: Uint8ClampedArray }, kind: Kind): void {
  const W = kind === 'vector' ? VECTOR_SIZE : 512;
  const H = kind === 'vector' ? VECTOR_SIZE : SCOPE_LEVELS;
  if (cv.width !== W || cv.height !== H) [cv.width, cv.height] = [W, H];
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const tmp = new OffscreenCanvas(img.width, img.height);
  tmp.getContext('2d')!.putImageData(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0);
  ctx.imageSmoothingEnabled = kind !== 'vector';
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(tmp, 0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
  ctx.lineWidth = 1;
  if (kind !== 'vector') {
    ctx.strokeStyle = 'rgb(255 255 255 / 0.16)';
    ctx.fillStyle = 'rgb(255 255 255 / 0.45)';
    ctx.font = '9px ui-sans-serif, system-ui';
    for (const p of [0, 25, 50, 75, 100]) {
      const y = Math.round((1 - p / 100) * (H - 1)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
      ctx.fillText(String(p), 2, Math.min(H - 2, Math.max(9, y - 2)));
    }
    if (kind === 'parade')
      for (const x of [W / 3, (2 * W) / 3]) {
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, 0);
        ctx.lineTo(Math.round(x) + 0.5, H);
        ctx.stroke();
      }
    return;
  }
  const c = (VECTOR_SIZE - 1) / 2;
  ctx.strokeStyle = 'rgb(255 255 255 / 0.18)';
  for (const r of [0.25, 0.5]) {
    ctx.beginPath();
    ctx.arc(c, c, r * (VECTOR_SIZE - 1), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(0, c);
  ctx.lineTo(W, c);
  ctx.moveTo(c, 0);
  ctx.lineTo(c, H);
  ctx.stroke();
  // Alvos das cores primárias e secundárias a 75%, como no Resolve.
  ctx.strokeStyle = 'rgb(255 255 255 / 0.5)';
  for (const [R, G, B] of [[0.75, 0, 0], [0.75, 0, 0.75], [0, 0, 0.75], [0, 0.75, 0.75], [0, 0.75, 0], [0.75, 0.75, 0]] as [number, number, number][]) {
    const v = vectorCell(R, G, B);
    ctx.strokeRect(v.x - 4, v.y - 4, 8, 8);
  }
  // Linha de pele: do centro até a borda no ângulo da I-line (y do canvas para baixo).
  const a = (SKIN_LINE_DEG * Math.PI) / 180;
  ctx.strokeStyle = 'rgb(255 160 80 / 0.85)';
  ctx.beginPath();
  ctx.moveTo(c, c);
  ctx.lineTo(c + Math.cos(a) * c, c - Math.sin(a) * c);
  ctx.stroke();
}
