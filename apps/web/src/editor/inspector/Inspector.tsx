import { useEditor } from '../../lib/store.ts';
import { AgentPanel, type Brain } from '../../components/AgentPanel.tsx';
import { ReviewPanel } from '../../components/ReviewPanel.tsx';
import { Properties } from './Properties.tsx';
import type { RightTab } from '../shared.ts';

/**
 * Painel da direita (CapCut: o inspetor do que está selecionado). Aqui ganha duas abas a mais,
 * porque o agente trabalha dentro do editor: Agente e Revisão.
 */
export function Inspector({ tab, onTab, brain }: { tab: RightTab; onTab: (t: RightTab) => void; brain: Brain }) {
  const status = useEditor((s) => s.project?.status);
  const selection = useEditor((s) => s.selection);
  const tabs: [RightTab, string][] = [
    ['ajustes', selection ? 'Ajustes •' : 'Ajustes'],
    ['agente', 'Agente'],
    ['revisao', status === 'revisao' ? 'Revisão •' : 'Revisão'],
  ];
  return (
    <section aria-label="Painel da direita" className="flex h-full min-h-0 flex-col bg-ink-850">
      <div role="tablist" className="flex h-9 shrink-0 items-end gap-1 border-b border-ink-750 px-2">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => onTab(k)} className={`rounded-t-[var(--radius-ui-md)] px-3 py-1.5 text-ui-xs font-semibold transition ${tab === k ? 'bg-ink-800 text-white shadow-[inset_0_-2px_0_var(--color-nc-500)]' : 'text-ink-400 hover:text-ink-200'}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">{tab === 'ajustes' ? <Properties /> : tab === 'agente' ? <AgentPanel brain={brain} /> : <ReviewPanel />}</div>
    </section>
  );
}
