import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Loader2, Pause, Play, RotateCcw, SpellCheck, Wand2 } from 'lucide-react';
import { formatTime, passaDoAlvo, sameWordAt, textoPassaDoAlvo } from '@neweditor/core';
import { api, mediaUrl, type ReviewDoubt } from '../lib/api.ts';
import { useEditor } from '../lib/store.ts';
import { Button, ConfirmButton } from './ui.tsx';
import { ReviewFocus } from './ReviewFocus.tsx';
import { CommentsSection } from './CommentsSection.tsx';
import { Focus, ShieldCheck } from 'lucide-react';

const KIND_LABEL: Record<ReviewDoubt['kind'], string> = { tomada: 'Tomada', corte: 'Corte', agente: 'Dúvida do agente', palavra: 'Grafia', nome: 'Nome' };
const KIND_STYLE: Record<ReviewDoubt['kind'], string> = {
  tomada: 'bg-violet-500/15 text-violet-300',
  corte: 'bg-rose-500/15 text-rose-300',
  agente: 'bg-sky-500/15 text-sky-300',
  palavra: 'bg-amber-500/15 text-amber-300',
  nome: 'bg-amber-500/15 text-amber-300',
};
const strip = (w: string) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

/**
 * Revisão da decupagem (portão humano): o agente decupou; aqui o editor confere só o que é decisão — tomadas
 * descartadas, cortes de conteúdo, grafias — e aprova para o agente finalizar.
 */
export function ReviewPanel() {
  const project = useEditor((s) => s.project)!;
  const activity = useEditor((s) => s.activity);
  const [doubts, setDoubts] = useState<ReviewDoubt[] | null>(null);
  const [showLow, setShowLow] = useState(false);
  const [err, setErr] = useState('');
  const [approving, setApproving] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [focus, setFocus] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const stopAt = useRef(0);

  const status = project.status;
  // Recarrega quando a timeline muda (restaurou um corte, corrigiu uma palavra) — com folga para não martelar.
  useEffect(() => {
    const t = setTimeout(() => {
      api
        .review(project.id)
        .then((r) => setDoubts(r.doubts))
        .catch((e: Error) => setErr(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [project.id, project.version, project.review?.resolvidas?.length]);
  useEffect(() => () => audio.current?.pause(), []);

  const high = useMemo(() => (doubts ?? []).filter((d) => d.prioridade === 'alta'), [doubts]);
  const low = useMemo(() => (doubts ?? []).filter((d) => d.prioridade === 'baixa'), [doubts]);
  // BL-0024: peça acima da duração-alvo do briefing não é "nada pendente".
  const acima = passaDoAlvo(project);

  /** Ouve o trecho no BRUTO (o que foi cortado não está mais na timeline). */
  const listen = (d: ReviewDoubt) => {
    const el = audio.current;
    const a = project.assets.find((x) => x.id === d.assetId);
    if (!el || !a?.proxy) return;
    if (playing === d.id) {
      el.pause();
      setPlaying(null);
      return;
    }
    useEditor.getState().setPlaying(false);
    const url = mediaUrl(project.id, a.proxy);
    if (!el.src.endsWith(url)) el.src = url;
    stopAt.current = d.out + 0.15;
    const go = () => {
      el.currentTime = Math.max(0, d.in - 0.25);
      void el.play();
    };
    if (el.readyState >= 1) go();
    else el.addEventListener('loadedmetadata', go, { once: true });
    setPlaying(d.id);
  };
  const resolve = (d: ReviewDoubt) => {
    setDoubts((ds) => ds?.filter((x) => x.id !== d.id) ?? null);
    void api.resolveDoubt(project.id, d.id);
  };

  if (status === 'decupando' || (status === 'fila' && activity.state !== 'idle'))
    return <Waiting text="O agente está decupando. Quando terminar, a revisão aparece aqui e você recebe uma notificação." />;
  if (status === 'finalizando') return <Waiting text={`O agente está finalizando: ${activity.message || 'cor, legenda, motions e letterings'}.`} />;

  const approve = async () => {
    setApproving(true);
    setErr('');
    try {
      await api.approve(project.id);
      setFocus(false);
    } catch (e) {
      setErr((e as Error).message);
    }
    setApproving(false);
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {focus && status === 'revisao' && <ReviewFocus doubts={high} acima={acima} playing={playing} onListen={listen} onResolve={resolve} onClose={() => setFocus(false)} onApprove={() => void approve()} />}
      <audio ref={audio} onTimeUpdate={(e) => e.currentTarget.currentTime >= stopAt.current && (e.currentTarget.pause(), setPlaying(null))} onEnded={() => setPlaying(null)} />
      <div className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {status === 'revisao' ? (
          <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-3">
            <div className="text-xs font-semibold text-amber-200">Revisão da decupagem</div>
            <p className="mt-1 text-ui-xs leading-snug text-ink-300">O agente decupou. Confira só as decisões abaixo — ouça, restaure o que ficou melhor, corrija a grafia — e aprove para ele finalizar com cor, legenda, motions e letterings.</p>
            <p className="mt-1.5 text-ui-xs text-ink-400">Para mexer na copy à vontade: na aba Transcrição, selecione palavras para cortar ou restaurar; duplo clique numa palavra corrige a grafia.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-ink-700 bg-ink-800/60 p-3 text-ui-xs leading-snug text-ink-300">
            {project.review?.aprovadaEm ? `Decupagem aprovada em ${new Date(project.review.aprovadaEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}.` : 'Esta decupagem ainda não passou pela revisão.'}
            <button onClick={() => void api.updateProject(project.id, { status: 'revisao' })} className="mt-2 block text-ui-xs font-semibold text-nc-300 hover:text-white">
              Voltar para a revisão da decupagem
            </button>
          </div>
        )}

        <QcSection />
        {(status === 'editado' || status === 'alteracao' || status === 'entregue') && <CommentsSection />}
        {doubts === null && !err && <p className="text-ui-xs text-ink-400">Carregando…</p>}
        {err && <p className="text-ui-xs text-rose-400">{err}</p>}
        {doubts && (
          <>
            <div className="flex items-center gap-2 px-1">
              <h4 className="text-ui-xs font-semibold tracking-wide text-ink-400 uppercase">Decisões para conferir · {high.length}</h4>
              {status === 'revisao' && (
                <Button size="sm" variant="ghost" className="ml-auto" icon={<Focus size={12} />} onClick={() => setFocus(true)} title="Uma dúvida por vez, pelo teclado (J/K, L, A, T, R)">
                  Modo focado
                </Button>
              )}
            </div>
            {acima && <p className="px-1 text-ui-xs text-amber-300" data-testid="duracao-briefing">{textoPassaDoAlvo(acima)}. Corte trechos na aba Transcrição antes de aprovar.</p>}
            {high.length === 0 && !acima && <p className="px-1 text-ui-xs text-emerald-300">Nada pendente — pode aprovar.</p>}
            {high.map((d) => (
              <DoubtCard key={d.id} d={d} playing={playing === d.id} onListen={() => listen(d)} onResolve={() => resolve(d)} />
            ))}
            {low.length > 0 && (
              <>
                <button onClick={() => setShowLow(!showLow)} className="flex items-center gap-1 px-1 text-ui-xs font-semibold tracking-wide text-ink-400 uppercase hover:text-ink-300">
                  {showLow ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Cortes de rotina · {low.length}
                </button>
                {showLow && low.map((d) => <DoubtCard key={d.id} d={d} playing={playing === d.id} onListen={() => listen(d)} onResolve={() => resolve(d)} />)}
              </>
            )}
          </>
        )}
      </div>

      {status === 'revisao' && (
        <div className="border-t border-ink-750 p-3">
          <ConfirmButton
            variant="primary"
            className="w-full"
            loading={approving}
            icon={<Wand2 size={14} />}
            disabled={!project.timeline.main.length}
            needsConfirm={high.length > 0}
            confirmLabel={`Ainda há ${high.length} ponto(s) para conferir — clique de novo para aprovar`}
            onConfirm={async () => {
              setApproving(true);
              setErr('');
              try {
                await api.approve(project.id);
              } catch (e) {
                setErr((e as Error).message);
              }
              setApproving(false);
            }}
          >
            Aprovar decupagem e finalizar
          </ConfirmButton>
          <p className="mt-1.5 text-center text-ui-xs text-ink-400">O agente faz cor, legenda, motions, letterings e SFX; o vídeo vai para "Editado".</p>
        </div>
      )}
    </div>
  );
}

function DoubtCard({ d, playing, onListen, onResolve }: { d: ReviewDoubt; playing: boolean; onListen: () => void; onResolve: () => void }) {
  const project = useEditor((s) => s.project)!;
  const transcripts = useEditor((s) => s.transcripts);
  const sendOp = useEditor((s) => s.sendOp);
  const seek = useEditor((s) => s.seek);
  const [fix, setFix] = useState(d.suggestions?.[0] ?? d.text);
  const [all, setAll] = useState(true);
  // Nome próprio/marca: guardar no glossário do cliente já vem marcado (BL-0081).
  const [guardar, setGuardar] = useState(d.kind === 'nome');
  const [guardado, setGuardado] = useState('');
  const isWord = d.kind === 'palavra' || d.kind === 'nome';
  const guardarTermo = (text: string) => {
    if (!guardar) return;
    api.guardarNoGlossario(project.id, text).then((r) => setGuardado(`"${text}" guardado no glossário de ${r.nome}.`), (e: Error) => setGuardado(e.message));
  };

  const applyFix = (text: string) => {
    const words = transcripts[d.assetId] ?? [];
    const target = strip(d.text).toLowerCase();
    // A mesma palavra errada em outros pontos do vídeo também é corrigida (mantendo a pontuação de cada uma).
    const hits = all ? words.filter((w) => strip(w.w).toLowerCase() === target) : words.filter((w) => sameWordAt(w.start, d.wordAt ?? -1));
    const fixes = hits.map((w) => ({ assetId: d.assetId, at: w.start, text: text + (w.w.match(/[^\p{L}\p{N}]+$/u)?.[0] ?? '') }));
    if (fixes.length) sendOp({ op: { type: 'fix_words', fixes }, note: `Corrigiu "${d.text}" → "${text}"${fixes.length > 1 ? ` (${fixes.length}×)` : ''}` });
    guardarTermo(text);
  };

  return (
    <div className="space-y-2 rounded-lg border border-ink-750 bg-ink-800 p-2.5">
      <div className="flex items-center gap-1.5">
        <span className={`rounded px-1.5 py-px text-ui-2xs font-semibold ${KIND_STYLE[d.kind]}`}>{KIND_LABEL[d.kind]}</span>
        {d.at !== null && (
          <button aria-label="Levar o cursor até aqui" onClick={() => seek(d.at!)} className="font-mono text-ui-xs text-ink-400 hover:text-white" title="Levar o cursor até aqui">
            {formatTime(d.at)}
          </button>
        )}
        <button aria-label="Ouvir no bruto" onClick={onListen} className="ml-auto flex items-center gap-1 rounded-md bg-ink-700 px-1.5 py-0.5 text-ui-xs text-ink-100 hover:bg-nc-500" title="Ouvir no bruto">
          {playing ? <Pause size={11} /> : <Play size={11} />} ouvir
        </button>
      </div>
      {isWord ? (
        <div className="text-sm font-semibold text-white">{d.text}</div>
      ) : (
        <p className={`line-clamp-3 text-ui-sm leading-snug ${d.removalId ? 'text-ink-400 line-through decoration-ink-600' : 'text-ink-200'}`}>"{d.text}"</p>
      )}
      <p className="text-ui-xs leading-snug text-ink-400">{d.question}</p>

      {isWord ? (
        <div className="space-y-1.5">
          {!!d.suggestions?.length && (
            <div className="flex flex-wrap gap-1">
              {d.suggestions.map((s) => (
                <button key={s} onClick={() => setFix(s)} className={`rounded-full px-2 py-0.5 text-ui-xs ${fix === s ? 'bg-nc-500 text-white' : 'bg-ink-700 text-ink-300 hover:text-white'}`}>
                  {s}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-1.5">
            <input value={fix} onChange={(e) => setFix(e.target.value)} onKeyDown={(e) => (e.stopPropagation(), e.key === 'Enter' && fix.trim() && applyFix(fix.trim()))} className="input min-w-0 flex-1 py-1 text-xs" />
            <button onClick={() => fix.trim() && fix.trim() !== d.text && applyFix(fix.trim())} className="flex items-center gap-1 rounded-md bg-nc-500 px-2 text-ui-xs font-semibold text-white hover:brightness-110">
              <SpellCheck size={12} /> Corrigir
            </button>
          </div>
          <label className="flex items-center gap-1.5 text-ui-xs text-ink-400">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="accent-nc-500" /> em todo o vídeo
          </label>
          <label className="flex items-center gap-1.5 text-ui-xs text-ink-400" title="Nos próximos projetos deste cliente a transcrição já ouve assim e a revisão não pergunta de novo">
            <input type="checkbox" checked={guardar} onChange={(e) => setGuardar(e.target.checked)} className="accent-nc-500" /> Guardar no perfil do cliente
          </label>
          {guardado && <p className="text-ui-xs text-emerald-300">{guardado}</p>}
        </div>
      ) : null}

      {d.swap && <p className="text-ui-xs leading-snug text-ink-400">Ficou no lugar: <span className="text-ink-300">"{d.swap.text}"</span></p>}
      <div className="flex gap-1.5">
        {d.removalId && d.swap && project.timeline.removals.some((r) => r.id === d.removalId) && (
          <button onClick={() => void api.swapTake(project.id, d.id)} className="flex flex-1 items-center justify-center gap-1 rounded-md border border-ink-600 py-1 text-ui-xs text-ink-100 hover:border-emerald-400 hover:text-emerald-300" title="Volta esta tomada e corta a que tinha ficado">
            <RotateCcw size={12} /> Trocar por esta
          </button>
        )}
        {d.removalId && !d.swap && project.timeline.removals.some((r) => r.id === d.removalId) && (
          <button onClick={() => sendOp({ op: { type: 'restore', removalId: d.removalId! }, note: `Restaurou na revisão: "${d.text.slice(0, 40)}…"` })} className="flex flex-1 items-center justify-center gap-1 rounded-md border border-ink-600 py-1 text-ui-xs text-ink-100 hover:border-emerald-400 hover:text-emerald-300">
            <RotateCcw size={12} /> Restaurar
          </button>
        )}
        <button onClick={() => (isWord && guardarTermo(strip(d.text)), onResolve())} className="flex flex-1 items-center justify-center gap-1 rounded-md border border-ink-600 py-1 text-ui-xs text-ink-300 hover:border-nc-500 hover:text-white">
          <Check size={12} /> {isWord ? 'Está certo' : 'O agente acertou'}
        </button>
      </div>
    </div>
  );
}

function Waiting({ text }: { text: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <Loader2 size={20} className="animate-spin text-nc-300" />
      <p className="text-ui-sm leading-snug text-ink-300">{text}</p>
    </div>
  );
}

/** QC (papel 09): o que o checklist do DNA e do perfil apontou; roda de novo a qualquer hora. */
function QcSection() {
  const project = useEditor((s) => s.project)!;
  const seek = useEditor((s) => s.seek);
  const select = useEditor((s) => s.select);
  const [busy, setBusy] = useState(false);
  const qc = project.qc;
  if (project.status === 'fila' || project.status === 'decupando' || project.status === 'revisao') return null;
  const block = qc?.issues.filter((i) => i.severidade === 'bloqueia') ?? [];
  const warn = qc?.issues.filter((i) => i.severidade === 'avisa') ?? [];
  return (
    <section className={`rounded-[var(--radius-ui-md)] border p-3 ${block.length ? 'border-rose-500/40 bg-rose-500/5' : warn.length ? 'border-amber-400/30 bg-amber-400/5' : 'border-emerald-500/30 bg-emerald-500/5'}`}>
      <div className="flex items-center gap-2">
        <ShieldCheck size={14} className={block.length ? 'text-rose-300' : warn.length ? 'text-amber-300' : 'text-emerald-300'} />
        <span className="text-ui-xs font-semibold text-ink-100">QC {qc ? `· ${block.length} bloqueio(s), ${warn.length} aviso(s)` : ''}</span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            await api.qc(project.id).catch(() => undefined);
            setBusy(false);
          }}
        >
          Rodar QC
        </Button>
      </div>
      {qc?.render && (
        <p className="mt-1 text-ui-2xs text-ink-400">
          Render: {qc.render.lufs?.toFixed(1) ?? '?'} LUFS · pico {qc.render.truePeak?.toFixed(1) ?? '?'} dBTP{qc.render.blackFrames ? ` · ${qc.render.blackFrames} quadro(s) preto(s)` : ''}
        </p>
      )}
      {qc && qc.issues.length > 0 && (
        <ul className="mt-2 space-y-1">
          {qc.issues.map((i) => (
            <li key={i.id} className="flex items-start gap-1.5 text-ui-xs leading-snug">
              <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${i.severidade === 'bloqueia' ? 'bg-rose-400' : 'bg-amber-300'}`} />
              <button
                className="min-w-0 flex-1 text-left text-ink-200 hover:text-white"
                onClick={() => {
                  if (i.at !== undefined) seek(i.at);
                  if (i.overlayId) select({ kind: 'overlay', id: i.overlayId });
                }}
              >
                {i.texto}
              </button>
            </li>
          ))}
        </ul>
      )}
      {qc && !qc.issues.length && <p className="mt-1 text-ui-xs text-emerald-300">Nada a apontar.</p>}
      {!qc && <p className="mt-1 text-ui-xs text-ink-400">O QC roda sozinho antes de "Editado".</p>}
    </section>
  );
}
