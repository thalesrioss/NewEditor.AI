import { useEffect, useRef, useState } from 'react';
import { Bot, BrainCircuit, Info, ListChecks, Plus, SlidersHorizontal, Trash2, User } from 'lucide-react';
import { ProjectDrawer } from './ProjectDrawer.tsx';
import { FORMAT_PRESETS, formatSize, formatTime, PROJECT_STATUSES, timelineDuration, type ClientProfile, type Project, type ProjectStatus, type ProjectTask } from '@neweditor/core';
import { api, mediaUrl } from '../lib/api.ts';
import { Button } from './ui.tsx';
import { STATUS_LABEL, STATUS_OWNER } from '../editor/shared.ts';
import { Notifications } from './Notifications.tsx';

const COLUMN_HINT: Record<ProjectStatus, string> = {
  fila: 'Esperando o material',
  decupando: 'O agente está decupando',
  revisao: 'Confira os cortes e a copy, depois aprove',
  finalizando: 'Cor, legenda, motions e letterings',
  editado: 'Revisão final',
  alteracao: 'Pedidos de ajuste',
  entregue: 'Concluído',
};

/** Quem está com a bola em cada coluna. */
const NEEDS_ME: ProjectStatus[] = ['revisao', 'editado', 'alteracao'];

/** Kanban do fluxo: o agente decupa → você revisa → o agente finaliza → revisão final → entrega. */
export function Home() {
  const [projects, setProjects] = useState<(Project & { pendentes?: number; estimativa?: number })[]>([]);
  const [creating, setCreating] = useState(false);
  const [drawer, setDrawer] = useState<string | null>(null);
  const [over, setOver] = useState<ProjectStatus | null>(null);
  const [mine, setMine] = useState(() => {
    try {
      return localStorage.getItem('ne-kanban-mine') === '1';
    } catch {
      return false;
    }
  });

  const [loaded, setLoaded] = useState(false);
  const load = () =>
    api
      .projects()
      .then((ps) => (setProjects(ps), setLoaded(true)))
      .catch(() => undefined);
  useEffect(() => {
    void load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);
  /** Apagar projeto: sai do Kanban na hora; no servidor a pasta vai para data/_lixeira (reversível à mão). */
  const remove = async (id: string) => {
    setProjects((ps) => ps.filter((p) => p.id !== id));
    setDrawer((d) => (d === id ? null : d));
    try {
      await api.deleteProject(id);
    } catch (e) {
      window.alert(`Não consegui apagar: ${(e as Error).message}`);
      void load();
    }
  };
  const move = async (id: string, status: ProjectStatus) => {
    setProjects((ps) => ps.map((p) => (p.id === id ? { ...p, status } : p)));
    await api.updateProject(id, { status }).catch(() => undefined);
    void load();
  };
  const toggleMine = () => {
    setMine(!mine);
    try {
      localStorage.setItem('ne-kanban-mine', mine ? '0' : '1');
    } catch {
      /* sem armazenamento */
    }
  };
  const waiting = projects.filter((p) => NEEDS_ME.includes(p.status)).length;
  const cols = mine ? PROJECT_STATUSES.filter((c) => NEEDS_ME.includes(c)) : PROJECT_STATUSES;

  return (
    <div className="flex h-full flex-col">
      <header className="ne-titlebar flex items-center gap-3 border-b border-ink-750 px-6 py-4">
        <img src="/logo-mark.png" alt="NewContent" className="h-8" />
        <div>
          <div className="text-base font-semibold">
            NewEditor<span className="nc-text-gradient">.AI</span>
          </div>
          <div className="text-ui-sm text-ink-400">Projetos de edição · NewContent</div>
        </div>
        <button
          onClick={toggleMine}
          aria-pressed={mine}
          className={`ml-6 flex items-center gap-1.5 rounded-full border px-3 py-1 text-ui-sm transition ${mine ? 'border-amber-400/60 bg-amber-400/10 text-amber-200' : 'border-ink-700 text-ink-300 hover:border-ink-500 hover:text-white'}`}
        >
          <User size={13} /> Precisa de mim
          {waiting > 0 && <span className="rounded-full bg-amber-400 px-1.5 text-ui-2xs font-bold text-ink-950">{waiting}</span>}
        </button>
        <div className="ml-auto flex items-center gap-2">
          <a href="#/cerebro" className="flex items-center gap-1.5 rounded-full border border-ink-700 px-3 py-1 text-ui-sm text-ink-300 hover:border-ink-500 hover:text-white" title="O conhecimento e as notas conectadas, em 3D">
            <BrainCircuit size={13} /> Cérebro
          </a>
          <a href="#/perfis" className="flex items-center gap-1.5 rounded-full border border-ink-700 px-3 py-1 text-ui-sm text-ink-300 hover:border-ink-500 hover:text-white">
            <SlidersHorizontal size={13} /> Perfis
          </a>
          <Notifications />
        </div>
        <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>
          Novo projeto
        </Button>
      </header>

      {loaded && projects.length === 0 && (
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="max-w-md space-y-4 rounded-[var(--radius-ui-lg)] border border-ink-750 bg-ink-850 p-6 text-center">
            <a href="#/cerebro" className="mx-auto block w-8 rounded-md ring-1 ring-transparent transition hover:ring-nc-500" title="Cérebro do Editor">
              <img src="/avatar/editor.png" alt="Cérebro do Editor" className="h-16 w-8 object-cover object-left-top" style={{ imageRendering: 'pixelated', objectPosition: '0 -192px' }} />
            </a>
            <h2 className="text-ui-lg font-semibold text-white">Seu primeiro projeto</h2>
            <ol className="space-y-1 text-left text-ui-sm text-ink-300">
              <li>1. Cole a tarefa do cliente (ou o link do Drive): o Gestor monta o briefing.</li>
              <li>2. O agente decupa e te avisa para revisar — só as decisões, não o vídeo inteiro.</li>
              <li>3. Aprove: ele faz cor, legenda, letterings, motions e SFX, e passa pelo QC.</li>
            </ol>
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>
              Novo projeto
            </Button>
            <p className="text-ui-2xs text-ink-400">Os perfis de edição (estilo de cada cliente) ficam em <a href="#/perfis" className="text-nc-300 hover:text-white">Perfis</a>.</p>
          </div>
        </div>
      )}
      <div className={`scroll-thin min-h-0 flex-1 gap-3 overflow-x-auto p-4 ${loaded && projects.length === 0 ? 'hidden' : 'flex'}`}>
        {cols.map((col) => {
          const items = projects.filter((p) => p.status === col);
          const owner = STATUS_OWNER[col];
          const collapsed = !items.length && over !== col && !mine;
          return (
            <div
              key={col}
              onDragOver={(e) => (e.preventDefault(), setOver(col))}
              onDragLeave={() => setOver((o) => (o === col ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const id = e.dataTransfer.getData('text/project');
                if (id) void move(id, col);
              }}
              className={`flex min-h-0 shrink-0 flex-col rounded-[var(--radius-ui-lg)] bg-ink-850 ring-1 transition-[width] duration-[var(--dur-base)] ${collapsed ? 'w-11 items-center' : 'w-[260px]'} ${over === col ? 'ring-nc-500' : col === 'revisao' ? 'ring-amber-400/30' : 'ring-ink-750'}`}
              title={collapsed ? `${STATUS_LABEL[col]} — vazia` : undefined}
            >
              {collapsed ? (
                <div className="flex flex-col items-center gap-2 py-3 text-ui-xs text-ink-400">
                  {owner === 'agente' ? <Bot size={13} className="text-nc-300" /> : <User size={13} />}
                  <span className="[writing-mode:vertical-rl] rotate-180 font-semibold whitespace-nowrap text-ink-300">{STATUS_LABEL[col]}</span>
                  <span className="rounded-full bg-ink-750 px-1.5 text-ui-2xs">0</span>
                </div>
              ) : (
                <>
                  <div className="px-3 pt-2.5 pb-2">
                    <div className="flex items-center gap-1.5 text-ui-sm font-semibold text-ink-200">
                      {owner === 'agente' ? <Bot size={13} className="text-nc-300" /> : <User size={13} className={col === 'revisao' ? 'text-amber-300' : 'text-ink-400'} />}
                      {STATUS_LABEL[col]}
                      <span className="ml-auto rounded-full bg-ink-750 px-1.5 text-ui-xs text-ink-400">{items.length}</span>
                    </div>
                    <div className="mt-0.5 text-ui-xs text-ink-400">{COLUMN_HINT[col]}</div>
                  </div>
                  <div className="scroll-thin min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                    {items.map((p) => (
                      <ProjectCard key={p.id} p={p} onInfo={() => setDrawer(p.id)} onDelete={() => void remove(p.id)} />
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {creating && <NewProject onClose={() => setCreating(false)} />}
      {drawer && projects.find((p) => p.id === drawer) && <ProjectDrawer p={projects.find((p) => p.id === drawer)!} onClose={() => setDrawer(null)} onChange={() => void load()} onDelete={() => void remove(drawer)} />}
    </div>
  );
}

const dayDiff = (iso: string) => Math.ceil((new Date(`${iso}T23:59:59`).getTime() - Date.now()) / 86400000);
/** Trabalho do agente que ainda falta: vem do servidor (calibrado pelo histórico de cada etapa). */
function agentEta(p: Project & { estimativa?: number }): number | null {
  if (p.status === 'editado' || p.status === 'alteracao' || p.status === 'entregue' || p.status === 'revisao') return null;
  return p.estimativa ?? null;
}

/** Cartão do projeto: miniatura (passe o mouse para ver 3 s do corte), cliente, prazo, quem está com a bola. */
function ProjectCard({ p, onInfo, onDelete }: { p: Project & { pendentes?: number; estimativa?: number }; onInfo: () => void; onDelete: () => void }) {
  const [hover, setHover] = useState(false);
  // Apagar em dois cliques: o primeiro arma (vira "Apagar?"), o segundo confirma; desarma sozinho em 4 s.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  const video = useRef<HTMLVideoElement>(null);
  const fala = p.assets.find((a) => a.role === 'fala' && a.kind === 'video') ?? p.assets.find((a) => a.kind === 'video');
  const th = fala?.thumbs;
  const first = p.timeline.main[0];
  const owner = STATUS_OWNER[p.status];
  const eta = agentEta(p);
  const due = p.dueAt ? dayDiff(p.dueAt) : null;
  useEffect(() => {
    const v = video.current;
    if (!v || !first) return;
    if (hover) {
      v.currentTime = first.in;
      void v.play().catch(() => undefined);
    } else v.pause();
  }, [hover, first]);
  return (
    <a
      href={`#/p/${p.id}${p.status === 'revisao' ? '/revisao' : ''}`}
      draggable
      onDragStart={(e) => (e.dataTransfer.setData('text/project', p.id), (e.dataTransfer.effectAllowed = 'move'))}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="group relative block overflow-hidden rounded-[var(--radius-ui-md)] border border-ink-700 bg-ink-800 transition hover:border-nc-500"
    >
      {fala && (th || fala.proxy) && (
        <div className="relative h-24 overflow-hidden bg-ink-900">
          {th && (
            <div
              className="absolute inset-0 bg-no-repeat"
              style={{ backgroundImage: `url(${mediaUrl(p.id, th.file)})`, backgroundSize: `${th.cols * 100}% auto`, backgroundPosition: `${(Math.min(th.cols - 1, Math.floor(th.count / 3)) / Math.max(1, th.cols - 1)) * 100}% 0` }}
            />
          )}
          {hover && fala.proxy && <video ref={video} src={mediaUrl(p.id, fala.proxy)} muted playsInline loop className="absolute inset-0 h-full w-full object-cover" onTimeUpdate={(e) => first && e.currentTarget.currentTime > first.in + 3 && (e.currentTarget.currentTime = first.in)} />}
          <span className={`absolute top-1.5 left-1.5 flex items-center gap-1 rounded-full px-1.5 py-px text-ui-2xs font-semibold ${owner === 'agente' ? 'bg-black/70 text-[var(--color-agent)]' : 'bg-amber-400 text-ink-950'}`}>
            {owner === 'agente' ? <Bot size={10} /> : <User size={10} />} {owner === 'agente' ? 'agente' : 'você'}
          </span>
          {p.timeline.main.length > 0 && <span className="absolute right-1.5 bottom-1.5 rounded bg-black/70 px-1 font-mono text-ui-2xs text-white">{formatTime(timelineDuration(p.timeline))}</span>}
        </div>
      )}
      <div className="absolute top-1.5 right-1.5 flex items-center gap-1">
        <button
          aria-label={armed ? 'Confirmar: apagar projeto' : 'Apagar projeto'}
          title={armed ? 'Clique de novo para apagar (vai para a lixeira)' : 'Apagar projeto'}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!armed) return setArmed(true);
            setArmed(false);
            onDelete();
          }}
          className={`flex items-center gap-1 rounded-full p-1 text-ui-2xs font-semibold transition ${armed ? 'bg-rose-500 px-2 text-white opacity-100' : 'bg-black/60 text-ink-200 opacity-0 group-hover:opacity-100 hover:bg-rose-500 hover:text-white'}`}
        >
          <Trash2 size={12} /> {armed && 'Apagar?'}
        </button>
        <button
          aria-label="Detalhes do projeto"
          title="Detalhes: briefing, prazo, tempos, versões"
          onClick={(e) => (e.preventDefault(), e.stopPropagation(), onInfo())}
          className="rounded-full bg-black/60 p-1 text-ink-200 opacity-0 transition group-hover:opacity-100 hover:bg-nc-500 hover:text-white"
        >
          <Info size={12} />
        </button>
      </div>
      <div className="p-2.5">
        {p.client && <div className="text-ui-2xs font-semibold tracking-wide text-nc-300 uppercase">{p.client}</div>}
        <div className="text-ui-md leading-snug font-medium text-ink-100">{p.name}</div>
        {p.brief && <div className="mt-1 line-clamp-2 text-ui-xs text-ink-400">{p.brief}</div>}
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-ui-2xs text-ink-400">
          {due !== null && <span className={`rounded px-1.5 py-px font-semibold ${due < 0 ? 'bg-rose-500/20 text-rose-300' : due <= 1 ? 'bg-amber-400/15 text-amber-300' : 'bg-ink-750 text-ink-300'}`}>{due < 0 ? `atrasado ${-due}d` : due === 0 ? 'entrega hoje' : `entrega em ${due}d`}</span>}
          {eta !== null && <span className="rounded bg-[var(--color-agent)]/10 px-1.5 py-px text-[var(--color-agent)]">agente ≈{eta < 60 ? `${Math.round(eta)} s` : `${Math.round(eta / 60)} min`}</span>}
          {p.status === 'revisao' && (
            <span className={`flex items-center gap-1 rounded px-1.5 py-px font-semibold ${p.pendentes ? 'bg-amber-400/15 text-amber-300' : 'bg-emerald-400/15 text-emerald-300'}`}>
              <ListChecks size={11} /> {p.pendentes ? `${p.pendentes} para conferir` : 'pronto para aprovar'}
            </span>
          )}
          {!fala && <span>{p.assets.length} arquivo(s)</span>}
        </div>
      </div>
    </a>
  );
}

function NewProject({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'tarefa' | 'manual'>('tarefa');
  const [name, setName] = useState('');
  const [brief, setBrief] = useState('');
  const [path, setPath] = useState('');
  const [client, setClient] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [tarefa, setTarefa] = useState('');
  const [briefing, setBriefing] = useState<ProjectTask | null>(null);
  const [perfis, setPerfis] = useState<ClientProfile[]>([]);
  const [profileId, setProfileId] = useState('');
  // Formato da entrega: 'auto' = pela tarefa (Reels → 1080×1920…), um preset, ou 'custom' com largura × altura.
  const [fmt, setFmt] = useState<string>('auto');
  const [cw, setCw] = useState('1080');
  const [ch, setCh] = useState('1920');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.perfis().then(setPerfis).catch(() => undefined);
  }, []);
  // Briefing ao vivo enquanto a tarefa é colada (Gestor de Projetos).
  useEffect(() => {
    if (!tarefa.trim()) return setBriefing(null);
    const t = setTimeout(() => api.briefing(tarefa).then(setBriefing).catch(() => undefined), 350);
    return () => clearTimeout(t);
  }, [tarefa]);
  useEffect(() => {
    if (briefing?.cliente && !profileId) {
      const want = briefing.cliente.toLowerCase();
      const hit = perfis.find((p) => p.id !== 'casa' && (want.includes(p.nome.toLowerCase().split(' ')[0]!) || p.nome.toLowerCase().includes(want)));
      if (hit) setProfileId(hit.id);
    }
  }, [briefing, perfis, profileId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      if (mode === 'tarefa') {
        const r = await api.gestor(tarefa, { nome: name.trim() || undefined, profileId: profileId || undefined, formato: formatoEscolhido() });
        location.hash = `#/p/${r.projectId}`;
      } else {
        const p = await api.createProject(name, brief);
        if (client.trim() || dueAt || profileId) await api.updateProject(p.id, { client: client.trim() || undefined, dueAt: dueAt || undefined, profileId: profileId || undefined });
        const f = formatoEscolhido();
        if (f) await api.op(p.id, { type: 'set_format', width: f.width, height: f.height }, `Formato ${f.width}×${f.height}`);
        if (path.trim()) await api.importPath(p.id, path.trim());
        location.hash = `#/p/${p.id}`;
      }
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  };

  /** Tamanho escolhido no diálogo (undefined = deixa a tarefa ou o primeiro vídeo decidir). */
  const formatoEscolhido = (): { width: number; height: number } | undefined => {
    if (fmt === 'auto') return mode === 'tarefa' && briefing?.formato ? formatSize(briefing.formato) : undefined;
    if (fmt === 'custom') {
      const width = Math.round(Number(cw));
      const height = Math.round(Number(ch));
      return width >= 64 && height >= 64 ? { width: width - (width % 2), height: height - (height % 2) } : undefined;
    }
    const p = FORMAT_PRESETS.find((x) => x.id === fmt);
    return p ? { width: p.width, height: p.height } : undefined;
  };
  const formatoSelect = (
    <Field label="Formato da entrega">
      <div className="flex gap-2">
        <select value={fmt} onChange={(e) => setFmt(e.target.value)} className="input min-w-0 flex-1" aria-label="Formato da entrega">
          <option value="auto">{mode === 'tarefa' ? `Pela tarefa${briefing?.formato ? ` (${briefing.formato} · ${formatSize(briefing.formato).width}×${formatSize(briefing.formato).height})` : ''}` : 'Pelo primeiro vídeo'}</option>
          {FORMAT_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.ratio} · {p.width}×{p.height} · {p.label}
            </option>
          ))}
          <option value="custom">Personalizado (pixels)…</option>
        </select>
        {fmt === 'custom' && (
          <>
            <input value={cw} onChange={(e) => setCw(e.target.value)} inputMode="numeric" aria-label="Largura em pixels" className="input w-20 text-right font-mono" />
            <span className="self-center text-ink-400">×</span>
            <input value={ch} onChange={(e) => setCh(e.target.value)} inputMode="numeric" aria-label="Altura em pixels" className="input w-20 text-right font-mono" />
          </>
        )}
      </div>
    </Field>
  );
  const perfilSelect = (
    <Field label="Perfil de edição (estilo do cliente)">
      <select value={profileId} onChange={(e) => setProfileId(e.target.value)} className="input">
        <option value="">Padrão da casa</option>
        {perfis
          .filter((p) => p.id !== 'casa')
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
      </select>
    </Field>
  );

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/60 backdrop-blur-sm" onMouseDown={onClose}>
      <form onSubmit={submit} onMouseDown={(e) => e.stopPropagation()} className="anim-pop w-full max-w-lg space-y-4 rounded-[var(--radius-ui-lg)] border border-ink-700 bg-ink-850 p-6 shadow-[var(--shadow-ui-3)]">
        <div className="flex items-center gap-3">
          <h2 className="text-ui-lg font-semibold">Novo projeto</h2>
          <div className="ml-auto flex rounded-full bg-ink-800 p-0.5 text-ui-xs" role="tablist">
            {(['tarefa', 'manual'] as const).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`rounded-full px-3 py-1 ${mode === m ? 'bg-nc-500 text-white' : 'text-ink-300'}`}>
                {m === 'tarefa' ? 'Colar a tarefa' : 'Manual'}
              </button>
            ))}
          </div>
        </div>
        {mode === 'tarefa' ? (
          <>
            <Field label="Texto da tarefa (como veio do cliente ou da plataforma)">
              <textarea autoFocus value={tarefa} onChange={(e) => setTarefa(e.target.value)} rows={6} placeholder={'Cliente: Thales Rios. YouTube talk head de até 7 min, sobre a procura da felicidade. Não pode faltar: a frase do título. Prazo 15/10.\nMaterial: https://drive.google.com/...'} className="input resize-none" />
            </Field>
            {briefing && (
              <div className="rounded-[var(--radius-ui-md)] bg-ink-800 p-3 text-ui-xs text-ink-300">
                <div className="mb-1 font-semibold text-ink-100">O Gestor entendeu:</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                  <span>Cliente: <b className="text-ink-100">{briefing.cliente ?? '—'}</b></span>
                  <span>Formato: <b className="text-ink-100">{briefing.formato ?? '—'}</b></span>
                  <span>Duração: <b className="text-ink-100">{briefing.duracaoAlvoS ? `${briefing.duracaoAlvoS[0]}–${briefing.duracaoAlvoS[1]} s` : '—'}</b></span>
                  <span>Prazo: <b className="text-ink-100">{briefing.prazo ?? '—'}</b></span>
                  <span className="col-span-2">Tom: <b className="text-ink-100">{briefing.tom ?? '—'}</b></span>
                  {briefing.naoPodeFaltar?.length ? <span className="col-span-2">Não pode faltar: <b className="text-ink-100">{briefing.naoPodeFaltar.join('; ')}</b></span> : null}
                  {briefing.pedidos?.length ? <span className="col-span-2">Pedidos: <b className="text-ink-100">{briefing.pedidos.join('; ')}</b></span> : null}
                  <span className="col-span-2">Material no Drive: <b className="text-ink-100">{briefing.links?.length ? `${briefing.links.length} link(s)` : 'nenhum link (arraste depois)'}</b></span>
                </div>
              </div>
            )}
            <Field label="Nome do projeto (opcional)">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Se vazio, o Gestor dá o nome" className="input" />
            </Field>
            {perfilSelect}
            {formatoSelect}
          </>
        ) : (
          <>
            <Field label="Nome">
              <input autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="Cliente — tema do vídeo" className="input" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cliente">
                <input value={client} onChange={(e) => setClient(e.target.value)} placeholder="Ex.: Thales Rios" className="input" />
              </Field>
              <Field label="Prazo de entrega">
                <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="input" />
              </Field>
            </div>
            {perfilSelect}
            {formatoSelect}
            <Field label="Briefing (o que o cliente pediu)">
              <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={4} placeholder="Formato, duração, tom, o que não pode faltar…" className="input resize-none" />
            </Field>
            <Field label="Material bruto (caminho no disco — opcional, dá pra arrastar depois)">
              <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/Users/…/bruto.mp4" className="input font-mono text-xs" />
            </Field>
          </>
        )}
        {err && <p className="text-ui-xs text-rose-400">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={mode === 'tarefa' ? !tarefa.trim() : !name.trim()}>
            {mode === 'tarefa' ? 'Criar e colocar na fila' : 'Criar e abrir'}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-ink-300">{label}</span>
      {children}
    </label>
  );
}
