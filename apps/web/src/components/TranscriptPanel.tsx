import { useEffect, useMemo, useRef } from 'react';
import { RotateCcw, Scissors, X } from 'lucide-react';
import { locate, sourceToTimeline, type Removal, fixedText } from '@neweditor/core';
import { api } from '../lib/api.ts';
import { useEditor } from '../lib/store.ts';
import { KIND_STYLE } from '../editor/shared.ts';

/**
 * Transcrição da fala, palavra por palavra — editar o texto edita o vídeo (estilo Descript):
 *  · clique numa palavra: o cursor vai até ela
 *  · arraste ou Shift+clique: seleciona um trecho → ⌫ apaga (corte com bordas medidas)
 *  · palavra riscada (cortada): selecione e restaure, ou dê duplo clique
 */
export function TranscriptPanel() {
  const project = useEditor((s) => s.project);
  const transcripts = useEditor((s) => s.transcripts);
  const playhead = useEditor((s) => s.playhead);
  const wordSel = useEditor((s) => s.wordSel);
  const selectWords = useEditor((s) => s.selectWords);
  const seek = useEditor((s) => s.seek);
  const sendOp = useEditor((s) => s.sendOp);
  const box = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);

  const asset = project?.assets.find((a) => a.role === 'fala' && transcripts[a.id]) ?? project?.assets.find((a) => transcripts[a.id]);
  const words = asset ? transcripts[asset.id] : undefined;
  const timeline = project?.timeline;

  const removalOf = useMemo(() => {
    if (!asset || !words || !timeline) return [] as (Removal | undefined)[];
    const rs = timeline.removals.filter((r) => r.assetId === asset.id);
    return words.map((w) => {
      const mid = w.c ?? (w.start + w.end) / 2;
      return rs.find((r) => mid >= r.in && mid < r.out);
    });
  }, [asset, words, timeline]);

  const current = useMemo(() => {
    if (!timeline?.main.length || !words || !asset) return -1;
    const loc = locate(timeline, playhead);
    if (!loc || loc.clip.assetId !== asset.id) return -1;
    return words.findIndex((w) => w.end > loc.sourceTime);
  }, [timeline, playhead, words, asset]);

  useEffect(() => {
    if (dragging.current !== null) return;
    const el = box.current?.querySelector<HTMLElement>(`[data-i="${current}"]`);
    if (el && box.current) {
      const top = el.offsetTop - box.current.offsetTop;
      if (top < box.current.scrollTop + 40 || top > box.current.scrollTop + box.current.clientHeight - 80) box.current.scrollTo({ top: top - 80, behavior: 'smooth' });
    }
  }, [current]);

  useEffect(() => {
    const up = () => (dragging.current = null);
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const stats = useMemo(() => {
    const m = new Map<string, number>();
    let last: Removal | undefined;
    for (const r of removalOf) {
      if (r && r !== last) m.set(r.kind, (m.get(r.kind) ?? 0) + 1);
      last = r;
    }
    return m;
  }, [removalOf]);

  const sel = wordSel && asset && wordSel.assetId === asset.id ? wordSel : null;
  const lo = sel ? Math.min(sel.from, sel.to) : -1;
  const hi = sel ? Math.max(sel.from, sel.to) : -1;
  const selRemoved = sel ? removalOf.slice(lo, hi + 1).filter(Boolean).length : 0;
  const selKept = sel ? hi - lo + 1 - selRemoved : 0;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="border-b border-ink-750 px-4 py-2.5">
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {(Object.keys(KIND_STYLE) as (keyof typeof KIND_STYLE)[])
            .filter((k) => k !== 'silence')
            .map((k) => (
              <span key={k} className="flex items-center gap-1 text-ui-xs text-ink-400">
                <span className="h-2 w-2 rounded-sm" style={{ background: KIND_STYLE[k].color }} />
                {KIND_STYLE[k].label}
                {stats.get(k) ? <span className="text-ink-400">({stats.get(k)})</span> : null}
              </span>
            ))}
        </div>
      </div>
      <div ref={box} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-3 pb-16 text-ui-md leading-[1.9]">
        {!words && <p className="pt-6 text-center text-ui-sm text-ink-400">{project?.assets.length ? 'Transcrevendo…' : 'Sem material ainda.'}</p>}
        {words?.map((w, i) => {
          const r = removalOf[i];
          const isCur = i === current;
          const isSel = i >= lo && i <= hi;
          const newPara = i > 0 && w.start - words[i - 1]!.end > 1.2;
          return (
            <span key={i}>
              {newPara && <span className="block h-2" />}
              <span
                data-i={i}
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (e.shiftKey && sel) {
                    selectWords({ assetId: asset!.id, from: sel.from, to: i });
                    return;
                  }
                  dragging.current = i;
                  selectWords({ assetId: asset!.id, from: i, to: i });
                  if (!r && timeline && asset) {
                    const t = sourceToTimeline(timeline, asset.id, (w.c ?? w.start) + 0.001);
                    if (t !== null) seek(Math.max(0, t - 0.05));
                  }
                }}
                onMouseEnter={() => {
                  if (dragging.current !== null && asset) selectWords({ assetId: asset.id, from: dragging.current, to: i });
                }}
                onDoubleClick={() => {
                  if (r) return sendOp({ op: { type: 'restore', removalId: r.id }, note: `Restaurou: ${r.reason}` });
                  // Duplo clique numa palavra que ficou: corrige a grafia (vale para legenda, lettering e motion).
                  if (!timeline || !asset) return;
                  const cur = fixedText(timeline, asset.id, w);
                  const next = window.prompt('Grafia correta desta palavra (vazio desfaz a correção):', cur);
                  if (next !== null && next.trim() !== cur) sendOp({ op: { type: 'fix_words', fixes: [{ assetId: asset.id, at: w.start, text: next.trim() || '' }] }, note: next.trim() ? `Corrigiu "${w.w}" → "${next.trim()}"` : `Desfez a correção de "${w.w}"` });
                }}
                title={r ? `${KIND_STYLE[r.kind].label}: ${r.reason}\n(duplo clique restaura)` : timeline && fixedText(timeline, asset!.id, w) !== w.w ? `Transcrição: "${w.w}" (corrigido)\nDuplo clique corrige a grafia` : 'Duplo clique corrige a grafia'}
                className={`cursor-text rounded-[3px] px-[1px] ${
                  isSel ? 'bg-nc-400/35 text-white' : r ? 'line-through decoration-2 opacity-55 hover:opacity-100' : isCur ? 'bg-nc-500 text-white' : 'text-ink-100 hover:bg-ink-700'
                }`}
                style={r && !isSel ? { color: KIND_STYLE[r.kind].color, textDecorationColor: KIND_STYLE[r.kind].color } : r ? { textDecoration: 'line-through' } : undefined}
              >
                {timeline ? fixedText(timeline, asset!.id, w) : w.w}
              </span>{' '}
            </span>
          );
        })}
      </div>

      {sel && project && asset && (
        <div className="anim-pop absolute inset-x-3 bottom-3 flex items-center gap-1.5 rounded-ui-lg border border-ink-600 bg-ink-800/95 p-1.5 shadow-ui-3 backdrop-blur">
          <span className="px-1.5 text-ui-xs text-ink-300">{hi - lo + 1} palavra(s)</span>
          {selKept > 0 && (
            <button onClick={() => void cutSelection(project.id, asset.id, lo, hi)} className="flex items-center gap-1 rounded-ui-md bg-rose-500/90 px-2.5 py-1 text-ui-sm font-semibold text-white hover:bg-rose-500">
              <Scissors size={12} /> Apagar <kbd className="ml-0.5 rounded bg-black/20 px-1 text-ui-xs">⌫</kbd>
            </button>
          )}
          {selRemoved > 0 && (
            <button onClick={() => void api.restoreWords(project.id, asset.id, lo, hi).then(() => selectWords(null))} className="flex items-center gap-1 rounded-ui-md bg-emerald-500/90 px-2.5 py-1 text-ui-sm font-semibold text-white hover:bg-emerald-500">
              <RotateCcw size={12} /> Restaurar
            </button>
          )}
          <button aria-label="Limpar seleção (Esc)" onClick={() => selectWords(null)} className="ml-auto rounded-ui-md p-1 text-ink-400 hover:text-white" title="Limpar seleção (Esc)">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

/** Apaga as palavras mantidas da seleção. Exportado para o atalho ⌫ do editor. */
export async function cutSelection(projectId: string, assetId: string, from: number, to: number): Promise<void> {
  await api.cutWords(projectId, assetId, from, to);
  useEditor.getState().selectWords(null);
}
