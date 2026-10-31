import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useEditor } from '../lib/store.ts';
import { IconButton } from './ui.tsx';

const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Reprodução',
    keys: [
      ['Espaço', 'Tocar / pausar'],
      ['J / K / L', 'Voltar 3 s e tocar / pausar / tocar'],
      ['← →  ou  , .', 'Um quadro (com Shift: 1 s)'],
      ['↑ / ↓', 'Corte anterior / seguinte'],
      ['Home / End', 'Início / fim'],
    ],
  },
  {
    title: 'Corte',
    keys: [
      ['⌘B  ou  S', 'Dividir no cursor'],
      ['Q', 'Aparar o começo do clipe até o cursor'],
      ['W', 'Aparar o fim do clipe a partir do cursor'],
      ['I / O', 'Marcar entrada / saída'],
      ['Delete', 'Apagar a seleção (ou o intervalo I–O)'],
      ['X', 'Limpar as marcas I–O'],
    ],
  },
  {
    title: 'Timeline',
    keys: [
      ['N', 'Ímã liga / desliga'],
      ['⌥ + roda  ou  ⌘ + roda', 'Zoom em volta do mouse'],
      ['+ / −', 'Zoom'],
      ['⇧Z', 'Ajustar à janela (a timeline inteira na tela)'],
      ['Arrastar a borda do cabeçalho', 'Altura da trilha (duplo clique volta ao padrão)'],
      ['⇧ + roda', 'Rolar no tempo'],
      ['Arrastar no vazio', 'Laço: seleciona vários'],
      ['Shift + clique', 'Soma à seleção'],
      ['⌘A', 'Selecionar todas as camadas'],
      ['Clique direito', 'Menu: dividir, aparar, esticar até o corte, pedir ao agente'],
      ['Esc', 'Tirar a seleção'],
    ],
  },
  {
    title: 'Geral',
    keys: [
      ['⌘Z / ⇧⌘Z', 'Desfazer / refazer'],
      ['⌘E', 'Exportar'],
      ['⌘K', 'Paleta de comandos (ação ou pedido ao agente)'],
      ['B (segurar)', 'Ver como estava antes da última passada do agente'],
      ['?', 'Esta folha'],
    ],
  },
];

/** Folha de atalhos do editor (tecla ?). */
export function Shortcuts() {
  const open = useEditor((s) => s.shortcutsOpen);
  const setOpen = useEditor((s) => s.setShortcutsOpen);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open, setOpen]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/60 p-6" onMouseDown={() => setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-label="Atalhos do teclado" className="anim-pop w-full max-w-2xl rounded-[var(--radius-ui-lg)] border border-ink-600 bg-ink-850 p-5 shadow-[var(--shadow-ui-3)]" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-ui-lg font-semibold text-white">Atalhos do teclado</h2>
          <IconButton label="Fechar" onClick={() => setOpen(false)}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3 className="mb-2 text-ui-xs font-semibold tracking-wide text-ink-400 uppercase">{g.title}</h3>
              <dl className="space-y-1.5">
                {g.keys.map(([k, d]) => (
                  <div key={k} className="flex items-center justify-between gap-3 text-ui-sm">
                    <dt className="text-ink-200">{d}</dt>
                    <dd>
                      <kbd className="rounded-[var(--radius-ui-sm)] border border-ink-600 bg-ink-800 px-1.5 py-0.5 font-mono text-ui-xs whitespace-nowrap text-ink-100">{k}</kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
