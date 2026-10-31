/**
 * Entrega (F-4): preset, legenda .srt, capa, pasta de entregas e "marcar como entregue" (só com o QC limpo).
 */
import { useEffect, useState } from 'react';
import { Download, FolderOpen, X } from 'lucide-react';
import { formatTime } from '@neweditor/core';
import { api } from '../lib/api.ts';
import { useEditor } from '../lib/store.ts';
import { Button, IconButton } from './ui.tsx';

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project)!;
  const playhead = useEditor((s) => s.playhead);
  const [presets, setPresets] = useState<{ id: string; label: string }[]>([]);
  const [pasta, setPasta] = useState('');
  const [preset, setPreset] = useState<string>(project.timeline.width >= project.timeline.height ? 'youtube' : 'reels');
  const [srt, setSrt] = useState(true);
  const [capa, setCapa] = useState(true);
  const [capaAqui, setCapaAqui] = useState(false);
  const [entregar, setEntregar] = useState(project.status === 'editado');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    api.entregaPresets().then((r) => (setPresets(r.presets), setPasta(r.pasta))).catch(() => undefined);
  }, []);
  const block = project.qc?.issues.filter((i) => i.severidade === 'bloqueia') ?? [];
  const go = async () => {
    setBusy(true);
    setErr('');
    try {
      await api.entregar(project.id, { preset, srt, capa, capaEm: capaAqui ? playhead : undefined, entregar });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/60 backdrop-blur-sm" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Exportar" onMouseDown={(e) => e.stopPropagation()} className="anim-pop w-full max-w-md space-y-4 rounded-ui-lg border border-ink-700 bg-ink-850 p-5 shadow-ui-3">
        <div className="flex items-center justify-between">
          <h2 className="text-ui-lg font-semibold">Exportar e entregar</h2>
          <IconButton label="Fechar" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <label className="block space-y-1 text-ui-xs text-ink-300">
          Preset
          <select value={preset} onChange={(e) => setPreset(e.target.value)} className="input">
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <span className="block text-ui-xs text-ink-400">
            O preset dá o nome do arquivo; o formato é o da timeline ({project.timeline.width}×{project.timeline.height}).
          </span>
        </label>
        <div className="space-y-2 text-ui-xs text-ink-300">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={srt} onChange={(e) => setSrt(e.target.checked)} className="h-4 w-4 accent-nc-500" /> Legenda .srt junto
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={capa} onChange={(e) => setCapa(e.target.checked)} className="h-4 w-4 accent-nc-500" /> Capa (.jpg)
          </label>
          {capa && (
            <label className="ml-6 flex items-center gap-2 text-ink-400">
              <input type="checkbox" checked={capaAqui} onChange={(e) => setCapaAqui(e.target.checked)} className="h-3.5 w-3.5 accent-nc-500" /> Capa no cursor ({formatTime(playhead)}) em vez do primeiro lettering
            </label>
          )}
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={entregar} onChange={(e) => setEntregar(e.target.checked)} className="h-4 w-4 accent-nc-500" /> Marcar como <b>Entregue</b> no Kanban
          </label>
          {entregar && block.length > 0 && <p className="ml-6 text-ui-xs text-rose-300">O QC tem {block.length} bloqueio(s); a entrega vai ser recusada até resolver (aba Revisão).</p>}
        </div>
        <div className="flex items-center gap-2 rounded-ui-md bg-ink-800 px-3 py-2 text-ui-xs text-ink-400">
          <FolderOpen size={13} className="shrink-0" />
          <span className="min-w-0 truncate" title={pasta}>
            {pasta}/{(project.client ?? 'sem-cliente').toLowerCase()}/…
          </span>
        </div>
        {err && <p className="text-ui-xs text-rose-400">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" icon={<Download size={14} />} loading={busy} onClick={go}>
            Exportar v{(project.versions?.at(-1)?.n ?? 0) + 1}
          </Button>
        </div>
      </div>
    </div>
  );
}
