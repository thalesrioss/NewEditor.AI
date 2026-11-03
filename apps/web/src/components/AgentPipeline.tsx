/**
 * O trabalho do agente legível (auditoria A1, A5, A6): as etapas do fluxo com estado e tempo
 * (estimado e gasto), quem está com a bola (agente ou você) e o que mudou na última passada.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Circle, Hand, Loader2, User } from 'lucide-react';
import { formatTime, timelineDuration, type Project } from '@neweditor/core';
import { api } from '../lib/api.ts';
import { useEditor } from '../lib/store.ts';
import { openRightTab } from '../editor/shared.ts';
import { Button } from './ui.tsx';

type StepId = 'decupar' | 'revisao' | 'cor' | 'legenda' | 'broll' | 'trilha' | 'motions' | 'letterings' | 'final';
interface Step {
  id: StepId;
  label: string;
  who: 'agente' | 'voce';
  /** Estimativa em segundos (medida no cérebro local). */
  est: (p: Project) => number;
}

const rawDur = (p: Project) => p.assets.filter((a) => a.role === 'fala').reduce((s, a) => s + a.duration, 0);
const STEPS: Step[] = [
  { id: 'decupar', label: 'Decupagem', who: 'agente', est: (p) => 8 + rawDur(p) * 0.02 },
  { id: 'revisao', label: 'Revisão da decupagem', who: 'voce', est: (p) => 60 + timelineDuration(p.timeline) * 1.5 },
  { id: 'cor', label: 'Cor', who: 'agente', est: () => 5 },
  { id: 'legenda', label: 'Legenda', who: 'agente', est: () => 1 },
  { id: 'broll', label: 'B-roll (Cinéfilo)', who: 'agente', est: () => 20 },
  { id: 'trilha', label: 'Trilha', who: 'agente', est: () => 4 },
  { id: 'motions', label: 'Motions (Studio) e SFX', who: 'agente', est: () => 6 },
  { id: 'letterings', label: 'Letterings', who: 'agente', est: () => 4 },
  { id: 'final', label: 'Revisão final', who: 'voce', est: (p) => 60 + timelineDuration(p.timeline) },
];

/** Qual etapa está acontecendo agora, pelo status do projeto e pela mensagem do agente. */
function current(p: Project, state: string, message: string): StepId | null {
  if (p.status === 'fila' || p.status === 'decupando') return state === 'idle' && p.status === 'fila' ? null : 'decupar';
  if (p.status === 'revisao') return 'revisao';
  if (p.status === 'finalizando') {
    if (/^Cor/i.test(message)) return 'cor';
    if (/^Cinéfilo|B-roll/i.test(message)) return 'broll';
    if (/^Trilha/i.test(message)) return 'trilha';
    if (/palavras-chave|Lettering|letterings/i.test(message)) return 'letterings';
    if (/história|Obra-alvo|motion|referência/i.test(message) || state === 'motion') return 'motions';
    return 'legenda';
  }
  if (p.status === 'editado' || p.status === 'alteracao') return 'final';
  return null;
}

const fmt = (s: number) => (s < 60 ? `${Math.max(1, Math.round(s))} s` : `${Math.round(s / 60)} min`);

export function AgentPipeline() {
  const project = useEditor((s) => s.project);
  const activity = useEditor((s) => s.activity);
  const started = useRef<Partial<Record<StepId, number>>>({});
  const [open, setOpen] = useState(false);
  // Estimativa calibrada pelo histórico (servidor); o chute local fica como reserva.
  const [est, setEst] = useState<Partial<Record<string, number>>>({});
  const pid = project?.id;
  const pstatus = project?.status;
  useEffect(() => {
    if (!pid) return;
    api.estimativa(pid).then((r) => setEst(Object.fromEntries(r.steps.map((s) => [s.step, s.seconds])))).catch(() => undefined);
  }, [pid, pstatus]);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (!project) return null;
  const cur = current(project, activity.state, activity.message ?? '');
  const curIdx = cur ? STEPS.findIndex((s) => s.id === cur) : project.status === 'entregue' ? STEPS.length : -1;
  if (cur && !started.current[cur]) started.current[cur] = Date.now();
  const estOf = (s: Step) => est[s.id] ?? s.est(project);
  const remaining = STEPS.slice(Math.max(0, curIdx)).filter((s) => s.who === 'agente').reduce((n, s) => n + estOf(s), 0);
  const yourTurn = cur === 'revisao' || cur === 'final';

  return (
    <div className="space-y-2 border-b border-ink-750 p-3">
      {yourTurn && activity.state === 'idle' && (
        <div className="flex items-center gap-2 rounded-ui-md border border-amber-400/40 bg-amber-400/10 px-2.5 py-2">
          <Hand size={14} className="shrink-0 text-amber-300" />
          <span className="min-w-0 flex-1 text-ui-sm text-amber-100">{cur === 'revisao' ? 'Sua vez: revise a decupagem e aprove.' : 'Sua vez: confira a edição e exporte.'}</span>
          {cur === 'revisao' && (
            <Button size="sm" variant="primary" onClick={() => openRightTab('revisao')}>
              Revisar
            </Button>
          )}
        </div>
      )}
      {/* Compacto: uma barra por etapa + a etapa atual. */}
      <button className="flex w-full items-center gap-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="etapas">
        <span className="flex flex-1 gap-0.5" aria-hidden>
          {STEPS.map((s, i) => (
            <span key={s.id} className={`h-1.5 flex-1 rounded-full ${i < curIdx ? 'bg-ok' : i === curIdx ? (s.who === 'voce' ? 'bg-human' : 'animate-pulse bg-agent') : 'bg-ink-700'}`} />
          ))}
        </span>
        <span className="text-ui-xs whitespace-nowrap text-ink-300">{curIdx >= 0 && curIdx < STEPS.length ? STEPS[curIdx]!.label : curIdx >= STEPS.length ? 'Entregue' : 'Na fila'}</span>
        <ChevronDown size={13} className={`text-ink-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
      <ol id="etapas" className="space-y-1" aria-label="Etapas do projeto">
        {STEPS.map((s, i) => {
          const done = i < curIdx;
          const active = i === curIdx;
          const spent = active && started.current[s.id] ? (Date.now() - started.current[s.id]!) / 1000 : 0;
          return (
            <li key={s.id} className={`flex items-center gap-2 text-ui-xs ${done ? 'text-ink-400' : active ? 'text-white' : 'text-ink-400'}`} aria-current={active ? 'step' : undefined}>
              {done ? <Check size={12} className="text-ok" /> : active ? s.who === 'voce' ? <User size={12} className="text-human" /> : <Loader2 size={12} className="animate-spin text-agent" /> : <Circle size={10} className="mx-px text-ink-600" />}
              <span className={`flex-1 ${done ? 'line-through decoration-ink-600' : ''}`}>
                {s.label}
                <span className={`ml-1.5 text-ui-xs ${s.who === 'voce' ? 'text-human' : 'text-agent'}`}>{s.who === 'voce' ? 'você' : 'agente'}</span>
              </span>
              <span className="font-mono text-ui-xs text-ink-400">{active && spent > 1 ? `${formatTime(spent)} / ≈${fmt(estOf(s))}` : done ? '' : `≈${fmt(estOf(s))}`}</span>
            </li>
          );
        })}
      </ol>
      )}
      {curIdx >= 0 && curIdx < STEPS.length && remaining > 0 && <p className="text-ui-xs text-ink-400">Trabalho do agente que falta: ≈{fmt(remaining)}</p>}
      <LastPass />
    </div>
  );
}

/** O que a última passada do agente mudou (comparado com o começo dela). */
function LastPass() {
  const project = useEditor((s) => s.project);
  const activity = useEditor((s) => s.activity);
  const seek = useEditor((s) => s.seek);
  const before = useRef<{ dur: number; removals: Set<string>; overlays: Set<string> } | null>(null);
  const [summary, setSummary] = useState<{ dt: number; cuts: number; firstCut?: number; motions: number; letterings: number } | null>(null);
  const busy = activity.state !== 'idle' && activity.state !== 'celebrating';
  useEffect(() => {
    const tl = project?.timeline;
    if (!tl) return;
    if (busy && !before.current) before.current = { dur: timelineDuration(tl), removals: new Set(tl.removals.map((r) => r.id)), overlays: new Set(tl.overlays.map((o) => o.id)) };
    if (!busy && before.current) {
      const b = before.current;
      before.current = null;
      const newCuts = tl.removals.filter((r) => !b.removals.has(r.id));
      const newOv = tl.overlays.filter((o) => !b.overlays.has(o.id));
      const s = { dt: timelineDuration(tl) - b.dur, cuts: newCuts.length, motions: newOv.filter((o) => o.role === 'motion').length, letterings: newOv.filter((o) => o.role === 'lettering').length };
      if (s.cuts || s.motions || s.letterings || Math.abs(s.dt) > 0.05) setSummary(s);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);
  if (!summary) return null;
  const parts = [summary.cuts && `${summary.cuts} corte(s)`, Math.abs(summary.dt) > 0.05 && `${summary.dt < 0 ? '−' : '+'}${Math.abs(summary.dt).toFixed(1)} s`, summary.motions && `${summary.motions} motion(s)`, summary.letterings && `${summary.letterings} lettering(s)`].filter(Boolean);
  return (
    <div className="flex items-center gap-2 rounded-ui-md bg-ink-800 px-2.5 py-1.5 text-ui-xs text-ink-200">
      <span className="flex-1">
        <span className="text-ink-400">Última passada: </span>
        {parts.join(' · ')}
      </span>
      <button className="text-ui-xs text-ink-400 hover:text-white" onClick={() => (seek(0), setSummary(null))}>
        ok
      </button>
    </div>
  );
}
