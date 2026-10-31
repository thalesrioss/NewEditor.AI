/**
 * Gaveta do projeto no Kanban (D-5): briefing do Gestor, cliente, prazo, perfil, estimado × real por etapa,
 * versões e alterações — sem abrir o editor.
 */
import { useEffect, useState } from 'react';
import { ExternalLink, Trash2, X } from 'lucide-react';
import { formatTime, profileOptions, profileValue, type ClientProfile, type Project, type StepId } from '@neweditor/core';
import { api } from '../lib/api.ts';
import { Button, ConfirmButton, IconButton } from './ui.tsx';

const STEP_LABEL: Record<StepId, string> = { ingest: 'Preparar material', decupar: 'Decupagem', revisao: 'Revisão (você)', cor: 'Cor', legenda: 'Legenda', broll: 'B-roll (Cinéfilo)', trilha: 'Trilha', motions: 'Motions', letterings: 'Letterings', qc: 'QC', final: 'Revisão final (você)', render: 'Render', alteracao: 'Alterações' };
const fmt = (s: number) => (s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min${s % 60 >= 30 ? ' ½' : ''}`);

export function ProjectDrawer({ p, onClose, onChange, onDelete }: { p: Project & { estimativa?: number }; onClose: () => void; onChange: () => void; onDelete?: () => void }) {
  const [perfis, setPerfis] = useState<ClientProfile[]>([]);
  const [est, setEst] = useState<{ step: StepId; seconds: number; amostras: number }[]>([]);
  const [client, setClient] = useState(p.client ?? '');
  const [dueAt, setDueAt] = useState(p.dueAt ?? '');
  useEffect(() => {
    api.perfis().then(setPerfis).catch(() => undefined);
    api.estimativa(p.id).then((r) => setEst(r.steps)).catch(() => undefined);
  }, [p.id]);
  const save = async (patch: Parameters<typeof api.updateProject>[1]) => {
    await api.updateProject(p.id, patch).catch(() => undefined);
    onChange();
  };
  const timings = Object.entries(p.timings ?? {}) as [StepId, { seconds?: number; startedAt: string }][];
  const rows: { step: StepId; real?: number; est?: number }[] = [...new Set([...timings.map(([s]) => s), ...est.map((e) => e.step)])].map((step) => ({ step, real: p.timings?.[step]?.seconds, est: est.find((e) => e.step === step)?.seconds }));
  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex justify-end bg-black/40" onMouseDown={onClose}>
      <aside onMouseDown={(e) => e.stopPropagation()} className="anim-pop flex h-full w-[420px] max-w-full flex-col border-l border-ink-700 bg-ink-850 shadow-ui-3">
        <div className="flex items-start gap-2 border-b border-ink-750 p-4">
          <div className="min-w-0 flex-1">
            {p.client && <div className="text-ui-xs font-semibold tracking-wide text-nc-300 uppercase">{p.client}</div>}
            <div className="text-ui-lg leading-snug font-semibold text-white">{p.name}</div>
          </div>
          <a href={`#/p/${p.id}`} className="rounded-ui-md p-1.5 text-ink-300 hover:bg-ink-800 hover:text-white" aria-label="Abrir no editor" title="Abrir no editor">
            <ExternalLink size={16} />
          </a>
          <IconButton label="Fechar" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-ui-xs">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-ink-300">
              Cliente
              <input value={client} onChange={(e) => setClient(e.target.value)} onBlur={() => client !== (p.client ?? '') && void save({ client })} className="input py-1" />
            </label>
            <label className="space-y-1 text-ink-300">
              Prazo
              <input type="date" value={dueAt} onChange={(e) => (setDueAt(e.target.value), void save({ dueAt: e.target.value }))} className="input py-1" />
            </label>
            <label className="col-span-2 space-y-1 text-ink-300">
              Perfil de edição
              <select value={profileValue(perfis, p.profileId)} onChange={(e) => void save({ profileId: e.target.value })} className="input py-1">
                {profileOptions(perfis, { personalizado: true }).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {p.task && (
            <section className="space-y-1 rounded-ui-md bg-ink-800 p-3">
              <div className="font-semibold text-ink-100">Briefing do Gestor</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-ink-300">
                <span>Formato: <b className="text-ink-100">{p.task.formato ?? '—'}</b></span>
                <span>Duração: <b className="text-ink-100">{p.task.duracaoAlvoS ? `${p.task.duracaoAlvoS[0]}–${p.task.duracaoAlvoS[1]} s` : '—'}</b></span>
                <span className="col-span-2">Tom: <b className="text-ink-100">{p.task.tom ?? '—'}</b></span>
                {p.task.naoPodeFaltar?.length ? <span className="col-span-2">Não pode faltar: <b className="text-ink-100">{p.task.naoPodeFaltar.join('; ')}</b></span> : null}
                {p.task.pedidos?.length ? <span className="col-span-2">Pedidos: <b className="text-ink-100">{p.task.pedidos.join('; ')}</b></span> : null}
              </div>
              <details className="pt-1 text-ink-400">
                <summary className="cursor-pointer">Texto original da tarefa</summary>
                <p className="mt-1 whitespace-pre-wrap text-ink-300">{p.task.texto}</p>
              </details>
            </section>
          )}
          {!p.task && p.brief && (
            <section className="rounded-ui-md bg-ink-800 p-3">
              <div className="mb-1 font-semibold text-ink-100">Briefing</div>
              <p className="whitespace-pre-wrap text-ink-300">{p.brief}</p>
            </section>
          )}

          <section>
            <div className="mb-1 font-semibold text-ink-100">Tempo por etapa — estimado × real</div>
            {rows.length === 0 ? (
              <p className="text-ink-400">Ainda sem etapas.</p>
            ) : (
              <table className="w-full text-left">
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.step} className="border-t border-ink-800">
                      <td className="py-1 text-ink-300">{STEP_LABEL[r.step]}</td>
                      <td className="py-1 text-right font-mono text-ink-400">{r.est !== undefined ? `≈${fmt(r.est)}` : ''}</td>
                      <td className={`py-1 text-right font-mono ${r.real !== undefined && r.est !== undefined && r.real > r.est * 1.25 ? 'text-amber-300' : 'text-ink-100'}`}>{r.real !== undefined ? fmt(r.real) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="grid grid-cols-3 gap-2 text-center">
            <Stat label="montado" value={p.timeline.main.length ? formatTime(p.timeline.main.reduce((s, c) => s + (c.out - c.in), 0)) : '—'} />
            <Stat label="versões" value={String(p.versions?.length ?? 0)} />
            <Stat label="alterações abertas" value={String((p.comments ?? []).filter((c) => c.status === 'aberto').length)} />
          </section>
          {p.qc && (
            <section className="text-ink-300">
              QC: {p.qc.issues.filter((i) => i.severidade === 'bloqueia').length} bloqueio(s), {p.qc.issues.filter((i) => i.severidade === 'avisa').length} aviso(s)
            </section>
          )}
        </div>
        <div className="space-y-2 border-t border-ink-750 p-3">
          <Button variant="primary" className="w-full" onClick={() => (location.hash = `#/p/${p.id}`)}>
            Abrir no Editor Brain
          </Button>
          {onDelete && (
            <ConfirmButton variant="ghost" size="sm" className="w-full text-ink-400 hover:text-rose-300" icon={<Trash2 size={13} />} onConfirm={onDelete} confirmLabel="Apagar mesmo? Vai para a lixeira (data/_lixeira)">
              Apagar projeto
            </ConfirmButton>
          )}
        </div>
      </aside>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-ui-md bg-ink-800 p-2">
      <div className="text-ui-md font-semibold text-white">{value}</div>
      <div className="text-ui-xs text-ink-400">{label}</div>
    </div>
  );
}
