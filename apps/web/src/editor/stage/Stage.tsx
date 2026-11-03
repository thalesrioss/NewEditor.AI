import { useRef, useState } from 'react';
import { ChevronFirst, ChevronLast, Cpu, FileVideo, Maximize2, Pause, Play, SkipBack, SkipForward, StepBack, StepForward, Volume2, VolumeX } from 'lucide-react';
import { clipStarts, FORMAT_PRESETS, formatPresetOf, ratioLabel, timelineDuration } from '@neweditor/core';
import { api } from '../../lib/api.ts';
import { webcodecsAvailable } from '../../lib/engine/media.ts';
import { useEditor } from '../../lib/store.ts';
import { EnginePlayer } from '../../components/EnginePlayer.tsx';
import { LegacyPlayer } from '../../components/Player.tsx';
import { useEngineMode } from '../../components/PlayerParts.tsx';
import { openRightTab, timecode } from '../shared.ts';

/**
 * Centro do editor (CapCut): cabeçalho "Player" com formato e qualidade, o quadro e a barra de transporte
 * (início, corte anterior, um quadro, play, um quadro, corte seguinte, fim, timecode, mudo, tela cheia).
 */
export function Stage() {
  const [mode, setMode] = useEngineMode();
  const project = useEditor((s) => s.project);
  const wrap = useRef<HTMLDivElement>(null);
  if (!project) return null;
  const tl = project.timeline;
  const fullscreen = () => {
    const el = wrap.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };
  return (
    <div ref={wrap} className="flex h-full min-h-0 flex-col bg-ink-950">
      <header className="flex h-9 shrink-0 items-center gap-2 px-3 text-ui-xs text-ink-400">
        <span className="font-semibold text-ink-200">Player</span>
        <span className="ml-auto flex items-center gap-1.5">
          <BeforeAfter />
          <FormatSelect />
          <button
            disabled={!webcodecsAvailable()}
            onClick={(e) => (e.currentTarget.blur(), setMode(mode === 'webcodecs' ? 'classico' : 'webcodecs'))}
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-ui-xs whitespace-nowrap ${mode === 'webcodecs' ? 'border-nc-500/60 text-nc-300' : 'border-ink-600 text-ink-400'} hover:text-white disabled:opacity-40`}
            title={mode === 'webcodecs' ? 'Prévia completa: quadro exato (WebCodecs + WebGL). Clique para a prévia rápida.' : 'Prévia rápida (vídeo do navegador). Clique para quadro exato.'}
          >
            <Cpu size={11} /> {mode === 'webcodecs' ? 'Prévia completa' : 'Prévia rápida'}
          </button>
        </span>
      </header>
      <div className="min-h-0 flex-1">{project.assets.length === 0 ? <ImportBox projectId={project.id} /> : mode === 'webcodecs' ? <EnginePlayer /> : <LegacyPlayer />}</div>
      <Transport onFullscreen={fullscreen} />
    </div>
  );
}


function Transport({ onFullscreen }: { onFullscreen: () => void }) {
  const timeline = useEditor((s) => s.project?.timeline);
  const playing = useEditor((s) => s.playing);
  const playhead = useEditor((s) => s.playhead);
  const setPlaying = useEditor((s) => s.setPlaying);
  const seek = useEditor((s) => s.seek);
  const sendOp = useEditor((s) => s.sendOp);
  const total = timeline ? timelineDuration(timeline) : 0;
  const fps = timeline?.fps || 30;
  const has = !!timeline?.main.length;
  const starts = timeline ? clipStarts(timeline) : [];
  const prevCut = () => seek([...starts].reverse().find((s) => s < playhead - 0.02) ?? 0);
  const nextCut = () => seek([...starts, total].find((s) => s > playhead + 0.02) ?? total);
  // O botão liga/desliga o mudo guardado da A1 (o solo de outra trilha não conta aqui: ele se desfaz no solo).
  const muted = !!timeline?.trackState?.A1?.muted;
  const Btn = ({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) => (
    <button aria-label={label} title={label} disabled={disabled || !has} onClick={(e) => (e.currentTarget.blur(), onClick())} className="rounded-ui-md p-1.5 text-ink-300 transition hover:bg-ink-800 hover:text-white disabled:pointer-events-none disabled:opacity-30">
      {children}
    </button>
  );
  return (
    <div className="grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-t border-ink-750 bg-ink-900 px-3">
      <div className="font-mono text-ui-sm tabular-nums text-ink-400">
        <span className="text-white">{timecode(playhead, fps)}</span> <span className="text-ink-600">/</span> {timecode(total, fps)}
      </div>
      <div className="flex items-center gap-0.5">
        <Btn label="Início (Home)" onClick={() => seek(0)}>
          <ChevronFirst size={16} />
        </Btn>
        <Btn label="Corte anterior (↑)" onClick={prevCut}>
          <SkipBack size={15} />
        </Btn>
        <Btn label="Um quadro para trás (←)" onClick={() => seek(playhead - 1 / fps)}>
          <StepBack size={15} />
        </Btn>
        <button
          className="mx-1 flex h-9 w-9 items-center justify-center rounded-full nc-gradient text-white shadow-ui-1 transition hover:brightness-110 disabled:opacity-40"
          disabled={!has}
          onClick={(e) => (e.currentTarget.blur(), setPlaying(!playing))}
          aria-label={playing ? 'Pausar' : 'Tocar'}
          title="Tocar / pausar (espaço)"
        >
          {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
        </button>
        <Btn label="Um quadro para a frente (→)" onClick={() => seek(playhead + 1 / fps)}>
          <StepForward size={15} />
        </Btn>
        <Btn label="Corte seguinte (↓)" onClick={nextCut}>
          <SkipForward size={15} />
        </Btn>
        <Btn label="Fim (End)" onClick={() => seek(total)}>
          <ChevronLast size={16} />
        </Btn>
      </div>
      <div className="flex items-center justify-end gap-0.5">
        <Btn label={muted ? 'Ligar o som da fala' : 'Mudo na fala (A1)'} onClick={() => timeline && sendOp({ op: { type: 'set_track_state', trackId: 'A1', patch: { muted: !muted } }, note: muted ? 'Som da fala de volta' : 'Mudo na fala' })}>
          {muted ? <VolumeX size={15} className="text-amber-300" /> : <Volume2 size={15} />}
        </Btn>
        <Btn label="Tela cheia" onClick={onFullscreen}>
          <Maximize2 size={14} />
        </Btn>
      </div>
    </div>
  );
}

/** Segure para ver como estava ANTES da última passada do agente (tecla B). */
function BeforeAfter() {
  const before = useEditor((s) => s.beforeAgent);
  const show = useEditor((s) => s.showBefore);
  const set = useEditor((s) => s.setShowBefore);
  if (!before) return null;
  return (
    <button
      onMouseDown={() => set(true)}
      onMouseUp={() => set(false)}
      onMouseLeave={() => set(false)}
      aria-pressed={show}
      title="Segure para ver como estava antes da última passada do agente (B)"
      className={`rounded-full border px-2 py-0.5 text-ui-xs whitespace-nowrap ${show ? 'border-amber-300 bg-amber-400/20 text-amber-200' : 'border-ink-600 text-ink-400 hover:text-white'}`}
    >
      {show ? 'Antes' : 'Antes/depois'}
    </button>
  );
}

function ImportBox({ projectId }: { projectId: string }) {
  const [value, setValue] = useState('');
  const [err, setErr] = useState('');
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="w-full max-w-lg rounded-ui-lg border border-dashed border-ink-600 bg-ink-850 p-8 text-center">
        <FileVideo className="mx-auto mb-3 text-nc-400" size={34} />
        <h2 className="font-semibold">Traga o material bruto</h2>
        <p className="mt-1 text-ui-md text-ink-400">Arraste o arquivo para cá, use Mídia → Importar, ou cole o caminho no disco (o original não é copiado nem alterado).</p>
        <form
          className="mt-5 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setErr('');
            try {
              if (value.trim()) await api.importPath(projectId, value.trim());
            } catch (x) {
              setErr((x as Error).message);
            }
          }}
        >
          <input value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="/Users/…/bruto.mp4" className="input flex-1 font-mono text-ui-sm" />
          <button className="rounded-ui-md nc-gradient px-4 text-ui-md font-semibold text-white">Importar</button>
        </form>
        {err && <p className="mt-2 text-ui-sm text-rose-400">{err}</p>}
      </div>
    </div>
  );
}

/** Formato da entrega no cabeçalho do player (CapCut): presets em pixels ou "Personalizado…" (abre Ajustes → Projeto). */
function FormatSelect() {
  const tl = useEditor((s) => s.project?.timeline);
  const sendOp = useEditor((s) => s.sendOp);
  const select = useEditor((s) => s.select);
  if (!tl) return null;
  const preset = formatPresetOf(tl.width, tl.height);
  return (
    <select
      aria-label="Formato da entrega"
      title={`Formato da entrega: ${tl.width}×${tl.height} (${ratioLabel(tl.width, tl.height)}) · ${+tl.fps.toFixed(3)} fps. Mudar reposiciona legenda e letterings (alturas relativas); material mais largo pede reframe.`}
      value={preset?.id ?? 'custom'}
      onChange={(e) => {
        const p = FORMAT_PRESETS.find((x) => x.id === e.target.value);
        if (p) sendOp({ op: { type: 'set_format', width: p.width, height: p.height }, note: `Formato ${p.label} (${p.width}×${p.height})` });
        else {
          select(null);
          openRightTab('ajustes');
        }
        e.currentTarget.blur();
      }}
      className="rounded-full border border-ink-700 bg-ink-900 px-2 py-0.5 font-mono text-ui-xs text-ink-300 focus:outline-none hover:border-ink-500"
    >
      {FORMAT_PRESETS.map((p) => (
        <option key={p.id} value={p.id}>
          {p.ratio} · {p.width}×{p.height} · {p.label}
        </option>
      ))}
      <option value="custom">{preset ? 'Personalizado…' : `${ratioLabel(tl.width, tl.height)} · ${tl.width}×${tl.height} · Personalizado…`}</option>
    </select>
  );
}
