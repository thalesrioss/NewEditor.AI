/**
 * Motion Studio Brain ↔ NewEditor.AI (regra A-08 do Thales: em motion, manda o Motion Studio Brain).
 *
 * O produto não desenha os motions de cena: ele escreve as ORDENS (uma pasta por cena, no formato do
 * modo CENA da skill `motion-designer`) em `Cérebro do Editor/montagens/<slug>/motions/`, com fala literal,
 * tempos de palavra, frames exatos, quadro do bruto e posição do rosto. O Motion Studio renderiza cada cena
 * com `--alpha` (ProRes 4444 em `out/<pasta>.mov`); depois o produto IMPORTA os renders e os coloca na V3
 * no frame exato. Re-render → re-importa (substitui). Nada mais do vault é tocado.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { anchorAt, cutEndAfter, placeWords, resolveOverlay, timelineDuration, type CueWord, type Project, type TextWord } from '@neweditor/core';
import { readTranscript } from './asr.ts';
import { CEREBRO_DIR } from './cerebro.ts';
import { ingest } from './ingest.ts';
import { run } from './media.ts';
import { normalizeSfxKind, type SfxCue } from '@neweditor/core';
import { pickReference, planMotions, storyReading } from './motion/plan.ts';
import { BRAIN_DIR, getRef, listRefs } from './motion/refs.ts';
import { slug } from './profiles.ts';
import { store } from './store.ts';
import { facesOf, faceSummary } from './vision.ts';

export const STUDIO_DIR = process.env.MOTION_STUDIO ?? path.join(BRAIN_DIR, 'Motion Studio');

export interface Cena {
  id: string;
  pasta: string;
  /** Tempo na timeline (s) e em frames, no fps da timeline. */
  tlStart: number;
  tlEnd: number;
  frameIn: number;
  frames: number;
  fala: string;
  funcao: string;
  ideia: string;
  elementos: string[];
  papel?: string;
  /** Âncora na fonte (sobrevive a recortes da timeline). */
  anchor: { assetId: string; at: number };
  /** Render importado: arquivo e mtime, para saber quando re-importar. */
  importado?: { arquivo: string; mtime: number; assetId: string };
}

export interface OrdensMeta {
  projectId: string;
  nome: string;
  fps: number;
  width: number;
  height: number;
  exportadoEm: string;
  obraAlvo?: string;
  cenas: Cena[];
}

export async function studioAvailable(): Promise<boolean> {
  try {
    await fs.access(path.join(STUDIO_DIR, 'render.mjs'));
    return true;
  } catch {
    return false;
  }
}

export const ordensDir = (p: Project): string => path.join(CEREBRO_DIR, 'montagens', slug(p.name), 'motions');
const META = 'neweditor.json';

const tc = (frames: number, fps: number): string => {
  const f = Math.max(0, Math.round(frames));
  const s = Math.floor(f / fps);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}:${String(Math.round(f - s * fps)).padStart(2, '0')}`;
};

async function timelineWords(p: Project): Promise<CueWord[]> {
  const transcripts: Record<string, TextWord[]> = {};
  for (const a of p.assets) if (a.transcript) transcripts[a.id] = (await readTranscript(path.join(store.dir(p.id), a.transcript))).words;
  return placeWords(p.timeline, transcripts);
}

async function readMeta(dir: string): Promise<OrdensMeta | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, META), 'utf8')) as OrdensMeta;
  } catch {
    return null;
  }
}

/** Estado para a tela: pasta, cenas pedidas e quais já têm render. */
export async function studioStatus(projectId: string): Promise<{ disponivel: boolean; dir: string; cenas: (Cena & { render?: string; novo?: boolean })[]; exportadoEm?: string }> {
  const p = store.get(projectId);
  const dir = ordensDir(p);
  const meta = await readMeta(dir);
  const cenas = [];
  for (const c of meta?.cenas ?? []) {
    const r = await findRender(path.join(dir, c.pasta));
    cenas.push({ ...c, render: r?.file, novo: !!r && (!c.importado || c.importado.mtime < r.mtime) });
  }
  return { disponivel: await studioAvailable(), dir, cenas, exportadoEm: meta?.exportadoEm };
}

async function findRender(cenaDir: string): Promise<{ file: string; mtime: number } | null> {
  let files: string[] = [];
  try {
    files = (await fs.readdir(path.join(cenaDir, 'out'))).filter((f) => /\.mov$/i.test(f));
  } catch {
    return null;
  }
  // Uma camada só; se o Studio entregou "-tras/-frente", a da frente é a que vai por cima da pessoa.
  const pick = files.find((f) => !/-(tras|frente)\.mov$/i.test(f)) ?? files.find((f) => /-frente\.mov$/i.test(f));
  if (!pick) return null;
  const file = path.join(cenaDir, 'out', pick);
  return { file, mtime: (await fs.stat(file)).mtimeMs };
}

/** Escreve as ordens de cena para o Motion Studio (uma pasta por cena) e devolve quantas. */
export async function exportOrdens(projectId: string): Promise<{ dir: string; cenas: number; obraAlvo?: string }> {
  const p = store.get(projectId);
  const tl = p.timeline;
  const fps = tl.fps;
  const words = await timelineWords(p);
  if (!words.length) throw Object.assign(new Error('não há fala transcrita na timeline'), { statusCode: 409 });
  const total = timelineDuration(tl);
  const reading = storyReading(words, total);
  const refs = (await listRefs()).filter((r) => r.uso !== 'lettering');
  const chosen = tl.motionRef ? await getRef(tl.motionRef) : undefined;
  const target = chosen ? { ref: chosen, why: 'obra-alvo definida para este vídeo' } : pickReference(refs, reading);
  const placed = tl.overlays.map((o) => ({ o, pos: resolveOverlay(tl, o) })).filter((x) => x.pos);
  const blocked = placed.filter(({ o }) => o.role === 'broll' || (o.role === 'motion' && o.by === 'human')).map(({ pos }) => pos!);
  const plan = planMotions({ words, total, ref: target.ref, blocked, replaceable: [] });

  const dir = ordensDir(p);
  const prev = await readMeta(dir);
  await fs.mkdir(dir, { recursive: true });
  const cenas: Cena[] = [];
  const sentences = words;
  for (let i = 0; i < plan.motions.length; i++) {
    const m = plan.motions[i]!;
    const anchor = anchorAt(tl, m.start);
    if (!anchor) continue;
    const frameIn = Math.round(m.start * fps);
    // Regra do Thales: a cena vai até o fim do corte em que termina (parar no meio do clipe fica mal acabado).
    const sceneEnd = cutEndAfter(tl, m.end - 0.05);
    const frames = Math.max(1, Math.round((sceneEnd - m.start) * fps));
    const nn = String(i + 1).padStart(2, '0');
    const pasta = `${nn}-${tc(frameIn, fps).replace(/:/g, '')}-${slug(m.spec.ideia).slice(0, 28).replace(/-$/, '')}`;
    const id = `${nn}-${frameIn}`;
    const cenaDir = path.join(dir, pasta);
    await fs.mkdir(cenaDir, { recursive: true });
    const inWords = sentences.filter((w) => w.start >= m.start - 0.05 && w.start < m.end);
    const before = sentences.filter((w) => w.end <= m.start).slice(-12).map((w) => w.text).join(' ');
    const after = sentences.filter((w) => w.start >= m.end).slice(0, 12).map((w) => w.text).join(' ');

    // Contexto visual: o quadro do bruto no começo da cena e onde está o rosto.
    const asset = p.assets.find((a) => a.id === anchor.assetId);
    let rosto = 'não medido';
    if (asset?.proxy) {
      await run('ffmpeg', ['-y', '-v', 'error', '-ss', String(anchor.at), '-i', path.join(store.dir(p.id), asset.proxy), '-frames:v', '1', '-q:v', '3', path.join(cenaDir, 'contexto.jpg')]).catch(() => undefined);
      try {
        const f = await facesOf(p, asset);
        const s = f ? faceSummary(f, anchor.at, anchor.at + (m.end - m.start)) : null;
        if (s) rosto = `centro x=${s.centerX.toFixed(2)}, olhos y=${s.eyesY.toFixed(2)}, queixo y=${s.chinY.toFixed(2)} (frações do quadro) → espaço livre ${s.centerX > 0.55 ? 'à esquerda' : s.centerX < 0.45 ? 'à direita' : 'nas laterais'}`;
      } catch {
        /* sem Vision */
      }
    }
    const old = prev?.cenas.find((c) => c.id === id);
    const cena: Cena = { id, pasta, tlStart: m.start, tlEnd: m.end, frameIn, frames, fala: m.spec.fala, funcao: m.spec.funcao, ideia: m.spec.ideia, elementos: m.spec.texts, papel: m.papel, anchor, importado: old?.importado };
    cenas.push(cena);
    const brief = [
      `# Cena ${nn} · ${tc(frameIn, fps)} → ${tc(frameIn + frames, fps)} · ${frames} frames @ ${fps} fps`,
      '',
      `**Modo:** CENA (sobre a edição) · **Formato:** ${tl.width}×${tl.height} · **Saída:** \`--alpha\` → ProRes 4444 em \`out/${pasta}.mov\`, **${frames} frames exatos**, sem som (o produto cuida do SFX).`,
      `**Projeto NewEditor.AI:** ${p.name} (\`${p.id}\`) · pedido em ${new Date().toLocaleString('pt-BR')}`,
      '',
      `## Função narrativa: ${m.spec.funcao}${m.papel ? ` (${m.papel} da história)` : ''}`,
      '',
      '## Fala literal',
      `> "${m.spec.fala}"`,
      '',
      `Palavras (s desde o início da cena): ${inWords.map((w) => `${w.text} ${(w.start - m.start).toFixed(2)}–${(w.end - m.start).toFixed(2)}`).join(' · ')}`,
      '',
      '## Ponto de partida (o Motion Studio Brain decide a imagem)',
      `- Ideia lida pelo produto: ${m.spec.ideia}`,
      `- Elementos sugeridos: ${m.spec.texts.map((t) => `"${t}"`).join(', ')}${m.spec.kicker ? ` · kicker: "${m.spec.kicker}"` : ''}`,
      `- Obra-alvo sugerida: ${target.ref ? `${target.ref.obra} — ${target.why}` : 'nenhuma — escolha pelo Mapa Estético'} (o Brain pode trocar)`,
      '',
      '## Contexto',
      `- Antes: "…${before}" · Depois: "${after}…"`,
      `- Rosto: ${rosto}. Nunca cobrir rosto nem boca; o motion divide o espaço com a pessoa (4b da skill).`,
      `- Legenda em y=${((tl.captions?.position ?? 0.72) * 100).toFixed(0)}% do quadro — não ocupar.`,
      `- Quadro do bruto no início da cena: \`contexto.jpg\`.`,
      `- Tema do vídeo: ${reading.tema.join(', ') || '—'}${reading.tese ? ` · tese: "${reading.tese.text}"` : ''}`,
      '',
      '## Entrega',
      `\`node "${path.join(STUDIO_DIR, 'render.mjs')}" "${cenaDir}" --alpha\` → \`out/${pasta}.mov\`. Depois, no NewEditor.AI: aba Motion → "Importar do Motion Studio" (ou ⌘K).`,
      '',
    ].join('\n');
    await fs.writeFile(path.join(cenaDir, 'BRIEF.md'), brief);
    await fs.writeFile(path.join(cenaDir, 'cena.json'), JSON.stringify({ ...cena, projectId: p.id, fps, width: tl.width, height: tl.height, palavras: inWords.map((w) => ({ w: w.text, t0: +(w.start - m.start).toFixed(3), t1: +(w.end - m.start).toFixed(3) })) }, null, 2));
  }
  const meta: OrdensMeta = { projectId: p.id, nome: p.name, fps, width: tl.width, height: tl.height, exportadoEm: new Date().toISOString(), obraAlvo: target.ref?.obra, cenas };
  await fs.writeFile(path.join(dir, META), JSON.stringify(meta, null, 2));
  const index = [
    `# Ordens de motion — ${p.name}`,
    '',
    `Pedidas pelo NewEditor.AI em ${new Date().toLocaleString('pt-BR')} · ${tl.width}×${tl.height} @ ${fps} fps · ${cenas.length} cena(s). Em motion manda o Motion Studio Brain (A-08): estas pastas são ordens de serviço no **modo CENA** da skill \`motion-designer\`; a ideia e a obra-alvo são pontos de partida.`,
    '',
    '| # | Pasta | TC in → out | Frames | Função | Fala |',
    '|---|---|---|---|---|---|',
    ...cenas.map((c) => `| ${c.id.split('-')[0]} | \`${c.pasta}\` | ${tc(c.frameIn, fps)} → ${tc(c.frameIn + c.frames, fps)} | ${c.frames} | ${c.funcao} | "${c.fala.slice(0, 70)}${c.fala.length > 70 ? '…' : ''}" |`),
    '',
    '## Como entregar',
    `1. Em cada pasta, leia \`BRIEF.md\` e \`contexto.jpg\`; crie o filme (\`index.html\` + \`film.js\`, \`window.seek(t)\`) com a duração exata em frames.`,
    `2. \`node "${path.join(STUDIO_DIR, 'render.mjs')}" "<pasta>" --alpha\` → \`out/<pasta>.mov\` (ProRes 4444).`,
    '3. No NewEditor.AI (aba Motion ou ⌘K): **Importar do Motion Studio** — cada render entra na V3 no frame certo; re-render substitui.',
    '',
  ].join('\n');
  await fs.writeFile(path.join(dir, 'ORDENS.md'), index);
  return { dir, cenas: cenas.length, obraAlvo: target.ref?.obra };
}

/** Os cues do film.js (render.mjs --cues) viram SFX do produto, um por ação do motion. */
export async function sceneCues(cenaDir: string): Promise<SfxCue[]> {
  try {
    await run('node', [path.join(STUDIO_DIR, 'render.mjs'), cenaDir, '--cues']);
    const j = JSON.parse(await fs.readFile(path.join(cenaDir, 'cues.json'), 'utf8')) as { cues?: { t: number; kind: string; gain?: number }[] };
    return (j.cues ?? []).map((c, i) => ({ t: c.t, kind: normalizeSfxKind(c.kind), gain: c.gain ?? 0.8, seed: 9000 + i * 17 }));
  } catch {
    return [];
  }
}

/** Importa os renders prontos (novos ou re-renderizados) para a V3, no frame exato de cada cena. */
export async function importRenders(projectId: string): Promise<{ importados: number; pendentes: number }> {
  const p = store.get(projectId);
  const dir = ordensDir(p);
  const meta = await readMeta(dir);
  if (!meta) return { importados: 0, pendentes: 0 };
  let importados = 0;
  let pendentes = 0;
  await store.transaction(projectId, 'Motions do Motion Studio', async () => {
    for (const c of meta.cenas) {
      const r = await findRender(path.join(dir, c.pasta));
      if (!r) {
        pendentes++;
        continue;
      }
      if (c.importado && c.importado.mtime >= r.mtime && store.get(projectId).assets.some((a) => a.id === c.importado!.assetId)) {
        // Já importado: garante os SFX (cenas importadas antes dos cues existirem).
        const ov = store.get(projectId).timeline.overlays.find((o) => o.id === `ms_${c.id}`);
        if (ov && !ov.sfx?.length) {
          const sfx = await sceneCues(path.join(dir, c.pasta));
          if (sfx.length) store.apply(projectId, { by: 'agent', op: { type: 'set_overlay_sfx', id: ov.id, sfx }, note: `SFX do Motion Studio em ${c.pasta} (${sfx.length})` });
        }
        continue;
      }
      // Re-render: tira o asset antigo e importa o novo (o proxy com alpha é gerado na importação).
      if (c.importado) {
        const oldId = `ms_${c.id}`;
        if (store.get(projectId).timeline.overlays.some((o) => o.id === oldId)) store.apply(projectId, { by: 'agent', op: { type: 'remove_overlay', id: oldId } });
        const cur = store.get(projectId).assets.find((a) => a.id === c.importado!.assetId);
        if (cur) store.removeAsset(projectId, cur.id);
      }
      store.setActivity(projectId, { state: 'motion', message: `Importando ${path.basename(r.file)}`, at: c.tlStart });
      const asset = await ingest(projectId, r.file, 'motion');
      const sfx = await sceneCues(path.join(dir, c.pasta));
      const id = `ms_${c.id}`;
      if (store.get(projectId).timeline.overlays.some((o) => o.id === id)) store.apply(projectId, { by: 'agent', op: { type: 'remove_overlay', id } });
      store.apply(projectId, {
        by: 'agent',
        op: { type: 'add_overlay', item: { id, trackId: 'V3', role: 'motion', anchor: c.anchor, duration: Math.min(asset.duration, c.frames / meta.fps + 0.5), source: { type: 'media', assetId: asset.id, in: 0 }, reason: `Motion Studio: ${c.pasta}`, sfx } },
        note: `Motion do Studio em ${tc(c.frameIn, meta.fps)}: ${c.pasta}`,
      });
      c.importado = { arquivo: r.file, mtime: r.mtime, assetId: asset.id };
      importados++;
    }
  });
  await fs.writeFile(path.join(dir, META), JSON.stringify(meta, null, 2));
  if (importados) store.log(projectId, 'agent', `${importados} motion(s) do Motion Studio importado(s) para a V3${pendentes ? ` · ${pendentes} cena(s) ainda sem render` : ''}.`);
  return { importados, pendentes };
}
