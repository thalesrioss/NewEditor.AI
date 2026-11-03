/**
 * Aba Legenda (ADR-011, fase 2 — igual ao CapCut): presets em cartões com prévia, blocos, posição (também
 * arrastando no player), tipografia, contorno, sombra completa, tarja, opacidade/rotação/escala e animação.
 * O mesmo CSS vale para o preview e para o export (captionInlineStyle no core), e tudo isso viaja para o
 * padrão editorial do cliente (legenda.ajustes).
 */
import { useEffect, useMemo, useState } from 'react';
import { Captions, Save, Trash2 } from 'lucide-react';
import { buildCues, CAPTION_ANIMS, CAPTION_ANIMS_OUT, CAPTION_FONTS, CAPTION_WORD_ANIMS, captionDefaults, captionInlineStyle, cueHtml, DEFAULT_CAPTIONS, type CaptionAnim, type CaptionAnimOut, type CaptionFont, type CaptionSettings, type CaptionWordAnim, type Cue } from '@neweditor/core';
import { api, type CaptionPreset } from '../lib/api.ts';
import { useEditor } from '../lib/store.ts';
import { Button, RangeField } from './ui.tsx';
import { inlineToObject } from './PlayerParts.tsx';

const BUILTIN: CaptionPreset[] = [
  { nome: 'Reels NewContent', legenda: { style: 'reels', uppercase: true, highlight: true, position: 0.72 } },
  { nome: 'Frase limpa', legenda: { style: 'frase', uppercase: false, highlight: false, position: 0.8, weight: 600, size: 2.6 } },
  { nome: 'Karaokê com tarja', legenda: { style: 'reels', uppercase: true, highlight: true, position: 0.74, box: true, boxColor: '#000000', boxOpacity: 0.65, maxWords: 3, shadow: 0 } },
  { nome: 'Bebas gigante', legenda: { style: 'reels', uppercase: true, highlight: true, position: 0.5, font: 'bebas', weight: 400, size: 6, letterSpacing: 0.02, stroke: 0.35, strokeColor: '#000000', maxWords: 2 } },
  { nome: 'Anton contorno', legenda: { style: 'reels', uppercase: true, highlight: true, position: 0.7, font: 'anton', weight: 400, size: 4.4, stroke: 0.3, strokeColor: '#000000', shadow: 0.3, accent: '#FFD400' } },
  { nome: 'Pop na palavra', legenda: { style: 'reels', uppercase: true, highlight: true, position: 0.72, animIn: 'pop', wordAnim: 'scale', maxWords: 2 } },
  { nome: 'Caixa na palavra', legenda: { style: 'reels', uppercase: true, highlight: true, position: 0.72, wordAnim: 'box', accent: '#FFD400', color: '#111111', shadow: 0, maxWords: 3 } },
  { nome: 'Palavra por palavra', legenda: { style: 'frase', uppercase: false, highlight: true, position: 0.76, animIn: 'type', wordAnim: 'color', maxWords: 5, weight: 700 } },
  { nome: 'Montserrat sombra longa', legenda: { style: 'reels', uppercase: true, highlight: true, position: 0.7, font: 'montserrat', weight: 900, shadow: 1, shadowColor: '#000000', shadowBlur: 0, shadowDistance: 0.35, shadowAngle: 60, animIn: 'slide', animOut: 'fade' } },
];

/** Cue de amostra para a prévia dos presets (a 2ª palavra é a "falada"). */
const SAMPLE: Cue = { start: 0, end: 1, words: [{ text: 'isso', start: 0, end: 0.3 }, { text: 'muda', start: 0.3, end: 0.7 }, { text: 'tudo', start: 0.7, end: 1 }] };

export function CaptionPanel() {
  const project = useEditor((s) => s.project);
  const transcripts = useEditor((s) => s.transcripts);
  const sendOp = useEditor((s) => s.sendOp);
  const tl = project?.timeline;
  const caps: CaptionSettings = tl?.captions ?? DEFAULT_CAPTIONS;
  const d = captionDefaults(caps);
  const cues = useMemo(() => (tl ? buildCues(tl, transcripts, { ...caps, enabled: true }) : []), [tl, transcripts, caps]);
  const [presets, setPresets] = useState<CaptionPreset[]>([]);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    api.captionPresets().then(setPresets).catch(() => setPresets([]));
  }, []);
  if (!project || !tl) return null;

  const set = (patch: Partial<CaptionSettings>, note = 'Ajustou a legenda') => sendOp({ op: { type: 'set_captions', captions: { ...caps, ...patch } }, note });
  const apply = (p: CaptionPreset) => set({ ...clean(caps), ...p.legenda, enabled: caps.enabled } as Partial<CaptionSettings>, `Preset de legenda: ${p.nome}`);
  const savePreset = async () => {
    const nome = window.prompt('Nome do preset de legenda');
    if (!nome?.trim()) return;
    const list = await api.saveCaptionPreset(nome.trim(), caps).catch((e: Error) => (setMsg(e.message), null));
    if (list) (setPresets(list), setMsg(`Preset "${nome.trim()}" salvo`));
  };
  const all = [...BUILTIN, ...presets];
  const same = (p: CaptionPreset) => Object.entries(p.legenda).every(([k, v]) => (caps as unknown as Record<string, unknown>)[k] === v);

  return (
    <div className="scroll-thin h-full space-y-4 overflow-y-auto p-3">
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-ui-sm font-semibold tracking-wide text-ink-300 uppercase">
            <Captions size={14} /> Legenda automática
          </h3>
          <Toggle on={caps.enabled} onChange={(v) => set({ enabled: v }, v ? 'Ligou a legenda automática' : 'Desligou a legenda')} />
        </div>
        <p className="text-ui-xs leading-snug text-ink-400">Sai da transcrição e acompanha os cortes. {cues.length} blocos no corte atual. No player: arraste a legenda para mover, a alça do canto muda a escala, duplo clique edita.</p>
      </section>

      <section className="space-y-2 border-t border-ink-750 pt-3">
        <h4 className="text-ui-xs font-semibold tracking-wide text-ink-400 uppercase">Presets</h4>
        <div className="grid grid-cols-2 gap-1.5">
          {all.map((p) => (
            <PresetCard key={p.nome} preset={p} active={same(p)} onApply={() => apply(p)} onDelete={presets.includes(p) ? () => api.deleteCaptionPreset(p.nome).then(setPresets).catch(() => undefined) : undefined} />
          ))}
        </div>
        <Button size="sm" icon={<Save size={13} />} onClick={savePreset}>
          Salvar a legenda atual como preset
        </Button>
        {msg && <p className="text-ui-xs text-emerald-300/90">{msg}</p>}
      </section>

      <Group title="Blocos">
        <div className="grid grid-cols-2 gap-1.5">
          {(['reels', 'frase'] as const).map((st) => (
            <button key={st} onClick={() => set({ style: st })} className={`rounded-ui-md border px-2 py-2 text-left text-ui-xs transition ${caps.style === st ? 'border-nc-500 bg-nc-500/15 text-white' : 'border-ink-700 text-ink-300 hover:border-ink-500'}`}>
              <div className="font-semibold">{st === 'reels' ? 'Reels' : 'Frase'}</div>
              <div className="text-ink-400">{st === 'reels' ? 'blocos curtos, fortes' : 'frases inteiras'}</div>
            </button>
          ))}
        </div>
        <RangeField label="Palavras por bloco" value={d.maxWords} min={1} max={8} step={1} resetTo={caps.style === 'reels' ? 2 : 6} onCommit={(v) => set({ maxWords: v })} />
        <RangeField label="Máximo de caracteres por bloco" value={caps.maxChars ?? 0} min={0} max={60} step={1} unit={caps.maxChars ? '' : ' (livre)'} resetTo={0} onCommit={(v) => set({ maxChars: v || undefined })} hint="0 = sem limite; quebra antes de passar" />
        <Row label="Caixa alta">
          <Toggle on={caps.uppercase} onChange={(v) => set({ uppercase: v })} />
        </Row>
        <Row label="Destacar a palavra falada">
          <Toggle on={caps.highlight} onChange={(v) => set({ highlight: v })} />
        </Row>
        <Row label="Por cima de B-roll e motion">
          <Toggle on={!!caps.overLayers} onChange={(v) => set({ overLayers: v || undefined }, v ? 'Legenda por cima de B-roll e motion' : 'Legenda some sob B-roll e motion')} />
        </Row>
      </Group>

      <Group title="Animação">
        <Row label="Entrada do bloco">
          <Select value={d.animIn} options={CAPTION_ANIMS} onChange={(v) => set({ animIn: v as CaptionAnim }, `Entrada da legenda: ${CAPTION_ANIMS[v as CaptionAnim]}`)} />
        </Row>
        <Row label="Saída do bloco">
          <Select value={d.animOut} options={CAPTION_ANIMS_OUT} onChange={(v) => set({ animOut: v as CaptionAnimOut }, `Saída da legenda: ${CAPTION_ANIMS_OUT[v as CaptionAnimOut]}`)} />
        </Row>
        <Row label="Palavra falada">
          <Select value={d.wordAnim} options={CAPTION_WORD_ANIMS} onChange={(v) => set({ wordAnim: v as CaptionWordAnim }, `Palavra falada: ${CAPTION_WORD_ANIMS[v as CaptionWordAnim]}`)} />
        </Row>
        {(d.animIn !== 'none' || d.animOut !== 'none') && <RangeField label="Duração da entrada/saída" value={Math.round(d.animDur * 100)} min={6} max={60} step={2} unit="/100 s" resetTo={18} onCommit={(v) => set({ animDur: v / 100 })} />}
        <p className="text-ui-xs leading-snug text-ink-400">Em talk head a legenda limpa lê mais rápido; animação é escolha do padrão do cliente (vocabulário no Cérebro).</p>
      </Group>

      <Group title="Posição e transformação">
        <RangeField label="Altura" value={Math.round(caps.position * 100)} min={4} max={96} step={1} unit="%" resetTo={72} onCommit={(v) => set({ position: v / 100 })} hint={caps.position < 0.4 ? 'No alto do quadro' : caps.position > 0.65 ? 'Embaixo — confira que não cobre o rosto' : 'No meio do quadro'} />
        <RangeField label="Centro horizontal" value={Math.round(d.x * 100)} min={5} max={95} step={1} unit="%" resetTo={50} onCommit={(v) => set({ x: v / 100 })} />
        <RangeField label="Largura máxima" value={d.width} min={30} max={96} step={1} unit="%" resetTo={84} onCommit={(v) => set({ width: v })} />
        <RangeField label="Escala" value={Math.round(d.scale * 100)} min={30} max={300} step={5} unit="%" resetTo={100} onCommit={(v) => set({ scale: v / 100 })} />
        <RangeField label="Rotação" value={d.rotation} min={-45} max={45} step={1} unit="°" resetTo={0} onCommit={(v) => set({ rotation: v })} />
        <RangeField label="Opacidade" value={Math.round(d.opacity * 100)} min={10} max={100} step={5} unit="%" resetTo={100} onCommit={(v) => set({ opacity: v / 100 })} />
      </Group>

      <Group title="Tipografia">
        <div className="grid grid-cols-5 gap-1">
          {(Object.keys(CAPTION_FONTS) as CaptionFont[]).map((f) => (
            <button key={f} onClick={() => set({ font: f })} className={`rounded-ui-md border px-1 py-1.5 text-ui-xs ${d.font === f ? 'border-nc-500 bg-nc-500/15 text-white' : 'border-ink-700 text-ink-300 hover:border-ink-500'}`} style={{ fontFamily: CAPTION_FONTS[f].family }} title={CAPTION_FONTS[f].label}>
              Aa
            </button>
          ))}
        </div>
        <RangeField label="Tamanho" value={Math.round(d.size * 10) / 10} min={1.5} max={8} step={0.1} unit="% alt." resetTo={caps.style === 'reels' ? 3.6 : 2.7} onCommit={(v) => set({ size: v })} />
        <RangeField label="Peso" value={d.weight} min={300} max={900} step={100} resetTo={caps.style === 'reels' ? 800 : 700} onCommit={(v) => set({ weight: v })} />
        <RangeField label="Distância entre letras" value={Math.round(d.letterSpacing * 100)} min={-8} max={20} step={1} unit="/100 em" resetTo={-1} onCommit={(v) => set({ letterSpacing: v / 100 })} />
        <RangeField label="Entrelinha" value={Math.round(d.lineHeight * 100)} min={90} max={160} step={2} unit="%" resetTo={112} onCommit={(v) => set({ lineHeight: v / 100 })} />
        <div className="grid grid-cols-2 gap-2">
          <Row label="Itálico">
            <Toggle on={d.italic} onChange={(v) => set({ italic: v })} />
          </Row>
          <Row label="Sublinhado">
            <Toggle on={d.underline} onChange={(v) => set({ underline: v })} />
          </Row>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <ColorField label="Cor do texto" value={d.color} onChange={(v) => set({ color: v })} />
          <ColorField label="Cor do destaque" value={d.accent} onChange={(v) => set({ accent: v })} />
        </div>
      </Group>

      <Group title="Contorno">
        <RangeField label="Contorno" value={Math.round(d.stroke * 100) / 100} min={0} max={0.8} step={0.05} unit="% alt." resetTo={0} onCommit={(v) => set({ stroke: v })} />
        {d.stroke > 0 && <ColorField label="Cor do contorno" value={d.strokeColor} onChange={(v) => set({ strokeColor: v })} />}
      </Group>

      <Group title="Sombra">
        <RangeField label="Intensidade" value={Math.round(d.shadow * 100)} min={0} max={100} step={5} unit="%" resetTo={65} onCommit={(v) => set({ shadow: v / 100 })} />
        {d.shadow > 0 && (
          <>
            <ColorField label="Cor da sombra" value={d.shadowColor} onChange={(v) => set({ shadowColor: v })} />
            <RangeField label="Desfoque" value={Math.round(d.shadowBlur * 100) / 100} min={0} max={3} step={0.05} unit="% alt." resetTo={0.9} onCommit={(v) => set({ shadowBlur: v })} />
            <RangeField label="Distância" value={Math.round(d.shadowDistance * 100) / 100} min={0} max={2} step={0.02} unit="% alt." resetTo={0.18} onCommit={(v) => set({ shadowDistance: v })} />
            <RangeField label="Ângulo" value={d.shadowAngle} min={0} max={360} step={5} unit="°" resetTo={90} onCommit={(v) => set({ shadowAngle: v })} />
          </>
        )}
      </Group>

      <Group title="Tarja">
        <Row label="Tarja atrás do texto">
          <Toggle on={d.box} onChange={(v) => set({ box: v })} />
        </Row>
        {d.box && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <ColorField label="Cor da tarja" value={d.boxColor} onChange={(v) => set({ boxColor: v })} />
              <RangeField label="Opacidade" value={Math.round(d.boxOpacity * 100)} min={10} max={100} step={5} unit="%" resetTo={70} onCommit={(v) => set({ boxOpacity: v / 100 })} />
            </div>
            <RangeField label="Raio dos cantos" value={Math.round(d.boxRadius * 100) / 100} min={0} max={3} step={0.1} unit="% alt." resetTo={0.5} onCommit={(v) => set({ boxRadius: v })} />
            <RangeField label="Margem interna" value={Math.round(d.boxPadding * 100) / 100} min={0} max={2} step={0.05} unit="% alt." resetTo={0.5} onCommit={(v) => set({ boxPadding: v })} />
          </>
        )}
      </Group>
    </div>
  );
}

/** Cartão de preset com a prévia desenhada pelo mesmo HTML/CSS do export (quadro 9:16 pequeno). */
function PresetCard({ preset: p, active, onApply, onDelete }: { preset: CaptionPreset; active: boolean; onApply: () => void; onDelete?: () => void }) {
  const caps: CaptionSettings = { ...DEFAULT_CAPTIONS, ...p.legenda, enabled: true, position: 0.5, x: 0.5, width: 92 };
  const H = 96;
  return (
    <div className={`group relative overflow-hidden rounded-ui-md border transition ${active ? 'border-nc-400 ring-2 ring-nc-500/40' : 'border-ink-700 hover:border-ink-500'}`}>
      <button onClick={onApply} className="block w-full text-left" title={Object.entries(p.legenda).map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}>
        <div className="relative w-full bg-gradient-to-b from-ink-700 to-ink-900" style={{ height: H }}>
          <div className="ne-text-layer" style={{ ['--u' as string]: `${H / 100}px`, fontSize: 0 }}>
            <div className={`ne-caption ${caps.style}${caps.box ? ' boxed' : ''}`} style={inlineToObject(captionInlineStyle({ ...caps, size: Math.min(caps.size ?? (caps.style === 'reels' ? 3.6 : 2.7), 5) * 2.2 }))} dangerouslySetInnerHTML={{ __html: `<span>${cueHtml(SAMPLE, caps, 0.5)}</span>` }} />
          </div>
        </div>
        <div className="truncate px-1.5 py-1 text-ui-xs text-ink-300">{p.nome}</div>
      </button>
      {onDelete && (
        <button aria-label={`Apagar preset ${p.nome}`} onClick={onDelete} className="absolute top-1 right-1 rounded-full bg-black/60 p-0.5 text-ink-300 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-rose-300">
          <Trash2 size={11} />
        </button>
      )}
    </div>
  );
}

/** Tira do objeto os campos opcionais, para um preset substituir tudo. */
function clean(c: CaptionSettings): CaptionSettings {
  return { enabled: c.enabled, style: c.style, uppercase: c.uppercase, highlight: c.highlight, position: c.position };
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-t border-ink-750 pt-3">
      <h4 className="text-ui-xs font-semibold tracking-wide text-ink-400 uppercase">{title}</h4>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2 text-ui-sm text-ink-300">
      <span className="truncate">{label}</span>
      {children}
    </label>
  );
}

function Select<T extends string>({ value, options, onChange }: { value: T; options: Record<T, string>; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="input w-40 py-1 text-ui-xs">
      {(Object.keys(options) as T[]).map((k) => (
        <option key={k} value={k}>
          {options[k]}
        </option>
      ))}
    </select>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 text-ui-sm text-ink-300">
      <span className="truncate">{label}</span>
      <span className="flex items-center gap-1.5">
        <span className="font-mono text-ui-xs text-ink-400">{value.toUpperCase()}</span>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-6 w-8 cursor-pointer rounded border border-ink-600 bg-transparent" aria-label={label} />
      </span>
    </label>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} className={`relative h-5 w-9 rounded-full transition ${on ? 'bg-nc-500' : 'bg-ink-600'}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  );
}
