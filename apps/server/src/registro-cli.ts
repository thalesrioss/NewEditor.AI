/**
 * Registro do Thales pela linha de comando (para os agentes da NewStudios, ao receber recado dele no Slack, no
 * Trello ou no APROVACOES.md). Não precisa do servidor no ar: grava direto nos dois .jsonl.
 *
 *   node --import tsx apps/server/src/registro-cli.ts --tipo alteracao --canal slack \
 *     --pedido "fala literal" [--antes ...] [--depois ...] [--projeto eq2210-03] [--cliente equity-sales] \
 *     [--ref <ts da mensagem>] [--quando "2026-10-27 00:33"] [--quem studio-gestor-1] [--skill 06-editor] [--titulo ...]
 *
 * Sai com 0 e imprime o resultado em JSON; 2 = argumento faltando ou inválido.
 */
import { parseArgs } from 'node:util';
import { CANAIS, registrarThales, TIPOS, type CanalThales, type TipoThales } from './registro-thales.ts';

const campos = ['tipo', 'canal', 'pedido', 'antes', 'depois', 'projeto', 'cliente', 'ref', 'quando', 'quem', 'skill', 'titulo'] as const;

const { values } = parseArgs({ options: Object.fromEntries(campos.map((c) => [c, { type: 'string' as const }])), strict: true });
const v = values as Partial<Record<(typeof campos)[number], string>>;

if (!v.tipo || !v.canal || !v.pedido || !TIPOS.includes(v.tipo as TipoThales) || !CANAIS.includes(v.canal as CanalThales)) {
  console.error(`uso: registro-cli --tipo ${TIPOS.join('|')} --canal ${CANAIS.join('|')} --pedido "fala literal" [--antes] [--depois] [--projeto] [--cliente] [--ref] [--quando] [--quem] [--skill] [--titulo]`);
  process.exit(2);
}

const r = await registrarThales({ ...v, tipo: v.tipo as TipoThales, canal: v.canal as CanalThales, pedido: v.pedido });
console.log(JSON.stringify(r, null, 2));
