/**
 * Modo Revisão focado (auditoria D-1): uma dúvida por vez, em cima do player, com o teclado —
 * J/K ou ↓/↑ próxima/anterior · L ouvir · A está certo · T trocar tomada · R restaurar · Esc sair.
 */
import { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Play, RotateCcw, Undo2, X } from 'lucide-react';
import { formatTime, textoPassaDoAlvo } from '@neweditor/core';
import { api, type ReviewDoubt } from '../lib/api.ts';
import { useEditor } from '../lib/store.ts';
import { Button, IconButton } from './ui.tsx';

const KIND_LABEL: Record<ReviewDoubt['kind'], string> = { tomada: 'Tomada', corte: 'Corte', agente: 'Dúvida do agente', palavra: 'Grafia', nome: 'Nome' };

export function ReviewFocus({ doubts, acima, onListen, playing, onResolve, onClose, onApprove }: { doubts: ReviewDoubt[]; acima?: { total: number; alvo: number }; onListen: (d: ReviewDoubt) => void; playing: string | null; onResolve: (d: ReviewDoubt) => void; onClose: () => void; onApprove: () => void }) {
  const project = useEditor((s) => s.project)!;
  const sendOp = useEditor((s) => s.sendOp);
  const seek = useEditor((s) => s.seek);
  const [i, setI] = useState(0);
  const d = doubts[Math.min(i, doubts.length - 1)];
  useEffect(() => {
    if (d?.at !== null && d?.at !== undefined) seek(d.at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d?.id]);
  const next = () => setI((x) => Math.min(doubts.length - 1, x + 1));
  const prev = () => setI((x) => Math.max(0, x - 1));
  const restore = () => d?.removalId && sendOp({ op: { type: 'restore', removalId: d.removalId }, note: 'Restaurou um trecho na revisão' });
  const swap = () => d?.swap && void api.swapTake(project.id, d.id);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select')) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') return onClose();
      if (k === 'j' || e.key === 'ArrowDown') return (e.preventDefault(), next());
      if (k === 'k' || e.key === 'ArrowUp') return (e.preventDefault(), prev());
      if (!d) return;
      if (k === 'l') return (e.preventDefault(), onListen(d));
      if (k === 'a') return (e.preventDefault(), onResolve(d), void 0);
      if (k === 't' && d.swap) return (e.preventDefault(), swap());
      if (k === 'r' && d.removalId) return (e.preventDefault(), restore());
      if (e.key === 'Enter' && !doubts.length) return onApprove();
    };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, doubts.length]);

  return (
    <div className="absolute inset-0 z-[var(--z-modal)] flex flex-col bg-ink-900/95 backdrop-blur-sm">
      <div className="flex items-center gap-2 border-b border-ink-750 px-3 py-2">
        <span className="text-ui-sm font-semibold text-white">Revisão focada</span>
        <span className="text-ui-xs text-ink-400">
          {doubts.length ? `${Math.min(i + 1, doubts.length)} de ${doubts.length}` : 'nada pendente'}
        </span>
        <span className="ml-auto flex gap-1">
          <IconButton label="Anterior" shortcut="K" onClick={prev} disabled={i <= 0}>
            <ChevronUp size={14} />
          </IconButton>
          <IconButton label="Próxima" shortcut="J" onClick={next} disabled={i >= doubts.length - 1}>
            <ChevronDown size={14} />
          </IconButton>
          <IconButton label="Sair do modo focado" shortcut="Esc" onClick={onClose}>
            <X size={14} />
          </IconButton>
        </span>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">
        {d ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-ui-xs">
              <span className="rounded-full bg-ink-700 px-2 py-0.5 font-semibold text-ink-200">{KIND_LABEL[d.kind]}</span>
              {d.at !== null && <span className="font-mono text-ink-400">{formatTime(d.at)}</span>}
            </div>
            <p className="text-ui-md leading-snug text-white">{d.question}</p>
            <blockquote className="rounded-[var(--radius-ui-md)] border-l-2 border-ink-600 bg-ink-800 p-3 text-ui-sm leading-relaxed text-ink-200">"{d.text}"</blockquote>
            {d.swap && (
              <div className="text-ui-xs text-ink-400">
                Ficou no lugar: <span className="text-ink-200">"{d.swap.text}"</span>
              </div>
            )}
            {d.suggestions && d.suggestions.length > 0 && <div className="text-ui-xs text-ink-400">Sugestões: {d.suggestions.slice(0, 4).join(', ')}</div>}
            <div className="flex flex-wrap gap-1.5 pt-1">
              <Button size="sm" icon={<Play size={12} />} onClick={() => onListen(d)}>
                {playing === d.id ? 'Parar' : 'Ouvir'} <kbd className="ml-1 text-ui-2xs text-ink-400">L</kbd>
              </Button>
              <Button size="sm" variant="primary" icon={<Check size={12} />} onClick={() => onResolve(d)}>
                Está certo <kbd className="ml-1 text-ui-2xs opacity-70">A</kbd>
              </Button>
              {d.swap && (
                <Button size="sm" icon={<RotateCcw size={12} />} onClick={swap}>
                  Trocar por esta <kbd className="ml-1 text-ui-2xs text-ink-400">T</kbd>
                </Button>
              )}
              {d.removalId && (
                <Button size="sm" icon={<Undo2 size={12} />} onClick={restore}>
                  Restaurar <kbd className="ml-1 text-ui-2xs text-ink-400">R</kbd>
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            {acima ? <p className="max-w-sm text-ui-md text-amber-300">{textoPassaDoAlvo(acima)}.</p> : <p className="text-ui-md text-emerald-300">Nada pendente.</p>}
            <Button variant="primary" onClick={onApprove}>
              Aprovar decupagem e finalizar <kbd className="ml-1 text-ui-2xs opacity-70">Enter</kbd>
            </Button>
          </div>
        )}
      </div>
      <p className="border-t border-ink-750 px-3 py-1.5 text-ui-2xs text-ink-400">J/K próxima e anterior · L ouvir · A está certo · T trocar tomada · R restaurar · Esc sair</p>
    </div>
  );
}
