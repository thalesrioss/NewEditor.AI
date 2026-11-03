import { useEffect, useMemo, useRef, useState } from 'react';
import { BookmarkPlus, Columns2, ClipboardCopy, ClipboardPaste, Eye, Palette, RotateCcw, Search, Users, Wand2, X } from 'lucide-react';
import { HSL_BANDS, HSL_BAND_HUES, INPUT_TRANSFORMS, NEUTRAL_CURVES, NEUTRAL_GRADE, NEUTRAL_HSL, NEUTRAL_WHEELS, type ColorGrade, type InputTransform, type PadraoCor } from '@neweditor/core';
import { api, type CineproItem } from '../lib/api.ts';
import { clipeDaCor, clipesDaCamera, colarGrade, gradeParaPadrao, type AlvoCor, type CopiaCor } from '../lib/cor-clipe.ts';
import { scopeFrame } from '../lib/scopeSource.ts';
import { useEditor } from '../lib/store.ts';
import { Scopes } from './Scopes.tsx';
import { Button, RangeField } from './ui.tsx';

type Num = 'exposure' | 'contrast' | 'highlights' | 'shadows' | 'whites' | 'blacks' | 'temperature' | 'tint' | 'saturation' | 'vibrance';
const LIGHT: { k: Num; label: string; min: number; max: number; step: number }[] = [
  { k: 'exposure', label: 'Exposição', min: -3, max: 3, step: 0.05 },
  { k: 'contrast', label: 'Contraste', min: -1, max: 1, step: 0.02 },
  { k: 'highlights', label: 'Altas luzes', min: -1, max: 1, step: 0.02 },
  { k: 'shadows', label: 'Sombras', min: -1, max: 1, step: 0.02 },
  { k: 'whites', label: 'Brancos', min: -1, max: 1, step: 0.02 },
  { k: 'blacks', label: 'Pretos', min: -1, max: 1, step: 0.02 },
];
const COLOR: { k: Num; label: string; min: number; max: number; step: number }[] = [
  { k: 'temperature', label: 'Temperatura', min: -1, max: 1, step: 0.02 },
  { k: 'tint', label: 'Matiz (verde ↔ magenta)', min: -1, max: 1, step: 0.02 },
  { k: 'saturation', label: 'Saturação', min: 0, max: 2, step: 0.02 },
  { k: 'vibrance', label: 'Vibração', min: -1, max: 1, step: 0.02 },
];

/** Grade copiada, com o alvo da cópia (cola só no mesmo alvo: arquivo em arquivo, clipe em clipe; vale enquanto o editor está aberto). */
let copiada: CopiaCor | null = null;

/**
 * Aba Cor: LOG da câmera → Rec.709 (sempre primeiro), correções primárias e, por cima, um look do CinePRO
 * (LUT .cube da nuvem, com força). Ao vivo no player, com o mesmo LUT do export.
 */
export function ColorPanel() {
  const project = useEditor((s) => s.project);
  const sendOp = useEditor((s) => s.sendOp);
  const setDraft = useEditor((s) => s.setGradeDraft);
  const setCompare = useEditor((s) => s.setCompare);
  const videos = (project?.assets ?? []).filter((a) => a.kind === 'video');
  const [fileAssetId, setAssetId] = useState(() => videos.find((a) => a.role === 'fala')?.id ?? videos[0]?.id ?? '');
  // Alvo (BL-0159 C3): a grade do arquivo (todos os clipes dele) ou a do clipe, por cima da do arquivo.
  const [alvo, setAlvo] = useState<AlvoCor>('arquivo');
  const [alvoCopia, setAlvoCopia] = useState<AlvoCor | null>(copiada?.alvo ?? null);
  // O clipe: o selecionado na timeline, senão o sob o cursor (o id só muda na troca de clipe, não a cada quadro).
  const clipId = useEditor((s) => clipeDaCor(s.project?.timeline, s.selection?.kind === 'clip' ? s.selection.id : null, s.playhead)?.id ?? null);
  const clip = clipId ? project?.timeline.main.find((c) => c.id === clipId) : undefined;
  const doClipe = alvo === 'clipe' && !!clip;
  const assetId = doClipe ? clip!.assetId : fileAssetId;
  const saved = (doClipe ? clip!.grade : assetId && project?.timeline.grades?.[assetId]) || NEUTRAL_GRADE;
  const [g, setG] = useState<ColorGrade>(saved);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => setG(saved), [assetId, doClipe, clipId, JSON.stringify(saved)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => setDraft(null), [setDraft]);
  if (!project) return null;
  if (!videos.length) return <p className="p-4 text-ui-sm text-ink-400">Sem vídeo no projeto.</p>;

  const live = (next: ColorGrade) => {
    setG(next);
    setDraft(doClipe ? { assetId, grade: next, clipId: clip!.id } : { assetId, grade: next });
  };
  const commit = (next: ColorGrade, note = 'Ajustou a cor') => {
    setDraft(null);
    if (doClipe) sendOp({ op: { type: 'set_clip_grade', clipIds: [clip!.id], grade: next }, note: `${note} (clipe)` });
    else sendOp({ op: { type: 'set_grade', assetId, grade: next }, note });
  };
  const daCamera = clip && project ? clipesDaCamera(project.timeline, clip) : [];
  const nomeDe = (id: string) => project?.assets.find((a) => a.id === id)?.name ?? id;
  const input = INPUT_TRANSFORMS.find((x) => x.id === g.input);

  return (
    <div className="scroll-thin h-full space-y-4 overflow-y-auto p-4">
      <div className="flex items-center gap-2">
        <Palette size={14} className="text-ink-300" />
        <select value={assetId} disabled={doClipe} onChange={(e) => setAssetId(e.target.value)} className="min-w-0 flex-1 rounded-ui-md border border-ink-700 bg-ink-800 px-2 py-1 text-ui-xs text-ink-100 focus:outline-none">
          {videos.map((a) => (
            <option key={a.id} value={a.id}>
              {a.role === 'fala' ? 'Fala · ' : 'B-roll · '}
              {a.name}
            </option>
          ))}
        </select>
      </div>

      <div role="radiogroup" aria-label="Alvo da cor" className="grid grid-cols-2 gap-1 rounded-ui-md border border-ink-700 p-0.5 text-ui-xs">
        {(['arquivo', 'clipe'] as const).map((k) => (
          <button key={k} role="radio" aria-checked={alvo === k} disabled={k === 'clipe' && !clip} onClick={() => (setDraft(null), setAlvo(k))} className={`rounded-ui-md px-2 py-1 font-medium disabled:opacity-40 ${alvo === k ? 'bg-ink-700 text-ink-50' : 'text-ink-300 hover:text-ink-100'}`}>
            {k === 'arquivo' ? 'Arquivo (todos os clipes)' : 'Este clipe'}
          </button>
        ))}
      </div>
      {doClipe && (
        <p className="text-ui-xs leading-snug text-ink-400">
          Clipe {project.timeline.main.indexOf(clip!) + 1} ({nomeDe(clip!.cam ?? clip!.assetId)}): por cima da grade do arquivo, que já faz a conversão da câmera.{clip!.grade ? (clip!.gradeHerdada ? ' Grade herdada do padrão de cor do cliente.' : '') : ' Sem grade própria.'}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="secondary" icon={<ClipboardCopy size={12} />} onClick={() => ((copiada = { grade: { ...g }, alvo: doClipe ? 'clipe' : 'arquivo' }), setAlvoCopia(copiada.alvo))} title="Copiar a grade mostrada">
          Copiar
        </Button>
        <Button size="sm" variant="secondary" icon={<ClipboardPaste size={12} />} disabled={alvoCopia !== (doClipe ? 'clipe' : 'arquivo')} onClick={() => { const c = copiada && colarGrade(copiada, g, doClipe ? 'clipe' : 'arquivo'); if (c) commit(c, 'Colou a grade'); }} title={alvoCopia && alvoCopia !== (doClipe ? 'clipe' : 'arquivo') ? (alvoCopia === 'arquivo' ? 'A cópia é de uma grade de arquivo: cole em Arquivo' : 'A cópia é de uma grade de clipe: cole em Este clipe') : doClipe ? 'Colar neste clipe' : 'Colar no arquivo'}>
          Colar
        </Button>
        {doClipe && (
          <Button size="sm" variant="secondary" icon={<Users size={12} />} onClick={() => sendOp({ op: { type: 'set_clip_grade', clipIds: daCamera, grade: g }, note: `Grade do clipe em ${daCamera.length} clipe(s) da câmera ${nomeDe(clip!.cam ?? clip!.assetId)}` })} title="Mesma grade de clipe em todos os clipes da timeline com esta câmera">
            Aplicar aos {daCamera.length} clipes desta câmera
          </Button>
        )}
      </div>

      <Scopes />

      {!doClipe && (<>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMsg('');
          try {
            const r = await api.colorAuto(project.id, assetId);
            setMsg(r.why);
          } catch (e) {
            setMsg((e as Error).message);
          }
          setBusy(false);
        }}
        className="flex w-full items-center justify-center gap-1.5 rounded-ui-md nc-gradient px-3 py-2 text-ui-sm font-semibold text-white disabled:opacity-40"
      >
        <Wand2 size={13} /> {busy ? 'Medindo o original…' : 'Corrigir automático para Rec.709'}
      </button>
      {msg && <p className="text-ui-xs leading-snug text-emerald-300/90">{msg}</p>}

      <label className="block space-y-1">
        <span className="text-ui-xs font-medium text-ink-400">Câmera / perfil de gravação</span>
        <select value={g.input} onChange={(e) => commit({ ...g, input: e.target.value as InputTransform }, `Entrada de cor: ${e.target.selectedOptions[0]?.text}`)} className="w-full rounded-ui-md border border-ink-700 bg-ink-800 px-2 py-1.5 text-ui-sm text-ink-100 focus:outline-none">
          {INPUT_TRANSFORMS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        {input && <span className="block text-ui-xs text-ink-400">{input.camera}</span>}
      </label>
      </>)}

      <Group title="Luz" items={LIGHT} g={g} live={live} commit={commit} />
      <Group title="Cor" items={COLOR} g={g} live={live} commit={commit} />
      <Wheels g={g} live={live} commit={commit} />
      <Hsl g={g} live={live} commit={commit} />
      <Curves g={g} live={live} commit={commit} />
      <Looks g={g} live={live} commit={commit} />
      <Texture g={g} live={live} commit={commit} />

      <div className="flex gap-1.5 border-t border-ink-750 pt-3">
        <button aria-label="Segure para ver o original" onMouseDown={() => setCompare(true)} onMouseUp={() => setCompare(false)} onMouseLeave={() => setCompare(false)} className="flex flex-1 items-center justify-center gap-1.5 rounded-ui-md border border-ink-600 py-1.5 text-ui-xs text-ink-200 hover:border-nc-500" title="Segure para ver o original">
          <Eye size={13} /> Segure: antes
        </button>
        <button aria-label="Zerar ajustes (mantém a entrada da câmera)" onClick={() => commit({ ...NEUTRAL_GRADE, input: g.input }, doClipe ? 'Tirou a grade do clipe' : 'Zerou os ajustes de cor')} className="flex items-center gap-1.5 rounded-ui-md border border-ink-600 px-3 py-1.5 text-ui-xs text-ink-200 hover:border-rose-400" title="Zerar ajustes (mantém a entrada da câmera)">
          <RotateCcw size={13} /> Zerar
        </button>
      </div>
      {/* O still é o quadro do player, com as duas camadas do clipe dele: a do alvo como está agora (g) e a outra como está salva. */}
      <PadraoCliente
        projectId={project.id}
        arquivo={doClipe || (clip && clip.assetId !== assetId) ? project.timeline.grades?.[clip!.assetId] : g}
        clipe={doClipe ? g : clip?.grade}
      />
      <p className="text-ui-xs leading-snug text-ink-400">Ordem da cadeia: conversão da câmera (LOG → Rec.709), luz e cor, e só então o look. É assim que o look do cliente cai igual em qualquer bruto. O export usa exatamente o mesmo LUT.</p>
    </div>
  );
}

/** O quadro do player agora (já com a grade), sem o letterbox, em JPEG de até 1280 px: o still de referência do padrão. */
function quadroAtual(): string | null {
  const f = scopeFrame();
  if (!f) return null;
  const r = f.rect ?? { x: 0, y: 0, w: f.canvas.width, h: f.canvas.height };
  const k = Math.min(1, 1280 / Math.max(r.w, r.h));
  const cv = document.createElement('canvas');
  [cv.width, cv.height] = [Math.round(r.w * k), Math.round(r.h * k)];
  cv.getContext('2d')!.drawImage(f.canvas, r.x, r.y, r.w, r.h, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', 0.85);
}

/**
 * "Salvar como padrão do cliente" (BL-0161): o look do quadro vai para o perfil do projeto (por cima da conversão da
 * câmera, sem a entrada) e, se pedido, o quadro atual como still de referência (até 3 no perfil). O still tem as duas
 * camadas (arquivo e clipe): salva a que tem o look e recusa quando as duas têm (`gradeParaPadrao`).
 */
function PadraoCliente({ projectId, arquivo, clipe }: { projectId: string; arquivo?: ColorGrade; clipe?: ColorGrade }) {
  const [comStill, setComStill] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [padrao, setPadrao] = useState<{ perfil: string; padrao: PadraoCor | null } | null>(null);
  useEffect(() => {
    let vivo = true;
    api.padraoCor(projectId).then((r) => vivo && setPadrao(r), () => vivo && setPadrao(null));
    return () => void (vivo = false);
  }, [projectId]);
  const salvar = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const camada = gradeParaPadrao(arquivo, clipe);
      if ('erro' in camada) throw new Error(camada.erro);
      const still = comStill ? quadroAtual() : null;
      const r = await api.salvarPadraoCor(projectId, camada.grade, still ? [still] : undefined);
      setPadrao({ perfil: r.perfil, padrao: r.padrao });
      setMsg({ ok: true, texto: `Padrão de cor de ${r.nome} salvo${r.padrao.stills.length ? ` (${r.padrao.stills.length} de 3 stills)` : ''}. Projeto novo do cliente nasce com ele nos clipes da fala.` });
    } catch (e) {
      setMsg({ ok: false, texto: (e as Error).message });
    }
    setBusy(false);
  };
  const apagar = async (nome: string) => {
    if (!padrao) return;
    try {
      const r = await api.apagarStillPadrao(padrao.perfil, nome);
      setPadrao({ ...padrao, padrao: r.padrao });
    } catch (e) {
      setMsg({ ok: false, texto: (e as Error).message });
    }
  };
  return (
    <section className="space-y-2 border-t border-ink-750 pt-3">
      <Button size="sm" variant="secondary" className="w-full" icon={<BookmarkPlus size={12} />} disabled={busy} onClick={salvar} title="O look do quadro (do arquivo ou do clipe, sem a conversão da câmera) vira o padrão de cor do perfil deste projeto">
        {busy ? 'Salvando…' : 'Salvar como padrão do cliente'}
      </Button>
      <label className="flex items-center gap-1.5 text-ui-2xs text-ink-400">
        <input type="checkbox" checked={comStill} onChange={(e) => setComStill(e.target.checked)} />
        Guardar o quadro atual como still de referência (até 3)
      </label>
      {msg && <p className={`text-ui-xs leading-snug ${msg.ok ? 'text-emerald-300/90' : 'text-rose-300'}`}>{msg.texto}</p>}
      {padrao?.padrao?.stills.length ? <StillSplit perfil={padrao.perfil} stills={padrao.padrao.stills} onApagar={apagar} /> : null}
    </section>
  );
}

/**
 * Still de referência do padrão × quadro atual (BL-0161, fatia 3): lado a lado, o still à esquerda e o quadro do
 * player (já com a grade, o mesmo dos scopes) à direita, atualizado enquanto a comparação está aberta.
 */
function StillSplit({ perfil, stills, onApagar }: { perfil: string; stills: string[]; onApagar: (nome: string) => void }) {
  const [sel, setSel] = useState(stills[0]!);
  const [aberto, setAberto] = useState(false);
  const cv = useRef<HTMLCanvasElement>(null);
  const atual = stills.includes(sel) ? sel : stills[0]!;
  useEffect(() => {
    if (!aberto) return;
    let raf = 0;
    let visto = -1;
    const desenha = () => {
      const f = scopeFrame();
      const alvo = cv.current;
      if (f && alvo && f.version !== visto) {
        visto = f.version;
        const r = f.rect ?? { x: 0, y: 0, w: f.canvas.width, h: f.canvas.height };
        const k = Math.min(1, 480 / Math.max(r.w, r.h));
        const [w, h] = [Math.max(1, Math.round(r.w * k)), Math.max(1, Math.round(r.h * k))];
        if (alvo.width !== w || alvo.height !== h) [alvo.width, alvo.height] = [w, h];
        alvo.getContext('2d')?.drawImage(f.canvas, r.x, r.y, r.w, r.h, 0, 0, w, h);
      }
      raf = requestAnimationFrame(desenha);
    };
    raf = requestAnimationFrame(desenha);
    return () => cancelAnimationFrame(raf);
  }, [aberto]);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <span className="text-ui-2xs text-ink-400">Stills do padrão</span>
        {stills.map((s, i) => (
          <span key={s} className={`group relative h-9 w-9 overflow-hidden rounded border ${s === atual ? 'border-white' : 'border-ink-700'}`}>
            <button className="h-full w-full" title={`Still ${i + 1}: comparar com o quadro`} onClick={() => (setSel(s), setAberto(true))}>
              <img src={api.stillPadraoUrl(perfil, s)} alt={`Still ${i + 1}`} className="h-full w-full object-cover" />
            </button>
            <button className="absolute top-0 right-0 hidden rounded-bl bg-black/70 p-0.5 text-white group-focus-within:block group-hover:block" title="Apagar este still do padrão" aria-label={`Apagar o still ${i + 1} do padrão`} onClick={() => window.confirm(`Apagar o still ${i + 1} do padrão de cor? O arquivo sai do perfil e não volta.`) && onApagar(s)}>
              <X size={9} />
            </button>
          </span>
        ))}
        <Button size="sm" variant="secondary" className="ml-auto" icon={<Columns2 size={12} />} onClick={() => setAberto(!aberto)} title="Still de referência ao lado do quadro atual">
          {aberto ? 'Fechar' : 'Comparar'}
        </Button>
      </div>
      {aberto && (
        <div className="grid grid-cols-2 gap-1">
          <figure className="space-y-0.5">
            <img src={api.stillPadraoUrl(perfil, atual)} alt="Still de referência" className="w-full rounded border border-ink-700 bg-black object-contain" />
            <figcaption className="text-center text-ui-2xs text-ink-400">Still do padrão</figcaption>
          </figure>
          <figure className="space-y-0.5">
            <canvas ref={cv} className="w-full rounded border border-ink-700 bg-black" />
            <figcaption className="text-center text-ui-2xs text-ink-400">Quadro atual</figcaption>
          </figure>
        </div>
      )}
    </div>
  );
}

function Group({ title, items, g, live, commit }: { title: string; items: { k: Num; label: string; min: number; max: number; step: number }[]; g: ColorGrade; live: (x: ColorGrade) => void; commit: (x: ColorGrade) => void }) {
  return (
    <section className="space-y-2.5">
      <h4 className="text-ui-xs font-semibold tracking-wide text-ink-300 uppercase">{title}</h4>
      {items.map(({ k, label, min, max, step }) => {
        const v = g[k];
        const neutral = NEUTRAL_GRADE[k];
        return <RangeField key={k} label={label} value={v} min={min} max={max} step={step} digits={2} resetTo={neutral} onLive={(x) => live({ ...g, [k]: x })} onCommit={(x) => commit({ ...g, [k]: x })} />;
      })}
    </section>
  );
}

/** Looks do CinePRO (LUTs .cube da nuvem): busca, aplica com força, tira. */
function Looks({ g, live, commit }: { g: ColorGrade; live: (x: ColorGrade) => void; commit: (x: ColorGrade, note?: string) => void }) {
  const [busca, setBusca] = useState('');
  const [itens, setItens] = useState<CineproItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [erro, setErro] = useState('');
  useEffect(() => {
    const t = setTimeout(() => {
      api
        .cineproItens({ modo: 'lut', busca: busca.trim() || undefined, limit: 60 })
        .then((r) => (setItens(r.itens), setTotal(r.total), setErro('')))
        .catch((e: Error) => setErro(e.message));
    }, 180);
    return () => clearTimeout(t);
  }, [busca]);
  const grupos = useMemo(() => {
    const by = new Map<string, CineproItem[]>();
    for (const it of itens ?? []) {
      const k = it.pasta.split('/').slice(-2).join(' · ') || it.categoria;
      by.set(k, [...(by.get(k) ?? []), it]);
    }
    return [...by.entries()];
  }, [itens]);
  return (
    <section className="space-y-2.5 border-t border-ink-750 pt-3">
      <h4 className="text-ui-xs font-semibold tracking-wide text-ink-300 uppercase">Look (CinePRO Looks)</h4>
      {g.lut ? (
        <div className="space-y-2 rounded-ui-md border border-nc-500/40 bg-nc-500/10 p-2">
          <div className="flex items-center gap-2 text-ui-xs text-ink-100">
            <span className="min-w-0 flex-1 truncate" title={g.lut.nome}>
              {g.lut.nome}
            </span>
            <button aria-label="Tirar o look" onClick={() => commit({ ...g, lut: undefined }, 'Tirou o look')} className="rounded p-0.5 text-ink-400 hover:text-rose-300">
              <X size={13} />
            </button>
          </div>
          <RangeField label="Força" value={Math.round(g.lut.strength * 100)} min={0} max={100} step={5} unit="%" resetTo={100} onLive={(v) => live({ ...g, lut: { ...g.lut!, strength: v / 100 } })} onCommit={(v) => commit({ ...g, lut: { ...g.lut!, strength: v / 100 } }, `Look a ${v}%`)} />
        </div>
      ) : (
        <p className="text-ui-xs leading-snug text-ink-400">Nenhum look aplicado. O look entra depois da conversão e das primárias.</p>
      )}
      <label className="flex items-center gap-1.5 rounded-ui-md border border-ink-700 bg-ink-900 px-2">
        <Search size={12} className="text-ink-400" />
        <input value={busca} onChange={(e) => setBusca(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder={`Buscar nos looks${total ? ` (${total})` : ''}`} aria-label="Buscar looks" className="w-full bg-transparent py-1 text-ui-xs text-ink-100 outline-none" />
      </label>
      {erro && <p className="text-ui-xs text-rose-300">{erro}</p>}
      <div className="scroll-thin max-h-64 space-y-2 overflow-y-auto">
        {grupos.map(([grupo, list]) => (
          <div key={grupo}>
            <div className="mb-0.5 truncate text-ui-xs font-semibold text-ink-400" title={grupo}>
              {grupo}
            </div>
            <div className="flex flex-wrap gap-1">
              {list.map((it) => (
                <Button key={it.id} size="sm" variant={g.lut?.id === it.id ? 'primary' : 'secondary'} className="!h-6 max-w-full !px-2 !text-ui-xs" title={`${it.categoria}/${it.pasta}/${it.nome}`} onClick={() => commit({ ...g, lut: { id: it.id, nome: it.nome, strength: g.lut?.strength ?? 1 } }, `Look: ${it.nome}`)}>
                  <span className="truncate">{it.nome}</span>
                </Button>
              ))}
            </div>
          </div>
        ))}
        {itens && !itens.length && <p className="text-ui-xs text-ink-400">Nenhum look com esse nome.</p>}
      </div>
    </section>
  );
}

type LiveCommit = { g: ColorGrade; live: (x: ColorGrade) => void; commit: (x: ColorGrade, note?: string) => void };
const RGB = ['R', 'G', 'B'] as const;

/** Rodas de cor (lift / gamma / gain), como no DaVinci: R, G e B de cada uma, em −1..1. */
function Wheels({ g, live, commit }: LiveCommit) {
  const w = g.wheels ?? NEUTRAL_WHEELS;
  const [which, setWhich] = useState<'lift' | 'gamma' | 'gain'>('gamma');
  const set = (i: number, v: number, final: boolean) => {
    const next = { ...w, [which]: w[which].map((x, k) => (k === i ? v : x)) as [number, number, number] };
    const grade = { ...g, wheels: JSON.stringify(next) === JSON.stringify(NEUTRAL_WHEELS) ? undefined : next };
    (final ? commit : live)(grade, `Roda ${which}`);
  };
  return (
    <section className="space-y-2 border-t border-ink-750 pt-3">
      <h4 className="text-ui-xs font-semibold tracking-wide text-ink-300 uppercase">Rodas de cor</h4>
      <div className="flex rounded-ui-md border border-ink-700 p-0.5" role="radiogroup" aria-label="Roda">
        {(
          [
            ['lift', 'Lift · sombras'],
            ['gamma', 'Gamma · meios'],
            ['gain', 'Gain · altas'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="radio" aria-checked={which === id} onClick={() => setWhich(id)} className={`flex-1 rounded-ui-sm py-1 text-ui-xs font-semibold ${which === id ? 'bg-ink-700 text-white' : 'text-ink-400 hover:text-ink-200'}`}>
            {label}
          </button>
        ))}
      </div>
      {RGB.map((ch, i) => (
        <RangeField key={`${which}-${ch}`} label={ch} value={w[which][i]!} min={-1} max={1} step={0.02} digits={2} resetTo={0} onLive={(v) => set(i, v, false)} onCommit={(v) => set(i, v, true)} />
      ))}
      {g.wheels && (
        <Button size="sm" variant="ghost" className="w-full" onClick={() => commit({ ...g, wheels: undefined }, 'Zerou as rodas')}>
          Zerar rodas
        </Button>
      )}
    </section>
  );
}

/** HSL por faixa de matiz: escolha a faixa e mexa em matiz, saturação e luminância. */
function Hsl({ g, live, commit }: LiveCommit) {
  const bands = g.hsl ?? NEUTRAL_HSL;
  const [band, setBand] = useState(1);
  const b = bands[band] ?? { h: 0, s: 0, l: 0 };
  const set = (k: 'h' | 's' | 'l', v: number, final: boolean) => {
    const next = bands.map((x, i) => (i === band ? { ...x, [k]: v } : x));
    const grade = { ...g, hsl: next.every((x) => !x.h && !x.s && !x.l) ? undefined : next };
    (final ? commit : live)(grade, `HSL ${HSL_BANDS[band]}`);
  };
  return (
    <section className="space-y-2 border-t border-ink-750 pt-3">
      <h4 className="text-ui-xs font-semibold tracking-wide text-ink-300 uppercase">HSL por cor</h4>
      <div className="flex gap-1" role="radiogroup" aria-label="Faixa de cor">
        {HSL_BANDS.map((name, i) => {
          const on = bands[i] && (bands[i]!.h || bands[i]!.s || bands[i]!.l);
          return (
            <button key={name} role="radio" aria-checked={band === i} title={name} onClick={() => setBand(i)} className={`h-6 flex-1 rounded-ui-sm border-2 ${band === i ? 'border-white' : on ? 'border-nc-400' : 'border-transparent'}`} style={{ background: `hsl(${HSL_BAND_HUES[i]} 80% 50%)` }} />
          );
        })}
      </div>
      <RangeField label={`Matiz · ${HSL_BANDS[band]}`} value={b.h} min={-1} max={1} step={0.02} digits={2} resetTo={0} onLive={(v) => set('h', v, false)} onCommit={(v) => set('h', v, true)} hint="±30° de giro" />
      <RangeField label="Saturação" value={b.s} min={-1} max={1} step={0.02} digits={2} resetTo={0} onLive={(v) => set('s', v, false)} onCommit={(v) => set('s', v, true)} />
      <RangeField label="Luminância" value={b.l} min={-1} max={1} step={0.02} digits={2} resetTo={0} onLive={(v) => set('l', v, false)} onCommit={(v) => set('l', v, true)} />
    </section>
  );
}

/** Curvas por 5 pontos (luma, R, G, B): o valor de saída em 0, ¼, ½, ¾ e 1. */
function Curves({ g, live, commit }: LiveCommit) {
  const cv = g.curves ?? NEUTRAL_CURVES;
  const [ch, setCh] = useState<'luma' | 'r' | 'g' | 'b'>('luma');
  const pts = cv[ch];
  const set = (i: number, v: number, final: boolean) => {
    const next = { ...cv, [ch]: pts.map((x, k) => (k === i ? v : x)) };
    const grade = { ...g, curves: JSON.stringify(next) === JSON.stringify(NEUTRAL_CURVES) ? undefined : next };
    (final ? commit : live)(grade, `Curva ${ch}`);
  };
  return (
    <section className="space-y-2 border-t border-ink-750 pt-3">
      <h4 className="text-ui-xs font-semibold tracking-wide text-ink-300 uppercase">Curvas</h4>
      <div className="flex rounded-ui-md border border-ink-700 p-0.5" role="radiogroup" aria-label="Canal">
        {(
          [
            ['luma', 'Luma'],
            ['r', 'R'],
            ['g', 'G'],
            ['b', 'B'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="radio" aria-checked={ch === id} onClick={() => setCh(id)} className={`flex-1 rounded-ui-sm py-1 text-ui-xs font-semibold ${ch === id ? 'bg-ink-700 text-white' : 'text-ink-400 hover:text-ink-200'}`}>
            {label}
          </button>
        ))}
      </div>
      <CurvePreview pts={pts} />
      {['Pretos (0)', 'Sombras (¼)', 'Meios (½)', 'Altas (¾)', 'Brancos (1)'].map((label, i) => (
        <RangeField key={`${ch}-${i}`} label={label} value={pts[i]!} min={0} max={1} step={0.01} digits={2} resetTo={NEUTRAL_CURVES.luma[i]!} onLive={(v) => set(i, v, false)} onCommit={(v) => set(i, v, true)} />
      ))}
      {g.curves && (
        <Button size="sm" variant="ghost" className="w-full" onClick={() => commit({ ...g, curves: undefined }, 'Zerou as curvas')}>
          Zerar curvas
        </Button>
      )}
    </section>
  );
}

function CurvePreview({ pts }: { pts: number[] }) {
  const d = Array.from({ length: 33 }, (_, i) => {
    const x = i / 32;
    // Mesma interpolação do núcleo (curveAt não é exportada para o React por simplicidade: aproximação linear por trechos para o desenho).
    const t = x * 4, k = Math.min(3, Math.floor(t)), f = t - k;
    const y = pts[k]! + (pts[k + 1]! - pts[k]!) * f;
    return `${(x * 100).toFixed(1)},${((1 - y) * 100).toFixed(1)}`;
  }).join(' ');
  return (
    <svg viewBox="0 0 100 100" className="h-20 w-full rounded-ui-sm border border-ink-700 bg-ink-900" aria-hidden="true">
      <line x1="0" y1="100" x2="100" y2="0" stroke="rgb(255 255 255 / 0.15)" strokeWidth="1" />
      <polyline points={d} fill="none" stroke="var(--color-nc-300)" strokeWidth="1.5" />
    </svg>
  );
}

/** Textura: nitidez, vinheta e grão — filtros no quadro, iguais no preview e no FFmpeg. */
function Texture({ g, live, commit }: LiveCommit) {
  const items: { k: 'sharpen' | 'vignette' | 'grain'; label: string; hint: string }[] = [
    { k: 'sharpen', label: 'Nitidez', hint: 'máscara de nitidez leve; evite acima de 0,5 em pele' },
    { k: 'vignette', label: 'Vinheta', hint: 'escurece as bordas, foco no rosto' },
    { k: 'grain', label: 'Grão', hint: 'grão vivo (muda a cada quadro), textura de filme' },
  ];
  return (
    <section className="space-y-2.5 border-t border-ink-750 pt-3">
      <h4 className="text-ui-xs font-semibold tracking-wide text-ink-300 uppercase">Textura</h4>
      {items.map(({ k, label, hint }) => (
        <RangeField key={k} label={label} value={g[k] ?? 0} min={0} max={1} step={0.02} digits={2} resetTo={0} hint={hint} onLive={(v) => live({ ...g, [k]: v || undefined })} onCommit={(v) => commit({ ...g, [k]: v || undefined }, `${label} ${Math.round(v * 100)}%`)} />
      ))}
    </section>
  );
}
