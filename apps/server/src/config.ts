import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Raiz do produto (código, serviços, fontes, web). No app de desktop empacotado vem de NEWEDITOR_ROOT. */
export const ROOT = process.env.NEWEDITOR_ROOT ?? path.resolve(here, '../../..');
/** Pasta de dados do usuário (projetos, perfis, fila, presets). No app de desktop vem de NEWEDITOR_DATA. */
export const DATA_ROOT = process.env.NEWEDITOR_DATA ?? path.join(ROOT, 'data');
export const DATA_DIR = path.join(DATA_ROOT, 'projects');
export const ASR_SCRIPT = path.join(ROOT, 'services', 'asr', 'transcribe.py');

export const PORT = Number(process.env.NEWEDITOR_PORT ?? 4310);
export const MODEL = process.env.NEWEDITOR_MODEL ?? 'claude-opus-5-5';
/** Cérebro do agente: 'local' (padrão — regras em código, sem API) ou 'claude' (API da Anthropic). */
export const BRAIN: 'local' | 'claude' = process.env.NEWEDITOR_BRAIN === 'claude' ? 'claude' : 'local';

/** Resolução de análise de energia: janela 20 ms, passo 10 ms (procedimento validado no Cérebro do Editor). */
export const ENV_HOP = 0.01;
export const ENV_WIN = 0.02;
export const ANALYSIS_RATE = 16000;
