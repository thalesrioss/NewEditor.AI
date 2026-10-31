/**
 * Cinéfilo.AI na aba Mídia: busca de cenas de filme no clip.cafe (por frase) e sugestões a partir do roteiro
 * (pontos narrativos → buscas). "Usar" baixa o clipe para o projeto e ele aparece como B-roll aqui mesmo.
 */
import { useState } from 'react';
import { Clapperboard, Film, Search, Sparkles } from 'lucide-react';
import { anchorAt, formatTime, sourceToTimeline } from '@neweditor/core';
import { api, type BeatQuery, type CafeClip } from '../lib/api.ts';
import { useEditor } from '../lib/store.ts';
import { Button } from './ui.tsx';

export function CinefiloPanel() {
  const project = useEditor((s) => s.project)!;
  const sendOp = useEditor((s) => s.sendOp);
  const seek = useEditor((s) => s.seek);
  const [q, setQ] = useState('');
  const [clips, setClips] = useState<CafeClip[]>([]);
  const [beats, setBeats] = useState<BeatQuery[]>([]);
  const [beat, setBeat] = useState<BeatQuery | null>(null);
  const [busy, setBusy] = useState<string>('');
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState(false);

  const search = async (query: string, b: BeatQuery | null = null) => {
    if (!query.trim()) return;
    setBusy('busca');
    setMsg('');
    setBeat(b);
    try {
      setClips((await api.cafeSearch(query)).clips);
    } catch (e) {
      setMsg((e as Error).message);
    }
    setBusy('');
  };
  const sugerir = async () => {
    setBusy('beats');
    setMsg('');
    try {
      const r = await api.cafeBeats(project.id);
      setBeats(r.beats);
      if (!r.beats.length) setMsg('Não achei pontos narrativos com imagem forte no corte.');
    } catch (e) {
      setMsg((e as Error).message);
    }
    setBusy('');
  };
  const usar = async (c: CafeClip, insert: boolean) => {
    setBusy(c.slug);
    try {
      const r = await api.cafeUse(project.id, c);
      if (insert) {
        const tl = useEditor.getState().project!.timeline;
        const t = beat ? (sourceToTimeline(tl, beat.assetId, beat.start) ?? useEditor.getState().playhead) : useEditor.getState().playhead;
        const anchor = anchorAt(tl, t);
        if (anchor) sendOp({ op: { type: 'add_overlay', item: { trackId: 'V2', role: 'broll', anchor, duration: Math.min(c.duracao ?? 3, beat ? beat.end - beat.start : 3.5, 6), source: { type: 'media', assetId: r.assetId, in: 0 } } }, note: `B-roll de filme: ${c.filme} em ${formatTime(t)}` });
        seek(t);
      }
      setMsg(`"${c.filme}" ${insert ? 'inserido na V2' : 'está na Mídia'}.`);
    } catch (e) {
      setMsg((e as Error).message);
    }
    setBusy('');
  };

  return (
    <div className="border-t border-ink-750">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-ui-xs font-semibold text-ink-200 hover:bg-ink-800" aria-expanded={open}>
        <Clapperboard size={13} className="text-nc-300" /> Cinéfilo.AI — B-roll de filme
        <span className="ml-auto text-ui-xs font-normal text-ink-400">clip.cafe</span>
      </button>
      {open && (
        <div className="space-y-2 px-3 pb-3">
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void search(q);
            }}
          >
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Fala do filme (em inglês): I know you mean well" className="input min-w-0 flex-1 py-1 text-ui-xs" aria-label="Buscar cena de filme" />
            <Button size="sm" type="submit" loading={busy === 'busca'} icon={<Search size={12} />} aria-label="Buscar" />
          </form>
          <Button size="sm" variant="ghost" className="w-full" loading={busy === 'beats'} icon={<Sparkles size={12} />} onClick={sugerir}>
            Sugerir pelo roteiro
          </Button>
          {beats.length > 0 && (
            <div className="space-y-1">
              {beats.map((b, i) => (
                <div key={i} className="rounded-ui-md bg-ink-800 p-2 text-ui-xs">
                  <div className="truncate text-ink-200" title={b.fala}>
                    <span className="font-mono text-ink-400">{formatTime(sourceToTimeline(project.timeline, b.assetId, b.start) ?? b.start)}</span> {b.fala}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {b.queries.map((qq) => (
                      <button key={qq} onClick={() => (setQ(qq), void search(qq, b))} className={`rounded-full border px-2 py-0.5 text-ui-xs ${beat === b && q === qq ? 'border-nc-400 text-nc-300' : 'border-ink-600 text-ink-300 hover:border-nc-500 hover:text-white'}`}>
                        {qq}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {msg && <p className="text-ui-xs text-emerald-300/90">{msg}</p>}
          {clips.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {clips.map((c) => (
                <div key={c.slug} className="group overflow-hidden rounded-ui-md border border-ink-700 bg-ink-800">
                  <div className="relative aspect-video bg-ink-900">
                    <img src={c.poster} alt="" className="h-full w-full object-cover" loading="lazy" />
                    {c.duracao !== undefined && <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 font-mono text-ui-xs text-white">{formatTime(c.duracao)}</span>}
                    <div className="absolute inset-0 hidden items-center justify-center gap-1 bg-black/60 group-hover:flex">
                      <Button size="sm" variant="primary" loading={busy === c.slug} onClick={() => void usar(c, true)}>
                        {beat ? 'Inserir ali' : 'No cursor'}
                      </Button>
                      <Button size="sm" loading={busy === c.slug} onClick={() => void usar(c, false)}>
                        Mídia
                      </Button>
                    </div>
                  </div>
                  <div className="p-1.5">
                    <div className="flex items-center gap-1 truncate text-ui-xs font-semibold text-ink-100">
                      <Film size={10} className="shrink-0 text-ink-400" /> {c.filme}
                      {c.ano && <span className="font-normal text-ink-400">· {c.ano}</span>}
                    </div>
                    <div className="line-clamp-2 text-ui-xs leading-snug text-ink-400" title={c.transcript}>
                      {c.transcript}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
