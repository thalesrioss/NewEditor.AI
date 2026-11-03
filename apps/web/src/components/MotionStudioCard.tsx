/**
 * Motion Studio Brain na aba Motion: em motion manda o Studio (A-08). O produto escreve as ordens de cena
 * (pasta por cena no Cérebro do Editor), o Thales renderiza lá com alpha, e aqui ele importa os renders.
 */
import { useCallback, useEffect, useState } from 'react';
import { Clapperboard, Download, FolderOpen, RefreshCw } from 'lucide-react';
import { api, type StudioStatus } from '../lib/api.ts';
import { useEditor } from '../lib/store.ts';
import { Button } from './ui.tsx';

export function MotionStudioCard() {
  const project = useEditor((s) => s.project);
  const [st, setSt] = useState<StudioStatus | null>(null);
  const [busy, setBusy] = useState<'' | 'ordens' | 'importar'>('');
  const [msg, setMsg] = useState('');
  const load = useCallback(() => {
    if (!project) return;
    api
      .motionStudio(project.id)
      .then(setSt)
      .catch(() => setSt(null));
  }, [project?.id]);
  useEffect(() => void load(), [load]);
  if (!project) return null;
  const novos = st?.cenas.filter((c) => c.novo).length ?? 0;
  const comRender = st?.cenas.filter((c) => c.render).length ?? 0;

  const pedir = async () => {
    setBusy('ordens');
    setMsg('');
    try {
      const r = await api.motionStudioOrdens(project.id);
      setMsg(`${r.cenas} cena(s) pedidas${r.obraAlvo ? ` · obra-alvo sugerida: ${r.obraAlvo}` : ''}`);
      load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  const importar = async () => {
    setBusy('importar');
    setMsg('');
    try {
      const r = await api.motionStudioImport(project.id);
      setMsg(r.importados ? `${r.importados} render(s) importado(s) para a V3` : r.pendentes ? `nenhum render novo (${r.pendentes} cena(s) ainda sem render)` : 'nada para importar — peça as cenas primeiro');
      load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="m-2 rounded-ui-lg border border-orange-400/30 bg-orange-400/5 p-3">
      <div className="flex items-center gap-2 text-ui-sm font-semibold text-white">
        <Clapperboard size={14} className="text-orange-300" /> Motion Studio Brain
        {st && !st.disponivel && <span className="rounded bg-rose-500/15 px-1.5 text-ui-xs text-rose-300">studio não encontrado</span>}
        <button onClick={load} className="ml-auto rounded p-1 text-ink-400 hover:text-white" aria-label="Atualizar" title="Atualizar">
          <RefreshCw size={12} />
        </button>
      </div>
      <p className="mt-1 text-ui-xs text-ink-300">Em motion manda o Studio: o produto escreve as ordens de cena (fala, frames, quadro do bruto, rosto), você renderiza lá com alpha e importa aqui.</p>
      {st && st.cenas.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-ui-xs">
          {st.cenas.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${c.render ? (c.novo ? 'bg-amber-300' : 'bg-emerald-400') : 'bg-ink-500'}`} title={c.render ? (c.novo ? 'render novo, ainda não importado' : 'importado') : 'sem render'} />
              <span className="truncate text-ink-200" title={c.fala}>
                {c.pasta}
              </span>
              <span className="ml-auto shrink-0 font-mono text-ui-xs text-ink-400">{c.frames} f</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Button size="sm" icon={<FolderOpen size={13} />} loading={busy === 'ordens'} onClick={pedir} title="Escreve uma pasta por cena em Cérebro do Editor/montagens/<projeto>/motions/">
          {st?.cenas.length ? 'Refazer as ordens' : 'Pedir cenas ao Studio'}
        </Button>
        <Button size="sm" variant={novos ? 'primary' : 'secondary'} icon={<Download size={13} />} loading={busy === 'importar'} onClick={importar} disabled={!st?.cenas.length}>
          Importar do Motion Studio{novos ? ` (${novos})` : ''}
        </Button>
        {st && st.cenas.length > 0 && (
          <span className="text-ui-xs text-ink-400">
            {comRender}/{st.cenas.length} com render
          </span>
        )}
      </div>
      {st?.dir && <p className="mt-1.5 truncate font-mono text-ui-xs text-ink-500" title={st.dir}>{st.dir}</p>}
      {msg && <p className="mt-1 text-ui-xs text-ink-200">{msg}</p>}
    </section>
  );
}
