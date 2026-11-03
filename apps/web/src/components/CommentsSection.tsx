/**
 * Ciclo de Alteração (F-3): pedidos com tempo na timeline. O editor adiciona (ou repassa os do cliente), o
 * agente faz o que entende, e o que não entende fica marcado para fazer à mão. Versões ficam comparáveis.
 */
import { useEffect, useState } from 'react';
import { Check, MessageSquarePlus, Trash2, Wand2 } from 'lucide-react';
import { formatTime } from '@neweditor/core';
import { api } from '../lib/api.ts';
import { useEditor } from '../lib/store.ts';
import { Button, IconButton } from './ui.tsx';

export function CommentsSection() {
  const project = useEditor((s) => s.project)!;
  const playhead = useEditor((s) => s.playhead);
  const seek = useEditor((s) => s.seek);
  const [text, setText] = useState('');
  const [by, setBy] = useState<'editor' | 'cliente'>('editor');
  const [diff, setDiff] = useState<{ a: number; b: number | string; diff: { duracao: [number, number]; cortesNovos: number; cortesDesfeitos: number; overlaysNovos: string[]; overlaysRemovidos: string[]; zooms: number } } | null>(null);
  const comments = project.comments ?? [];
  const open = comments.filter((c) => c.status === 'aberto');
  const versions = project.versions ?? [];
  useEffect(() => {
    if (versions.length >= 2) api.versoesDiff(project.id).then(setDiff).catch(() => setDiff(null));
    else setDiff(null);
  }, [project.id, versions.length]);
  const add = async () => {
    if (!text.trim()) return;
    await api.addComment(project.id, { at: playhead, text: text.trim(), by });
    setText('');
  };
  return (
    <section className="space-y-2 rounded-ui-md border border-ink-700 bg-ink-800/60 p-3">
      <div className="flex items-center gap-2">
        <MessageSquarePlus size={14} className="text-nc-300" />
        <span className="text-ui-xs font-semibold text-ink-100">Alterações {comments.length ? `· ${open.length} aberta(s) de ${comments.length}` : ''}</span>
        {open.length > 0 && (
          <Button size="sm" variant="primary" className="ml-auto" icon={<Wand2 size={12} />} onClick={() => void api.alteracoes(project.id)}>
            Agente resolve
          </Button>
        )}
      </div>
      <div className="flex items-end gap-1.5">
        <div className="min-w-0 flex-1 space-y-1">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && !e.shiftKey) (e.preventDefault(), void add());
            }}
            rows={2}
            placeholder={`Pedido em ${formatTime(playhead)}: "tira a parte em que ele gagueja", "dá um zoom aqui"…`}
            className="input resize-none text-ui-xs"
          />
          <div className="flex items-center gap-2 text-ui-xs text-ink-400">
            De:
            {(['editor', 'cliente'] as const).map((b) => (
              <button key={b} onClick={() => setBy(b)} className={`rounded-full border px-2 py-px ${by === b ? 'border-nc-400 text-nc-300' : 'border-ink-700 hover:text-ink-200'}`}>
                {b === 'editor' ? 'mim' : 'cliente'}
              </button>
            ))}
          </div>
        </div>
        <Button size="sm" onClick={add} disabled={!text.trim()}>
          Adicionar
        </Button>
      </div>
      {comments.length > 0 && (
        <ul className="space-y-1">
          {[...comments]
            .sort((a, b) => a.at - b.at)
            .map((c) => (
              <li key={c.id} className={`group rounded-ui-sm px-2 py-1.5 text-ui-xs ${c.status === 'aberto' ? 'bg-ink-800' : c.status === 'manual' ? 'bg-amber-400/10' : 'bg-ink-850 opacity-70'}`}>
                <div className="flex items-start gap-1.5">
                  <button className="font-mono text-ink-400 hover:text-white" onClick={() => seek(c.at)}>
                    {formatTime(c.at)}
                  </button>
                  <span className={`rounded px-1 text-ui-xs ${c.by === 'cliente' ? 'bg-violet-400/15 text-violet-300' : 'bg-ink-700 text-ink-300'}`}>{c.by}</span>
                  <span className={`min-w-0 flex-1 text-ink-200 ${c.status === 'feito' ? 'line-through decoration-ink-600' : ''}`}>{c.text}</span>
                  <span className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                    {c.status !== 'feito' && (
                      <IconButton label="Marcar como feito" className="!p-0.5" onClick={() => void api.patchComment(project.id, c.id, { status: 'feito' })}>
                        <Check size={11} />
                      </IconButton>
                    )}
                    <IconButton label="Remover" className="!p-0.5" onClick={() => void api.removeComment(project.id, c.id)}>
                      <Trash2 size={11} />
                    </IconButton>
                  </span>
                </div>
                {c.resposta && <div className={`mt-0.5 pl-10 text-ui-xs ${c.status === 'manual' ? 'text-amber-200' : 'text-ink-400'}`}>{c.status === 'manual' ? 'Para fazer à mão — ' : 'Agente: '}{c.resposta.slice(0, 160)}</div>}
              </li>
            ))}
        </ul>
      )}
      {versions.length > 0 && (
        <div className="border-t border-ink-750 pt-2 text-ui-xs text-ink-400">
          Versões: {versions.map((v) => `v${v.n} ${v.label}`).join(' · ')}
          {diff && (
            <div className="mt-1 text-ink-300">
              v{diff.a} → {diff.b === 'atual' ? 'atual' : `v${diff.b}`}: {formatTime(diff.diff.duracao[0])} → {formatTime(diff.diff.duracao[1])}
              {diff.diff.cortesNovos ? ` · +${diff.diff.cortesNovos} corte(s)` : ''}
              {diff.diff.cortesDesfeitos ? ` · ${diff.diff.cortesDesfeitos} restaurado(s)` : ''}
              {diff.diff.overlaysNovos.length ? ` · +${diff.diff.overlaysNovos.length} overlay(s)` : ''}
              {diff.diff.overlaysRemovidos.length ? ` · −${diff.diff.overlaysRemovidos.length} overlay(s)` : ''}
              {diff.diff.zooms ? ` · zooms ${diff.diff.zooms > 0 ? '+' : ''}${diff.diff.zooms}` : ''}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
