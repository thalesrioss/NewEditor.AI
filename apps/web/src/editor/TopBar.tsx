import { useEffect, useState } from 'react';
import { ArrowLeft, Check, Download, Keyboard, ListChecks, PanelLeft, PanelRight } from 'lucide-react';
import { profileOptions, profileValue, type ClientProfile, type Project, type ProjectStatus } from '@neweditor/core';
import { api } from '../lib/api.ts';
import { useEditor } from '../lib/store.ts';
import { IconButton } from '../components/ui.tsx';
import { Notifications } from '../components/Notifications.tsx';
import { STATUS_LABEL } from './shared.ts';

/**
 * Barra superior (CapCut): voltar, logo, nome do projeto editável, etapa e perfil à esquerda;
 * estado de salvamento, notificações, atalhos, painéis e Exportar à direita.
 */
export function TopBar({ project, leftOpen, rightOpen, onLeft, onRight, onExport, onReview }: { project: Project; leftOpen: boolean; rightOpen: boolean; onLeft: () => void; onRight: () => void; onExport: () => void; onReview: () => void }) {
  const connected = useEditor((s) => s.connected);
  const history = useEditor((s) => s.history);
  const [statusErr, setStatusErr] = useState('');
  return (
    <header className="ne-titlebar flex h-11 shrink-0 items-center gap-2 border-b border-ink-750 bg-ink-900 px-2">
      <a href="#/" className="rounded-[var(--radius-ui-md)] p-1.5 text-ink-400 hover:bg-ink-800 hover:text-white" title="Projetos (Kanban)" aria-label="Voltar aos projetos">
        <ArrowLeft size={16} />
      </a>
      <img src="/logo-mark.png" alt="NewContent" className="h-5" />
      <span className="text-ui-xs font-semibold tracking-wide text-ink-400 uppercase">Editor Brain</span>
      <span className="text-ink-600">/</span>
      <ProjectName project={project} />
      <select
        value={project.status}
        aria-label="Etapa do projeto"
        onChange={(e) =>
          api.updateProject(project.id, { status: e.target.value as ProjectStatus }).catch((err: Error) => {
            setStatusErr(err.message);
            setTimeout(() => setStatusErr(''), 6000);
          })
        }
        className="rounded-full border border-ink-700 bg-ink-800 px-2.5 py-0.5 text-ui-xs text-ink-200 focus:outline-none"
      >
        {Object.entries(STATUS_LABEL).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
      <ProfileSelect project={project} />
      {statusErr && (
        <span className="max-w-xs truncate text-ui-xs text-rose-300" title={statusErr}>
          {statusErr}
        </span>
      )}
      {project.status === 'revisao' && (
        <button onClick={onReview} className="flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-0.5 text-ui-xs font-semibold text-amber-200 hover:bg-amber-400/20">
          <ListChecks size={12} /> Revisar e aprovar a decupagem
        </button>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        <span className={`flex items-center gap-1 text-ui-xs ${connected ? 'text-ink-400' : 'text-amber-300'}`} title={connected ? `Tudo salvo no servidor (v${project.version})${history.undoLabel ? ` · último: ${history.undoLabel}` : ''}` : 'Sem conexão com o servidor — tentando de novo'}>
          {connected ? <Check size={12} className="text-[var(--color-ok)]" /> : null}
          {connected ? 'Salvo' : 'reconectando…'}
        </span>
        <Notifications />
        <IconButton label="Atalhos do teclado" shortcut="?" onClick={() => useEditor.getState().setShortcutsOpen(true)}>
          <Keyboard size={15} />
        </IconButton>
        <span className="flex items-center gap-0.5 rounded-full border border-ink-700 p-0.5">
          <IconButton label={leftOpen ? 'Recolher o painel de recursos' : 'Abrir o painel de recursos'} active={!leftOpen} className="!p-1" onClick={onLeft}>
            <PanelLeft size={13} />
          </IconButton>
          <IconButton label={rightOpen ? 'Recolher o painel da direita' : 'Abrir o painel da direita'} active={!rightOpen} className="!p-1" onClick={onRight}>
            <PanelRight size={13} />
          </IconButton>
        </span>
        <button
          onClick={onExport}
          disabled={!project.timeline.main.length}
          className="ml-1 flex h-8 items-center gap-1.5 rounded-[var(--radius-ui-md)] nc-gradient px-3.5 text-ui-sm font-semibold text-white shadow-[var(--shadow-ui-1)] transition hover:brightness-110 disabled:opacity-40"
          title="Exportar o vídeo (⌘E)"
        >
          <Download size={14} /> Exportar
        </button>
      </div>
    </header>
  );
}

/** Nome do projeto: clique para renomear (Enter salva, Esc cancela). */
function ProjectName({ project }: { project: Project }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(project.name);
  useEffect(() => setV(project.name), [project.name]);
  const save = () => {
    setEditing(false);
    const name = v.trim();
    if (name && name !== project.name) void api.updateProject(project.id, { name }).catch(() => setV(project.name));
    else setV(project.name);
  };
  if (editing)
    return (
      <input
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') (setV(project.name), setEditing(false));
        }}
        aria-label="Nome do projeto"
        className="w-56 rounded-[var(--radius-ui-sm)] border border-nc-500 bg-ink-800 px-2 py-0.5 text-ui-sm text-white outline-none"
      />
    );
  return (
    <button onClick={() => setEditing(true)} className="max-w-[260px] truncate rounded-[var(--radius-ui-sm)] px-1.5 py-0.5 text-ui-sm font-semibold text-ink-100 hover:bg-ink-800" title="Clique para renomear">
      {project.name}
    </button>
  );
}

/** Perfil de edição do projeto (estilo do cliente): muda legenda, letterings, motions, SFX e QC. */
function ProfileSelect({ project }: { project: Project }) {
  const [perfis, setPerfis] = useState<ClientProfile[]>([]);
  useEffect(() => {
    api.perfis().then(setPerfis).catch(() => undefined);
  }, []);
  return (
    <select
      value={profileValue(perfis, project.profileId)}
      aria-label="Perfil de edição"
      title="Padrão de edição: o estilo do cliente (Cérebro do Editor), ou Personalizado = as regras saem desta edição"
      onChange={(e) => void api.updateProject(project.id, { profileId: e.target.value })}
      className="max-w-[160px] truncate rounded-full border border-ink-700 bg-ink-800 px-2.5 py-0.5 text-ui-xs text-ink-200 focus:outline-none"
    >
      {profileOptions(perfis, { personalizado: true }).map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
