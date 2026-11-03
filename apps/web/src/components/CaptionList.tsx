import { useMemo, useRef, useState } from 'react';
import { Download, Eye, EyeOff, Play, Replace, Search, Upload } from 'lucide-react';
import { formatTime, type CaptionEditOp, type Cue } from '@neweditor/core';
import { CaptionInput, captionActions, cueText, parseSrt, srtToEdits, toSrt, useCaptionCues } from '../lib/captions.tsx';
import { useEditor } from '../lib/store.ts';


/** Lista de legendas editável (como o painel de legendas do CapCut): texto, ▶, apagar, buscar e substituir, .srt. */
export function CaptionList() {
  const cues = useCaptionCues();
  const project = useEditor((s) => s.project)!;
  const playhead = useEditor((s) => s.playhead);
  const seek = useEditor((s) => s.seek);
  const select = useEditor((s) => s.select);
  const selection = useEditor((s) => s.selection);
  const sendOp = useEditor((s) => s.sendOp);
  const [find, setFind] = useState('');
  const [repl, setRepl] = useState('');
  const [showFind, setShowFind] = useState(false);
  const [msg, setMsg] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const transcripts = useEditor((s) => s.transcripts);
  const importSrt = async (f: File) => {
    const blocks = parseSrt(await f.text());
    if (!blocks.length) return setMsg('Não achei blocos de legenda nesse arquivo.');
    const { edits, matched, skipped } = srtToEdits(project.timeline, transcripts, blocks);
    if (!matched) return setMsg('Nenhum bloco do .srt cai sobre a fala desta timeline (o arquivo é de outro corte?).');
    sendOp({ op: { type: 'edit_captions', edits }, note: `Importou ${f.name}: ${matched} legenda(s)` });
    setMsg(`${matched} legenda(s) importada(s)${skipped ? ` · ${skipped} bloco(s) sem fala no corte ficaram de fora` : ''}. Desfazer volta tudo.`);
  };

  const visible = cues.filter((c) => !c.hidden);
  const matches = useMemo(() => (find.trim() ? cues.filter((c) => !c.hidden && cueText(c).toLowerCase().includes(find.trim().toLowerCase())) : []), [cues, find]);
  const replaceAll = () => {
    const re = new RegExp(find.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const edits: CaptionEditOp[] = matches.flatMap((c) => {
      const w = c.words[0]?.src;
      return w ? [{ assetId: w.assetId, at: w.at, patch: { text: cueText(c).replace(re, repl).replace(/\s+/g, ' ').trim() } }] : [];
    });
    if (edits.length) sendOp({ op: { type: 'edit_captions', edits }, note: `Substituiu "${find.trim()}" por "${repl}" em ${edits.length} legenda(s)` });
  };
  const downloadSrt = () => {
    const srt = toSrt(visible);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([srt], { type: 'application/x-subrip' }));
    a.download = `${project.name.replace(/[\\/:*?"<>|]/g, '-')}.srt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const current = (c: Cue) => playhead >= c.start && playhead < c.end;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-ink-750 px-3 py-2">
        <span className="text-ui-xs text-ink-400">
          {visible.length} legendas{cues.length > visible.length ? ` · ${cues.length - visible.length} apagada(s)` : ''}
        </span>
        <button aria-label="Encontrar e substituir" onClick={() => setShowFind(!showFind)} className={`ml-auto rounded-ui-md p-1.5 ${showFind ? 'bg-ink-700 text-white' : 'text-ink-400 hover:text-white'}`} title="Encontrar e substituir">
          <Search size={13} />
        </button>
        <button aria-label="Importar legendas (.srt)" onClick={() => fileInput.current?.click()} className="rounded-ui-md p-1.5 text-ink-400 hover:text-white" title="Importar legendas (.srt)">
          <Upload size={13} />
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".srt,text/plain"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importSrt(f);
            e.target.value = '';
          }}
        />
        <button aria-label="Baixar legendas (.srt)" onClick={downloadSrt} disabled={!visible.length} className="rounded-ui-md p-1.5 text-ink-400 hover:text-white disabled:opacity-30" title="Baixar legendas (.srt)">
          <Download size={13} />
        </button>
      </div>
      {msg && <p className="border-b border-ink-750 px-3 py-1.5 text-ui-xs leading-snug text-emerald-300/90">{msg}</p>}
      {showFind && (
        <div className="space-y-1.5 border-b border-ink-750 p-3">
          <div className="flex items-center gap-1.5">
            <input value={find} onChange={(e) => setFind(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Encontrar" className="input min-w-0 flex-1 py-1 text-ui-sm" autoFocus />
            <span className="w-10 text-right font-mono text-ui-xs text-ink-400">{matches.length}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <input value={repl} onChange={(e) => setRepl(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Substituir por" className="input min-w-0 flex-1 py-1 text-ui-sm" />
            <button disabled={!matches.length} onClick={replaceAll} className="flex items-center gap-1 rounded-ui-md bg-nc-500 px-2 py-1 text-ui-xs font-semibold text-white disabled:opacity-40" title="Substituir em todas (um passo de desfazer)">
              <Replace size={11} /> Tudo
            </button>
          </div>
        </div>
      )}
      <p className="border-b border-ink-750 px-3 py-1.5 text-ui-xs leading-snug text-ink-400">Enter no meio divide · ⌫ no começo junta com a de cima · Delete no fim junta com a de baixo</p>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {cues.map((c) => {
          const hit = matches.includes(c);
          const sel = selection?.kind === 'caption' && selection.id === c.key;
          return (
            <div key={c.key} className={`group flex items-center gap-1.5 border-b border-ink-800 px-2 py-1 ${sel ? 'bg-nc-500/15' : current(c) ? 'bg-ink-800' : ''} ${c.hidden ? 'opacity-45' : ''}`} onFocus={() => select({ kind: 'caption', id: c.key! })}>
              <button onClick={() => (seek(c.start + 0.01), select({ kind: 'caption', id: c.key! }))} className="w-10 shrink-0 text-left font-mono text-ui-xs text-ink-400 hover:text-white" title="Ir até">
                {formatTime(c.start)}
              </button>
              {c.hidden ? (
                <span className="min-w-0 flex-1 truncate text-ui-sm text-ink-400 line-through">{cueText(c)}</span>
              ) : (
                <CaptionInput cue={c} cues={cues} className={`min-w-0 flex-1 rounded border bg-transparent px-1 py-0.5 text-ui-sm text-ink-100 outline-none focus:border-nc-500 focus:bg-ink-850 ${hit ? 'border-amber-400/60' : 'border-transparent hover:border-ink-700'}`} />
              )}
              {c.edited && <span className="text-ui-xs text-amber-300" title={`Automático: "${c.original}"`}>✎</span>}
              <button aria-label="Tocar daqui"
                onClick={() => {
                  seek(c.start + 0.01);
                  setTimeout(() => useEditor.getState().setPlaying(true), 60);
                }}
                className="text-ink-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-white"
                title="Tocar daqui"
              >
                <Play size={11} />
              </button>
              <button onClick={() => captionActions.toggleHidden(c)} className={`text-ink-400 hover:text-white ${c.hidden ? '' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}`} title={c.hidden ? 'Restaurar' : 'Apagar'}>
                {c.hidden ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
            </div>
          );
        })}
        {!cues.length && <p className="p-4 text-ui-xs text-ink-400">Sem fala transcrita na timeline ainda.</p>}
      </div>
    </div>
  );
}
