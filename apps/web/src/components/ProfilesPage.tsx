/**
 * Perfis de edição por cliente (#/perfis) — o Cérebro do Editor virando dado que o agente executa.
 * Importa dos `PADRAO - *.md`, mostra o que foi medido (com o nível de evidência) e deixa o Thales revisar.
 * Embaixo: o Cérebro (LLM local com portão) e os gabaritos do benchmark.
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BrainCircuit, Download, Plus, RefreshCw, Save } from 'lucide-react';
import { formatoLabel, type ClientProfile, type Evidence } from '@neweditor/core';
import { api, type LlmSettings } from '../lib/api.ts';
import { Button, RangeField } from './ui.tsx';

const EV_STYLE: Record<Evidence, string> = {
  MEDIDO: 'bg-emerald-400/15 text-emerald-300',
  DERIVADO: 'bg-sky-400/15 text-sky-300',
  PREFERENCIA: 'bg-violet-400/15 text-violet-300',
  OFICIO: 'bg-ink-700 text-ink-300',
  HIPOTESE: 'bg-amber-400/15 text-amber-300',
  PADRAO: 'bg-ink-700 text-ink-400',
};

export function ProfilesPage() {
  const [list, setList] = useState<ClientProfile[]>([]);
  const [sel, setSel] = useState<string>('casa');
  const [draft, setDraft] = useState<ClientProfile | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => api.perfis().then(setList).catch((e: Error) => setMsg(e.message));
  useEffect(() => void load(), []);
  const cur = useMemo(() => list.find((p) => p.id === sel) ?? list[0], [list, sel]);
  useEffect(() => setDraft(cur ? structuredClone(cur) : null), [cur]);
  const dirty = !!draft && !!cur && JSON.stringify(draft) !== JSON.stringify(cur);

  const importar = async () => {
    setBusy(true);
    try {
      const r = await api.importPerfis();
      setMsg(`${r.importados.length} perfil(is) importado(s), ${r.atualizados.length} atualizado(s) de ${r.origem}`);
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    }
    setBusy(false);
  };
  const salvar = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const saved = await api.patchPerfil(draft.id, draft);
      setList((l) => l.map((p) => (p.id === saved.id ? saved : p)));
      setMsg(`Perfil "${saved.nome}" salvo.`);
    } catch (e) {
      setMsg((e as Error).message);
    }
    setBusy(false);
  };
  const novo = async () => {
    const nome = window.prompt('Nome do cliente');
    if (!nome?.trim()) return;
    const p = await api.createPerfil(nome.trim(), sel);
    await load();
    setSel(p.id);
  };
  const set = <K extends keyof ClientProfile>(k: K, patch: Partial<ClientProfile[K]>) => setDraft((d) => (d ? { ...d, [k]: { ...(d[k] as object), ...patch } } : d));
  const ev = (k: string) => draft?.evidencia?.[k];

  return (
    <div className="flex h-full flex-col">
      <header className="ne-titlebar flex items-center gap-3 border-b border-ink-750 px-6 py-3">
        <a href="#/" className="rounded-[var(--radius-ui-md)] p-1.5 text-ink-300 hover:bg-ink-800 hover:text-white" aria-label="Voltar ao Kanban">
          <ArrowLeft size={18} />
        </a>
        <div>
          <div className="text-ui-lg font-semibold">Perfis de edição</div>
          <div className="text-ui-xs text-ink-400">O que o Cérebro do Editor sabe de cada cliente, em dado que o agente executa</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" icon={<Download size={13} />} loading={busy} onClick={importar}>
            Importar do Cérebro
          </Button>
          <Button size="sm" icon={<Plus size={13} />} onClick={novo}>
            Novo perfil
          </Button>
        </div>
      </header>
      {msg && <p className="border-b border-ink-750 bg-ink-850 px-6 py-1.5 text-ui-xs text-emerald-300/90">{msg}</p>}
      <div className="flex min-h-0 flex-1">
        <aside className="w-64 shrink-0 overflow-y-auto border-r border-ink-750 bg-ink-850 p-2">
          {list.map((p) => (
            <button key={p.id} onClick={() => setSel(p.id)} className={`block w-full rounded-[var(--radius-ui-md)] px-3 py-2 text-left ${p.id === cur?.id ? 'bg-nc-500/15 text-white' : 'text-ink-300 hover:bg-ink-800'}`}>
              <div className="flex items-center gap-1.5 text-ui-sm font-medium">
                {p.nome}
                {p.padraoCasa && <span className="rounded bg-emerald-400/15 px-1 text-ui-2xs font-semibold text-emerald-300">padrão da casa</span>}
                {p.validado === false && <span className="rounded bg-amber-400/15 px-1 text-ui-2xs font-semibold text-amber-300">teste</span>}
                {p.formatoPeca && <span className="rounded bg-nc-500/15 px-1 text-ui-2xs font-semibold text-nc-300">{formatoLabel(p.formatoPeca)}</span>}
              </div>
              <div className="text-ui-2xs text-ink-400">
                {p.formato.width}×{p.formato.height} · {p.formato.fps} fps{p.fonte ? ' · do vault' : p.origem ? ' · lido de uma edição' : ''}
              </div>
            </button>
          ))}
          <div className="mt-4 border-t border-ink-750 pt-3">
            <BrainCard />
          </div>
        </aside>
        {draft && (
          <main className="scroll-thin min-w-0 flex-1 overflow-y-auto p-6">
            <div className="mx-auto max-w-3xl space-y-6">
              <div className="flex items-center gap-3">
                <input value={draft.nome} onChange={(e) => setDraft({ ...draft, nome: e.target.value })} className="input max-w-sm text-ui-lg font-semibold" aria-label="Nome do perfil" />
                <Button variant="primary" size="sm" icon={<Save size={13} />} disabled={!dirty} loading={busy} onClick={salvar}>
                  Salvar
                </Button>
                {draft.fonte && <span className="truncate text-ui-2xs text-ink-400" title={draft.fonte}>Fonte: {draft.fonte.split('/').pop()}</span>}
                {draft.origem && (
                  <a href={`#/p/${draft.origem.projectId}`} className="truncate text-ui-2xs text-nc-300 hover:underline" title="Abrir a edição de onde este padrão foi lido">
                    Padrão editorial{draft.formatoPeca ? ` · ${formatoLabel(draft.formatoPeca)}` : ''} lido de "{draft.origem.projectName}" em {new Date(draft.origem.at).toLocaleDateString('pt-BR')}
                  </a>
                )}
              </div>
              <div className={`flex flex-wrap items-center gap-3 rounded-[var(--radius-ui-md)] border p-3 text-ui-xs ${draft.padraoCasa ? 'border-emerald-500/30 bg-emerald-500/5' : draft.validado === false ? 'border-amber-400/30 bg-amber-400/5' : 'border-ink-750 bg-ink-850'}`}>
                <label className="flex items-center gap-2 text-ink-200">
                  <input type="checkbox" checked={!!draft.validado} onChange={(e) => setDraft({ ...draft, validado: e.target.checked, nota: e.target.checked ? undefined : draft.nota })} className="h-4 w-4 accent-nc-500" />
                  Padrão validado (referência de sucesso)
                </label>
                {!draft.validado && <span className="text-amber-200">{draft.nota ?? 'Teste — o agente não assume este perfil sozinho.'}</span>}
                {draft.padraoCasa ? (
                  <span className="ml-auto font-semibold text-emerald-300">Este é o padrão da casa: vale para todo projeto sem perfil escolhido.</span>
                ) : (
                  <Button
                    size="sm"
                    className="ml-auto"
                    disabled={draft.id === 'casa'}
                    onClick={async () => {
                      const saved = await api.setHousePerfil(draft.id);
                      setList((l) => l.map((p) => (p.id === saved.id ? saved : { ...p, padraoCasa: false })));
                      setMsg(`"${saved.nome}" agora é o padrão da casa.`);
                    }}
                  >
                    Usar como padrão da casa
                  </Button>
                )}
              </div>

              <Section title="Formato e peça" ev={ev('formato')}>
                <div className="grid grid-cols-3 gap-3">
                  <Num label="Largura" value={draft.formato.width} onChange={(v) => set('formato', { width: v })} />
                  <Num label="Altura" value={draft.formato.height} onChange={(v) => set('formato', { height: v })} />
                  <Num label="fps" value={draft.formato.fps} step={0.001} onChange={(v) => set('formato', { fps: v })} />
                  <Num label="Duração mín. (s)" value={draft.peca.duracaoMin} onChange={(v) => set('peca', { duracaoMin: v })} />
                  <Num label="Duração máx. (s)" value={draft.peca.duracaoMax} onChange={(v) => set('peca', { duracaoMax: v })} />
                </div>
              </Section>

              <Section title="Corte" ev={ev('corte.folgas') ?? ev('corte.clipeMedianaS')}>
                <RangeField label="Folga antes do trecho" value={draft.corte.headPad} min={0} max={0.3} step={0.01} unit="s" onCommit={(v) => set('corte', { headPad: v })} />
                <RangeField label="Folga depois do trecho" value={draft.corte.tailPad} min={0} max={0.4} step={0.01} unit="s" onCommit={(v) => set('corte', { tailPad: v })} />
                <RangeField label="Pausa máxima que fica" value={draft.corte.maxPause} min={0.1} max={1} step={0.05} unit="s" onCommit={(v) => set('corte', { maxPause: v })} hint="Calibradas pelo benchmark (bench:all --tune) a partir dos cortes que você aprova." />
                <div className="grid grid-cols-2 gap-3">
                  <Num label="Mediana do clipe (s)" value={draft.corte.clipeMedianaS ?? 0} step={0.1} onChange={(v) => set('corte', { clipeMedianaS: v || undefined })} />
                  <Select label="Transição" value={draft.corte.transicao} options={[['seca', 'Corte seco'], ['smooth-cut', 'Smooth cut onde o jump cut apareceria']]} onChange={(v) => set('corte', { transicao: v as ClientProfile['corte']['transicao'] })} />
                </div>
              </Section>

              <Section title="Zoom" ev={ev('zoom')}>
                <div className="grid grid-cols-3 gap-3">
                  <Num label="Mínimo" value={draft.zoom.min} step={0.01} onChange={(v) => set('zoom', { min: v })} />
                  <Num label="Máximo" value={draft.zoom.max} step={0.01} onChange={(v) => set('zoom', { max: v })} />
                  <Num label="Por minuto" value={draft.zoom.porMinuto} step={0.5} onChange={(v) => set('zoom', { porMinuto: v })} />
                </div>
              </Section>

              <Section title="Lettering" ev={ev('lettering.maxLinhas') ?? ev('lettering.posicao')}>
                <div className="grid grid-cols-3 gap-3">
                  <Num label="Máx. de linhas" value={draft.lettering.maxLinhas} onChange={(v) => set('lettering', { maxLinhas: v })} />
                  <Num label="Por minuto" value={draft.lettering.porMinuto} onChange={(v) => set('lettering', { porMinuto: v })} />
                  <Num label="Teto de SFX por 3 s" value={draft.lettering.sfxTetoPor3s} onChange={(v) => set('lettering', { sfxTetoPor3s: v })} />
                  <Select label="Posição" value={draft.lettering.posicao} options={[['legenda', 'No lugar da legenda'], ['abaixo-do-queixo', 'Logo abaixo do queixo']]} onChange={(v) => set('lettering', { posicao: v as ClientProfile['lettering']['posicao'] })} />
                  <Select label="Caixa" value={draft.lettering.caixa} options={[['livre', 'Livre'], ['baixa', 'Baixa'], ['alta', 'Alta']]} onChange={(v) => set('lettering', { caixa: v as ClientProfile['lettering']['caixa'] })} />
                </div>
                <div className="flex flex-wrap gap-4">
                  <Check label="Texto sempre literal da fala" on={draft.lettering.literal} onChange={(v) => set('lettering', { literal: v })} />
                  <Check label="Último lettering é citação centralizada" on={draft.lettering.ultimoCitacao} onChange={(v) => set('lettering', { ultimoCitacao: v })} />
                </div>
              </Section>

              <Section title="Motion e flash" ev={ev('motion.nuncaSeco') ?? ev('flash')}>
                <div className="flex flex-wrap gap-4">
                  <Check label="Nada entra seco (SFX + entrada animada)" on={draft.motion.nuncaSeco} onChange={(v) => set('motion', { nuncaSeco: v })} />
                  <Check label="Usar flash" on={draft.flash.usar} onChange={(v) => set('flash', { usar: v })} />
                  <Check label="SFX com o pico no frame do evento" on={draft.sfx.picoNoEvento} onChange={(v) => set('sfx', { picoNoEvento: v })} />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <Num label="Máx. do mesmo motion" value={draft.motion.maxPorModelo} onChange={(v) => set('motion', { maxPorModelo: v })} />
                  <Num label="Flash (quadros)" value={draft.flash.frames} onChange={(v) => set('flash', { frames: v })} />
                  <Text label="SFX do flash" value={draft.flash.sfx ?? ''} onChange={(v) => set('flash', { sfx: v || undefined })} />
                </div>
                {draft.motion.identidade && (
                  <details className="rounded-[var(--radius-ui-md)] bg-ink-800 p-3 text-ui-xs text-ink-300">
                    <summary className="cursor-pointer font-semibold text-ink-200">Identidade do motion (lida do padrão)</summary>
                    <pre className="mt-2 whitespace-pre-wrap font-sans">{draft.motion.identidade}</pre>
                  </details>
                )}
              </Section>

              <Section title="Legenda, trilha e cor" ev={ev('legenda') ?? ev('trilha.lufsSobVoz') ?? ev('cor.lut')}>
                <div className="grid grid-cols-3 gap-3">
                  <Num label="Palavras mín." value={draft.legenda.palavrasMin} onChange={(v) => set('legenda', { palavrasMin: v })} />
                  <Num label="Palavras máx." value={draft.legenda.palavrasMax} onChange={(v) => set('legenda', { palavrasMax: v })} />
                  <Num label="Altura (0 topo – 1 base)" value={draft.legenda.y} step={0.01} onChange={(v) => set('legenda', { y: v })} />
                  <Num label="Trilha sob a voz (LUFS)" value={draft.trilha.lufsSobVoz} onChange={(v) => set('trilha', { lufsSobVoz: v })} />
                  <Num label="Fade in (s)" value={draft.trilha.fadeIn} step={0.25} onChange={(v) => set('trilha', { fadeIn: v })} />
                  <Num label="Fade out (s)" value={draft.trilha.fadeOut} step={0.25} onChange={(v) => set('trilha', { fadeOut: v })} />
                  <Text label="LUT de referência" value={draft.cor.lut ?? ''} onChange={(v) => set('cor', { lut: v || undefined })} />
                </div>
                <div className="flex flex-wrap gap-4">
                  <Check label="Conferir números da legenda contra a fala" on={draft.legenda.conferirNumeros} onChange={(v) => set('legenda', { conferirNumeros: v })} />
                  <Check label="Trilha abaixa quando fala (ducking)" on={draft.trilha.ducking} onChange={(v) => set('trilha', { ducking: v })} />
                </div>
              </Section>

              <Section title="B-roll" ev={ev('broll.coberturaFraseInteira') ?? ev('broll.voltaSemAr')}>
                <div className="grid grid-cols-3 gap-3">
                  <Num label="Máx. de repetições" value={draft.broll.maxRepeticao} onChange={(v) => set('broll', { maxRepeticao: v })} />
                  <Num label="Volta sem ar (s)" value={draft.broll.voltaSemAr} step={0.05} onChange={(v) => set('broll', { voltaSemAr: v })} />
                  <Num label="Cobertura mínima (s)" value={draft.broll.minCoberturaS} step={0.5} onChange={(v) => set('broll', { minCoberturaS: v })} />
                </div>
                <Check label="Cobertura cobre a frase inteira (do corte ao fim dela)" on={draft.broll.coberturaFraseInteira} onChange={(v) => set('broll', { coberturaFraseInteira: v })} />
              </Section>

              {draft.notas.length > 0 && (
                <Section title={`Regras do padrão que ainda não viraram campo (${draft.notas.length})`}>
                  <ul className="list-disc space-y-1 pl-4 text-ui-xs leading-snug text-ink-300">
                    {draft.notas.map((n, i) => (
                      <li key={i} dangerouslySetInnerHTML={{ __html: n.replace(/\*\*([^*]+)\*\*/g, '<b class="text-ink-100">$1</b>').replace(/`([^`]+)`/g, '<code class="text-nc-300">$1</code>') }} />
                    ))}
                  </ul>
                </Section>
              )}
            </div>
          </main>
        )}
      </div>
    </div>
  );
}

function Section({ title, ev, children }: { title: string; ev?: Evidence; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-[var(--radius-ui-lg)] border border-ink-750 bg-ink-850 p-4">
      <h3 className="flex items-center gap-2 text-ui-xs font-semibold tracking-wide text-ink-300 uppercase">
        {title}
        {ev && <span className={`rounded px-1.5 py-px text-ui-2xs font-semibold normal-case ${EV_STYLE[ev]}`}>{ev}</span>}
      </h3>
      {children}
    </section>
  );
}
function Num({ label, value, step = 1, onChange }: { label: string; value: number; step?: number; onChange: (v: number) => void }) {
  return (
    <label className="block space-y-1 text-ui-xs text-ink-300">
      {label}
      <input type="number" value={value} step={step} onChange={(e) => onChange(Number(e.target.value))} className="input py-1 font-mono text-ui-sm" />
    </label>
  );
}
function Text({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block space-y-1 text-ui-xs text-ink-300">
      {label}
      <input value={value} onChange={(e) => onChange(e.target.value)} className="input py-1 text-ui-sm" />
    </label>
  );
}
function Select({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <label className="block space-y-1 text-ui-xs text-ink-300">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input py-1 text-ui-sm">
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
function Check({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-ui-xs text-ink-300">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-nc-500" /> {label}
    </label>
  );
}

/** O Cérebro: LLM local com portão (só liga o que ganhou no benchmark) e os gabaritos acumulados. */
function BrainCard() {
  const [llm, setLlm] = useState<(LlmSettings & { baixado: boolean }) | null>(null);
  const [bench, setBench] = useState<{ name: string; label: string; savedAt: string }[]>([]);
  const load = () => {
    api.llm().then(setLlm).catch(() => undefined);
    api.benchmark().then((b) => setBench(b.gabaritos)).catch(() => undefined);
  };
  useEffect(load, []);
  const patch = async (p: Partial<LlmSettings>) => {
    if (!llm) return;
    const next = await api.setLlm({ ...p, usos: { ...llm.usos, ...(p.usos ?? {}) } });
    setLlm({ ...next, baixado: llm.baixado });
  };
  if (!llm) return null;
  return (
    <div className="space-y-2 px-1 text-ui-xs">
      <div className="flex items-center gap-1.5 font-semibold text-ink-200">
        <BrainCircuit size={13} className="text-nc-300" /> Cérebro local
      </div>
      <label className="flex items-center justify-between text-ink-300">
        LLM no Mac (MLX)
        <input type="checkbox" checked={llm.enabled} disabled={!llm.baixado} onChange={(e) => void patch({ enabled: e.target.checked })} className="h-4 w-4 accent-nc-500" />
      </label>
      <div className="text-ui-2xs text-ink-400">{llm.baixado ? `${llm.model.split('/').pop()} · baixado` : 'modelo ainda não baixado'}</div>
      {llm.enabled && (
        <div className="space-y-1 rounded-[var(--radius-ui-md)] bg-ink-800 p-2">
          {(
            [
              ['briefing', 'Briefing do Gestor'],
              ['comando', 'Pedidos em texto livre'],
              ['broll', 'Buscas do Cinéfilo'],
              ['palavraChave', 'Palavra-chave do lettering'],
              ['tomada', 'Melhor tomada'],
            ] as [keyof LlmSettings['usos'], string][]
          ).map(([k, l]) => (
            <label key={k} className="flex items-center justify-between text-ink-300">
              {l}
              <input type="checkbox" checked={llm.usos[k]} onChange={(e) => void patch({ usos: { ...llm.usos, [k]: e.target.checked } })} className="h-3.5 w-3.5 accent-nc-500" />
            </label>
          ))}
          <p className="text-ui-2xs text-ink-400">Cada uso só fica ligado se ganhar das regras no benchmark.</p>
        </div>
      )}
      <div className="flex items-center justify-between pt-1 font-semibold text-ink-200">
        Benchmark <button onClick={load} aria-label="Atualizar" className="text-ink-400 hover:text-white"><RefreshCw size={11} /></button>
      </div>
      {bench.length === 0 ? <p className="text-ui-2xs text-ink-400">Nenhum gabarito ainda. Cada decupagem que você aprova vira um.</p> : bench.map((g, i) => <div key={i} className="truncate text-ui-2xs text-ink-400" title={g.name}>{g.label === 'aprovado' ? '✓' : '★'} {g.name}</div>)}
    </div>
  );
}
