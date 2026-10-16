import { useEffect, useMemo, useState } from 'react';
import { BookMarked, X } from 'lucide-react';
import { FORMATOS_PECA, formatoLabel, guessFormato, LETTERING_STYLES, type ClientProfile, type FormatoPeca, type LetteringStyleId, type Project } from '@neweditor/core';
import { api } from '../../lib/api.ts';
import { Button, IconButton } from '../../components/ui.tsx';

/**
 * "Tornar esta edição o padrão editorial de um formato do cliente": mede a edição (zoom, ritmo, lettering,
 * motion, legenda inteira, trilha, cor, B-roll), mostra a prévia e grava como perfil validado do cliente.
 */
export function PadraoEditorialDialog({ project, perfis, onClose, onSaved }: { project: Project; perfis: ClientProfile[]; onClose: () => void; onSaved: (p: ClientProfile) => void }) {
  const [cliente, setCliente] = useState(project.client ?? '');
  const [formato, setFormato] = useState<FormatoPeca>(project.task?.formato ?? guessFormato(project.timeline.width, project.timeline.height));
  const [nome, setNome] = useState('');
  const [aplicar, setAplicar] = useState(true);
  const [preview, setPreview] = useState<ClientProfile | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const clientes = useMemo(() => [...new Set(perfis.flatMap((p) => (p.cliente ? [p.cliente] : p.id !== 'casa' && !p.padraoCasa ? [p.nome.split(' · ')[0]!] : [])))], [perfis]);
  const autoNome = `${cliente.trim() || project.name} · ${formatoLabel(formato)}`;
  const existente = perfis.find((p) => p.cliente && p.formatoPeca === formato && p.cliente.trim().toLowerCase() === cliente.trim().toLowerCase());

  useEffect(() => {
    const t = setTimeout(() => {
      api.perfilDaEdicao(project.id, { cliente: cliente.trim() || undefined, formato, nome: nome.trim() || undefined }).then(setPreview).catch((e: Error) => setErr(e.message));
    }, 200);
    return () => clearTimeout(t);
  }, [project.id, cliente, formato, nome]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const salvar = async () => {
    setBusy(true);
    setErr('');
    try {
      const p = await api.salvarPerfilDaEdicao(project.id, { cliente: cliente.trim() || undefined, formato, nome: nome.trim() || undefined, aplicar });
      onSaved(p);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  const pv = preview;
  const rows: [string, string][] = pv
    ? [
        ['Formato', `${pv.formato.width}×${pv.formato.height} · ${+pv.formato.fps.toFixed(3)} fps`],
        ['Peça', `${pv.peca.duracaoMin}–${pv.peca.duracaoMax} s`],
        ['Ritmo', pv.corte.clipeMedianaS ? `clipe mediano de ${pv.corte.clipeMedianaS} s` : '—'],
        ['Zoom', pv.zoom.porMinuto ? `${pv.zoom.min}–${pv.zoom.max}× · ${pv.zoom.porMinuto}/min` : 'sem zoom'],
        ['Lettering', `${pv.lettering.porMinuto}/min${pv.lettering.estiloId ? ` · ${LETTERING_STYLES[pv.lettering.estiloId as LetteringStyleId]?.label ?? pv.lettering.estiloId}` : ''}${pv.lettering.y !== undefined ? ` · ${Math.round(pv.lettering.y * 100)}%` : ''}`],
        ['Motion', pv.motion.fonte === 'studio' ? 'Motion Studio (cenas com alfa)' : pv.motion.fonte === 'cartoes' ? 'cartões do produto' : '—'],
        ['Flash', pv.flash.usar ? `sim, ${pv.flash.frames} quadros` : 'não'],
        ['Legenda', pv.legenda.ajustes ? `${pv.legenda.estilo} · ${pv.legenda.palavrasMax} palavras · ${Math.round(pv.legenda.y * 100)}% · ${pv.legenda.ajustes.font ?? 'fonte padrão'}${pv.legenda.ajustes.uppercase ? ' · CAIXA ALTA' : ''}` : 'padrão da casa'],
        ['Trilha', pv.trilha.gainDb !== undefined ? `${pv.trilha.gainDb} dB · fade ${pv.trilha.fadeIn}/${pv.trilha.fadeOut} s${pv.trilha.ducking ? ' · ducking' : ''}` : 'padrão da casa'],
        ['Cor', pv.cor.grade ? `${pv.cor.input} + primárias desta edição` : 'padrão da casa'],
        ['B-roll', `até ${pv.broll.maxRepeticao}× · mínimo ${pv.broll.minCoberturaS} s`],
      ]
    : [];

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/60 p-6" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Tornar esta edição o padrão editorial" className="anim-pop w-full max-w-2xl rounded-[var(--radius-ui-lg)] border border-ink-600 bg-ink-850 shadow-[var(--shadow-ui-3)]" onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center gap-2 border-b border-ink-750 px-5 py-3">
          <BookMarked size={16} className="text-nc-300" />
          <h2 className="text-ui-lg font-semibold text-white">Tornar esta edição o padrão editorial</h2>
          <IconButton label="Fechar" className="ml-auto" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </header>
        <div className="grid gap-5 p-5 sm:grid-cols-[1fr_1fr]">
          <div className="space-y-3">
            <p className="text-ui-xs leading-relaxed text-ink-400">O Editor Brain mede o que você fez nesta edição e grava como o padrão do cliente para este formato. Daqui em diante, toda peça desse cliente nesse formato nasce assim.</p>
            <label className="block space-y-1 text-ui-xs text-ink-300">
              Cliente
              <input list="ne-clientes" value={cliente} onChange={(e) => setCliente(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder={project.name} className="input py-1.5 text-ui-sm" />
              <datalist id="ne-clientes">
                {clientes.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
            <label className="block space-y-1 text-ui-xs text-ink-300">
              Formato
              <select value={formato} onChange={(e) => setFormato(e.target.value as FormatoPeca)} className="input py-1.5 text-ui-sm">
                {FORMATOS_PECA.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label} · {f.width}×{f.height}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-ui-xs text-ink-300">
              Nome do padrão
              <input value={nome} onChange={(e) => setNome(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder={autoNome} className="input py-1.5 text-ui-sm" />
            </label>
            <label className="flex items-center gap-2 text-ui-xs text-ink-200">
              <input type="checkbox" checked={aplicar} onChange={(e) => setAplicar(e.target.checked)} className="h-4 w-4 accent-nc-500" />
              Usar este padrão neste projeto também
            </label>
            {existente && <p className="rounded-[var(--radius-ui-md)] border border-amber-400/30 bg-amber-400/10 px-2.5 py-1.5 text-ui-xs text-amber-200">Já existe "{existente.nome}" para {cliente.trim()} · {formatoLabel(formato)}. Gravar substitui as medições e mantém o que você marcou à mão em Perfis.</p>}
            {err && <p className="text-ui-xs text-rose-300">{err}</p>}
          </div>
          <div className="rounded-[var(--radius-ui-md)] border border-ink-750 bg-ink-800/50 p-3">
            <div className="mb-2 text-ui-2xs font-semibold tracking-wide text-ink-400 uppercase">O que foi medido nesta edição</div>
            {pv ? (
              <dl className="space-y-1">
                {rows.map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-3 text-ui-xs">
                    <dt className="shrink-0 text-ink-400">{k}</dt>
                    <dd className="text-right text-ink-100">{v}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-ui-xs text-ink-400">medindo…</p>
            )}
          </div>
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-ink-750 px-5 py-3">
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={busy} disabled={!pv} icon={<BookMarked size={13} />} onClick={salvar}>
            Gravar como padrão editorial
          </Button>
        </footer>
      </div>
    </div>
  );
}
