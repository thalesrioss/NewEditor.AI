import { useRef, useState } from 'react';
import { FileAudio, FilePlus2, Film, FolderOpen, Image, Plus, Search } from 'lucide-react';
import { anchorAt, cutEndAfter, formatTime, timelineDuration, type MediaAsset } from '@neweditor/core';
import { api, mediaUrl } from '../lib/api.ts';
import { useEditor } from '../lib/store.ts';
import { CinefiloPanel } from './CinefiloPanel.tsx';
import { Button } from './ui.tsx';
import { ASSET_MIME } from '../editor/shared.ts';

/**
 * Biblioteca de mídia (CapCut): importar, grade de miniaturas com "+" para inserir no cursor e arrasto para a trilha.
 * Abas: o material do projeto e o Cinéfilo (B-roll de cinema pela fala).
 */
export function MediaPanel() {
  const project = useEditor((s) => s.project);
  const [view, setView] = useState<'projeto' | 'cinefilo'>('projeto');
  const [q, setQ] = useState('');
  const [path, setPath] = useState('');
  const [pathOpen, setPathOpen] = useState(false);
  const [err, setErr] = useState('');
  const file = useRef<HTMLInputElement>(null);
  if (!project) return null;

  const importPath = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      if (path.trim()) await api.importPath(project.id, path.trim());
      setPath('');
      setPathOpen(false);
    } catch (x) {
      setErr((x as Error).message);
    }
  };
  const list = project.assets.filter((a) => !q || a.name.toLowerCase().includes(q.toLowerCase()));
  const groups: [string, MediaAsset[]][] = [
    ['Fala', list.filter((a) => a.role === 'fala' || a.role === 'cam')],
    ['B-roll e imagens', list.filter((a) => a.kind !== 'audio' && a.role !== 'fala' && a.role !== 'cam' && a.role !== 'motion')],
    ['Motions (Studio)', list.filter((a) => a.role === 'motion')],
    ['Áudio', list.filter((a) => a.kind === 'audio')],
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex gap-1 border-b border-ink-750 px-2 pt-2 pb-1.5">
        {(
          [
            ['projeto', `Projeto · ${project.assets.length}`],
            ['cinefilo', 'Cinéfilo'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={view === id} onClick={() => setView(id)} className={`rounded-[var(--radius-ui-md)] px-2.5 py-1 text-ui-xs font-semibold transition ${view === id ? 'bg-ink-700 text-white' : 'text-ink-400 hover:text-ink-200'}`}>
            {label}
          </button>
        ))}
      </div>
      {view === 'cinefilo' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <CinefiloPanel />
        </div>
      ) : (
        <>
          <div className="space-y-2 border-b border-ink-750 p-2.5">
            <div className="flex gap-1.5">
              <Button variant="primary" size="sm" className="flex-1" icon={<FilePlus2 size={13} />} onClick={() => file.current?.click()}>
                Importar
              </Button>
              <Button size="sm" icon={<FolderOpen size={13} />} onClick={() => setPathOpen(!pathOpen)} title="Colar o caminho de um arquivo no disco (o original não é copiado)">
                Caminho
              </Button>
              <input
                ref={file}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  for (const f of Array.from(e.target.files ?? [])) void api.upload(project.id, f);
                  e.target.value = '';
                }}
              />
            </div>
            {pathOpen && (
              <form onSubmit={importPath} className="flex gap-1.5">
                <input autoFocus value={path} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="/Users/…/bruto.mp4" className="input flex-1 py-1 font-mono text-ui-xs" />
                <button aria-label="Importar caminho" className="rounded-[var(--radius-ui-md)] nc-gradient px-2.5 text-white">
                  <Plus size={14} />
                </button>
              </form>
            )}
            {err && <p className="text-ui-xs text-rose-400">{err}</p>}
            <label className="flex items-center gap-1.5 rounded-[var(--radius-ui-md)] border border-ink-700 bg-ink-900 px-2">
              <Search size={12} className="text-ink-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Buscar na mídia" aria-label="Buscar na mídia" className="w-full bg-transparent py-1 text-ui-xs text-ink-100 outline-none" />
            </label>
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-2.5">
            {!project.assets.length && (
              <p className="pt-8 text-center text-ui-xs leading-relaxed text-ink-400">
                Arraste vídeos, áudios ou imagens para o editor,
                <br />
                ou clique em Importar.
              </p>
            )}
            {groups.map(
              ([title, items]) =>
                items.length > 0 && (
                  <section key={title} className="mb-3">
                    <h3 className="mb-1.5 text-ui-2xs font-semibold tracking-wide text-ink-400 uppercase">{title}</h3>
                    <div className="grid grid-cols-2 gap-2">
                      {items.map((a) => (
                        <AssetCard key={a.id} asset={a} projectId={project.id} />
                      ))}
                    </div>
                  </section>
                ),
            )}
          </div>
          <p className="border-t border-ink-750 px-3 py-1.5 text-ui-2xs leading-snug text-ink-400">Arraste um B-roll para V2, um motion para V3, um efeito sonoro para A2 ou música para A3. "+" insere no cursor.</p>
        </>
      )}
    </div>
  );
}

function AssetCard({ asset, projectId }: { asset: MediaAsset; projectId: string }) {
  const sendOp = useEditor((s) => s.sendOp);
  const th = asset.thumbs;
  const ready = !!asset.proxy;
  const role = asset.role === 'fala' ? 'Fala' : asset.role === 'motion' ? 'Motion' : asset.role === 'cam' ? `Câmera 2 (${(asset.syncOffset ?? 0) >= 0 ? '+' : ''}${(asset.syncOffset ?? 0).toFixed(2)} s)` : asset.kind === 'audio' ? 'Áudio' : asset.kind === 'image' ? 'Imagem' : 'B-roll';
  const [syncing, setSyncing] = useState(false);
  // Quantas vezes já está na timeline (regra da casa: o mesmo B-roll no máximo 2×).
  const uses = useEditor((s) => (s.project?.timeline.overlays ?? []).filter((o) => o.source.type === 'media' && o.source.assetId === asset.id).length + (s.project?.timeline.main.some((c) => c.assetId === asset.id) ? 1 : 0));
  const insertable = ready && asset.role !== 'fala' && asset.role !== 'cam';

  /** "+" do CapCut: entra no cursor, na trilha certa, e vai até o fim do corte. */
  const insertAtCursor = () => {
    const { project, playhead } = useEditor.getState();
    if (!project) return;
    const tl = project.timeline;
    const anchor = anchorAt(tl, playhead);
    if (!anchor) return;
    const remaining = timelineDuration(tl) - playhead;
    const isAudio = asset.kind === 'audio';
    const isMotion = asset.role === 'motion';
    const trackId = isAudio ? 'A3' : isMotion ? 'V3' : 'V2';
    const roleId = isAudio ? 'music' : isMotion ? 'motion' : 'broll';
    const toCut = cutEndAfter(tl, playhead) - playhead;
    const duration = Math.max(0.5, Math.min(isAudio ? remaining : isMotion ? asset.duration || 4 : Math.max(1, toCut), asset.duration || 4, remaining));
    sendOp({ op: { type: 'add_overlay', item: { trackId, role: roleId, anchor, duration, source: { type: 'media', assetId: asset.id, in: 0 } } }, note: `${isAudio ? 'Trilha' : isMotion ? 'Motion' : 'B-roll'}: ${asset.name} em ${formatTime(playhead)}` });
  };

  return (
    <div
      draggable={ready && asset.role !== 'fala'}
      onDragStart={(e) => {
        e.dataTransfer.setData(ASSET_MIME, asset.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      className={`group overflow-hidden rounded-[var(--radius-ui-md)] border border-ink-700 bg-ink-800 transition ${asset.role !== 'fala' && ready ? 'cursor-grab hover:border-nc-500' : ''}`}
      title={asset.name}
    >
      <div className="relative aspect-video bg-ink-900">
        {th ? (
          <div className="absolute inset-0 bg-no-repeat" style={{ backgroundImage: `url(${mediaUrl(projectId, th.file)})`, backgroundSize: `${th.cols * 100}% auto`, backgroundPosition: `${(Math.min(th.cols - 1, Math.floor(th.count / 3)) / Math.max(1, th.cols - 1)) * 100}% 0` }} />
        ) : (
          <div className="flex h-full items-center justify-center text-ink-400">{asset.kind === 'audio' ? <FileAudio size={22} /> : asset.kind === 'image' ? <Image size={22} /> : <Film size={22} />}</div>
        )}
        <span className={`absolute top-1 left-1 rounded px-1 text-ui-2xs font-semibold ${asset.role === 'fala' ? 'bg-nc-500 text-white' : 'bg-black/70 text-ink-200'}`}>{role}</span>
        <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 font-mono text-ui-2xs text-white">{formatTime(asset.duration)}</span>
        {uses > 0 && (
          <span className={`absolute right-1 bottom-1 rounded px-1 text-ui-2xs font-semibold ${asset.role !== 'fala' && uses >= 2 ? 'bg-amber-400 text-ink-950' : 'bg-[var(--color-ok)] text-ink-950'}`} title={asset.role === 'fala' ? 'Na timeline' : `Usado ${uses}× (máximo 2×)`}>
            ✓{asset.role !== 'fala' && ` ${uses}×`}
          </span>
        )}
        {!ready && <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-ui-2xs text-ink-200">preparando…</div>}
        {insertable && (
          <button
            aria-label="Inserir no cursor"
            title="Inserir no cursor (vai até o fim do corte)"
            onClick={insertAtCursor}
            className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-nc-500 text-white opacity-0 shadow transition group-hover:opacity-100 hover:brightness-110"
          >
            <Plus size={14} />
          </button>
        )}
        {ready && asset.kind === 'video' && asset.hasAudio && asset.envelope && asset.role !== 'fala' && (
          <button
            disabled={syncing}
            onClick={async () => {
              setSyncing(true);
              await api.syncCam(projectId, asset.id).catch(() => undefined);
              setSyncing(false);
            }}
            className="absolute right-1 bottom-6 rounded-full bg-black/70 px-1.5 py-px text-ui-2xs text-white opacity-0 transition group-hover:opacity-100 hover:bg-nc-500 disabled:opacity-50"
            title="Alinha pelo áudio com a fala e vira a 2ª câmera dos clipes"
          >
            {syncing ? 'alinhando…' : asset.role === 'cam' ? 'realinhar' : '2ª câmera'}
          </button>
        )}
      </div>
      <div className="flex items-center gap-1 px-1.5 py-1">
        <span className="min-w-0 flex-1 truncate text-ui-2xs text-ink-300">{asset.name}</span>
        {ready && asset.kind === 'video' && asset.hasAudio && asset.role !== 'cam' && asset.role !== 'motion' && (
          <button
            onClick={() => void api.setAssetRole(projectId, asset.id, asset.role === 'fala' ? 'broll' : 'fala').catch(() => undefined)}
            className="shrink-0 rounded px-1 text-ui-2xs text-ink-400 opacity-0 transition group-hover:opacity-100 hover:bg-ink-700 hover:text-white"
            title={asset.role === 'fala' ? 'Tirar da decupagem: vira B-roll' : 'É uma bruta de fala: transcrever e entrar na decupagem'}
          >
            {asset.role === 'fala' ? 'virar B-roll' : 'virar fala'}
          </button>
        )}
      </div>
    </div>
  );
}
