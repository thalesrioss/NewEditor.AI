/** Palavras fora do dicionário pt-BR (corretor do macOS, local). Em outro sistema, não acusa nada. */
import path from 'node:path';
import { ROOT } from './config.ts';
import { run } from './media.ts';

const SCRIPT = path.join(ROOT, 'services', 'spell', 'spell.js');
const cache = new Map<string, string[] | null>();

export async function misspelled(words: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (process.platform !== 'darwin') return out;
  const todo = [...new Set(words)].filter((w) => !cache.has(w));
  for (let i = 0; i < todo.length; i += 400) {
    const batch = todo.slice(i, i + 400);
    try {
      const res = JSON.parse((await run('osascript', ['-l', 'JavaScript', SCRIPT, ...batch])).toString() || '{}') as Record<string, string[]>;
      for (const w of batch) cache.set(w, res[w] ?? null);
    } catch {
      for (const w of batch) cache.set(w, null);
    }
  }
  for (const w of words) {
    const g = cache.get(w);
    if (g) out.set(w, g);
  }
  return out;
}
