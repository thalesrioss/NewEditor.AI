import { clipDuration, formatTime, locate, type Clip, type MediaAsset, type Removal } from '@neweditor/core';
import { useEditor } from '../../lib/store.ts';
import { KIND_STYLE } from '../shared.ts';

/** A fala bruta inteira, encaixada na largura: azul = ficou, colorido/hachurado = cortado (clique restaura). */
export function SourceLane({ asset, clips, removals, headerW }: { asset: MediaAsset; clips: Clip[]; removals: Removal[]; headerW: number }) {
  const sendOp = useEditor((s) => s.sendOp);
  const playhead = useEditor((s) => s.playhead);
  const timeline = useEditor((s) => s.project?.timeline);
  const words = useEditor((s) => s.transcripts[asset.id]);
  const D = asset.duration || 1;
  const pct = (t: number) => `${(t / D) * 100}%`;
  const loc = timeline?.main.length ? locate(timeline, playhead) : null;
  const mine = removals.filter((r) => r.assetId === asset.id);
  const kept = clips.filter((c) => c.assetId === asset.id).reduce((a, c) => a + clipDuration(c), 0);
  const textOf = (r: Removal) => words?.filter((w) => w.end > r.in && w.start < r.out).map((w) => w.w).join(' ') ?? '';

  return (
    <div className="flex h-7 shrink-0 items-center gap-3 border-t border-ink-750 bg-ink-900 pr-3">
      <div className="shrink-0 truncate pl-2 text-ui-xs text-ink-400" style={{ width: headerW - 8 }} title={`${asset.name}: ${formatTime(D)} no bruto → ${formatTime(kept)} no corte`}>
        <span className="font-semibold text-ink-300">Bruto</span> {formatTime(D)}→{formatTime(kept)}
      </div>
      <div className="relative h-3.5 flex-1 overflow-hidden rounded bg-ink-800">
        {clips
          .filter((c) => c.assetId === asset.id)
          .map((c) => (
            <div key={c.id} className="absolute top-0 bottom-0 bg-nc-500/70" style={{ left: pct(c.in), width: pct(c.out - c.in) }} />
          ))}
        {mine.map((r) => (
          <button
            aria-label={`${KIND_STYLE[r.kind].label} — ${r.reason}. Clique para restaurar`}
            key={r.id}
            className="hatch absolute top-0 bottom-0 cursor-pointer opacity-80 transition hover:opacity-100 hover:ring-1 hover:ring-white"
            style={{ left: pct(r.in), width: `max(2px, ${pct(r.out - r.in)})`, backgroundColor: KIND_STYLE[r.kind].color }}
            title={`${KIND_STYLE[r.kind].label} — ${r.reason}\n"${textOf(r)}"\n\nClique para restaurar`}
            onClick={() => sendOp({ op: { type: 'restore', removalId: r.id }, note: `Restaurou: ${r.reason}` })}
          />
        ))}
        {loc && loc.clip.assetId === asset.id && <div className="absolute top-0 bottom-0 w-px bg-white" style={{ left: pct(loc.sourceTime) }} />}
      </div>
    </div>
  );
}
