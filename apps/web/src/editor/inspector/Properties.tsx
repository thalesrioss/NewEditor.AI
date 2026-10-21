import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BookMarked, CheckCircle2, ChevronDown, ChevronRight, Palette, Trash2 } from 'lucide-react';
import {
  clipDuration,
  clipStarts,
  editorialWarnings,
  formatTime,
  LETTERING_STYLES,
  letteringAccent,
  letteringCues,
  letteringFromText,
  MOTION_TEMPLATES,
  motionCues,
  NARRATIVE_FUNCTIONS,
  resolveOverlay,
  SFX_LABEL,
  VOICE_DENOISE_LEVELS,
  DEFAULT_CAPTIONS,
  FORMAT_PRESETS,
  formatPresetOf,
  ratioLabel,
  PERSONALIZADO_ID,
  profileLabel,
  profileValue,
  type ClientProfile,
  type LetteringSpec,
  type LetteringStyleId,
  type MotionSpec,
  type MotionTemplateId,
  type OverlayItem,
  type Clip,
} from '@neweditor/core';
import { api } from '../../lib/api.ts';
import { CaptionInput, captionActions, cueText, useCaptionCues } from '../../lib/captions.tsx';
import { useEditor } from '../../lib/store.ts';
import { Button, RangeField } from '../../components/ui.tsx';
import { StylePreview } from '../../components/TextPanel.tsx';
import { openRail, ROLE_STYLE, timecode } from '../shared.ts';
import { PadraoEditorialDialog } from './PadraoEditorialDialog.tsx';

/** Ajustes do que está selecionado (CapCut: inspetor); sem seleção, as configurações do projeto. */
export function Properties() {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const multi = useEditor((s) => s.multi);
  const multiClips = useEditor((s) => s.multiClips);
  if (!project) return null;
  const tl = project.timeline;
  const group = multi.length + multiClips.length;

  if (selection?.kind === 'clip') {
    const i = tl.main.findIndex((c) => c.id === selection.id);
    const c = tl.main[i];
    if (c) return <ClipProps clip={c} index={i} group={group} />;
  }
  if (selection?.kind === 'overlay') {
    const o = tl.overlays.find((x) => x.id === selection.id);
    if (o) return <OverlayProps item={o} group={group} />;
  }
  if (selection?.kind === 'caption') return <CaptionProps id={selection.id} />;
  return <ProjectProps />;
}

// ---------------------------------------------------------------------------
// Clipe da fala
// ---------------------------------------------------------------------------

function ClipProps({ clip: c, index: i, group }: { clip: Clip; index: number; group: number }) {
  const project = useEditor((s) => s.project)!;
  const sendOp = useEditor((s) => s.sendOp);
  const select = useEditor((s) => s.select);
  const tl = project.timeline;
  const fps = tl.fps;
  const start = clipStarts(tl)[i]!;
  const asset = project.assets.find((a) => a.id === c.assetId);
  return (
    <Panel title={`Clipe ${i + 1} de ${tl.main.length}`} subtitle={group ? `+ ${group} no grupo` : asset?.name}>
      <Section title="Básico">
        <Row k="Na timeline" v={`${timecode(start, fps)} → ${timecode(start + clipDuration(c), fps)}`} />
        <Row k="No bruto" v={`${timecode(c.in, fps)} → ${timecode(c.out, fps)}`} />
        <Row k="Duração" v={`${clipDuration(c).toFixed(2)} s`} />
        {c.reason && <Row k="Por quê" v={c.reason} />}
      </Section>
      <Section title="Zoom">
        <RangeField label="Cut zoom" value={c.zoom ?? 1} min={1} max={1.3} step={0.01} unit="×" resetTo={1} onCommit={(z) => sendOp({ op: { type: 'set_zoom', clipId: c.id, zoom: z }, note: z === 1 ? 'Tirou o zoom' : `Zoom ${z}×` })} hint="Referência da casa: 1,06–1,14 na fala, sem repetir o valor em clipes seguidos." />
        <RangeField label="Zoom animado até" value={c.zoomTo ?? c.zoom ?? 1} min={1} max={1.5} step={0.01} unit="×" resetTo={c.zoom ?? 1} onCommit={(z) => sendOp({ op: { type: 'set_zoom', clipId: c.id, zoom: c.zoom ?? 1, zoomTo: Math.abs(z - (c.zoom ?? 1)) < 0.005 ? null : z }, note: Math.abs(z - (c.zoom ?? 1)) < 0.005 ? 'Tirou o zoom animado' : `Zoom animado até ${z}×` })} hint="Punch-in: vai do zoom fixo até aqui ao longo do clipe, com ease-out." />
        <Toggle label="Flash na entrada" hint="2 quadros invertidos + obturador no SFX" on={!!c.flash} onChange={(v) => sendOp({ op: { type: 'set_flash', clipId: c.id, on: v }, note: v ? `Flash em ${formatTime(start)}` : 'Tirou o flash' })} />
      </Section>
      <Section title="Velocidade">
        <RangeField label="Velocidade" value={c.speed ?? 1} min={0.5} max={2} step={0.05} unit="×" resetTo={1} onCommit={(v) => sendOp({ op: { type: 'set_speed', clipId: c.id, speed: v }, note: Math.abs(v - 1) < 0.01 ? 'Velocidade normal' : `Velocidade ${v}×` })} hint="O áudio acompanha sem mudar o tom; a legenda acompanha." />
        <RangeField label="Congelar o último quadro" value={c.freeze ?? 0} min={0} max={4} step={0.1} unit="s" resetTo={0} onCommit={(v) => sendOp({ op: { type: 'set_speed', clipId: c.id, freeze: v }, note: v ? `Freeze de ${v.toFixed(1)} s` : 'Tirou o freeze' })} />
      </Section>
      <CameraControls clip={c} />
      <Section title="Cor">
        <Button size="sm" variant="ghost" className="w-full" icon={<Palette size={13} />} onClick={() => openRail('cor')}>
          Abrir a correção de cor deste arquivo
        </Button>
      </Section>
      <Danger onClick={() => (sendOp({ op: { type: 'delete_clip', clipId: c.id, reason: 'removido pelo editor' }, note: 'Removeu um clipe' }), select(null))}>Remover clipe</Danger>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Overlay (B-roll, lettering, motion, SFX, trilha)
// ---------------------------------------------------------------------------

function OverlayProps({ item: o, group }: { item: OverlayItem; group: number }) {
  const project = useEditor((s) => s.project)!;
  const sendOp = useEditor((s) => s.sendOp);
  const select = useEditor((s) => s.select);
  const seek = useEditor((s) => s.seek);
  const tl = project.timeline;
  const fps = tl.fps;
  const assets = new Map(project.assets.map((a) => [a.id, a]));
  const pos = resolveOverlay(tl, o);
  const name = o.source.type === 'media' ? assets.get(o.source.assetId)?.name : o.source.type === 'text' ? `"${o.source.text}"` : o.source.type === 'motion' ? MOTION_TEMPLATES[o.source.motion.template].label : o.source.type === 'lettering' ? LETTERING_STYLES[o.source.lettering.estilo]?.label : o.source.compositionId;
  return (
    <Panel title={`${ROLE_STYLE[o.role].label} · ${o.trackId}`} subtitle={group ? `+ ${group} no grupo` : name}>
      <Section title="Básico">
        <Row k="Fonte" v={name ?? '—'} />
        <Row k="Na timeline" v={pos ? `${timecode(pos.start, fps)} → ${timecode(pos.end, fps)}` : 'órfão (fala cortada)'} />
        <Row k="Preso à fala em" v={`${timecode(o.anchor.at, fps)} do bruto`} />
        <DurationControl value={o.duration} onCommit={(d) => sendOp({ op: { type: 'trim_overlay', id: o.id, duration: d }, note: `Duração ${d.toFixed(1)}s` })} />
        {o.by === 'agent' && o.reason && <Row k="Por quê (agente)" v={o.reason} />}
      </Section>
      {o.source.type === 'motion' && <MotionEditor item={o} spec={o.source.motion} />}
      {(o.source.type === 'lettering' || o.source.type === 'text') && <LetteringEditor item={o} spec={o.source.type === 'lettering' ? o.source.lettering : letteringFromText(o.source.text)} />}
      {o.role === 'broll' && o.source.type === 'media' && !assets.get(o.source.assetId)?.alpha && <FramingEditor item={o} />}
      {o.role === 'broll' && o.source.type === 'media' && assets.get(o.source.assetId)?.kind === 'video' && <OverlaySpeedEditor item={o} sourceDuration={assets.get(o.source.assetId)?.duration ?? 0} />}
      {(o.role === 'music' || o.role === 'sfx') && <MixEditor item={o} />}
      {o.role === 'motion' && o.source.type === 'media' && (
        <Section title="Som do motion">
          <p className="text-ui-xs leading-snug text-ink-400">{o.sfx?.length ? `${o.sfx.length} efeitos (lidos das cues do Motion Studio): ${[...new Set(o.sfx.map((c) => SFX_LABEL[c.kind] ?? c.kind))].join(' · ')}` : 'Sem cues de som neste render.'}</p>
        </Section>
      )}
      {pos && (
        <Button size="sm" variant="ghost" className="w-full" onClick={() => seek(pos.start)}>
          Ir para o início
        </Button>
      )}
      <Danger onClick={() => (sendOp({ op: { type: 'remove_overlay', id: o.id }, note: 'Removeu um overlay' }), select(null))}>Remover</Danger>
    </Panel>
  );
}

/** Posição e zoom do B-roll que preenche o quadro (CH-0003) — a mesma conta do export. */
function FramingEditor({ item }: { item: OverlayItem }) {
  const sendOp = useEditor((s) => s.sendOp);
  const f = item.framing ?? { x: 0.5, y: 0.5, zoom: 1 };
  const set = (patch: Partial<typeof f>, note: string) => sendOp({ op: { type: 'set_overlay_framing', id: item.id, framing: patch }, note });
  return (
    <Section title="Enquadramento">
      <RangeField label="Zoom" value={f.zoom} min={1} max={4} step={0.01} unit="×" resetTo={1} onCommit={(v) => set({ zoom: v }, `B-roll com zoom ${v}×`)} />
      <RangeField label="Horizontal" value={f.x} min={0} max={1} step={0.01} resetTo={0.5} onCommit={(v) => set({ x: v }, 'Moveu o B-roll na horizontal')} hint="0 = esquerda da imagem · 1 = direita." />
      <RangeField label="Vertical" value={f.y} min={0} max={1} step={0.01} resetTo={0.5} onCommit={(v) => set({ y: v }, 'Moveu o B-roll na vertical')} hint="0 = topo · 1 = base. Só anda se houver sobra (zoom ou imagem mais alta que o quadro)." />
      {item.framing && (
        <Button size="sm" variant="ghost" className="w-full" onClick={() => sendOp({ op: { type: 'set_overlay_framing', id: item.id, framing: null }, note: 'B-roll de volta ao recorte central' })}>
          Voltar ao centro
        </Button>
      )}
    </Section>
  );
}

/** Velocidade e congelamento do B-roll (CH-0004) — o mesmo tempo no export. */
function OverlaySpeedEditor({ item, sourceDuration }: { item: OverlayItem; sourceDuration: number }) {
  const sendOp = useEditor((s) => s.sendOp);
  const srcIn = item.source.type === 'media' ? item.source.in : 0;
  // Esticar: o que sobra da fonte cobre o evento inteiro (B-roll mais curto que o evento vira câmera lenta).
  const fit = Math.min(4, Math.max(0.25, Math.round(((sourceDuration - srcIn) / Math.max(0.1, item.duration - (item.freeze ?? 0))) * 1000) / 1000));
  return (
    <Section title="Tempo do B-roll">
      <RangeField label="Velocidade" value={item.speed ?? 1} min={0.25} max={4} step={0.05} unit="×" resetTo={1} onCommit={(v) => sendOp({ op: { type: 'set_overlay_speed', id: item.id, speed: v }, note: Math.abs(v - 1) < 0.01 ? 'B-roll na velocidade normal' : `B-roll a ${v}×` })} hint="Menor que 1 = câmera lenta. A duração na timeline não muda." />
      <RangeField label="Congelar o fim" value={item.freeze ?? 0} min={0} max={Math.min(10, item.duration)} step={0.1} unit="s" resetTo={0} onCommit={(v) => sendOp({ op: { type: 'set_overlay_speed', id: item.id, freeze: v }, note: v ? `B-roll congela nos últimos ${v.toFixed(1)} s` : 'B-roll sem congelar' })} />
      {sourceDuration > 0 && Math.abs(fit - (item.speed ?? 1)) > 0.01 && (
        <Button size="sm" variant="ghost" className="w-full" onClick={() => sendOp({ op: { type: 'set_overlay_speed', id: item.id, speed: fit }, note: `B-roll esticado até o fim do evento (${fit}×)` })}>
          Esticar a fonte até o fim ({fit}×)
        </Button>
      )}
    </Section>
  );
}

/** Volume, fades e ducking de trilha/SFX — a mesma mixagem do export. */
function MixEditor({ item }: { item: OverlayItem }) {
  const sendOp = useEditor((s) => s.sendOp);
  const mix = item.mix ?? { gainDb: item.role === 'music' ? -16 : 0, fadeIn: item.role === 'music' ? 1.5 : 0, fadeOut: item.role === 'music' ? 2.5 : 0, duck: item.role === 'music' };
  const set = (patch: Partial<typeof mix>, note: string) => sendOp({ op: { type: 'set_overlay_mix', id: item.id, mix: { ...mix, ...patch } }, note });
  return (
    <Section title="Áudio">
      <RangeField label="Volume" value={mix.gainDb} min={-40} max={6} step={0.5} unit="dB" resetTo={item.role === 'music' ? -16 : 0} onCommit={(v) => set({ gainDb: v }, `Volume ${v} dB`)} />
      <RangeField label="Fade in" value={mix.fadeIn} min={0} max={6} step={0.1} unit="s" resetTo={0} onCommit={(v) => set({ fadeIn: v }, `Fade in ${v.toFixed(1)} s`)} />
      <RangeField label="Fade out" value={mix.fadeOut} min={0} max={8} step={0.1} unit="s" resetTo={0} onCommit={(v) => set({ fadeOut: v }, `Fade out ${v.toFixed(1)} s`)} />
      <Toggle label="Abaixar quando tem fala" hint="ducking (sidechain) de ~10 dB" on={mix.duck} onChange={(v) => set({ duck: v }, v ? 'Ducking ligado' : 'Ducking desligado')} />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Legenda (um bloco da trilha LG)
// ---------------------------------------------------------------------------

function CaptionProps({ id }: { id: string }) {
  const cues = useCaptionCues();
  const select = useEditor((s) => s.select);
  const seek = useEditor((s) => s.seek);
  const fps = useEditor((s) => s.project?.timeline.fps ?? 30);
  const i = cues.findIndex((c) => c.key === id);
  const c = cues[i];
  if (!c)
    return (
      <Panel title="Legenda">
        <p className="text-ui-xs text-ink-400">Essa legenda mudou com o corte — selecione de novo na trilha LG.</p>
      </Panel>
    );
  const prev = cues[i - 1];
  const next = cues[i + 1];
  const hasEdits = c.edited || c.hidden;
  return (
    <Panel title={`Legenda ${i + 1} de ${cues.length} · LG`}>
      <Section title="Texto">
        <Row k="Na timeline" v={`${timecode(c.start, fps)} → ${timecode(c.end, fps)}`} />
        {c.hidden ? <p className="text-ui-xs text-ink-400 line-through">{cueText(c)}</p> : <CaptionInput cue={c} cues={cues} className="input w-full py-1.5 text-xs" />}
        {c.edited && <p className="text-ui-xs text-ink-400">Automático: "{c.original}"</p>}
        <p className="text-ui-xs leading-snug text-ink-400">Enter no meio divide · ⌫ no começo junta com a de cima · Delete no fim junta com a de baixo</p>
        {c.coveredBy && (
          <Toggle label="Mostrar mesmo sob a camada" hint={`há ${c.coveredBy === 'broll' ? 'B-roll' : c.coveredBy} em cima; a regra é esconder`} on={!!c.forced} onChange={() => captionActions.toggleForce(c)} />
        )}
      </Section>
      {c.words.length > 1 && !c.hidden && (
        <Section title="Dividir antes de">
          <div className="flex flex-wrap gap-1">
            {c.words.slice(1).map((w, k) => (
              <button key={k} disabled={!w.src} onClick={() => captionActions.split(c, k + 1)} className="rounded-full bg-ink-700 px-2 py-0.5 text-ui-xs text-ink-200 hover:bg-nc-500 hover:text-white disabled:opacity-30">
                {w.text}
              </button>
            ))}
          </div>
        </Section>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        <Button size="sm" disabled={!prev} onClick={() => prev && (captionActions.merge(prev, c), select({ kind: 'caption', id: prev.key! }))}>
          Juntar com a de cima
        </Button>
        <Button size="sm" disabled={!next} onClick={() => next && captionActions.merge(c, next)}>
          Juntar com a de baixo
        </Button>
      </div>
      <Button size="sm" variant="ghost" className="w-full" onClick={() => seek(c.start + 0.01)}>
        Ir para o início
      </Button>
      {hasEdits && (
        <Button size="sm" variant="ghost" className="w-full" onClick={() => captionActions.reset(c)}>
          Voltar ao automático
        </Button>
      )}
      <Danger onClick={() => captionActions.toggleHidden(c)}>{c.hidden ? 'Restaurar legenda' : 'Apagar legenda'}</Danger>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Projeto (sem seleção)
// ---------------------------------------------------------------------------

function ProjectProps() {
  const project = useEditor((s) => s.project)!;
  const sendOp = useEditor((s) => s.sendOp);
  const select = useEditor((s) => s.select);
  const [brief, setBrief] = useState(project.brief);
  useEffect(() => setBrief(project.brief), [project.brief]);
  const tl = project.timeline;
  const assets = new Map(project.assets.map((a) => [a.id, a]));
  const warnings = useMemo(() => editorialWarnings(tl, (id) => assets.get(id)?.name ?? id), [tl]); // eslint-disable-line react-hooks/exhaustive-deps
  const caps = tl.captions ?? DEFAULT_CAPTIONS;
  const fala = project.assets.find((a) => a.role === 'fala');
  const wide = !!fala?.width && !!fala?.height && fala.width / fala.height > tl.width / tl.height + 0.02;
  return (
    <Panel title="Projeto" subtitle="Clique num clipe, numa camada ou numa legenda para ver os ajustes dela.">
      <PadraoEditorial project={project} />
      <FormatSection wide={wide} />
      <Section title="Legenda">
        <Toggle label="Legenda automática" hint={`${caps.enabled ? 'ligada' : 'desligada'} · estilo e presets em Legenda, no trilho`} on={caps.enabled} onChange={(v) => sendOp({ op: { type: 'set_captions', captions: { ...caps, enabled: v } }, note: v ? 'Ligou a legenda automática' : 'Desligou a legenda' })} />
      </Section>
      <Section title="Voz">
        <label className="flex items-center justify-between gap-3 text-ui-xs text-ink-300">
          Limpeza de ruído
          <select value={tl.voiceDenoise ?? 0} onChange={(e) => sendOp({ op: { type: 'set_voice_denoise', amount: Number(e.target.value) }, note: Number(e.target.value) ? 'Limpeza de ruído da voz' : 'Desligou a limpeza de ruído' })} className="input w-28 py-1 text-ui-xs">
            <option value={0}>Desligada</option>
            {VOICE_DENOISE_LEVELS.map((l) => (
              <option key={l.id} value={l.mix}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <Toggle label="Cadeia de voz" hint="passa-alta, compressor, de-esser e limiter" on={!!tl.voiceChain} onChange={(v) => sendOp({ op: { type: 'set_voice_chain', on: v }, note: v ? 'Ligou a cadeia de voz' : 'Desligou a cadeia de voz' })} />
        <RangeField label="SFX dos motions" value={tl.motionSfxDb ?? 0} min={-18} max={6} step={0.5} unit="dB" resetTo={0} onCommit={(v) => sendOp({ op: { type: 'set_motion_sfx', gainDb: v }, note: `SFX dos motions ${v > 0 ? '+' : ''}${v} dB` })} />
        <label className="flex items-center justify-between gap-3 text-ui-xs text-ink-300">
          Banco de SFX
          <select value={tl.sfxBank ?? 'sintetizado'} onChange={(e) => sendOp({ op: { type: 'set_sfx_bank', bank: e.target.value as 'cinepro' | 'sintetizado' }, note: e.target.value === 'cinepro' ? 'SFX reais do CinePRO' : 'SFX sintetizados' })} className="input w-40 py-1 text-ui-xs">
            <option value="cinepro">CinePRO (amostras reais)</option>
            <option value="sintetizado">Sintetizado (sem rede)</option>
          </select>
        </label>
      </Section>
      <Section title="Briefing">
        <textarea value={brief} onChange={(e) => setBrief(e.target.value)} onBlur={() => brief !== project.brief && void api.updateProject(project.id, { brief })} onKeyDown={(e) => e.stopPropagation()} rows={5} className="input resize-none text-xs" placeholder="O que o cliente pediu…" />
      </Section>
      <Section title="Regras editoriais">
        {warnings.length === 0 ? (
          <div className="flex items-center gap-1.5 text-xs text-emerald-400">
            <CheckCircle2 size={13} /> Sem alertas — nenhum B-roll ou motion repetido mais de 2×.
          </div>
        ) : (
          warnings.map((w, i) => (
            <button key={i} onClick={() => w.overlayIds[0] && select({ kind: 'overlay', id: w.overlayIds[0] })} className={`flex w-full items-start gap-1.5 rounded-[var(--radius-ui-md)] px-2 py-1.5 text-left text-ui-sm ${w.level === 'erro' ? 'bg-rose-500/10 text-rose-300' : 'bg-amber-400/10 text-amber-200'}`}>
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {w.message}
            </button>
          ))
        )}
      </Section>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Peças do inspetor
// ---------------------------------------------------------------------------

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="scroll-thin h-full space-y-3 overflow-y-auto px-3 py-3">
      <div>
        <div className="text-ui-sm font-semibold text-ink-100">{title}</div>
        {subtitle && <div className="truncate text-ui-xs text-ink-400">{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

/** Seção recolhível, como os grupos "Básico / Áudio / Animação" do inspetor do CapCut. */
function Section({ title, children, open: initial = true }: { title: string; children: React.ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <section className="rounded-[var(--radius-ui-md)] border border-ink-750 bg-ink-800/40">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-ui-2xs font-semibold tracking-wide text-ink-300 uppercase hover:text-white" aria-expanded={open}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {title}
      </button>
      {open && <div className="space-y-2.5 px-2.5 pb-2.5">{children}</div>}
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-ui-xs">
      <span className="shrink-0 text-ink-400">{k}</span>
      <span className="text-right text-ink-100">{v}</span>
    </div>
  );
}

function Toggle({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-ui-xs text-ink-200">
      <span>
        {label}
        {hint && <span className="block text-ui-2xs text-ink-400">{hint}</span>}
      </span>
      <button role="switch" aria-checked={on} onClick={() => onChange(!on)} className={`relative h-4 w-7 shrink-0 rounded-full transition ${on ? 'bg-nc-500' : 'bg-ink-600'}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition ${on ? 'left-3.5' : 'left-0.5'}`} />
      </button>
    </label>
  );
}

function DurationControl({ value, onCommit }: { value: number; onCommit: (d: number) => void }) {
  const [d, setD] = useState(value.toFixed(2));
  useEffect(() => setD(value.toFixed(2)), [value]);
  const commit = () => {
    const n = Number(d.replace(',', '.'));
    if (n > 0.2 && Math.abs(n - value) > 0.005) onCommit(n);
  };
  return (
    <label className="flex items-center justify-between gap-3 text-ui-xs">
      <span className="text-ink-400">Duração (s)</span>
      <input value={d} onChange={(e) => setD(e.target.value)} onBlur={commit} onKeyDown={(e) => (e.stopPropagation(), e.key === 'Enter' && commit())} className="input w-24 py-1 text-right font-mono text-ui-xs" />
    </label>
  );
}

function Danger({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-ui-md)] border border-rose-500/40 py-1.5 text-ui-xs text-rose-300 hover:bg-rose-500/10">
      <Trash2 size={13} /> {children}
    </button>
  );
}

/** Quantos elementos cada mecanismo espera (pergunta/citação: uma palavra por elemento). */
const SHAPE: Record<MotionTemplateId, { hint: string; words: boolean }> = {
  palavra: { hint: 'Linha 1: a palavra · linha 2: o complemento', words: false },
  pergunta: { hint: 'A pergunta (entra palavra por palavra)', words: true },
  contraste: { hint: 'Linha 1: lado A · linha 2: lado B', words: false },
  numero: { hint: 'Linha 1: o número (ex.: 15, R$ 23, 40%) · linha 2: a unidade', words: false },
  lista: { hint: 'Um item por linha', words: false },
  citacao: { hint: 'A frase (datilografada no ritmo da fala)', words: true },
};

/** Ajusta o texto/mecanismo de um motion de cartão; os tempos de entrada acompanham a fala. */
function MotionEditor({ item, spec }: { item: OverlayItem; spec: MotionSpec }) {
  const sendOp = useEditor((s) => s.sendOp);
  const shape = SHAPE[spec.template];
  const toText = (sp: MotionSpec) => (SHAPE[sp.template].words ? sp.texts.join(' ') : sp.texts.join('\n'));
  const [text, setText] = useState(toText(spec));
  const [kicker, setKicker] = useState(spec.kicker ?? '');
  useEffect(() => (setText(toText(spec)), setKicker(spec.kicker ?? '')), [spec]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = (next: Partial<MotionSpec>, note: string) => sendOp({ op: { type: 'set_overlay_motion', id: item.id, motion: { ...spec, ...next } }, note });
  const saveText = () => {
    const texts = shape.words ? text.split(/\s+/).filter(Boolean) : text.split('\n').map((x) => x.trim()).filter(Boolean);
    if (!texts.length || texts.join('|') === spec.texts.join('|')) return;
    let beats = spec.beats;
    if (texts.length !== spec.beats.length) {
      const a = spec.beats[0] ?? 0.2;
      const b = spec.beats[spec.beats.length - 1] ?? a + 1;
      beats = texts.map((_, i) => +(a + ((b - a) * i) / Math.max(1, texts.length - 1)).toFixed(3));
    }
    const key = spec.key !== undefined && spec.key < texts.length ? spec.key : undefined;
    commit({ texts, beats, key }, 'Editou o texto do motion');
  };
  return (
    <Section title="Motion">
      <div className="flex flex-wrap items-center gap-1.5 text-ui-xs">
        <span className="rounded bg-ink-700 px-1.5 py-px font-semibold text-ink-200">{NARRATIVE_FUNCTIONS[spec.funcao].label}</span>
        <span className="text-ink-400">{NARRATIVE_FUNCTIONS[spec.funcao].desc}</span>
      </div>
      <p className="text-ui-xs leading-snug text-ink-300">"{spec.fala}"</p>
      <p className="text-ui-xs leading-snug text-ink-400">{spec.ideia}</p>
      <label className="block space-y-1">
        <span className="text-ui-xs font-medium text-ink-400">Mecanismo</span>
        <select
          value={spec.template}
          onChange={(e) => {
            const template = e.target.value as MotionTemplateId;
            const words = SHAPE[template].words;
            const texts = words === shape.words ? spec.texts : words ? spec.fala.split(/\s+/) : spec.texts.slice(0, 2);
            const a = spec.beats[0] ?? 0.2;
            const b = spec.beats[spec.beats.length - 1] ?? a + 1;
            const beats = texts.length === spec.beats.length ? spec.beats : texts.map((_, i) => +(a + ((b - a) * i) / Math.max(1, texts.length - 1)).toFixed(3));
            commit({ template, texts, beats, key: words ? Math.min(spec.key ?? 0, texts.length - 1) : spec.key }, `Motion virou ${MOTION_TEMPLATES[template].label}`);
          }}
          className="input py-1 text-xs"
        >
          {Object.entries(MOTION_TEMPLATES).map(([id, t]) => (
            <option key={id} value={id}>
              {t.label} · {t.modo}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1">
        <span className="text-ui-xs font-medium text-ink-400">Texto na tela</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} onBlur={saveText} onKeyDown={(e) => e.stopPropagation()} rows={shape.words ? 3 : Math.max(2, text.split('\n').length)} className="input resize-none text-xs" />
        <span className="block text-ui-xs text-ink-400">{shape.hint}</span>
      </label>
      <label className="block space-y-1">
        <span className="text-ui-xs font-medium text-ink-400">Kicker (rótulo pequeno)</span>
        <input value={kicker} onChange={(e) => setKicker(e.target.value)} onBlur={() => kicker !== (spec.kicker ?? '') && commit({ kicker: kicker || undefined }, 'Editou o kicker do motion')} onKeyDown={(e) => e.stopPropagation()} className="input py-1 text-xs" placeholder="—" />
      </label>
      {spec.template === 'contraste' && <Toggle label='Riscar o primeiro lado ("não é X, é Y")' on={spec.variant === 'negacao'} onChange={(v) => commit({ variant: v ? 'negacao' : 'par' }, 'Ajustou o contraste')} />}
      <Toggle label="SFX do motion" hint={`${motionCues(spec, item.duration).length} efeitos${spec.sfx !== false ? `: ${[...new Set(motionCues(spec, item.duration).map((c) => SFX_LABEL[c.kind]))].join(' · ')}` : ''}`} on={spec.sfx !== false} onChange={(v) => commit({ sfx: v ? undefined : false }, v ? 'Ligou o som do motion' : 'Silenciou o motion')} />
      {spec.refName && <p className="text-ui-xs text-ink-400">Estilo: {spec.refName}</p>}
    </Section>
  );
}

/** Texto do lettering com a palavra-chave entre *asteriscos* (o mesmo formato do lettering manual). */
const letteringText = (sp: LetteringSpec) => {
  const out: string[] = [];
  sp.words.forEach((w, i) => {
    const prev = sp.words[i - 1];
    const next = sp.words[i + 1];
    out.push(`${w.destaque && !prev?.destaque ? '*' : ''}${w.text}${w.destaque && !next?.destaque ? '*' : ''}`);
  });
  return out.join(' ');
};

/** Copia estilo e cor deste lettering para todos os outros (um passo de desfazer cada). */
function ApplyToAll({ spec, id }: { spec: LetteringSpec; id: string }) {
  const overlays = useEditor((s) => s.project?.timeline.overlays ?? []);
  const sendOp = useEditor((s) => s.sendOp);
  const others = overlays.filter((o) => o.id !== id && o.source.type === 'lettering' && (o.source.lettering.estilo !== spec.estilo || o.source.lettering.accent !== spec.accent));
  if (!others.length) return null;
  return (
    <Button size="sm" variant="ghost" className="w-full" onClick={() => others.forEach((o) => o.source.type === 'lettering' && sendOp({ op: { type: 'set_overlay_lettering', id: o.id, lettering: { ...o.source.lettering, estilo: spec.estilo, accent: spec.accent } }, note: `Estilo ${LETTERING_STYLES[spec.estilo].label} em todos os letterings` }))}>
      Aplicar a todos os letterings ({others.length})
    </Button>
  );
}

function LetteringEditor({ item, spec }: { item: OverlayItem; spec: LetteringSpec }) {
  const sendOp = useEditor((s) => s.sendOp);
  const [text, setText] = useState(letteringText(spec));
  useEffect(() => setText(letteringText(spec)), [spec]);
  const commit = (next: LetteringSpec, note: string) => sendOp({ op: { type: 'set_overlay_lettering', id: item.id, lettering: next }, note });
  const saveText = () => {
    if (!text.trim() || text === letteringText(spec)) return;
    const parsed = letteringFromText(text.trim(), spec.estilo);
    const a = spec.words[0]?.at ?? 0.1;
    const b = spec.words[spec.words.length - 1]?.at ?? a + 1;
    const words = parsed.words.map((w, i) => ({ ...w, at: parsed.words.length === spec.words.length ? spec.words[i]!.at : +(a + ((b - a) * i) / Math.max(1, parsed.words.length - 1)).toFixed(3) }));
    commit({ ...spec, words }, 'Editou o lettering');
  };
  const cues = letteringCues(spec, item.duration);
  const caps = useEditor((s) => s.project?.timeline.captions);
  return (
    <>
      <Section title="Texto">
        {spec.motivo && <p className="text-ui-xs text-ink-400">Por quê: {spec.motivo}</p>}
        <textarea value={text} onChange={(e) => setText(e.target.value)} onBlur={saveText} onKeyDown={(e) => e.stopPropagation()} rows={2} className="input resize-none text-xs" aria-label="Texto do lettering (palavra-chave entre asteriscos)" />
        <span className="block text-ui-2xs text-ink-400">Palavra-chave entre *asteriscos*.</span>
      </Section>
      <Section title="Posição">
        <RangeField label="Altura" value={Math.round((spec.y ?? caps?.position ?? 0.72) * 100)} min={10} max={92} step={1} unit="%" resetTo={Math.round((caps?.position ?? 0.72) * 100)} onCommit={(v) => commit({ ...spec, y: v / 100 }, `Lettering em ${v}% do quadro`)} />
        <div className="flex rounded-[var(--radius-ui-md)] border border-ink-700 p-0.5" role="radiogroup" aria-label="Alinhamento do lettering">
          {(
            [
              ['left', 'Esquerda'],
              ['center', 'Centro'],
              ['right', 'Direita'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} role="radio" aria-checked={(spec.align ?? 'center') === id} onClick={() => commit({ ...spec, align: id }, `Lettering à ${label.toLowerCase()}`)} className={`flex-1 rounded-[var(--radius-ui-sm)] py-1 text-ui-xs font-semibold ${(spec.align ?? 'center') === id ? 'bg-ink-700 text-white' : 'text-ink-400 hover:text-ink-200'}`}>
              {label}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Estilo">
        <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Estilo do lettering">
          {(Object.keys(LETTERING_STYLES) as LetteringStyleId[]).map((id) => (
            <button key={id} role="radio" aria-checked={spec.estilo === id} onClick={() => spec.estilo !== id && commit({ ...spec, estilo: id }, `Lettering em ${LETTERING_STYLES[id].label}`)} className={`overflow-hidden rounded-[var(--radius-ui-md)] border text-left transition ${spec.estilo === id ? 'border-nc-400 ring-2 ring-nc-500/40' : 'border-ink-700 hover:border-ink-500'}`}>
              <StylePreview spec={{ ...spec, estilo: id, accent: undefined }} className="h-[72px] w-full" />
              <span className="block truncate px-1 py-0.5 text-ui-2xs text-ink-300">{LETTERING_STYLES[id].label}</span>
            </button>
          ))}
        </div>
        <label className="flex items-center justify-between text-ui-xs text-ink-300">
          Cor de acento
          <input type="color" value={letteringAccent(spec)} onChange={(e) => commit({ ...spec, accent: e.target.value }, 'Mudou a cor do lettering')} className="h-6 w-8 cursor-pointer rounded border border-ink-600 bg-transparent" />
        </label>
        <ApplyToAll spec={spec} id={item.id} />
        <Toggle label="SFX" hint={`${cues.length} efeitos`} on={spec.sfx !== false} onChange={(v) => commit({ ...spec, sfx: v ? undefined : false }, v ? 'Ligou o som do lettering' : 'Silenciou o lettering')} />
        {spec.refName && <p className="text-ui-xs text-ink-400">Referência: {spec.refName}</p>}
      </Section>
    </>
  );
}

/** 2ª câmera e reframe para o clipe selecionado. */
function CameraControls({ clip }: { clip: Clip }) {
  const project = useEditor((s) => s.project)!;
  const sendOp = useEditor((s) => s.sendOp);
  const cams = project.assets.filter((a) => a.role === 'cam' && a.syncOffset !== undefined);
  const fala = project.assets.find((a) => a.id === clip.assetId);
  const wide = !!fala?.width && !!fala?.height && fala.width / fala.height > project.timeline.width / project.timeline.height + 0.02;
  const [busy, setBusy] = useState('');
  const go = async (k: string, fn: () => Promise<unknown>) => {
    setBusy(k);
    await fn().catch(() => undefined);
    setBusy('');
  };
  if (!cams.length && !wide) return null;
  return (
    <Section title="Câmera e enquadramento">
      {cams.length > 0 && (
        <>
          <label className="block space-y-1 text-ui-xs text-ink-300">
            Câmera
            <select value={clip.cam ?? ''} onChange={(e) => sendOp({ op: { type: 'set_cam', clipId: clip.id, assetId: e.target.value || null }, note: e.target.value ? 'Trocou para a 2ª câmera' : 'Voltou para a câmera principal' })} className="input py-1 text-ui-xs">
              <option value="">Principal ({fala?.name ?? 'fala'})</option>
              {cams.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.syncOffset! >= 0 ? '+' : ''}
                  {c.syncOffset!.toFixed(2)} s)
                </option>
              ))}
            </select>
          </label>
          <Button size="sm" variant="ghost" className="w-full" loading={busy === 'multi'} onClick={() => void go('multi', () => api.multicamAuto(project.id))}>
            Alternar câmeras automaticamente
          </Button>
        </>
      )}
      {wide && (
        <>
          <Button size="sm" variant="ghost" className="w-full" loading={busy === 'reframe'} onClick={() => void go('reframe', () => api.reframeAuto(project.id))}>
            {project.timeline.reframe ? 'Reenquadrar no rosto de novo' : 'Reframe 16:9 → vertical seguindo o rosto'}
          </Button>
          {project.timeline.reframe && <RangeField label="Centro do recorte" value={clip.framing?.x ?? 0.5} min={0} max={1} step={0.01} resetTo={0.5} onCommit={(x) => sendOp({ op: { type: 'set_framing', clipId: clip.id, x }, note: 'Ajustou o enquadramento' })} hint="0 = esquerda da imagem · 1 = direita. O reframe segue o rosto; ajuste se precisar." />}
        </>
      )}
    </Section>
  );
}

/**
 * Padrão de edição do projeto: qual está valendo, "Personalizado" (as regras saem desta edição) e o botão que
 * transforma esta edição no padrão editorial do cliente para um formato.
 */
function PadraoEditorial({ project }: { project: import('@neweditor/core').Project }) {
  const [perfis, setPerfis] = useState<ClientProfile[]>([]);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState('');
  const reload = () => api.perfis().then(setPerfis).catch(() => undefined);
  useEffect(() => void reload(), [project.profileId]);
  const atual = project.profileId === PERSONALIZADO_ID ? null : perfis.find((p) => p.id === profileValue(perfis, project.profileId));
  const nome = project.profileId === PERSONALIZADO_ID ? 'Personalizado (esta edição)' : atual ? profileLabel(atual) : 'Padrão da casa';
  return (
    <Section title="Padrão de edição">
      <Row k="Valendo agora" v={nome} />
      {project.profileId === PERSONALIZADO_ID && <p className="text-ui-2xs leading-snug text-ink-400">O agente segue o que está nesta timeline: zoom, legenda, lettering, trilha, cor e B-roll são lidos daqui a cada passada.</p>}
      {atual?.origem && <p className="text-ui-2xs leading-snug text-ink-400">Lido da edição "{atual.origem.projectName}".</p>}
      <Button size="sm" variant="secondary" className="w-full" icon={<BookMarked size={13} />} disabled={!project.timeline.main.length} onClick={() => setOpen(true)}>
        Tornar esta edição o padrão editorial…
      </Button>
      <p className="text-ui-2xs leading-snug text-ink-400">Grava o que você fez aqui como o padrão do cliente para um formato (Reels, Shorts, YouTube…). Vale para as próximas peças dele.</p>
      {msg && <p className="text-ui-xs text-emerald-300">{msg}</p>}
      {open && (
        <PadraoEditorialDialog
          project={project}
          perfis={perfis}
          onClose={() => setOpen(false)}
          onSaved={(p) => {
            setOpen(false);
            setMsg(`"${p.nome}" gravado como padrão editorial.`);
            void reload();
          }}
        />
      )}
    </Section>
  );
}

/**
 * Formato da entrega (ADR-011, fase 1): presets em pixels ou largura × altura × fps livres. Mudar o formato
 * entra no histórico; as alturas de legenda e lettering são relativas e acompanham; material mais largo pede reframe.
 */
function FormatSection({ wide }: { wide: boolean }) {
  const project = useEditor((s) => s.project)!;
  const sendOp = useEditor((s) => s.sendOp);
  const tl = project.timeline;
  const preset = formatPresetOf(tl.width, tl.height);
  const [w, setW] = useState(String(tl.width));
  const [h, setH] = useState(String(tl.height));
  const [fps, setFps] = useState(String(+tl.fps.toFixed(3)));
  const [busy, setBusy] = useState(false);
  useEffect(() => (setW(String(tl.width)), setH(String(tl.height)), setFps(String(+tl.fps.toFixed(3)))), [tl.width, tl.height, tl.fps]);
  const apply = (width: number, height: number, f?: number, note?: string) => {
    if (!(width >= 64 && height >= 64) || (f !== undefined && !(f >= 1 && f <= 120))) return;
    if (width === tl.width && height === tl.height && (f === undefined || Math.abs(f - tl.fps) < 0.001)) return;
    sendOp({ op: { type: 'set_format', width, height, fps: f }, note: note ?? `Formato ${width}×${height}${f ? ` · ${f} fps` : ''}` });
  };
  const num = (s: string) => Number(s.replace(',', '.'));
  return (
    <Section title="Formato">
      <label className="block space-y-1 text-ui-xs text-ink-300">
        Entrega
        <select
          value={preset?.id ?? 'custom'}
          onChange={(e) => {
            const p = FORMAT_PRESETS.find((x) => x.id === e.target.value);
            if (p) apply(p.width, p.height, undefined, `Formato ${p.label} (${p.width}×${p.height})`);
          }}
          className="input py-1 text-ui-xs"
        >
          {FORMAT_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.ratio} · {p.width}×{p.height} · {p.label}
            </option>
          ))}
          <option value="custom">Personalizado ({ratioLabel(tl.width, tl.height)} · {tl.width}×{tl.height})</option>
        </select>
      </label>
      <div className="grid grid-cols-3 gap-1.5">
        {(
          [
            ['Largura', w, setW],
            ['Altura', h, setH],
            ['fps', fps, setFps],
          ] as const
        ).map(([label, v, set]) => (
          <label key={label} className="block space-y-0.5 text-ui-2xs text-ink-400">
            {label}
            <input
              value={v}
              inputMode="decimal"
              onChange={(e) => set(e.target.value)}
              onKeyDown={(e) => (e.stopPropagation(), e.key === 'Enter' && apply(num(w), num(h), num(fps)))}
              onBlur={() => apply(num(w), num(h), num(fps))}
              className="input px-1.5 py-1 text-right font-mono text-ui-xs"
              aria-label={`${label} da entrega`}
            />
          </label>
        ))}
      </div>
      <p className="text-ui-2xs leading-snug text-ink-400">Pares, 64–8192 px. Legenda e letterings têm altura relativa e acompanham. {tl.formatoManual ? 'Formato escolhido: o bruto não o muda.' : 'Formato veio do primeiro vídeo.'}</p>
      <Row k="Duração" v={`${formatTime(tl.main.reduce((a, c) => a + clipDuration(c), 0), true)} · ${tl.main.length} clipes · ${tl.overlays.length} camadas`} />
      {wide && (
        <>
          <Toggle label="Reframe no rosto" hint="material mais largo é recortado em volta do rosto, sem tarja" on={!!tl.reframe} onChange={(v) => sendOp({ op: { type: 'set_reframe', on: v }, note: v ? 'Ligou o reframe' : 'Desligou o reframe' })} />
          <Button
            size="sm"
            variant="ghost"
            className="w-full"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await api.reframeAuto(project.id).catch(() => undefined);
              setBusy(false);
            }}
          >
            {tl.reframe ? 'Reenquadrar no rosto de novo' : 'Reenquadrar no rosto'}
          </Button>
        </>
      )}
    </Section>
  );
}
