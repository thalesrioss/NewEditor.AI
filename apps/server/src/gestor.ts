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

/** Briefing por regras de texto: funciona offline; o LLM local, quando ligado, refina. */
export function parseTaskRules(texto: string): ProjectTask {
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
  const cli = /\bcliente\s*(?::|é|-)?\s*([A-ZÁÉÍÓÚ][\p{L}\s.]{1,40})/u.exec(texto);
  if (cli) t.cliente = cli[1]!.trim().replace(/\s+(para|pra|com|e)$/i, '');
  const prazo = /(?:prazo|entrega(?:r)?|at[ée])\s*(?:o dia|dia|em)?\s*:?\s*(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?/i.exec(texto);
  if (prazo) {
    const y = prazo[3] ? (prazo[3].length === 2 ? `20${prazo[3]}` : prazo[3]) : String(new Date().getFullYear());
    t.prazo = `${y}-${prazo[2]!.padStart(2, '0')}-${prazo[1]!.padStart(2, '0')}`;
  }
  if (!t.tom && /\b(leve|descontra[íi]do|engra[çc]ado)\b/i.test(low)) t.tom = 'leve';
  if (!t.tom && /\b(s[ée]rio|institucional|formal)\b/i.test(low)) t.tom = 'sério';
  return t;
}

/** Briefing: regras + LLM local (se ligado para "briefing"), que só refina os campos vazios. */
export async function parseTask(texto: string): Promise<ProjectTask> {
  const t = parseTaskRules(texto);
  if (!(await llmFor('briefing'))) return t;
  try {
    const r = await askJson<Partial<ProjectTask>>({
      system: 'Você é o Gestor de Projetos de uma produtora de vídeo. Extraia um briefing estruturado do texto da tarefa.',
      user: `Tarefa:\n"""${texto}"""\n\nDevolva JSON com as chaves: formato (reels|shorts|tiktok|youtube|stories|outro), duracaoAlvoS ([min,max] em segundos ou null), tom (string curta ou null), naoPodeFaltar (lista de strings), cliente (string ou null), prazo (AAAA-MM-DD ou null).`,
      maxTokens: 300,
      timeoutMs: 40_000,
    });
    return {
      ...t,
      formato: t.formato ?? (r.formato as ProjectTask['formato']) ?? undefined,
      duracaoAlvoS: t.duracaoAlvoS ?? (Array.isArray(r.duracaoAlvoS) ? (r.duracaoAlvoS as [number, number]) : undefined),
      tom: t.tom ?? (r.tom || undefined),
      naoPodeFaltar: t.naoPodeFaltar ?? (Array.isArray(r.naoPodeFaltar) && r.naoPodeFaltar.length ? r.naoPodeFaltar : undefined),
      cliente: t.cliente ?? (r.cliente || undefined),
      prazo: t.prazo ?? (r.prazo || undefined),
    };
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
