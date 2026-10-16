import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '../lib/api.ts';
import { reloadTranscripts, useEditor } from '../lib/store.ts';
import type { Brain } from '../components/AgentPanel.tsx';
import { RenderViewer } from '../components/RenderViewer.tsx';
import { ExportDialog } from '../components/ExportDialog.tsx';
import { CommandPalette } from '../components/CommandPalette.tsx';
import { Shortcuts } from '../components/Shortcuts.tsx';
import { TopBar } from './TopBar.tsx';
import { Rail } from './Rail.tsx';
import { ResourcePanel } from './ResourcePanel.tsx';
import { Resizer } from './Resizer.tsx';
import { Stage } from './stage/Stage.tsx';
import { Inspector } from './inspector/Inspector.tsx';
import { Timeline } from './timeline/Timeline.tsx';
import { ContextMenu } from './timeline/ContextMenu.tsx';
import { useShortcuts } from './useShortcuts.ts';
import type { RailTab, RightTab } from './shared.ts';

const LS = { rail: 'ne2-rail', left: 'ne2-left', right: 'ne2-right', tl: 'ne2-tl' };
const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* sem armazenamento */
  }
};
const num = (k: string, fallback: number, min: number, max: number) => Math.min(max, Math.max(min, Number(read(k)) || fallback));

/**
 * Editor Brain — a casca, no layout do CapCut:
 *
 *   [ barra superior: voltar · logo · nome · etapa · perfil ............ salvo · sino · atalhos · painéis · Exportar ]
 *   [ trilho | painel de recursos ] [        Player        ] [ Ajustes | Agente | Revisão ]
 *   [ ──────────────────────── timeline multitrilha, largura inteira ─────────────────────── ]
 */
export function EditorShell({ projectId, brain }: { projectId: string; brain: Brain }) {
  const connect = useEditor((s) => s.connect);
  const project = useEditor((s) => s.project);
  const activity = useEditor((s) => s.activity);
  const selection = useEditor((s) => s.selection);

  const [rail, setRail] = useState<RailTab | null>(() => (read(LS.rail) === '' ? null : ((read(LS.rail) as RailTab | null) ?? 'fala')));
  // Largura do painel de recursos lembrada por aba (Motion, Efeitos e CinePRO pedem mais espaço).
  const widthFor = (tab: RailTab | null) => (tab ? num(`${LS.left}:${tab}`, tab === 'motion' || tab === 'efeitos' || tab === 'cinepro' ? 440 : 340, 260, 640) : 340);
  const [leftW, setLeftW] = useState(() => widthFor(rail));
  const [rightW, setRightW] = useState(() => num(LS.right, 320, 260, 520));
  const [rightOpen, setRightOpen] = useState(true);
  const [timelineH, setTimelineH] = useState(() => num(LS.tl, Math.round(window.innerHeight * 0.4), 200, window.innerHeight - 240));
  const [rightTab, setRightTab] = useState<RightTab>(() => (/\/revisao$/.test(location.hash) ? 'revisao' : 'agente'));
  const [exporting, setExporting] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => connect(projectId), [projectId, connect]);
  useEffect(() => write(LS.rail, rail ?? ''), [rail]);
  useEffect(() => {
    if (rail) write(`${LS.left}:${rail}`, String(leftW));
  }, [leftW, rail]);
  useEffect(() => setLeftW(widthFor(rail)), [rail]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => write(LS.right, String(rightW)), [rightW]);
  useEffect(() => write(LS.tl, String(timelineH)), [timelineH]);

  // Projeto esperando revisão abre direto na aba de revisão (uma vez, ao carregar).
  const openedReview = useRef(false);
  useEffect(() => {
    if (project && !openedReview.current) {
      openedReview.current = true;
      if (project.status === 'revisao') setRightTab('revisao');
    }
  }, [project]);
  // Outras partes pedem uma aba ou um painel (marcas do agente → Revisão; clique direito → Agente; clipe → Cor).
  useEffect(() => {
    const onTab = (e: Event) => (setRightOpen(true), setRightTab((e as CustomEvent<RightTab>).detail));
    const onRail = (e: Event) => setRail((e as CustomEvent<RailTab>).detail);
    window.addEventListener('ne:tab', onTab);
    window.addEventListener('ne:rail', onRail);
    return () => (window.removeEventListener('ne:tab', onTab), window.removeEventListener('ne:rail', onRail));
  }, []);
  // Selecionar algo na timeline abre os ajustes (CapCut: o inspetor segue a seleção).
  useEffect(() => {
    if (selection) setRightTab('ajustes');
  }, [selection]);

  // Quando o agente começa uma passada, guarda a timeline de antes (segurar B mostra o "antes").
  const wasBusy = useRef(false);
  useEffect(() => {
    const busy = activity.state !== 'idle' && activity.state !== 'celebrating';
    const st = useEditor.getState();
    if (busy && !wasBusy.current && st.project) st.setBeforeAgent(st.project.timeline);
    wasBusy.current = busy;
  }, [activity.state]);
  // Depois de uma decupagem o servidor grava os centros sonoros das palavras: recarrega a transcrição.
  const prevState = useRef(activity.state);
  useEffect(() => {
    if (prevState.current !== 'celebrating' && activity.state === 'celebrating') reloadTranscripts(projectId);
    prevState.current = activity.state;
  }, [activity.state, projectId]);

  const onExport = useCallback(() => setExporting(true), []);
  const actions = useMemo(() => ({ onExport }), [onExport]);
  useShortcuts(projectId, actions);

  const onDrop = async (e: React.DragEvent) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    setDragging(false);
    for (const f of Array.from(e.dataTransfer.files)) await api.upload(projectId, f);
  };

  if (!project)
    return (
      <div className="flex h-full items-center justify-center text-ink-400">
        <Loader2 className="animate-spin" />
      </div>
    );

  return (
    <div
      className="relative flex h-full flex-col bg-ink-900"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={onDrop}
    >
      <TopBar project={project} leftOpen={rail !== null} rightOpen={rightOpen} onLeft={() => setRail(rail ? null : 'fala')} onRight={() => setRightOpen(!rightOpen)} onExport={onExport} onReview={() => (setRightOpen(true), setRightTab('revisao'))} />

      <div className="flex min-h-0 flex-1">
        <Rail value={rail} onChange={setRail} />
        {rail && (
          <>
            <aside className="min-h-0 shrink-0 border-r border-ink-750" style={{ width: leftW }}>
              <ResourcePanel tab={rail} onClose={() => setRail(null)} />
            </aside>
            <Resizer axis="x" onDelta={(d) => setLeftW((w) => Math.min(640, Math.max(260, w + d)))} />
          </>
        )}
        <main className="min-h-0 min-w-0 flex-1">
          <Stage />
        </main>
        {rightOpen && (
          <>
            <Resizer axis="x" onDelta={(d) => setRightW((w) => Math.min(520, Math.max(260, w - d)))} />
            <aside className="min-h-0 shrink-0 border-l border-ink-750" style={{ width: rightW }}>
              <Inspector tab={rightTab} onTab={setRightTab} brain={brain} />
            </aside>
          </>
        )}
      </div>

      <Resizer axis="y" className="border-t border-ink-750" onDelta={(d) => setTimelineH((h) => Math.min(window.innerHeight - 240, Math.max(200, h - d)))} />
      <section className="min-h-0 shrink-0" style={{ height: timelineH }}>
        <Timeline />
      </section>

      <ContextMenu />
      <RenderViewer />
      <Shortcuts />
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      <CommandPalette onExport={onExport} />

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center border-2 border-dashed border-nc-500 bg-nc-600/10 backdrop-blur-sm">
          <div className="rounded-xl bg-ink-800 px-6 py-4 text-sm font-medium">Solte para importar</div>
        </div>
      )}
    </div>
  );
}
