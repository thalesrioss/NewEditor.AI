import { Captions, Clapperboard, FileText, Film, Library, Music, Palette, Sparkles, Type } from 'lucide-react';
import type { RailTab } from './shared.ts';

export const RAIL: { id: RailTab; label: string; icon: React.ReactNode; title: string }[] = [
  { id: 'midia', label: 'Mídia', icon: <Film size={18} />, title: 'Mídia: brutas, B-rolls, Cinéfilo' },
  { id: 'fala', label: 'Fala', icon: <FileText size={18} />, title: 'Fala: edite o vídeo pelo texto' },
  { id: 'audio', label: 'Áudio', icon: <Music size={18} />, title: 'Áudio: trilha, SFX e voz' },
  { id: 'legenda', label: 'Legenda', icon: <Captions size={18} />, title: 'Legenda automática: estilo e presets' },
  { id: 'texto', label: 'Texto', icon: <Type size={18} />, title: 'Lettering: estilos e referências' },
  { id: 'motion', label: 'Motion', icon: <Clapperboard size={18} />, title: 'Motion: história visual e Motion Studio' },
  { id: 'cor', label: 'Cor', icon: <Palette size={18} />, title: 'Cor: LOG → Rec.709 e primárias' },
  { id: 'cinepro', label: 'CinePRO', icon: <Library size={18} />, title: 'CinePRO: efeitos sonoros e trilhas da nuvem do CinePRO' },
  { id: 'efeitos', label: 'Efeitos', icon: <Sparkles size={18} />, title: 'Efeitos: overlays, transições, flares, frames e GIFs do CinePRO' },
];

/** Trilho de ícones da esquerda (CapCut): clicar abre o painel de recursos; clicar de novo recolhe. */
export function Rail({ value, onChange }: { value: RailTab | null; onChange: (v: RailTab | null) => void }) {
  return (
    <nav aria-label="Recursos" className="flex w-16 shrink-0 flex-col items-stretch gap-0.5 border-r border-ink-750 bg-ink-900 py-1.5">
      {RAIL.map((t) => {
        const active = value === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(active ? null : t.id)}
            title={t.title}
            aria-pressed={active}
            className={`mx-1 flex flex-col items-center gap-1 rounded-ui-md px-1 py-2 text-ui-xs font-medium transition ${active ? 'bg-ink-750 text-white' : 'text-ink-400 hover:bg-ink-800 hover:text-ink-100'}`}
          >
            <span className={active ? 'text-nc-300' : ''}>{t.icon}</span>
            <span className="leading-none">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
