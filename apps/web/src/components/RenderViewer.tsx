import { useEffect, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import { useEditor } from '../lib/store.ts';

/**
 * Mostra o vídeo exportado dentro do Editor Brain. Abre sozinho quando um render termina
 * (e pelo botão "Ver vídeo exportado" no log do agente).
 */
export function RenderViewer() {
  const logs = useEditor((s) => s.logs);
  const project = useEditor((s) => s.project);
  const [url, setUrl] = useState<string | null>(null);
  const opened = useRef(new Set<string>());
  const mountedAt = useRef(Date.now());

  // Render que terminou DEPOIS de abrir a tela → abre o player.
  useEffect(() => {
    const last = [...logs].reverse().find((l) => l.text.startsWith('/media/') && l.text.endsWith('.mp4'));
    if (last && !opened.current.has(last.id) && Date.parse(last.at) > mountedAt.current) {
      opened.current.add(last.id);
      setUrl(last.text);
    }
  }, [logs]);

  useEffect(() => {
    const on = (e: Event) => setUrl((e as CustomEvent<string>).detail);
    window.addEventListener('neweditor:render', on);
    return () => window.removeEventListener('neweditor:render', on);
  }, []);

  useEffect(() => {
    if (!url) return;
    useEditor.getState().setPlaying(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setUrl(null);
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [url]);

  if (!url) return null;
  const name = url.split('/').pop() ?? 'video.mp4';
  const portrait = (project?.timeline.height ?? 1920) > (project?.timeline.width ?? 1080);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm" onMouseDown={() => setUrl(null)}>
      <div className="anim-pop flex max-h-full flex-col overflow-hidden rounded-2xl border border-ink-700 bg-ink-850 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-ink-750 px-4 py-2.5">
          <div className="text-sm font-semibold">Vídeo exportado</div>
          <div className="truncate font-mono text-ui-xs text-ink-400">{name}</div>
          <a href={url} download={name} className="ml-auto flex items-center gap-1.5 rounded-lg nc-gradient px-3 py-1.5 text-xs font-semibold text-white">
            <Download size={13} /> Baixar
          </a>
          <button aria-label="Fechar (Esc)" onClick={() => setUrl(null)} className="rounded-md p-1 text-ink-400 hover:text-white" title="Fechar (Esc)">
            <X size={16} />
          </button>
        </div>
        <video src={url} controls autoPlay playsInline className={`bg-black ${portrait ? 'h-[78vh]' : 'max-h-[78vh] w-[min(1100px,90vw)]'}`} />
      </div>
    </div>
  );
}
