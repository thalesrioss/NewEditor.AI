import { useEffect, useMemo, useState } from 'react';
import { sourceToTimeline, type Removal } from '@neweditor/core';
import { api, type ReviewDoubt } from '../../lib/api.ts';
import { useEditor } from '../../lib/store.ts';
import { KIND_STYLE, openRightTab, ROW } from '../shared.ts';

/**
 * O que o agente decidiu, em cima do vídeo: ✂ onde ele tirou trechos (com o motivo; clique restaura só aquele),
 * ◆ onde ele tem dúvida para o humano (clique abre a Revisão) e 💬 pedidos de alteração.
 */
export function AgentMarks({ pps, pad }: { pps: number; pad: number }) {
  const project = useEditor((s) => s.project);
  const seek = useEditor((s) => s.seek);
  const sendOp = useEditor((s) => s.sendOp);
  const [doubts, setDoubts] = useState<ReviewDoubt[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const pid = project?.id;
  const status = project?.status;
  useEffect(() => {
    if (!pid) return;
    api.review(pid).then((r) => setDoubts(r.doubts)).catch(() => setDoubts([]));
  }, [pid, status, project?.version]);
  const tl = project?.timeline;
  const cuts = useMemo(() => {
    if (!tl) return [] as { t: number; items: Removal[] }[];
    const by = new Map<number, Removal[]>();
    for (const r of tl.removals) {
      const t = sourceToTimeline(tl, r.assetId, r.in) ?? sourceToTimeline(tl, r.assetId, r.out);
      if (t === null) continue;
      const k = Math.round(t * 20) / 20;
      by.set(k, [...(by.get(k) ?? []), r]);
    }
    return [...by.entries()].map(([t, items]) => ({ t, items })).sort((a, b) => a.t - b.t);
  }, [tl]);
  if (!tl) return null;
  const doubtMarks = doubts.flatMap((d) => {
    const t = sourceToTimeline(tl, d.assetId, d.at ?? d.in);
    return t === null ? [] : [{ t, d }];
  });
  return (
    <div className="relative border-b border-ink-750/60" style={{ height: ROW.marks, marginLeft: pad }}>
      {cuts.map((c, i) => {
        const k = c.items[0]!.kind;
        const color = KIND_STYLE[k]?.color ?? 'var(--color-cut-manual)';
        return (
          <div key={i} className="absolute top-0" style={{ left: c.t * pps - 5 }}>
            <button
              aria-label={`Corte: ${c.items.map((r) => r.reason).join('; ')}`}
              title={c.items.map((r) => `${KIND_STYLE[r.kind]?.label ?? r.kind} · ${(r.out - r.in).toFixed(1)}s · ${r.reason}${r.by === 'agent' ? ' (agente)' : ''}`).join('\n')}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setOpen(open === i ? null : i)}
              className="block h-3 w-2.5 rounded-sm text-[0px] hover:scale-125"
              style={{ background: color, opacity: c.items.some((r) => r.by === 'agent') ? 1 : 0.55 }}
            >
              ✂
            </button>
            {open === i && (
              <div className="anim-pop absolute top-4 left-0 z-[var(--z-popover)] w-64 space-y-1 rounded-[var(--radius-ui-md)] border border-ink-600 bg-ink-850 p-2 shadow-[var(--shadow-ui-2)]" onMouseDown={(e) => e.stopPropagation()}>
                {c.items.map((r) => (
                  <div key={r.id} className="flex items-start gap-2 text-ui-xs">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: KIND_STYLE[r.kind]?.color }} />
                    <span className="min-w-0 flex-1 text-ink-200">
                      {KIND_STYLE[r.kind]?.label ?? r.kind} · {(r.out - r.in).toFixed(1)}s<span className="block text-ink-400">{r.reason}</span>
                    </span>
                    <button className="shrink-0 rounded px-1.5 py-0.5 text-ui-2xs font-semibold text-nc-300 hover:bg-nc-500/20" onClick={() => (sendOp({ op: { type: 'restore', removalId: r.id }, note: 'Restaurou um corte' }), setOpen(null))}>
                      Restaurar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {(project.comments ?? []).map((c) => (
        <button
          key={c.id}
          aria-label={`Alteração: ${c.text}`}
          title={`${c.by === 'cliente' ? 'Cliente' : 'Você'}: ${c.text}${c.status !== 'aberto' ? ` (${c.status})` : ''}`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => (seek(c.at), openRightTab('revisao'))}
          className={`absolute top-0 h-3 w-3 rounded-full border text-[8px] leading-3 hover:scale-125 ${c.status === 'aberto' ? 'border-violet-200 bg-violet-400 text-ink-950' : c.status === 'manual' ? 'border-amber-200 bg-amber-400 text-ink-950' : 'border-ink-500 bg-ink-600 text-ink-300'}`}
          style={{ left: c.at * pps - 6 }}
        >
          💬
        </button>
      ))}
      {doubtMarks.map(({ t, d }) => (
        <button key={d.id} aria-label={`Dúvida do agente: ${d.question}`} title={`Dúvida: ${d.question}`} onMouseDown={(e) => e.stopPropagation()} onClick={() => (seek(t), openRightTab('revisao'))} className="absolute top-0.5 h-2.5 w-2.5 rotate-45 border border-amber-200 bg-amber-400 hover:scale-125" style={{ left: t * pps - 5 }} />
      ))}
    </div>
  );
}
