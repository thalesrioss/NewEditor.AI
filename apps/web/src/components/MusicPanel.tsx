import { useEffect, useMemo, useRef, useState } from 'react';
import { Mic, Music, Pause, Play, Search, Trash2 } from 'lucide-react';
import { DEFAULT_MUSIC_MIX, formatTime, VOICE_DENOISE_LEVELS, type AudioMix } from '@neweditor/core';
import { api, type MusicTrack } from '../lib/api.ts';
import { useEditor } from '../lib/store.ts';
import { RangeField } from './ui.tsx';

/** Aba Áudio: limpeza da voz + biblioteca de músicas do editor + a trilha do projeto (volume, fades, ducking). */
export function MusicPanel() {
  const project = useEditor((s) => s.project);
  const sendOp = useEditor((s) => s.sendOp);
  const [tracks, setTracks] = useState<MusicTrack[] | null>(null);
  const [q, setQ] = useState('');
  const [playing, setPlaying] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const audio = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    api.music().then(setTracks).catch((e: Error) => setErr(e.message));
  }, []);
  useEffect(() => () => audio.current?.pause(), []);

  const current = project?.timeline.overlays.find((o) => o.role === 'music');
  const src = current?.source;
  const currentAsset = src?.type === 'media' ? project?.assets.find((a) => a.id === src.assetId) : undefined;
  const mix: AudioMix = current?.mix ?? DEFAULT_MUSIC_MIX;
  const filtered = useMemo(() => (tracks ?? []).filter((t) => t.name.toLowerCase().includes(q.toLowerCase())), [tracks, q]);
  if (!project) return null;

  const audition = (t: MusicTrack) => {
    const el = audio.current!;
    if (playing === t.path) {
      el.pause();
      setPlaying(null);
      return;
    }
    useEditor.getState().setPlaying(false);
    el.src = api.musicAudioUrl(t.path);
    el.currentTime = 0;
    void el.play();
    setPlaying(t.path);
  };
  const setMix = (patch: Partial<AudioMix>, sourceIn?: number) =>
    current && sendOp({ op: { type: 'set_overlay_mix', id: current.id, mix: { ...mix, ...patch }, sourceIn }, note: 'Ajustou a trilha' });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <audio ref={audio} onEnded={() => setPlaying(null)} />
      <VoiceClean />
      {current && currentAsset ? (
        <section className="space-y-3 border-b border-ink-750 p-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-nc/15 text-cyan-nc">
              <Music size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-ink-100">{currentAsset.name.replace(/\.[^.]+$/, '')}</div>
              <div className="text-ui-xs text-ink-400">Trilha do vídeo · A3 · cobre o vídeo inteiro</div>
            </div>
            <button aria-label="Tirar a trilha" onClick={() => sendOp({ op: { type: 'remove_overlay', id: current.id }, note: 'Tirou a trilha' })} className="text-ink-400 hover:text-rose-400" title="Tirar a trilha">
              <Trash2 size={14} />
            </button>
          </div>
          <Slider label="Volume" value={mix.gainDb} min={-36} max={0} step={1} fmt={(v) => `${v} dB`} onCommit={(v) => setMix({ gainDb: v })} />
          <Slider label="Começar a música em" value={current.source.type === 'media' ? current.source.in : 0} min={0} max={Math.max(1, currentAsset.duration - 5)} step={0.5} fmt={(v) => formatTime(v)} onCommit={(v) => setMix({}, v)} />
          <div className="grid grid-cols-2 gap-3">
            <Slider label="Fade in" value={mix.fadeIn} min={0} max={6} step={0.25} fmt={(v) => `${v}s`} onCommit={(v) => setMix({ fadeIn: v })} />
            <Slider label="Fade out" value={mix.fadeOut} min={0} max={8} step={0.25} fmt={(v) => `${v}s`} onCommit={(v) => setMix({ fadeOut: v })} />
          </div>
          <label className="flex items-center justify-between text-xs text-ink-300">
            <span>
              Abaixar quando você fala <span className="text-ink-400">(ducking)</span>
            </span>
            <input type="checkbox" checked={mix.duck} onChange={(e) => setMix({ duck: e.target.checked })} className="h-4 w-4 accent-nc-500" />
          </label>
        </section>
      ) : (
        <p className="border-b border-ink-750 p-4 text-ui-sm leading-snug text-ink-400">Sem trilha. Ouça uma da sua biblioteca e clique em <b className="text-ink-200">Usar</b> — ela entra na A3, cobrindo o vídeo inteiro, abaixando sozinha quando você fala.</p>
      )}

      <div className="flex items-center gap-2 border-b border-ink-750 px-3 py-2">
        <Search size={13} className="text-ink-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Buscar na biblioteca…" className="flex-1 bg-transparent text-xs text-ink-100 placeholder:text-ink-400 focus:outline-none" />
        <span className="text-ui-xs text-ink-400">{tracks?.length ?? 0}</span>
        <button
          onClick={async () => {
            setErr('');
            try {
              const r = await api.musicAuto(project.id);
              if (!r.track) setErr('Nenhuma faixa com BPM medido ainda — a análise roda em segundo plano ao abrir esta aba.');
            } catch (e) {
              setErr((e as Error).message);
            }
          }}
          className="rounded-full border border-ink-700 px-2 py-0.5 text-ui-2xs whitespace-nowrap text-ink-300 hover:border-nc-500 hover:text-white"
          title="Escolhe a trilha pelo ritmo do corte (BPM) e começa num tempo forte"
        >
          pela batida
        </button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {err && <p className="p-3 text-ui-xs text-rose-400">{err}</p>}
        {tracks?.length === 0 && <p className="p-4 text-ui-xs text-ink-400">Biblioteca vazia ou disco desconectado (Thales SSD/Clientes/Thales/Trilhas).</p>}
        {filtered.map((t) => {
          const inUse = currentAsset?.path === t.path;
          return (
            <div key={t.path} className={`group flex items-center gap-2 border-b border-ink-800 px-3 py-2 ${inUse ? 'bg-nc-500/10' : 'hover:bg-ink-800'}`}>
              <button onClick={() => audition(t)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-700 text-ink-100 hover:bg-nc-500" title="Ouvir">
                {playing === t.path ? <Pause size={12} /> : <Play size={12} className="ml-0.5" />}
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-ui-sm text-ink-100" title={t.name}>
                  {t.name}
                </div>
                <div className="font-mono text-ui-xs text-ink-400">
                  {formatTime(t.duration)}
                  {t.analise && <span className="ml-1.5 text-ink-300">· {t.analise.bpm} BPM · {t.analise.clima}</span>}
                </div>
              </div>
              {inUse ? (
                <span className="text-ui-xs font-semibold text-nc-300">em uso</span>
              ) : (
                <button
                  onClick={() => {
                    audio.current?.pause();
                    setPlaying(null);
                    api.useMusic(project.id, t.path).catch((e: Error) => setErr(e.message));
                  }}
                  className="rounded-md bg-ink-700 px-2 py-1 text-ui-xs font-semibold text-ink-100 opacity-0 transition group-hover:opacity-100 hover:bg-nc-500"
                >
                  Usar
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Limpar ruído da voz (RNNoise): o mesmo áudio limpo toca no preview e sai no export. */
function VoiceClean() {
  const project = useEditor((s) => s.project);
  const sendOp = useEditor((s) => s.sendOp);
  if (!project) return null;
  const mix = project.timeline.voiceDenoise ?? 0;
  const ids = new Set(project.timeline.main.map((c) => c.assetId));
  const voices = project.assets.filter((a) => ids.has(a.id) && a.hasAudio);
  const chain = !!project.timeline.voiceChain;
  const ready = voices.every((a) => (a.clean?.mix ?? 0) === mix && !!a.clean?.chain === chain) || (!mix && !chain);
  const set = (m: number, label: string) => m !== mix && sendOp({ op: { type: 'set_voice_denoise', amount: m }, note: m ? `Limpeza da voz: ${label}` : 'Desligou a limpeza da voz' });
  const opts = [{ label: 'Desligada', mix: 0 }, ...VOICE_DENOISE_LEVELS];
  return (
    <section className="space-y-2 border-b border-ink-750 p-4">
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-nc-500/15 text-nc-300">
          <Mic size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-ink-100">Limpar ruído da voz</div>
          <div className="text-ui-xs text-ink-400">Chiado, ar-condicionado, rua — a voz fica igual</div>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-1 rounded-lg bg-ink-850 p-1">
        {opts.map((o) => (
          <button key={o.label} disabled={!voices.length} onClick={() => set(o.mix, o.label)} className={`rounded-md py-1 text-ui-xs font-semibold transition ${Math.abs(o.mix - mix) < 0.001 ? 'bg-nc-500 text-white' : 'text-ink-400 hover:text-white'} disabled:opacity-40`}>
            {o.label}
          </button>
        ))}
      </div>
      <label className="flex items-center justify-between text-ui-xs text-ink-300">
        <span>
          Cadeia de voz <span className="text-ink-400">(passa-alta, compressão leve, de-esser)</span>
        </span>
        <input type="checkbox" checked={chain} disabled={!voices.length} onChange={(e) => sendOp({ op: { type: 'set_voice_chain', on: e.target.checked }, note: e.target.checked ? 'Ligou a cadeia de voz' : 'Desligou a cadeia de voz' })} className="h-4 w-4 accent-nc-500" />
      </label>
      {(mix > 0 || chain) && <p className={`text-ui-xs ${ready ? 'text-emerald-300/90' : 'text-amber-300/90'}`}>{ready ? 'Aplicada no preview e no export.' : 'Processando a voz… o preview troca sozinho quando ficar pronto.'}</p>}
    </section>
  );
}

function Slider({ label, value, min, max, step, fmt, onCommit }: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onCommit: (v: number) => void }) {
  const unit = fmt(min).replace(/^[-\d.,:\s+]+/, '');
  return <RangeField label={label} value={value} min={min} max={max} step={step} unit={unit} onCommit={onCommit} />;
}
