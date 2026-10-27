/**
 * Registro do Thales no Cérebro (força-tarefa 27/10, frente R): toda aprovação, reprovação ou alteração dele vira
 * UMA linha JSON, só por append, em dois lugares:
 *  - memória da NewStudios (`NEWSTUDIOS_MEMORIA`, padrão ~/newstudios/memoria): correcoes.jsonl (alteração e
 *    reprovação) ou decisoes.jsonl (aprovação), no formato das linhas de lá (data, quem, projeto, origem,
 *    pedido_literal, antes, depois);
 *  - cofre do Thales (`CEREBRO_COFRE`, padrão ~/Documents/Cérebro do Editor/_SISTEMA), no formato do
 *    PROTOCOLO_GLOBAL, com "fonte": "newstudios". Cofre ausente = grava só na NewStudios e avisa.
 * Mesmo `ref` (id da mensagem, do card, do comentário) não grava duas vezes no mesmo arquivo.
 * Leitura: as linhas com origem Thales de um cliente (as duas fontes, sem repetir) e o perfil do cliente em
 * `<dados>/perfis/thales/<cliente>.json` (subpasta: `perfis/*.json` são os perfis de edição).
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Project } from '@neweditor/core';
import { DATA_ROOT } from './config.ts';
import { slug } from './profiles.ts';
import { notaRecusado, raizCofre, rodarRegistroPy } from './registro-cofre.ts';
import { PRODUTORA_DIR } from './videos.ts';

export type TipoThales = 'aprovacao' | 'reprovacao' | 'alteracao';
export type CanalThales = 'slack' | 'trello' | 'aprovacoes' | 'tela-5410' | 'editor-brain';
export const TIPOS: TipoThales[] = ['aprovacao', 'reprovacao', 'alteracao'];
export const CANAIS: CanalThales[] = ['slack', 'trello', 'aprovacoes', 'tela-5410', 'editor-brain'];

export interface RegistroThales {
  tipo: TipoThales;
  /** Fala literal do Thales (ou o resumo do que ele fez à mão na tela). */
  pedido: string;
  antes?: string;
  depois?: string;
  projeto?: string;
  cliente?: string;
  canal: CanalThales;
  /** ISO ou "AAAA-MM-DD HH:MM"; padrão: agora. */
  quando?: string;
  /** Id do evento (ts da mensagem, id do card, do comentário): não grava 2×. */
  ref?: string;
  /** Quem gravou (agente ou "editor-brain"). */
  quem?: string;
  /** Skill do sistema editorial (cofre); padrão 06-editor. */
  skill?: string;
  /** Frase curta para a nota A-NN do cofre (registro.py). */
  titulo?: string;
}

export interface ResultadoRegistro {
  newstudios: { arquivo: string; gravado: boolean; duplicado?: boolean } | null;
  cofre: { arquivo: string; gravado: boolean; duplicado?: boolean } | null;
  /** R4: saída do registro.py do cofre e a nota R-NN criada (reprovação). */
  cofreNotas?: { registro?: string; recusado?: string };
  avisos: string[];
}

/** Linha normalizada para leitura (das duas fontes). */
export interface LinhaThales {
  data: string;
  tipo: TipoThales | 'decisao';
  pedido: string;
  antes: string;
  depois: string;
  projeto: string;
  cliente: string;
  canal: string;
  ref: string;
  fontes: ('newstudios' | 'cofre')[];
}

// Caminhos lidos na hora (os testes trocam por env).
export const memoriaDir = () => process.env.NEWSTUDIOS_MEMORIA ?? path.join(os.homedir(), 'newstudios', 'memoria');
export const cofreDir = () => process.env.CEREBRO_COFRE ?? path.join(os.homedir(), 'Documents', 'Cérebro do Editor', '_SISTEMA');
export const perfisThalesDir = () => path.join(DATA_ROOT, 'perfis', 'thales');

/** Sob `node --test` sem os env apontados, nunca toca nos arquivos reais. */
function desligadoEmTeste(): boolean {
  return !!process.env.NODE_TEST_CONTEXT && (!process.env.NEWSTUDIOS_MEMORIA || !process.env.CEREBRO_COFRE);
}

/** JSON numa linha no estilo das linhas de lá (`json.dumps` do Python: ", " e ": "). */
function linhaJson(o: Record<string, string>): string {
  return `{${Object.entries(o).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')}}`;
}

function quandoDe(r: RegistroThales): Date {
  const d = r.quando ? new Date(r.quando.replace(' ', 'T')) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
}
const p2 = (n: number) => String(n).padStart(2, '0');
const dataDe = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const horaDe = (d: Date) => `${p2(d.getDate())}/${p2(d.getMonth() + 1)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;

/** `cliente/projeto`, como a NewStudios escreve ("equity-sales/eq2210-03"). */
function projetoDe(r: RegistroThales): string {
  const pj = (r.projeto ?? '').trim();
  const cl = r.cliente ? slug(r.cliente) : '';
  if (!cl) return pj;
  if (!pj) return cl;
  return pj.includes('/') || pj.startsWith(cl) ? pj : `${cl}/${pj}`;
}

const NOME_TIPO: Record<TipoThales, string> = { aprovacao: 'aprovação', reprovacao: 'reprovação', alteracao: 'alteração' };

/** Linha da memória da NewStudios (mesmas chaves das de lá, mais tipo/canal/ref para ler e não repetir). */
export function linhaNewstudios(r: RegistroThales): string {
  const d = quandoDe(r);
  return linhaJson({
    data: dataDe(d),
    quem: r.quem ?? 'editor-brain',
    projeto: projetoDe(r),
    origem: 'Thales',
    pedido_literal: r.pedido,
    antes: r.antes ?? '',
    depois: r.depois ?? '',
    tipo: r.tipo,
    canal: r.canal,
    quando: horaDe(d),
    cliente: r.cliente ? slug(r.cliente) : '',
    ref: r.ref ?? '',
  });
}

/** Linha do cofre: aprovação no molde de decisoes.jsonl, alteração/reprovação no de correcoes.jsonl (PROTOCOLO_GLOBAL). */
export function linhaCofre(r: RegistroThales): string {
  const d = quandoDe(r);
  const evidencia = `Thales (${r.canal}, ${horaDe(d)})`;
  const comum = { skill: r.skill ?? '06-editor', projeto: projetoDe(r), data: dataDe(d) };
  const fim = { origem: 'Thales', fonte: 'newstudios', registrado_por: r.quem ?? 'editor-brain', tipo: r.tipo, canal: r.canal, cliente: r.cliente ? slug(r.cliente) : '', ref: r.ref ?? '' };
  // R4: toda linha do cofre leva um título curto (o registro.py usa no nome da nota).
  const titulo = r.titulo ?? `${r.tipo === 'aprovacao' ? 'Aprovou: ' : r.tipo === 'reprovacao' ? 'Reprovou: ' : ''}${curto(r.pedido, 70)}`;
  if (r.tipo === 'aprovacao') {
    return linhaJson({
      ...comum,
      titulo,
      decision: r.depois || `aprovado pelo Thales: ${r.pedido}`,
      level: 'PREFERÊNCIA',
      context: r.antes ?? '',
      justification: `decisão do Thales: ${r.pedido}`,
      evidence: evidencia,
      confidence: 'MEDIDO (fala literal do Thales)',
      alternatives: '',
      result: 'aprovado',
      learning: '',
      ...fim,
    });
  }
  return linhaJson({
    ...comum,
    titulo,
    ORIGINAL_DECISION: r.antes ?? '',
    USER_CORRECTION: r.pedido,
    CONTEXT: '',
    REASON: '',
    RESULT: r.depois ?? '',
    PATTERN: '',
    CONFIDENCE: 'NÍVEL 0',
    evidence: evidencia,
    ...fim,
  });
}

function curto(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, ' ');
  if (t.length <= n) return t;
  const c = t.slice(0, n);
  return `${c.slice(0, c.lastIndexOf(' ') > 20 ? c.lastIndexOf(' ') : n)}…`;
}

async function existe(p: string): Promise<boolean> {
  return fs.stat(p).then(() => true, () => false);
}

/** O arquivo já tem uma linha com esse ref? */
async function temRef(arq: string, ref: string): Promise<boolean> {
  const txt = await fs.readFile(arq, 'utf8').catch(() => '');
  if (!txt.includes(ref)) return false;
  return txt.split('\n').some((l) => {
    try {
      return l.trim() !== '' && (JSON.parse(l) as { ref?: string }).ref === ref;
    } catch {
      return false;
    }
  });
}

/** Append de uma linha (O_APPEND, uma escrita). Arquivo sem quebra no fim ganha uma antes, para não colar linhas. */
async function anexar(arq: string, linha: string): Promise<void> {
  let prefixo = '';
  const fh = await fs.open(arq, 'a+');
  try {
    const { size } = await fh.stat();
    if (size > 0) {
      const b = Buffer.alloc(1);
      await fh.read(b, 0, 1, size - 1);
      if (b[0] !== 0x0a) prefixo = '\n';
    }
    await fh.appendFile(`${prefixo}${linha}\n`, 'utf8');
  } finally {
    await fh.close();
  }
}

// Um registro por vez neste processo: a checagem do ref e o append não se cruzam.
let fila: Promise<unknown> = Promise.resolve();

export function registrarThales(r: RegistroThales): Promise<ResultadoRegistro> {
  const job = fila.then(() => gravar(r));
  fila = job.catch(() => undefined);
  return job;
}

async function gravar(r: RegistroThales): Promise<ResultadoRegistro> {
  if (!TIPOS.includes(r.tipo)) throw Object.assign(new Error(`tipo inválido (${TIPOS.join(', ')})`), { statusCode: 400 });
  if (!CANAIS.includes(r.canal)) throw Object.assign(new Error(`canal inválido (${CANAIS.join(', ')})`), { statusCode: 400 });
  if (!r.pedido?.trim()) throw Object.assign(new Error('pedido obrigatório (a fala literal do Thales)'), { statusCode: 400 });
  const res: ResultadoRegistro = { newstudios: null, cofre: null, avisos: [] };
  if (desligadoEmTeste()) {
    res.avisos.push('teste sem NEWSTUDIOS_MEMORIA/CEREBRO_COFRE: nada gravado');
    return res;
  }
  const arquivo = r.tipo === 'aprovacao' ? 'decisoes.jsonl' : 'correcoes.jsonl';
  const destinos: { chave: 'newstudios' | 'cofre'; dir: string; linha: string }[] = [
    { chave: 'newstudios', dir: memoriaDir(), linha: linhaNewstudios(r) },
    { chave: 'cofre', dir: cofreDir(), linha: linhaCofre(r) },
  ];
  for (const d of destinos) {
    if (!(await existe(d.dir))) {
      res.avisos.push(`${d.chave === 'cofre' ? 'cofre' : 'memória da NewStudios'} não encontrado em ${d.dir}: não gravado lá`);
      continue;
    }
    const arq = path.join(d.dir, arquivo);
    if (r.ref && (await temRef(arq, r.ref))) {
      res[d.chave] = { arquivo: arq, gravado: false, duplicado: true };
      continue;
    }
    await anexar(arq, d.linha);
    res[d.chave] = { arquivo: arq, gravado: true };
  }
  if (res.cofre?.gravado) await notasDoCofre(r, res).catch((e) => res.avisos.push(`notas do cofre: ${(e as Error).message}`));
  const cliente = r.cliente ? slug(r.cliente) : clienteDoTexto(projetoDe(r));
  if (cliente && (res.newstudios?.gravado || res.cofre?.gravado)) await atualizarPerfil(cliente).catch((e) => res.avisos.push(`perfil do cliente: ${(e as Error).message}`));
  return res;
}

/**
 * R4: depois da linha no cofre, o registro.py do cofre gera a nota A-NN e a lista na nota do cliente; reprovação de
 * peça inteira vira também a nota R-NN em Recusados/.
 */
async function notasDoCofre(r: RegistroThales, res: ResultadoRegistro): Promise<void> {
  const raiz = raizCofre(cofreDir());
  res.cofreNotas = {};
  let linha: number | undefined;
  if (r.tipo !== 'aprovacao') linha = (await fs.readFile(path.join(cofreDir(), 'correcoes.jsonl'), 'utf8')).replace(/\n+$/, '').split('\n').length;
  if (await existe(path.join(cofreDir(), 'bin', 'registro.py'))) {
    try {
      res.cofreNotas.registro = await rodarRegistroPy(raiz);
    } catch (e) {
      res.avisos.push(`registro.py do cofre falhou: ${(e as Error).message}`);
    }
  } else res.avisos.push('registro.py do cofre não encontrado: notas A-NN não geradas');
  if (r.tipo === 'reprovacao') {
    const d = quandoDe(r);
    const f = await notaRecusado(raiz, { pedido: r.pedido, antes: r.antes, depois: r.depois, projeto: projetoDe(r), cliente: r.cliente, titulo: r.titulo ?? curto(r.pedido, 70), data: dataDe(d), ref: r.ref, linha });
    if (f) res.cofreNotas.recusado = f;
  }
}

// --- Leitura ---------------------------------------------------------------------------------------------

/** Cliente pelo começo do campo projeto ("equity-sales/eq2210-03" → equity-sales). */
function clienteDoTexto(projeto: string): string {
  const p = projeto.trim();
  return p.includes('/') ? slug(p.split('/')[0]!) : '';
}

/** Linha vale para o cliente: campo cliente, prefixo do projeto, ou regra da casa ("todos os clientes"). */
function doCliente(o: Record<string, unknown>, cliente: string): boolean {
  if (typeof o.cliente === 'string' && o.cliente) return slug(o.cliente) === cliente;
  const pj = String(o.projeto ?? '');
  if (/todos os clientes/i.test(pj)) return true;
  return slug(pj).startsWith(cliente);
}

const semPrefixo = (s: string) => s.replace(/^decisão do Thales:\s*/i, '');

function normalizar(o: Record<string, unknown>, fonte: 'newstudios' | 'cofre', arquivo: 'decisoes' | 'correcoes', cliente: string): LinhaThales {
  const s = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '');
  const tipo = (TIPOS as string[]).includes(s('tipo')) ? (s('tipo') as TipoThales) : arquivo === 'correcoes' ? 'alteracao' : 'decisao';
  return {
    data: s('data'),
    tipo,
    pedido: s('pedido_literal') || s('USER_CORRECTION') || semPrefixo(s('justification')) || s('pedido') || s('decision'),
    antes: s('antes') || s('ORIGINAL_DECISION') || (fonte === 'cofre' && arquivo === 'decisoes' ? s('context') : ''),
    depois: s('depois') || s('RESULT') || s('NEW_PATTERN') || (arquivo === 'decisoes' ? s('decision') : ''),
    projeto: s('projeto'),
    cliente: s('cliente') || clienteDoTexto(s('projeto')) || cliente,
    canal: s('canal') || s('evidence') || s('origem'),
    ref: s('ref'),
    fontes: [fonte],
  };
}

/** Chave para não repetir a mesma fala vinda das duas fontes. */
const chave = (l: LinhaThales) => l.ref || `${l.data}|${l.pedido.toLowerCase().replace(/\W+/g, '').slice(0, 80)}`;

/** Últimas linhas com origem Thales de um cliente, das duas fontes, sem repetir, da mais nova para a mais velha. */
export async function linhasThales(clienteBruto: string, limit = 20): Promise<LinhaThales[]> {
  const cliente = slug(clienteBruto);
  const fontes: [string, 'newstudios' | 'cofre'][] = [
    [memoriaDir(), 'newstudios'],
    [cofreDir(), 'cofre'],
  ];
  const vistas = new Map<string, LinhaThales>();
  const ordem: LinhaThales[] = [];
  const pos = new Map<LinhaThales, number>();
  let n = 0;
  for (const [dir, fonte] of fontes) {
    for (const arquivo of ['decisoes', 'correcoes'] as const) {
      const txt = await fs.readFile(path.join(dir, `${arquivo}.jsonl`), 'utf8').catch(() => '');
      for (const raw of txt.split('\n')) {
        if (!raw.includes('Thales')) continue;
        let o: Record<string, unknown>;
        try {
          o = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (!/^thales/i.test(String(o.origem ?? '')) || !doCliente(o, cliente)) continue;
        const l = normalizar(o, fonte, arquivo, cliente);
        const k = chave(l);
        const ja = vistas.get(k);
        if (ja) {
          if (!ja.fontes.includes(fonte)) ja.fontes.push(fonte);
          continue;
        }
        vistas.set(k, l);
        ordem.push(l);
        pos.set(l, n++);
      }
    }
  }
  // Mais nova primeiro; no mesmo dia, a gravada por último primeiro.
  ordem.sort((a, b) => b.data.localeCompare(a.data) || pos.get(b)! - pos.get(a)!);
  return ordem.slice(0, Math.max(1, limit));
}

// --- Perfil por cliente ----------------------------------------------------------------------------------

/** Temas que a gente reconhece nas falas dele (palavras do próprio texto; sem palavra, sem tema). */
const TEMAS: [string, RegExp][] = [
  ['cor', /\b(cor|cores|grade|grading|colori|look|lut|log|satura|pele|preto)/i],
  ['sincronia', /\b(sinc|sync|dessinc|desincron|boca|lábio)/i],
  ['export/qualidade', /\b(export|qualidade|baixa qualidade|bitrate|render|encode|nitidez)/i],
  ['legenda', /\b(legenda|caption|grafia)/i],
  ['lettering', /\b(lettering|título|destaque|fonte|tipografia)/i],
  ['motion', /\b(motion|animação|vinheta)/i],
  ['som/sfx', /\b(sfx|som|sound|trilha|música|áudio|volume|ruído)/i],
  ['corte/ritmo', /\b(corte|cortar|ritmo|pausa|respiro|take|tomada|duração)/i],
  ['enquadramento', /\b(zoom|enquadra|reframe|crop|recorte|plano)/i],
  ['b-roll', /\b(b-?roll|cobertura|stock)/i],
  ['formato', /\b(formato|vertical|horizontal|9:16|16:9)/i],
];

export interface PerfilThales {
  cliente: string;
  atualizadoEm: string;
  total: Record<TipoThales | 'decisao', number>;
  /** Temas que ele mais corrige, com a última fala de cada um (derivado das linhas, nível OBSERVAÇÃO). */
  preferencias: { tema: string; ocorrencias: number; ultima: string; data: string }[];
  ultimasCorrecoes: LinhaThales[];
  ultimasAprovacoes: LinhaThales[];
}

export function perfilDe(cliente: string, linhas: LinhaThales[]): PerfilThales {
  const total = { aprovacao: 0, reprovacao: 0, alteracao: 0, decisao: 0 };
  const temas = new Map<string, { ocorrencias: number; ultima: string; data: string }>();
  for (const l of linhas) {
    total[l.tipo]++;
    if (l.tipo === 'aprovacao') continue;
    const txt = `${l.pedido} ${l.depois}`;
    for (const [tema, re] of TEMAS) {
      if (!re.test(txt)) continue;
      const t = temas.get(tema);
      if (t) t.ocorrencias++;
      else temas.set(tema, { ocorrencias: 1, ultima: l.pedido, data: l.data }); // linhas vêm da mais nova
    }
  }
  return {
    cliente,
    atualizadoEm: new Date().toISOString(),
    total,
    preferencias: [...temas].map(([tema, t]) => ({ tema, ...t })).sort((a, b) => b.ocorrencias - a.ocorrencias),
    ultimasCorrecoes: linhas.filter((l) => l.tipo === 'alteracao' || l.tipo === 'reprovacao').slice(0, 20),
    ultimasAprovacoes: linhas.filter((l) => l.tipo === 'aprovacao' || l.tipo === 'decisao').slice(0, 10),
  };
}

/** Refaz `<dados>/perfis/thales/<cliente>.json` a partir das linhas (escrita atômica: tmp + rename). */
export async function atualizarPerfil(clienteBruto: string): Promise<PerfilThales> {
  const cliente = slug(clienteBruto);
  const perfil = perfilDe(cliente, await linhasThales(cliente, 500));
  const dir = perfisThalesDir();
  await fs.mkdir(dir, { recursive: true });
  const arq = path.join(dir, `${cliente}.json`);
  await fs.writeFile(`${arq}.tmp`, JSON.stringify(perfil, null, 2));
  await fs.rename(`${arq}.tmp`, arq);
  return perfil;
}

export async function lerPerfil(clienteBruto: string): Promise<PerfilThales | null> {
  const txt = await fs.readFile(path.join(perfisThalesDir(), `${slug(clienteBruto)}.json`), 'utf8').catch(() => null);
  return txt ? (JSON.parse(txt) as PerfilThales) : null;
}

// --- Cliente e projeto de um Project do Editor Brain -----------------------------------------------------

/**
 * Cliente do projeto: o campo do projeto/briefing; senão a pasta `producao/<cliente>/` de algum arquivo; senão o
 * começo do nome casando com uma pasta de cliente da produtora ("Equity Sales eq2210-03…" → equity-sales).
 */
export async function clienteDoProjeto(p: Pick<Project, 'name' | 'client' | 'task' | 'assets'>): Promise<string | undefined> {
  const dado = p.client || p.task?.cliente;
  if (dado) return slug(dado);
  const producao = path.join(PRODUTORA_DIR, 'producao') + path.sep;
  for (const a of p.assets) if (a.path?.startsWith(producao)) return slug(a.path.slice(producao.length).split(path.sep)[0]!);
  const clientes = await fs.readdir(path.join(PRODUTORA_DIR, 'producao')).catch(() => [] as string[]);
  const nome = slug(p.name);
  return clientes.filter((c) => nome.startsWith(slug(c))).sort((a, b) => b.length - a.length)[0];
}

/** Código curto do projeto para o registro: eq2210-03, o id de card (8 hex) ou o nome. */
export function projetoCurto(p: Pick<Project, 'name' | 'id'>): string {
  return /\b[a-z]{2}\d{4}-\d{2}\b/i.exec(p.name)?.[0]?.toLowerCase() ?? /\b[0-9a-f]{8}\b/.exec(p.name)?.[0] ?? (slug(p.name).slice(0, 60) || p.id);
}

/** Bloco de texto para o contexto do agente editor: as últimas correções do Thales para o cliente do projeto. */
export async function contextoThales(p: Pick<Project, 'name' | 'client' | 'task' | 'assets'>, n = 8): Promise<string> {
  const cliente = await clienteDoProjeto(p);
  if (!cliente) return '';
  const linhas = (await linhasThales(cliente, 60).catch(() => [])).filter((l) => l.tipo !== 'aprovacao').slice(0, n);
  if (!linhas.length) return '';
  const item = (l: LinhaThales) => `- ${l.data} [${l.tipo === 'decisao' ? 'decisão' : NOME_TIPO[l.tipo]}] "${curto(l.pedido, 220)}"${l.depois ? ` → ${curto(l.depois, 160)}` : ''}`;
  return [`Últimas correções do Thales para ${cliente} (leia antes de editar; não repita o que ele já corrigiu):`, ...linhas.map(item)].join('\n');
}
