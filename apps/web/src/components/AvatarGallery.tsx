import type { AgentState } from '@neweditor/core';
import { Avatar, AvatarBust } from './Avatar.tsx';

const STATES: { state: AgentState; label: string; moving?: boolean; facing?: 1 | -1 }[] = [
  { state: 'idle', label: 'Disponível' },
  { state: 'idle', label: 'Andando', moving: true },
  { state: 'idle', label: 'Andando (volta)', moving: true, facing: -1 },
  { state: 'analyzing', label: 'Ouvindo o material' },
  { state: 'thinking', label: 'Pensando (sentado no clipe)' },
  { state: 'cutting', label: 'Indo cortar', moving: true },
  { state: 'cutting', label: 'Cortando' },
  { state: 'motion', label: 'Indo fazer motion', moving: true },
  { state: 'motion', label: 'Fazendo motion' },
  { state: 'celebrating', label: 'Comemorando' },
];

/** Vitrine do personagem — #/avatar */
export function AvatarGallery() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-10 overflow-auto bg-ink-900 p-8">
      <div className="flex items-center gap-4">
        <div className="h-12 w-12 overflow-hidden rounded-ui-lg bg-gradient-to-b from-nc-600/30 to-ink-800 ring-1 ring-ink-700">
          <AvatarBust state="idle" />
        </div>
        <div>
          <div className="text-ui-lg font-semibold">
            O editor da NewEditor<span className="nc-text-gradient">.AI</span>
          </div>
          <div className="text-ui-md text-ink-400">Estados do avatar dentro do Editor Brain</div>
        </div>
      </div>
      <div className="flex max-w-5xl flex-wrap items-end justify-center gap-x-12 gap-y-10">
        {STATES.map((s) => (
          <div key={s.label} className="flex flex-col items-center gap-4">
            <div className="flex h-72 items-end border-b-4 border-nc-500/50 px-2">
              <Avatar state={s.state} scale={4} moving={s.moving} facing={s.facing} />
            </div>
            <span className="text-ui-sm text-ink-300">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
