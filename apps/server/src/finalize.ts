/**
 * Portão da revisão: o editor aprova a decupagem → o agente finaliza (cor, legenda, motions, letterings, SFX)
 * → o card vai para "Editado" para a revisão final.
 *
 * A aprovação também guarda o APRENDIZADO: o que o agente cortou × o que o humano aprovou (cortes desfeitos,
 * cortes acrescentados, grafias corrigidas) em review.json — cada vídeo revisado vira gabarito para a decupagem.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_CAPTIONS, normalizeCaptions, profileLabel, type Project, type Removal } from '@neweditor/core';
import { autoMotions } from './agent-motion.ts';
import { autoReframe } from './reframe.ts';
import { autoLettering } from './agent-text.ts';
import { autoGrade } from './color.ts';
import { sleep } from './jobs.ts';
import { notify } from './notify.ts';
import { reviewDoubts } from './review.ts';
import { store } from './store.ts';
import { stepEnd, stepStart } from './estimate.ts';
import { profileOf } from './profiles.ts';
import { runQc } from './qc.ts';
import { autoFlashes, autoZooms } from './ritmo.ts';
import { autoBroll } from './broll.ts';
import { exportOrdens, importRenders, studioAvailable } from './motion-studio.ts';
import { musicAuto } from './music.ts';
import { safeTextY } from './vision.ts';

type Range = { in: number; out: number; kind?: string; reason?: string };
const overlap = (a: Range, b: Range) => Math.max(0, Math.min(a.out, b.out) - Math.max(a.in, b.in));

/** Diferença entre o plano do agente (decupagem.json) e o corte aprovado. */
async function learningDiff(p: Project): Promise<Record<string, unknown>> {
  const dir = store.dir(p.id);
  const perAsset: Record<string, unknown> = {};
  for (const assetId of [...new Set(p.timeline.main.map((c) => c.assetId))]) {
    let agent: Range[] = [];
    try {
      const dec = JSON.parse(await fs.readFile(path.join(dir, assetId, 'decupagem.json'), 'utf8')) as { removals: { start: number; end: number; kind: string; reason: string }[] };
      agent = dec.removals.map((r) => ({ in: r.start, out: r.end, kind: r.kind, reason: r.reason }));
    } catch {
      continue;
    }
    const approved: Range[] = p.timeline.removals.filter((r: Removal) => r.assetId === assetId).map((r) => ({ in: r.in, out: r.out, kind: r.kind, reason: r.reason }));
    const covered = (r: Range, by: Range[]) => by.reduce((a, b) => a + overlap(r, b), 0) / Math.max(1e-6, r.out - r.in);
    perAsset[assetId] = {
      agente: agent,
      aprovado: approved,
      // Cortes do agente que o humano desfez (no todo ou em parte) — o agente cortou demais.
      desfeitos: agent.filter((r) => r.kind !== 'silence' && covered(r, approved) < 0.6),
      // Cortes que o humano fez e o agente não — o agente deixou passar.
      acrescentados: approved.filter((r) => covered(r, agent) < 0.4),
    };
  }
  return { projeto: p.id, nome: p.name, aprovadoEm: new Date().toISOString(), grafias: p.timeline.wordFixes ?? [], ativos: perAsset };
}

export async function approveDecupagem(projectId: string): Promise<{ pendentes: number }> {
  const p = store.get(projectId);
  if (!p.timeline.main.length) throw Object.assign(new Error('não há decupagem para aprovar'), { statusCode: 409 });
  const pendentes = (await reviewDoubts(p)).filter((d) => d.prioridade === 'alta').length;
  await fs.writeFile(path.join(store.dir(projectId), 'review.json'), JSON.stringify(await learningDiff(p), null, 1));
  store.update(projectId, { status: 'finalizando', review: { ...p.review, aprovadaEm: new Date().toISOString() } });
  store.log(projectId, 'human', `Aprovou a decupagem${pendentes ? ` (${pendentes} dúvida(s) deixada(s) como estavam)` : ''}. O agente vai finalizar.`);
  return { pendentes };
}

/** A finalização em sequência; cada etapa é um passo de desfazer próprio. */
export async function finalize(projectId: string): Promise<void> {
  const p = store.get(projectId);
  const prof = await profileOf(p);
  // 0. Reframe: material mais largo que o quadro (16:9 numa peça 9:16) é recortado em volta do rosto, não tarjado.
  {
    const tl0 = p.timeline;
    const ar = tl0.width / tl0.height;
    const wide = p.assets.some((a) => a.kind === 'video' && a.role === 'fala' && !!a.width && !!a.height && a.width / a.height > ar + 0.05 && tl0.main.some((c) => c.assetId === a.id));
    if (wide && !tl0.reframe) {
      store.setActivity(projectId, { state: 'analyzing', message: `Reframe: seguindo o rosto no quadro ${tl0.width}×${tl0.height}` });
      try {
        const r = await autoReframe(projectId);
        store.log(projectId, 'agent', `Reframe pelo rosto em ${r.clips} clipe(s): o material é mais largo que o quadro ${tl0.width}×${tl0.height}.`);
      } catch (e) {
        store.log(projectId, 'system', `Reframe automático falhou: ${(e as Error).message}`);
      }
    }
  }
  // 0b. Banco de SFX: o do perfil (CinePRO por padrão), se o projeto ainda não escolheu.
  if (!p.timeline.sfxBank) store.apply(projectId, { by: 'agent', op: { type: 'set_sfx_bank', bank: prof.sfx.biblioteca ?? 'cinepro' }, note: `SFX ${prof.sfx.biblioteca === 'sintetizado' ? 'sintetizados' : 'reais, da biblioteca do CinePRO'} (padrão "${prof.nome}")` });
  // 1. Cor: LOG → Rec.709 nos vídeos de fala que ainda não têm correção.
  stepStart(projectId, 'cor');
  for (const a of p.assets.filter((x) => x.kind === 'video' && x.role === 'fala' && !p.timeline.grades?.[x.id] && p.timeline.main.some((c) => c.assetId === x.id))) {
    store.setActivity(projectId, { state: 'analyzing', message: `Cor: medindo ${a.name}` });
    try {
      const { grade, why } = await autoGrade(a);
      store.apply(projectId, { by: 'agent', op: { type: 'set_grade', assetId: a.id, grade }, note: `Cor automática: ${why}` });
    } catch (e) {
      store.log(projectId, 'system', `Cor automática falhou em ${a.name}: ${(e as Error).message}`);
    }
  }
  stepEnd(projectId, 'cor');
  // 2. Legenda automática ligada (se ninguém mexeu nela ainda), na altura do perfil do cliente.
  stepStart(projectId, 'legenda');
  if (!store.get(projectId).timeline.captions) {
    // Altura: a do perfil; se o perfil pede "abaixo do queixo" (ou o rosto está onde a legenda cairia), mede o rosto.
    let position = prof.legenda.y;
    let porque = `altura do perfil ${profileLabel(prof)}`;
    const safe = await safeTextY(p, prof.legenda.y);
    if (prof.lettering.posicao === 'abaixo-do-queixo' || Math.abs(safe.y - prof.legenda.y) > 0.12) {
      position = safe.y;
      porque = safe.porque;
    }
    // Padrão editorial lido de uma edição traz a legenda inteira (fonte, cor, tarja, palavras por bloco…).
    // Ajuste com cor/enum fora da regra (BL-0177) cai no padrão, em vez de recusar a op e deixar o vídeo sem legenda.
    store.apply(projectId, { by: 'agent', op: { type: 'set_captions', captions: { ...DEFAULT_CAPTIONS, ...normalizeCaptions(prof.legenda.ajustes ?? {}), enabled: true, position } }, note: `Liguei a legenda automática em ${Math.round(position * 100)}% do quadro (${porque})${prof.legenda.ajustes ? ` com o estilo do padrão "${prof.nome}"` : ''}` });
  }
  stepEnd(projectId, 'legenda');
  // 2b. B-roll pelo Cinéfilo (clip.cafe): cobre as frases de imagem forte até a cobertura do perfil.
  stepStart(projectId, 'broll');
  try {
    const b = await autoBroll(projectId);
    store.log(projectId, 'agent', b.colocados ? `B-roll: ${b.colocados} cena(s) de filme cobrindo ${Math.round(b.cobertura * 100)}% da peça (${b.filmes.join(', ')}).` : `B-roll: ${b.motivo ?? 'nenhuma cena encontrada para as falas.'}`);
  } catch (e) {
    store.log(projectId, 'system', `B-roll automático falhou: ${(e as Error).message}`);
  }
  stepEnd(projectId, 'broll');
  // 2c. Trilha pelo ritmo do corte (BPM alvo, clima), no nível do perfil, começando num tempo forte.
  stepStart(projectId, 'trilha');
  if (!store.get(projectId).timeline.overlays.some((o) => o.role === 'music')) {
    store.setActivity(projectId, { state: 'thinking', message: 'Trilha: escolhendo pela batida do corte' });
    try {
      const m = await musicAuto(projectId);
      if (!m) store.log(projectId, 'agent', 'Trilha: a biblioteca de músicas não está disponível (disco externo?) — ficou sem trilha.');
    } catch (e) {
      store.log(projectId, 'system', `Trilha automática falhou: ${(e as Error).message}`);
    }
  }
  stepEnd(projectId, 'trilha');
  // 3. Motions narrativos primeiro (o lettering desvia deles), 4. letterings nas palavras-chave — na quantidade do perfil.
  stepStart(projectId, 'motions');
  if ((prof.motion.fonte ?? 'studio') === 'studio' && (await studioAvailable())) {
    // Regra A-08: em motion manda o Motion Studio Brain. O produto escreve as ordens de cena e importa o que já estiver renderizado.
    store.setActivity(projectId, { state: 'thinking', message: 'Motions: escrevendo as ordens de cena para o Motion Studio' });
    try {
      const r = await exportOrdens(projectId);
      const imp = await importRenders(projectId).catch(() => ({ importados: 0, pendentes: r.cenas }));
      store.log(projectId, 'agent', `Motions: ${r.cenas} cena(s) pedidas ao Motion Studio Brain${r.obraAlvo ? ` (obra-alvo sugerida: ${r.obraAlvo})` : ''} em ${r.dir}${imp.importados ? ` · ${imp.importados} render(s) importado(s)` : ' · renderize lá e importe na aba Motion'}. Cartões de template não entram: em motion manda o Studio.`);
    } catch (e) {
      store.log(projectId, 'system', `Ordens para o Motion Studio falharam: ${(e as Error).message}`);
    }
  } else await autoMotions(projectId);
  stepEnd(projectId, 'motions');
  await sleep(400);
  stepStart(projectId, 'letterings');
  await autoLettering(projectId, prof.lettering.porMinuto <= 3 ? 'pouco' : prof.lettering.porMinuto <= 5 ? 'medio' : 'muito');
  stepEnd(projectId, 'letterings');
  // 4b. Quebra de padrão: cut zooms nas ênfases onde a peça ficou parada (regra R7 do canvas).
  store.setActivity(projectId, { state: 'cutting', message: 'Quebras de padrão: cut zooms nos trechos parados' });
  const zooms = await autoZooms(projectId).catch(() => 0);
  if (zooms) store.log(projectId, 'agent', `Coloquei ${zooms} cut zoom(s) para a peça não ficar parada.`);
  // 4c. Flash onde a emenda apareceria (troca de arquivo, salto longo) — regra do padrão da casa.
  const flashes = await autoFlashes(projectId).catch(() => 0);
  if (flashes) store.log(projectId, 'agent', `${flashes} flash(es) em cima de cortes que a emenda denunciaria.`);

  // 5. QC (papel 09): o checklist do DNA e do perfil, antes de ir para a revisão final.
  stepStart(projectId, 'qc');
  store.setActivity(projectId, { state: 'thinking', message: 'QC: conferindo legenda, letterings, motions e repetições' });
  const qc = await runQc(projectId);
  stepEnd(projectId, 'qc');
  const block = qc.issues.filter((i) => i.severidade === 'bloqueia');
  store.log(projectId, 'agent', qc.issues.length ? `QC: ${block.length} bloqueio(s) e ${qc.issues.length - block.length} aviso(s) — ${qc.issues.slice(0, 3).map((i) => i.texto).join(' · ')}${qc.issues.length > 3 ? '…' : ''}` : 'QC: nada a apontar.');

  const done = store.get(projectId);
  store.update(projectId, { status: 'editado' });
  stepStart(projectId, 'final');
  const n = (k: string) => done.timeline.overlays.filter((o) => o.role === k).length;
  await notify(done, 'editado', `Edição pronta para revisão: ${done.name} — ${n('broll')} B-rolls, ${n('music') ? 'trilha, ' : ''}${n('motion')} motions, ${n('lettering')} letterings, legenda e cor.`);
  store.setActivity(projectId, { state: 'celebrating', message: 'Edição pronta para a sua revisão final' });
  setTimeout(() => store.setActivity(projectId, { state: 'idle', message: 'Pronto' }), 2400);
}
