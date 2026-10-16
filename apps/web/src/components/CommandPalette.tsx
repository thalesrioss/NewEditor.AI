/**
 * Paleta de comandos ⌘K (D-4): ações do editor e pedido ao agente no mesmo campo. Digite uma ação
 * (dividir, exportar, ímã…) ou qualquer frase — o que não é ação vira pedido ao agente no cursor.
 */
import { useEffect, useMemo, useState } from 'react';
import { Command, CornerDownLeft } from 'lucide-react';
import { formatTime } from '@neweditor/core';
import { api } from '../lib/api.ts';
import { useEditor } from '../lib/store.ts';
import { openRightTab } from '../editor/shared.ts';

interface Action {
  id: string;
  label: string;
  hint?: string;
  keys?: string;
  run: () => void;
}

export function CommandPalette({ onExport }: { onExport: () => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        setQ('');
        setI(0);
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  const actions = useMemo<Action[]>(() => {
    const s = () => useEditor.getState();
    return [
      { id: 'split', label: 'Dividir no cursor', keys: 'S', run: () => s().sendOp({ op: { type: 'split', time: s().playhead }, note: 'Dividiu um clipe' }) },
      { id: 'magnet', label: s().magnet ? 'Desligar o ímã' : 'Ligar o ímã', keys: 'N', run: () => s().setMagnet(!s().magnet) },
      { id: 'export', label: 'Exportar e entregar…', run: onExport },
      { id: 'review', label: 'Abrir a Revisão', run: () => openRightTab('revisao') },
      { id: 'agent', label: 'Abrir o Agente', run: () => openRightTab('agente') },
      { id: 'props', label: 'Abrir Propriedades', run: () => openRightTab('propriedades') },
      { id: 'undo', label: 'Desfazer', keys: '⌘Z', run: () => s().send({ type: 'undo' }) },
      { id: 'redo', label: 'Refazer', keys: '⇧⌘Z', run: () => s().send({ type: 'redo' }) },
      {
        id: 'qc',
        label: 'Rodar o QC',
        run: () => {
          const p = s().project;
          if (p) void api.qc(p.id);
        },
      },
      {
        id: 'zooms',
        label: 'Quebras de padrão: cut zooms automáticos',
        hint: 'coloca zooms nas ênfases onde a peça fica parada',
        run: () => {
          const p = s().project;
          if (p) void api.autoZooms(p.id);
        },
      },
      {
        id: 'ate-o-corte',
        label: 'Esticar motions e B-rolls até o corte',
        hint: 'nada termina no meio de um clipe (regra da casa)',
        run: () => {
          const p = s().project;
          if (p) void api.ateOCorte(p.id);
        },
      },
      {
        id: 'broll-auto',
        label: 'B-roll automático (Cinéfilo)',
        hint: 'cenas de filme nas frases de imagem forte, até ~40% de cobertura',
        run: () => {
          const p = s().project;
          if (p) void api.autoBroll(p.id);
        },
      },
      {
        id: 'studio-ordens',
        label: 'Pedir cenas ao Motion Studio',
        hint: 'escreve uma pasta por cena no Cérebro do Editor (modo CENA)',
        run: () => {
          const p = s().project;
          if (p) void api.motionStudioOrdens(p.id);
        },
      },
      {
        id: 'studio-importar',
        label: 'Importar do Motion Studio',
        hint: 'os renders com alfa entram na V3 no frame certo',
        run: () => {
          const p = s().project;
          if (p) void api.motionStudioImport(p.id);
        },
      },
      {
        id: 'flashes',
        label: 'Flashes onde a emenda apareceria',
        hint: 'troca de arquivo e saltos longos, como no padrão da casa',
        run: () => {
          const p = s().project;
          if (p) void api.autoFlashes(p.id);
        },
      },
      {
        id: 'music',
        label: 'Trilha pela batida',
        hint: 'escolhe a música pelo ritmo do corte e começa num tempo forte',
        run: () => {
          const p = s().project;
          if (p) void api.musicAuto(p.id);
        },
      },
      {
        id: 'reframe',
        label: 'Reframe seguindo o rosto',
        hint: 'material 16:9 numa peça vertical',
        run: () => {
          const p = s().project;
          if (p) void api.reframeAuto(p.id);
        },
      },
      {
        id: 'multicam',
        label: 'Alternar câmeras automaticamente',
        run: () => {
          const p = s().project;
          if (p) void api.multicamAuto(p.id);
        },
      },
      { id: 'start', label: 'Ir para o início', run: () => s().seek(0) },
      { id: 'shortcuts', label: 'Atalhos do teclado', keys: '?', run: () => s().setShortcutsOpen(true) },
      { id: 'home', label: 'Voltar ao Kanban', run: () => (location.hash = '#/') },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const norm = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const list = q.trim() ? actions.filter((a) => norm(a.label).includes(norm(q)) || (a.hint && norm(a.hint).includes(norm(q)))) : actions;
  const playhead = useEditor((s) => s.playhead);
  const ask = () => {
    const st = useEditor.getState();
    if (!st.project || !q.trim()) return;
    void api.command(st.project.id, q.trim(), st.playhead);
    openRightTab('agente');
    setOpen(false);
  };
  const pick = (a: Action) => {
    a.run();
    setOpen(false);
  };
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-start justify-center bg-black/50 pt-[12vh]" onMouseDown={() => setOpen(false)}>
      <div role="dialog" aria-label="Paleta de comandos" onMouseDown={(e) => e.stopPropagation()} className="anim-pop w-full max-w-lg overflow-hidden rounded-[var(--radius-ui-lg)] border border-ink-600 bg-ink-850 shadow-[var(--shadow-ui-3)]">
        <div className="flex items-center gap-2 border-b border-ink-750 px-3">
          <Command size={14} className="text-ink-400" />
          <input
            autoFocus
            value={q}
            onChange={(e) => (setQ(e.target.value), setI(0))}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') setOpen(false);
              if (e.key === 'ArrowDown') (e.preventDefault(), setI((x) => Math.min(list.length, x + 1)));
              if (e.key === 'ArrowUp') (e.preventDefault(), setI((x) => Math.max(0, x - 1)));
              if (e.key === 'Enter') {
                e.preventDefault();
                if (list[i]) pick(list[i]!);
                else ask();
              }
            }}
            placeholder="Ação ou pedido ao agente… (ex.: tira a pausa longa aqui)"
            className="h-11 min-w-0 flex-1 bg-transparent text-ui-md text-ink-100 placeholder:text-ink-400 focus:outline-none"
          />
          <kbd className="rounded border border-ink-600 px-1 text-ui-2xs text-ink-400">Esc</kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto py-1">
          {list.map((a, k) => (
            <li key={a.id}>
              <button onMouseEnter={() => setI(k)} onClick={() => pick(a)} className={`flex w-full items-center gap-2 px-3 py-2 text-left text-ui-sm ${k === i ? 'bg-nc-500/15 text-white' : 'text-ink-200'}`}>
                <span className="flex-1">
                  {a.label}
                  {a.hint && <span className="ml-2 text-ui-2xs text-ink-400">{a.hint}</span>}
                </span>
                {a.keys && <kbd className="rounded border border-ink-600 px-1 font-mono text-ui-2xs text-ink-400">{a.keys}</kbd>}
              </button>
            </li>
          ))}
          {q.trim() && (
            <li>
              <button onMouseEnter={() => setI(list.length)} onClick={ask} className={`flex w-full items-center gap-2 px-3 py-2 text-left text-ui-sm ${i === list.length ? 'bg-nc-500/15 text-white' : 'text-ink-200'}`}>
                <span className="flex-1">
                  Pedir ao agente em {formatTime(playhead)}: <span className="text-nc-300">"{q.trim()}"</span>
                </span>
                <CornerDownLeft size={12} className="text-ink-400" />
              </button>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
