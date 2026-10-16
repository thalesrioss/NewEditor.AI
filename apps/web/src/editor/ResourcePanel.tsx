import { PanelLeftClose } from 'lucide-react';
import { IconButton } from '../components/ui.tsx';
import { MediaPanel } from '../components/MediaPanel.tsx';
import { TranscriptPanel } from '../components/TranscriptPanel.tsx';
import { MusicPanel } from '../components/MusicPanel.tsx';
import { CaptionPanel } from '../components/CaptionPanel.tsx';
import { TextPanel } from '../components/TextPanel.tsx';
import { MotionPanel } from '../components/MotionPanel.tsx';
import { ColorPanel } from '../components/ColorPanel.tsx';
import { CineproPanel } from '../components/CineproPanel.tsx';
import { RAIL } from './Rail.tsx';
import type { RailTab } from './shared.ts';

const PANELS: Record<RailTab, () => React.ReactNode> = {
  midia: () => <MediaPanel />,
  fala: () => <TranscriptPanel />,
  audio: () => <MusicPanel />,
  legenda: () => <CaptionPanel />,
  texto: () => <TextPanel />,
  motion: () => <MotionPanel />,
  cor: () => <ColorPanel />,
  cinepro: () => <CineproPanel modo="som" />,
  efeitos: () => <CineproPanel modo="visual" />,
};

/** Painel de recursos ao lado do trilho (CapCut): título, botão de recolher e o conteúdo da aba. */
export function ResourcePanel({ tab, onClose }: { tab: RailTab; onClose: () => void }) {
  const meta = RAIL.find((r) => r.id === tab)!;
  return (
    <section aria-label={meta.label} className="flex h-full min-h-0 flex-col bg-ink-850">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-ink-750 pr-1 pl-3">
        <span className="text-ink-300">{meta.icon}</span>
        <h2 className="text-ui-sm font-semibold text-ink-100">{meta.label}</h2>
        <IconButton label="Recolher o painel" className="ml-auto !p-1" onClick={onClose}>
          <PanelLeftClose size={14} />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1">{PANELS[tab]()}</div>
    </section>
  );
}
