/**
 * Gestor de Projetos (canvas / ADR-004 / ADR-007 F-1): lê o texto da tarefa, tira dele um briefing
 * estruturado (formato, duração-alvo, tom, o que não pode faltar, cliente, prazo, links), baixa o material
 * do Google Drive por link público e põe o projeto na FILA — um conteúdo por vez para o NewEditor.AI.
 *
 * Sem API paga: o briefing sai de regras de texto (e do LLM local, quando ligado); o Drive é baixado como
 * um navegador baixaria (link "qualquer pessoa com o link").
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { formatSize, type ProjectTask } from '@neweditor/core';
import { ingest } from './ingest.ts';
import { enqueueJob } from './jobs.ts';
import { askJson, llmFor } from './llm-local.ts';
import { listProfiles, slug } from './profiles.ts';
import { store } from './store.ts';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0 Safari/537.36';

// --- Briefing ------------------------------------------------------------------------------------

const FORMATS: [RegExp, NonNullable<ProjectTask['formato']>, [number, number]][] = [
  [/\breels?\b/i, 'reels', [30, 90]],
  [/\bshorts?\b/i, 'shorts', [30, 60]],
  [/\btik ?tok\b/i, 'tiktok', [30, 90]],
  [/\bstories\b/i, 'stories', [15, 60]],
  [/\byoutube\b|\bv[íi]deo longo\b|\b16:9\b/i, 'youtube', [180, 900]],
];

/** Minúsculas e sem acento: "Não Especificado" → "nao especificado". */
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Data de hoje no fuso da máquina, AAAA-MM-DD. */
export function hojeLocal(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const isoValido = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
const somaDias = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// Palavra que anuncia o prazo antes do dia. Forte ("entrega sexta", "prazo: até a quinta") vale sozinha;
// genérica ("pra", "até", "essa") só quando o dia fecha a frase ou vem com "-feira", "que vem", "de manhã"…,
// senão "para a segunda opção" e "até a quinta cena" viram prazo.
const MEIO = String.raw`(?:(?:ate|para|pra|a|o|na|no|dia|nesta|nessa|esta|essa)\s+)*`;
const FORTE = String.raw`(?:prazo|entreg\w*|proxim[ao])\s*:?\s*${MEIO}`;
const FRACO = String.raw`(?:ate|para|pra|nesta|nessa|esta|essa)\s+${MEIO}`;
const FECHA = String.raw`(?=\s*(?:$|[.,;:!?)]|-feira|que vem|cedo|de (?:manha|tarde|noite)))`;
// Dia da semana usado como ordinal ("segunda versão", "quinta parte", "próxima quinta cena") não é prazo.
const NAO_ORDINAL = String.raw`(?!\s+(?:vers|opc|cena|parte|vez|etapa|tomada|take|rodada|revis|alterac|edic|temporada|episodio|camera|fase|cor|corte|metade))`;
const doDia = (dias: string, depois = '') =>
  String.raw`\b(?:${FORTE}(${dias})\b${depois}|${FRACO}(${dias})${depois}${FECHA})`;
const DIAS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

/**
 * Prazo por regra (ADR-0004: data relativa nunca vem do LLM): "Prazo 20/10" (ano de hoje), "entrega sexta"
 * (a próxima sexta depois de hoje), "pra amanhã", "entrega hoje". `hoje` em AAAA-MM-DD.
 */
export function prazoDoTexto(texto: string, hoje = hojeLocal()): string | undefined {
  const dm = /(?:prazo|entrega(?:r)?|at[ée])\s*(?:o dia|dia|em)?\s*:?\s*(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?/i.exec(texto);
  if (dm) {
    const md = `${dm[2]!.padStart(2, '0')}-${dm[1]!.padStart(2, '0')}`;
    let y = dm[3] ? (dm[3].length === 2 ? `20${dm[3]}` : dm[3]) : hoje.slice(0, 4);
    // Sem ano e já passou há mais de 60 dias: é do ano que vem ("Prazo 05/01" escrito em dezembro).
    if (!dm[3] && `${y}-${md}` < somaDias(hoje, -60)) y = String(Number(y) + 1);
    const iso = `${y}-${md}`;
    if (isoValido(iso)) return iso;
  }
  const low = norm(texto);
  const rel = new RegExp(doDia('depois de amanha|amanha|hoje')).exec(low);
  if (rel) {
    const r = rel[1] ?? rel[2];
    return somaDias(hoje, r === 'hoje' ? 0 : r === 'amanha' ? 1 : 2);
  }
  const dia = new RegExp(String.raw`${doDia(DIAS.join('|'), NAO_ORDINAL)}|\b(segunda|terca|quarta|quinta|sexta)-feira\b`).exec(low);
  if (dia) {
    const alvo = DIAS.indexOf((dia[1] ?? dia[2] ?? dia[3])!);
    const atual = new Date(`${hoje}T00:00:00Z`).getUTCDay();
    return somaDias(hoje, (alvo - atual + 7) % 7 || 7);
  }
  return undefined;
}

/** O texto fala de data ou prazo? Sem isso, nenhum prazo do LLM é aceito. */
const temPalavraDePrazo = (texto: string) =>
  /\d{1,2}[/-]\d{1,2}|\b(prazo|entreg\w*|amanha|hoje|semana|segunda|terca|quarta|quinta|sexta|sabado|domingo|janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/.test(norm(texto));

/** Respostas de "não sei" do LLM ("não especificado", "cliente não informado", "null", "n/a", "-"). */
export function valorVazio(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v !== 'string') return false;
  const s = norm(v).replace(/[.!]+$/, '');
  return !s || /^(?:[\p{L}]+ )?(?:nao especificad[oa]s?|nao informad[oa]s?|nao definid[oa]s?|null|undefined|none|n\/a|na|nenhum[a]?|desconhecid[oa]|-+)$/u.test(s);
}

// Instrução de edição: "tirar gaguejadas e repetições", "legenda amarela", "coloca zoom no gancho".
const PEDIDO = /\b(tirar|tira|tire|cortar|corta|corte as?|remover|remova|remove|colocar|coloca|coloque|botar|bota|bote|adicionar|adiciona|adicione|trocar|troca|troque|acelerar|acelera|acelere|legendas?|zoom)\b/;
const ehPedido = (s: string) => PEDIDO.test(norm(s));

/** Pedidos de edição por regra, uma oração por item (linhas de material/link e URLs ficam de fora). */
export function pedidosDoTexto(texto: string): string[] {
  const out: string[] = [];
  for (const linha of texto.split('\n')) {
    if (/^\s*(material|links?|arquivos?)\s*:/i.test(linha)) continue;
    const limpa = linha.replace(/https?:\/\/\S+/g, ' ').replace(/(?:~\/|\/)[^\s,;]*(?:\s[^\s,;/]+)*\.\w{2,4}\b/g, ' ');
    for (const parte of limpa.split(/[.;!?]+(?:\s|$)|,\s*|…/)) {
      const c = parte.trim().replace(/^(?:e|também|tambem|por favor)\s+/i, '');
      if (c.length >= 3 && c.length <= 120 && ehPedido(c) && !/^n[ãa]o pode faltar/i.test(c) && !out.includes(c)) out.push(c);
    }
  }
  return out;
}

/** O valor do LLM está no texto? (sem caixa/acento; para listas, o item inteiro). */
const noTexto = (valor: string, texto: string) => norm(texto).includes(norm(valor));
/** Alguma palavra (4+ letras) do valor aparece como palavra no texto? */
const palavraNoTexto = (valor: string, texto: string) => {
  const palavras = new Set(norm(texto).split(/[^\p{L}\d]+/u));
  return norm(valor).split(/[^\p{L}\d]+/u).some((w) => w.length >= 4 && palavras.has(w));
};

/**
 * ADR-0004: o que o LLM devolve só vira briefing se passar por tipo, faixa e presença no texto.
 * Campo sem evidência fica vazio (vazio é melhor que errado).
 */
export function validarBriefingLlm(r: Record<string, unknown>, texto: string, hoje = hojeLocal()): Partial<ProjectTask> {
  const out: Partial<ProjectTask> = {};
  const str = (v: unknown) => (typeof v === 'string' && !valorVazio(v) ? v.trim() : undefined);
  const formato = str(r.formato)?.toLowerCase();
  if (formato && FORMATS.some(([, f]) => f === formato)) out.formato = formato as ProjectTask['formato'];
  const d = r.duracaoAlvoS;
  if (Array.isArray(d) && d.length === 2 && d.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 7200) && d[0] <= d[1]) out.duracaoAlvoS = [d[0], d[1]];
  const tom = str(r.tom);
  if (tom && tom.length <= 60 && palavraNoTexto(tom, texto)) out.tom = tom;
  if (Array.isArray(r.naoPodeFaltar)) {
    const itens = r.naoPodeFaltar.map(str).filter((s): s is string => !!s && noTexto(s, texto) && !ehPedido(s));
    if (itens.length) out.naoPodeFaltar = itens;
  }
  const cliente = str(r.cliente);
  if (cliente && cliente.length <= 60 && noTexto(cliente, texto)) out.cliente = cliente;
  const prazo = str(r.prazo);
  if (prazo && isoValido(prazo) && prazo >= hoje && prazo <= somaDias(hoje, 365) && temPalavraDePrazo(texto)) out.prazo = prazo;
  return out;
}

/** Briefing por regras de texto: funciona offline; o LLM local, quando ligado, refina. */
export function parseTaskRules(texto: string, hoje = hojeLocal()): ProjectTask {
  const t: ProjectTask = { texto };
  const low = texto.toLowerCase();
  for (const [re, fmt, dur] of FORMATS) if (re.test(texto)) ((t.formato = fmt), (t.duracaoAlvoS = dur), (() => undefined)());
  // "até 60 s", "de 30 a 45 segundos", "1 min", "~2 min"
  const dur = /(\d{1,3})\s*(?:a|–|-|até)\s*(\d{1,3})\s*(?:s\b|seg|segundos)/i.exec(texto) ?? /(?:até|max(?:imo)?|no m[áa]ximo)\s*(\d{1,3})\s*(?:s\b|seg|segundos)/i.exec(texto);
  if (dur) t.duracaoAlvoS = dur[2] ? [+dur[1]!, +dur[2]!] : [Math.round(+dur[1]! * 0.6), +dur[1]!];
  const min = /(\d{1,2})\s*(?:min\b|minutos?)/i.exec(texto);
  if (!dur && min) t.duracaoAlvoS = [Math.round(+min[1]! * 60 * 0.7), +min[1]! * 60];
  const tom = /\btom\s*(?::|de|é)?\s*([^.\n;]{3,60})/i.exec(texto);
  if (tom) t.tom = tom[1]!.trim();
  const must = [...texto.matchAll(/(?:não pode faltar|precisa ter|obrigat[óo]rio|tem que ter|incluir)\s*:?\s*([^.\n]{3,120})/gi)].map((m) => m[1]!.trim());
  if (must.length) t.naoPodeFaltar = must;
  const links = [...texto.matchAll(/https?:\/\/[^\s<>"')]+/g)].map((m) => m[0].replace(/[.,;)]+$/, ''));
  if (links.length) t.links = [...new Set(links)];
  // "Cliente: Davi Lo." / "cliente é a Maria": a palavra em qualquer caixa, o nome com maiúscula, até o fim da frase.
  const cli = /\b(?:[Cc]liente|CLIENTE)\s*(?::|é|-)?\s*(?:(?:a|o)\s+)?([A-ZÁÉÍÓÚ][\p{L} .]{1,40})/u.exec(texto);
  if (cli) t.cliente = cli[1]!.split(/\.(?:\s|$)/)[0]!.trim().replace(/\s+(para|pra|com|e)$/i, '');
  const prazo = prazoDoTexto(texto, hoje);
  if (prazo) t.prazo = prazo;
  const pedidos = pedidosDoTexto(texto);
  if (pedidos.length) t.pedidos = pedidos;
  if (!t.tom && /\b(leve|descontra[íi]do|engra[çc]ado)\b/i.test(low)) t.tom = 'leve';
  if (!t.tom && /\b(s[ée]rio|institucional|formal)\b/i.test(low)) t.tom = 'sério';
  return t;
}

/**
 * Briefing: regras + LLM local (se ligado para "briefing"), que só preenche os campos vazios e só com o que
 * passar em `validarBriefingLlm`. `ask` e `hoje` existem para o teste (LLM simulado, data fixa).
 */
export async function parseTask(texto: string, deps: { hoje?: string; ask?: () => Promise<Record<string, unknown>> } = {}): Promise<ProjectTask> {
  const hoje = deps.hoje ?? hojeLocal();
  const t = parseTaskRules(texto, hoje);
  if (!deps.ask && !(await llmFor('briefing'))) return t;
  try {
    const r = deps.ask
      ? await deps.ask()
      : await askJson<Record<string, unknown>>({
          system: 'Você é o Gestor de Projetos de uma produtora de vídeo. Extraia um briefing estruturado do texto da tarefa. Campo que não está escrito no texto fica null.',
          user: `Tarefa:\n"""${texto}"""\n\nDevolva JSON com as chaves: formato (reels|shorts|tiktok|youtube|stories|outro), duracaoAlvoS ([min,max] em segundos ou null), tom (string curta ou null), naoPodeFaltar (lista de strings), cliente (string ou null), prazo (AAAA-MM-DD ou null).`,
          maxTokens: 300,
          timeoutMs: 40_000,
        });
    const v = validarBriefingLlm(r && typeof r === 'object' ? r : {}, texto, hoje);
    const out: ProjectTask = {
      ...t,
      formato: t.formato ?? v.formato,
      duracaoAlvoS: t.duracaoAlvoS ?? v.duracaoAlvoS,
      tom: t.tom ?? v.tom,
      naoPodeFaltar: t.naoPodeFaltar ?? v.naoPodeFaltar,
      cliente: t.cliente ?? v.cliente,
      prazo: t.prazo ?? v.prazo,
    };
    for (const k of Object.keys(out) as (keyof ProjectTask)[]) if (out[k] === undefined) delete out[k];
    return out;
  } catch {
    return t;
  }
}

// --- Google Drive por link público -------------------------------------------------------------

export function driveId(link: string): { kind: 'file' | 'folder'; id: string } | null {
  const file = /drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=download&)?id=)([\w-]{10,})/.exec(link) ?? /drive\.usercontent\.google\.com\/download\?id=([\w-]{10,})/.exec(link);
  if (file) return { kind: 'file', id: file[1]! };
  const folder = /drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([\w-]{10,})/.exec(link);
  if (folder) return { kind: 'folder', id: folder[1]! };
  return null;
}

/** Arquivos de uma pasta pública (a vista "embutida" do Drive é HTML simples, sem API). */
export async function listDriveFolder(folderId: string): Promise<{ id: string; name: string }[]> {
  const r = await fetch(`https://drive.google.com/embeddedfolderview?id=${folderId}#list`, { headers: { 'user-agent': UA } });
  if (!r.ok) throw new Error(`pasta do Drive: HTTP ${r.status} (é pública?)`);
  const html = await r.text();
  const out: { id: string; name: string }[] = [];
  for (const m of html.matchAll(/href="https:\/\/drive\.google\.com\/file\/d\/([\w-]+)\/view[^"]*"[^>]*>[\s\S]*?<div class="flip-entry-title">([^<]+)<\/div>/g)) out.push({ id: m[1]!, name: m[2]!.trim() });
  if (!out.length) for (const m of html.matchAll(/\/file\/d\/([\w-]{10,})\/view/g)) if (!out.some((x) => x.id === m[1])) out.push({ id: m[1]!, name: `${m[1]!.slice(0, 8)}.bin` });
  return out;
}

/** Baixa um arquivo público do Drive para `dir`. Devolve o caminho final. */
export async function downloadDriveFile(fileId: string, dir: string, onProgress?: (bytes: number, total?: number) => void): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  let url = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });
    if (!r.ok) throw new Error(`Drive: HTTP ${r.status} (o link é "qualquer pessoa com o link"?)`);
    const type = r.headers.get('content-type') ?? '';
    if (type.startsWith('text/html')) {
      // Página de "arquivo grande, não dá para verificar vírus": reenvia o formulário.
      const html = await r.text();
      const action = /action="([^"]+)"/.exec(html)?.[1];
      const fields = [...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)].map((m) => `${m[1]}=${encodeURIComponent(m[2]!)}`);
      if (!action || !fields.length) throw new Error('o Drive não liberou o download (arquivo privado ou cota excedida)');
      url = `${action}?${fields.join('&')}`;
      continue;
    }
    const cd = r.headers.get('content-disposition') ?? '';
    const name = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(cd)?.[1] ?? /filename="([^"]+)"/.exec(cd)?.[1] ?? `${fileId}.mp4`);
    const total = Number(r.headers.get('content-length')) || undefined;
    const dest = path.join(dir, name.replace(/[/\\]/g, '_'));
    const tmp = `${dest}.part`;
    const out = await fs.open(tmp, 'w');
    let got = 0;
    try {
      for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
        await out.write(chunk);
        got += chunk.length;
        onProgress?.(got, total);
      }
    } finally {
      await out.close();
    }
    await fs.rename(tmp, dest);
    return dest;
  }
  throw new Error('o Drive não liberou o download');
}

// --- Criar o projeto a partir da tarefa ------------------------------------------------------------

/** Extensões de mídia que o Gestor importa (Drive e disco). */
const MEDIA_EXT = /\.(mp4|mov|m4v|mxf|mts|wav|mp3|m4a|aac|png|jpe?g)$/i;

/**
 * Caminhos absolutos citados no texto (`/...` ou `~/...`, com espaço e acento): os que terminam numa extensão
 * de mídia, em qualquer lugar do texto, e o resto da linha `Material:` quando é um caminho (pasta ou arquivo
 * sem extensão de mídia, para virar aviso). `~` vira a pasta do usuário.
 */
export function caminhosDoTexto(texto: string): string[] {
  const out: string[] = [];
  const vistos: string[] = [];
  const add = (raw: string) => {
    const c = raw.trim().replace(/^["'“‘`]+|["'”’`.,;)]+$/g, '').trim();
    if (!c.startsWith('/') && !c.startsWith('~/')) return;
    vistos.push(c);
    const abs = c.startsWith('~/') ? path.join(os.homedir(), c.slice(2)) : c;
    if (!out.includes(abs)) out.push(abs);
  };
  const ext = MEDIA_EXT.source.slice(0, -1); // sem o `$`
  for (const m of texto.matchAll(new RegExp(`(?:^|[\\s"'“‘(\`])((?:~/|/)[^\\n]*?${ext})(?=$|[\\s"'”’).,;\`])`, 'gimu'))) add(m[1]!);
  for (const m of texto.matchAll(/^\s*material\s*:\s*((?:~\/|\/)[^\n]+)$/gimu)) {
    if (!vistos.some((v) => m[1]!.includes(v))) add(m[1]!);
  }
  return out;
}

/** Separa os caminhos que dá para importar (arquivo de mídia que existe) dos que viram aviso. */
export async function conferirCaminhos(caminhos: string[]): Promise<{ arquivos: string[]; avisos: string[] }> {
  const arquivos: string[] = [];
  const avisos: string[] = [];
  for (const c of caminhos) {
    const st = await fs.stat(c).catch(() => null);
    if (!st) avisos.push(`Não achei ${c} no disco: confira o caminho ou arraste o material na tela do projeto.`);
    else if (!st.isFile()) avisos.push(`${c} não é um arquivo (pasta ainda não é importada pela tarefa): arraste os arquivos na tela do projeto.`);
    else if (!MEDIA_EXT.test(c)) avisos.push(`${path.basename(c)} não é um arquivo de mídia que eu importe: arraste o material na tela do projeto.`);
    else arquivos.push(c);
  }
  return { arquivos, avisos };
}

export interface GestorResult {
  projectId: string;
  briefing: ProjectTask;
  baixados: string[];
  avisos: string[];
}

/**
 * Cria o projeto com o briefing, importa o material citado por caminho local, baixa o dos links do Drive
 * (em segundo plano, um a um) e enfileira a decupagem na fila global. O Kanban mostra tudo acontecendo.
 */
export async function createFromTask(texto: string, opts: { nome?: string; links?: string[]; profileId?: string; formato?: { width: number; height: number; fps?: number } } = {}): Promise<GestorResult> {
  const briefing = await parseTask(texto);
  const links = [...new Set([...(briefing.links ?? []), ...(opts.links ?? [])])];
  briefing.links = links;
  const nome = opts.nome?.trim() || [briefing.cliente, texto.split(/[\n.]/)[0]?.trim().slice(0, 60)].filter(Boolean).join(' — ') || 'Projeto';
  const lines: string[] = [];
  if (briefing.formato) lines.push(`Formato: ${briefing.formato}`);
  if (briefing.duracaoAlvoS) lines.push(`Duração-alvo: ${briefing.duracaoAlvoS[0]}–${briefing.duracaoAlvoS[1]} s`);
  if (briefing.tom) lines.push(`Tom: ${briefing.tom}`);
  if (briefing.naoPodeFaltar?.length) lines.push(`Não pode faltar: ${briefing.naoPodeFaltar.join('; ')}`);
  if (briefing.pedidos?.length) lines.push(`Pedidos: ${briefing.pedidos.join('; ')}`);
  const brief = [...lines, '', texto].join('\n');
  const p = await store.create(nome, brief);
  // Formato da peça: o escolhido no diálogo, senão o da tarefa (Reels → 1080×1920, YouTube → 1920×1080). O bruto não sobrescreve.
  const fmt: { width: number; height: number; fps?: number } | undefined = opts.formato ?? (briefing.formato ? formatSize(briefing.formato) : undefined);
  if (fmt) store.setFormat(p.id, { width: fmt.width, height: fmt.height, ...(fmt.fps ? { fps: fmt.fps } : {}), formatoManual: true });
  // Perfil: o do cliente, se existir um com esse nome.
  let profileId = opts.profileId;
  if (!profileId && briefing.cliente) {
    const want = slug(briefing.cliente);
    // Só um perfil VALIDADO é assumido sozinho; os de teste ficam para o Thales escolher.
    const doCliente = (await listProfiles()).filter((x) => x.validado && (x.id === want || slug(x.nome).startsWith(want) || (x.cliente && slug(x.cliente) === want)));
    // Com um padrão editorial por formato, o do formato pedido vem primeiro.
    profileId = (doCliente.find((x) => x.formatoPeca && x.formatoPeca === briefing.formato) ?? doCliente.find((x) => !x.formatoPeca) ?? doCliente[0])?.id;
  }
  store.update(p.id, { task: briefing, client: briefing.cliente, dueAt: briefing.prazo, profileId });
  const baixados: string[] = [];
  // Material já no disco (caminho colado na tarefa, como no Manual): importa do lugar, sem copiar.
  const caminhos = caminhosDoTexto(texto);
  const { arquivos: locais, avisos } = await conferirCaminhos(caminhos);
  if (!links.length && !caminhos.length) avisos.push('Nenhum link do Drive nem caminho de arquivo na tarefa: arraste o material na tela do projeto.');
  // Os avisos aparecem no painel do agente, não só na resposta da API.
  for (const a of avisos) store.log(p.id, 'system', a);
  const dir = path.join(store.dir(p.id), 'material');
  // Material: baixa em segundo plano (um link por vez) e, quando a fala estiver transcrita, enfileira a decupagem.
  void (async () => {
    const files: { id: string; name?: string }[] = [];
    for (const link of links) {
      const d = driveId(link);
      if (!d) {
        store.log(p.id, 'system', `Link que não é do Drive, ignorei: ${link}`);
        continue;
      }
      if (d.kind === 'file') files.push({ id: d.id });
      else {
        try {
          const list = await listDriveFolder(d.id);
          store.log(p.id, 'agent', `Pasta do Drive com ${list.length} arquivo(s).`);
          files.push(...list.filter((f) => MEDIA_EXT.test(f.name) || !/\./.test(f.name)));
        } catch (e) {
          store.log(p.id, 'system', `Não consegui listar a pasta do Drive: ${(e as Error).message}`);
        }
      }
    }
    let temFala = false;
    for (const file of locais) {
      try {
        store.setActivity(p.id, { state: 'analyzing', message: `Importando do disco: ${path.basename(file)}` });
        const asset = await ingest(p.id, file);
        if (asset.role === 'fala') temFala = true;
      } catch (e) {
        store.log(p.id, 'system', `Não consegui importar ${path.basename(file)}: ${(e as Error).message}`);
      }
    }
    for (const f of files) {
      try {
        store.setActivity(p.id, { state: 'analyzing', message: `Baixando do Drive${f.name ? `: ${f.name}` : ''}` });
        const file = await downloadDriveFile(f.id, dir, (got, total) => total && store.setActivity(p.id, { state: 'analyzing', message: `Baixando do Drive${f.name ? `: ${f.name}` : ''}`, progress: got / total }));
        baixados.push(file);
        store.log(p.id, 'agent', `Baixei ${path.basename(file)} do Drive.`);
        const asset = await ingest(p.id, file);
        if (asset.role === 'fala') temFala = true;
      } catch (e) {
        store.log(p.id, 'system', `Download do Drive falhou (${f.id}): ${(e as Error).message}`);
      }
    }
    // Uma decupagem só, com todas as brutas já transcritas.
    if (temFala) enqueueJob(p.id, 'decupagem', {}).catch((e) => store.log(p.id, 'system', `Decupagem falhou: ${(e as Error).message}`));
    store.setActivity(p.id, { state: 'idle', message: files.length || locais.length ? 'Material pronto' : 'Esperando o material' });
  })();
  return { projectId: p.id, briefing, baixados, avisos };
}
