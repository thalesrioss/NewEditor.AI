/**
 * Cinéfilo.AI (canvas / ADR-007 F-5): acha B-roll de FILME no clip.cafe para os pontos narrativos da fala
 * e devolve para a aba Mídia do NewEditor.AI.
 *
 * O clip.cafe entrega a busca como HTML já renderizado (`/s/<frase>`) e cada clipe como MP4 direto
 * (`/videos/<slug>.mp4`) com legenda `.vtt` — então dá para buscar e baixar do próprio servidor, sem navegador.
 * Decisão do Thales (2026-10-10): o Cinéfilo usa o clip.cafe. Ressalva registrada uma vez: o site não publica
 * licença de reuso dos trechos; a responsabilidade pelo uso no vídeo do cliente é editorial.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { ingest } from './ingest.ts';
import { askJson, llmFor } from './llm-local.ts';
import { loadTranscripts } from './actions.ts';
import { sentences, isContent, clean } from './motion/plan.ts';
import { store } from './store.ts';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0 Safari/537.36';
const BASE = 'https://clip.cafe';

export interface CafeClip {
  slug: string;
  link: string;
  filme: string;
  ano?: string;
  duracao?: number;
  transcript: string;
  poster: string;
  mp4: string;
  vtt?: string;
}

const decode = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/** Busca no clip.cafe e lê os cartões do HTML. */
export async function searchCafe(query: string, limit = 12): Promise<CafeClip[]> {
  const q = query.trim().replace(/\s+/g, '+');
  if (!q) return [];
  const r = await fetch(`${BASE}/s/${encodeURIComponent(q).replace(/%2B/g, '+')}`, { headers: { 'user-agent': UA, 'accept-language': 'en' } });
  if (!r.ok) throw new Error(`clip.cafe: HTTP ${r.status}`);
  const html = await r.text();
  const out: CafeClip[] = [];
  const cards = html.split('<div class="searchResultClip">').slice(1);
  for (const c of cards) {
    const slug = /data-slug="([^"]+)"/.exec(c)?.[1];
    const link = /data-link="([^"]+)"/.exec(c)?.[1];
    if (!slug || !link) continue;
    const movie = /<div class="clipMovie"><a href="[^"]*">([^<]+)<\/a>(?:\s*•\s*(\d{4}))?/.exec(c);
    const dur = /<span class="videoDuration">(\d+):(\d+)<\/span>/.exec(c);
    const trans = /<div class="clipTrans">([\s\S]*?)<\/div>/.exec(c)?.[1] ?? '';
    const subs = /<span class="card-lang-cc"[\s\S]*?pill-code">([A-Z]{2})/.exec(c)?.[1]?.toLowerCase();
    out.push({
      slug,
      link: `${BASE}/${link}`,
      filme: decode(movie?.[1] ?? ''),
      ano: movie?.[2],
      duracao: dur ? +dur[1]! * 60 + +dur[2]! : undefined,
      transcript: decode(trans.replace(/<b>Transcript:<\/b>/, '')),
      poster: `${BASE}/img800/${slug}.jpg`,
      mp4: `${BASE}/videos/${slug}.mp4`,
      vtt: subs ? `${BASE}/vtt/${slug}-${subs}.vtt` : undefined,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Baixa o clipe (e a legenda) para o projeto e registra como B-roll na aba Mídia. */
export async function useCafeClip(projectId: string, clip: CafeClip): Promise<{ assetId: string; file: string }> {
  const dir = path.join(store.dir(projectId), 'cinefilo');
  await fs.mkdir(dir, { recursive: true });
  const safe = `${clip.filme.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40)}--${clip.slug}`.replace(/^-|-$/g, '');
  const file = path.join(dir, `${safe}.mp4`);
  try {
    await fs.access(file);
  } catch {
    const r = await fetch(clip.mp4, { headers: { 'user-agent': UA, referer: `${BASE}/` } });
    if (!r.ok) throw new Error(`clip.cafe não entregou o vídeo (HTTP ${r.status})`);
    await fs.writeFile(file, Buffer.from(await r.arrayBuffer()));
    if (clip.vtt) {
      const v = await fetch(clip.vtt, { headers: { 'user-agent': UA } }).catch(() => null);
      if (v?.ok) await fs.writeFile(file.replace(/\.mp4$/, '.vtt'), await v.text());
    }
    await fs.writeFile(file.replace(/\.mp4$/, '.json'), JSON.stringify({ fonte: 'clip.cafe', ...clip, baixadoEm: new Date().toISOString() }, null, 1));
  }
  const existing = store.get(projectId).assets.find((a) => a.path === file);
  if (existing) return { assetId: existing.id, file };
  const asset = await ingest(projectId, file, 'broll');
  store.log(projectId, 'agent', `Cinéfilo: "${clip.transcript.slice(0, 60)}…" (${clip.filme}${clip.ano ? `, ${clip.ano}` : ''}) está na Mídia.`);
  return { assetId: asset.id, file };
}

// --- Do roteiro para as buscas -------------------------------------------------------------------

export interface BeatQuery {
  /** Trecho da fala (tempo na fonte) que o B-roll vai cobrir. */
  assetId: string;
  start: number;
  end: number;
  fala: string;
  /** Frases de busca (inglês, como as citações do clip.cafe). */
  queries: string[];
  motivo: string;
}

/** Dicionário mínimo PT→EN para os temas mais comuns, quando o LLM local está desligado. */
const PT_EN: Record<string, string> = {
  dinheiro: 'money', tempo: 'time', medo: 'fear', trabalho: 'work', sucesso: 'success', fracasso: 'failure', foco: 'focus', disciplina: 'discipline',
  felicidade: 'happiness', amor: 'love', vida: 'life', morte: 'death', verdade: 'truth', mentira: 'lie', poder: 'power', liberdade: 'freedom',
  cansaço: 'tired', dormir: 'sleep', treinar: 'training', academia: 'gym', negócio: 'business', chefe: 'boss', decisão: 'decision', escolha: 'choice',
  coragem: 'courage', família: 'family', amigo: 'friend', inimigo: 'enemy', guerra: 'war', paz: 'peace', futuro: 'future', passado: 'past',
  mudar: 'change', começar: 'start', desistir: 'give up', vencer: 'win', perder: 'lose', aprender: 'learn', ensinar: 'teach', mente: 'mind', cérebro: 'brain',
  audiência: 'audience', público: 'crowd', funil: 'funnel', oferta: 'offer', vendas: 'sales', vender: 'sell', comprar: 'buy', compram: 'buy', confiança: 'trust', confiam: 'trust', confia: 'trust',
  cliente: 'customer', clientes: 'customers', marca: 'brand', empresa: 'company', empresas: 'business', empresário: 'businessman', produto: 'product', fórmula: 'formula', prioridade: 'priority',
  erro: 'mistake', erram: 'mistake', queimam: 'burn money', bilhões: 'billion', milhões: 'million', multiplicador: 'multiply', resultado: 'result', ordem: 'order', primeiro: 'first', construiu: 'build',
  conteúdo: 'content', marketing: 'marketing', estratégia: 'strategy', vitória: 'victory', pessoas: 'people', mercado: 'market', atenção: 'attention', comparativo: 'compare', sofisticado: 'sophisticated',
  rico: 'rich', pobre: 'poor', jogo: 'game', regra: 'rules', plano: 'plan', risco: 'risk', dúvida: 'doubt', promessa: 'promise', segredo: 'secret', história: 'story',
};

/** Pontos narrativos que pedem B-roll: frases com imagem forte (tema, emoção, contraste), espaçadas. */
export async function beatsForBroll(projectId: string, max = 6): Promise<BeatQuery[]> {
  const p = store.get(projectId);
  const trs = await loadTranscripts(p);
  const sents: (ReturnType<typeof sentences>[number] & { assetId: string })[] = [];
  for (const a of p.assets.filter((x) => x.role === 'fala')) {
    const tr = trs.get(a.id);
    if (!tr) continue;
    // Só o que ficou no corte.
    const kept = tr.words.filter((w) => p.timeline.main.some((c) => c.assetId === a.id && w.start >= c.in && w.start < c.out));
    for (const s of sentences(kept.map((w) => ({ text: w.w, start: w.start, end: w.end, src: { assetId: a.id, at: w.start } })))) sents.push({ ...s, assetId: a.id });
  }
  const out: BeatQuery[] = [];
  const useLlm = await llmFor('broll');
  let last = -1e9;
  for (const s of sents) {
    const text = s.words.map((w) => w.text).join(' ');
    if (s.start - last < 12 || s.words.length < 5) continue;
    const content = s.words.map((w) => clean(w.text)).filter((w) => isContent(w));
    const themes = content.filter((w) => PT_EN[w.toLowerCase()]);
    const strong = /\b(imagin[ae]|pensa|lembra|parece|como se|igual|tipo um|é como)\b/i.test(text) || themes.length >= 1;
    if (!strong) continue;
    const queries = themes.slice(0, 2).map((w) => PT_EN[w.toLowerCase()]!);
    out.push({ assetId: s.assetId, start: s.start, end: s.end, fala: text, queries, motivo: themes.length ? `tema: ${themes.join(', ')}` : 'imagem forte' });
    last = s.start;
    if (out.length >= max) break;
  }
  if (useLlm && out.length) {
    try {
      const r = await askJson<{ i: number; queries: string[] }[]>({
        system: 'Você é um editor de vídeo que escolhe cenas de FILMES famosos (em inglês) para ilustrar falas em português. Pense em citações curtas que um personagem diz, como se fossem buscadas num banco de frases de filmes.',
        user: `Para cada fala abaixo, dê 2 frases de busca em INGLÊS, curtas (3–7 palavras), que um personagem de filme diria e que ilustrem a ideia (pode ser literal ou irônica).\n\n${out.map((b, i) => `${i}. "${b.fala}"`).join('\n')}\n\nJSON: [{"i":0,"queries":["...","..."]}, ...]`,
        maxTokens: 600,
        timeoutMs: 90_000,
      });
      for (const x of r) if (out[x.i] && Array.isArray(x.queries)) out[x.i]!.queries = [...x.queries.filter((q) => typeof q === 'string'), ...out[x.i]!.queries].slice(0, 3);
    } catch {
      /* fica com as buscas por tema */
    }
  }
  return out.filter((b) => b.queries.length);
}
