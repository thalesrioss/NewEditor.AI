/** Ações compartilhadas pelos dois cérebros de comando (local e Claude). */
import path from 'node:path';
import { OpError, type AgentState, type OpEnvelope, type Project } from '@neweditor/core';
import { readTranscript, type Transcript } from './asr.ts';
import { sleep } from './jobs.ts';
import { store } from './store.ts';

export async function loadTranscripts(p: Project): Promise<Map<string, Transcript>> {
  const m = new Map<string, Transcript>();
  for (const a of p.assets) if (a.transcript) m.set(a.id, await readTranscript(path.join(store.dir(p.id), a.transcript)));
  return m;
}

export function textOf(tr: Transcript | undefined, a: number, b: number): string {
  if (!tr) return '';
  return tr.words.filter((w) => w.end > a && w.start < b).map((w) => w.w).join(' ');
}

/** Move o avatar até o ponto, espera um instante (o humano vê o gesto) e aplica a operação. */
export async function act(projectId: string, env: OpEnvelope, state: AgentState, at: number, message: string): Promise<string> {
  store.setActivity(projectId, { state, message, at });
  await sleep(450);
  try {
    store.apply(projectId, env);
    return 'ok';
  } catch (e) {
    if (e instanceof OpError) return `erro: ${e.message}`;
    throw e;
  }
}

export function finish(projectId: string, answer: string): string {
  store.log(projectId, 'agent', answer);
  store.setActivity(projectId, { state: 'celebrating', message: 'Alteração feita' });
  setTimeout(() => store.setActivity(projectId, { state: 'idle', message: 'Pronto' }), 2200);
  return answer;
}
