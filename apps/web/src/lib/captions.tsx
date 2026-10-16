import { useEffect, useMemo, useRef, useState } from 'react';
import { buildCues, DEFAULT_CAPTIONS, type CaptionEditOp, type Cue, type CueWord } from '@neweditor/core';
import { useEditor } from './store.ts';

/** Todas as legendas do corte atual, inclusive as apagadas (a trilha e a lista mostram e deixam restaurar). */
export function useCaptionCues(): Cue[] {
  const timeline = useEditor((s) => s.project?.timeline);
  const transcripts = useEditor((s) => s.transcripts);
  return useMemo(() => (timeline ? buildCues(timeline, transcripts, { ...(timeline.captions ?? DEFAULT_CAPTIONS), enabled: true }, { includeHidden: true }) : []), [timeline, transcripts]);
}

export const cueText = (c: Cue) => c.words.map((w) => w.text).join(' ');
const at = (w: CueWord | undefined) => (w?.src ? { assetId: w.src.assetId, at: w.src.at } : null);

function send(edits: CaptionEditOp[], note: string) {
  if (edits.length) useEditor.getState().sendOp({ op: { type: 'edit_captions', edits }, note });
}

/**
 * Ações de legenda (o mesmo modelo do editor de legendas do CapCut):
 * texto, dividir no cursor (Enter), juntar com a de cima (Backspace no começo) / de baixo (Delete no fim),
 * apagar/restaurar e voltar ao automático.
 */
export const captionActions = {
  setText(c: Cue, text: string) {
    const id = at(c.words[0]);
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!id || clean === cueText(c)) return;
    // Voltar ao texto automático limpa o ajuste.
    // Voltar ao texto automático (ou apagar tudo) limpa o ajuste — null, que sobrevive ao JSON.
    send([{ ...id, patch: { text: clean === c.original || !clean ? null : clean } }], clean === c.original ? 'Legenda de volta ao texto automático' : `Editou a legenda: "${clean.slice(0, 40)}"`);
  },
  /** Divide antes da palavra `k` (o texto digitado vai junto, repartido nas duas). */
  split(c: Cue, k: number, text?: string) {
    const toks = (text ?? cueText(c)).split(/\s+/).filter(Boolean);
    const target = at(c.words[k]);
    const first = at(c.words[0]);
    if (k <= 0 || k >= c.words.length || !target || !first) return false;
    const edits: CaptionEditOp[] = [{ ...target, patch: { split: true, join: false } }];
    if (c.edited || (text !== undefined && toks.join(' ') !== cueText(c))) {
      edits.push({ ...first, patch: { text: toks.slice(0, k).join(' ') } }, { ...target, patch: { split: true, join: false, text: toks.slice(k).join(' ') } });
    }
    send(edits, 'Dividiu a legenda');
    return true;
  },
  /** Junta `b` (a de baixo) na `a` (a de cima). */
  merge(a: Cue, b: Cue) {
    const fa = at(a.words[0]);
    const fb = at(b.words[0]);
    if (!fa || !fb) return;
    const edits: CaptionEditOp[] = [{ ...fb, patch: { join: true, split: false, text: null, hidden: false } }];
    if (a.edited || b.edited) edits.push({ ...fa, patch: { text: `${cueText(a)} ${cueText(b)}` } });
    send(edits, 'Juntou duas legendas');
  },
  /** Coberta por lettering/motion/B-roll: mostrar mesmo assim (ou voltar a esconder). */
  toggleForce(c: Cue) {
    const id = at(c.words[0]);
    if (id) send([{ ...id, patch: { force: !c.forced } }], c.forced ? 'Legenda volta a se esconder sob a camada' : 'Legenda mostrada mesmo sob a camada');
  },
  toggleHidden(c: Cue) {
    const id = at(c.words[0]);
    if (id) send([{ ...id, patch: { hidden: !c.hidden } }], c.hidden ? 'Restaurou uma legenda' : 'Apagou uma legenda');
  },
  reset(c: Cue) {
    const edits = c.words.map(at).filter((x): x is NonNullable<typeof x> => !!x).map((x) => ({ ...x, patch: null }));
    send(edits, 'Legenda de volta ao automático');
  },
};

/** Caixa de texto de uma legenda com os atalhos do CapCut. */
export function CaptionInput({ cue, cues, autoFocus, onDone, className = '' }: { cue: Cue; cues: Cue[]; autoFocus?: boolean; onDone?: () => void; className?: string }) {
  const [v, setV] = useState(cueText(cue));
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => setV(cueText(cue)), [cue]);
  useEffect(() => {
    // Abriu pelo duplo clique: já vem com o texto selecionado (digitar substitui).
    if (autoFocus) ref.current?.select();
  }, [autoFocus]);
  const i = cues.findIndex((c) => c.key === cue.key);
  const commit = () => {
    if (!done.current) captionActions.setText(cue, v);
    done.current = false;
    onDone?.();
  };
  return (
    <input
      ref={ref}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        const el = e.currentTarget;
        const caret = el.selectionStart ?? 0;
        const collapsed = caret === el.selectionEnd;
        if (e.key === 'Escape') {
          done.current = true;
          setV(cueText(cue));
          el.blur();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          // Enter no meio da frase divide ali (como no CapCut); no fim, só confirma.
          const k = v.slice(0, caret).trim().split(/\s+/).filter(Boolean).length;
          const total = v.trim().split(/\s+/).filter(Boolean).length;
          if (collapsed && k > 0 && k < total) done.current = captionActions.split(cue, k, v);
          el.blur();
        } else if (e.key === 'Backspace' && collapsed && caret === 0 && i > 0) {
          e.preventDefault();
          done.current = true;
          captionActions.merge(cues[i - 1]!, cue);
          el.blur();
        } else if (e.key === 'Delete' && collapsed && caret === v.length && i < cues.length - 1) {
          e.preventDefault();
          done.current = true;
          captionActions.merge(cue, cues[i + 1]!);
          el.blur();
        }
      }}
      className={className}
    />
  );
}

export { parseSrt, srtToEdits, toSrt } from '@neweditor/core';
