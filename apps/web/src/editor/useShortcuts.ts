import { useEffect } from 'react';
import { clipStarts, formatTime, locate, timelineDuration, trackFlag } from '@neweditor/core';
import { api } from '../lib/api.ts';
import { useEditor } from '../lib/store.ts';
import { cutSelection } from '../components/TranscriptPanel.tsx';

/**
 * Atalhos do editor (os do CapCut mais os de edição por texto):
 *  espaço play/pause · J K L · ← → quadro (⇧ 1 s) · ↑ ↓ corte anterior/seguinte · Home/End
 *  ⌘B ou S dividir · Q/W aparar até o cursor · I/O marcas · Delete apaga · N ímã · ⌘A seleciona overlays
 *  ⌘Z/⇧⌘Z · ⌘E exportar · + − zoom · ? atalhos · B (segurar) antes/depois
 */
export function useShortcuts(projectId: string, actions: { onExport: () => void }): void {
  useEffect(() => {
    const typing = (e: KeyboardEvent) => !!(e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]');
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      if ((e.key === 'b' || e.key === 'B') && !e.repeat && !e.metaKey && !e.ctrlKey) useEditor.getState().setShowBefore(true);
    };
    const up = (e: KeyboardEvent) => (e.key === 'b' || e.key === 'B') && useEditor.getState().setShowBefore(false);

    const onKey = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const s = useEditor.getState();
      const tl = s.project?.timeline;
      const fps = tl?.fps || 30;
      const locked = (trackId: string) => !!tl && trackFlag(tl, trackId, 'locked');
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();

      if (e.code === 'Space') {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur();
        s.setPlaying(!s.playing);
      } else if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) void api.redo(projectId);
        else void api.undo(projectId);
      } else if (mod && k === 'e') {
        e.preventDefault();
        actions.onExport();
      } else if (mod && k === 'a') {
        e.preventDefault();
        const ids = tl?.overlays.map((o) => o.id) ?? [];
        s.selectMany([], ids);
      } else if (mod && k === 'b') {
        e.preventDefault();
        if (tl && !locked('V1')) s.sendOp({ op: { type: 'split', time: s.playhead }, note: `Dividiu em ${formatTime(s.playhead)}` });
      } else if (e.key === 'Escape') {
        s.select(null);
        s.selectWords(null);
      } else if (!mod && k === 's') {
        if (tl && !locked('V1')) s.sendOp({ op: { type: 'split', time: s.playhead }, note: `Dividiu em ${formatTime(s.playhead)}` });
      } else if (!mod && (k === 'q' || k === 'w')) {
        // Aparar até o cursor (CapCut): Q tira do começo do clipe até aqui, W daqui até o fim.
        const loc = tl && !locked('V1') ? locate(tl, s.playhead) : null;
        if (!loc) return;
        if (k === 'q' && loc.sourceTime - loc.clip.in > 0.05) {
          s.sendOp({ op: { type: 'trim', clipId: loc.clip.id, in: loc.sourceTime }, note: 'Aparou o começo até o cursor (Q)' });
          s.seek(clipStarts(tl!)[loc.index] ?? s.playhead);
        } else if (k === 'w' && loc.clip.out - loc.sourceTime > 0.05) s.sendOp({ op: { type: 'trim', clipId: loc.clip.id, out: loc.sourceTime }, note: 'Aparou o fim a partir do cursor (W)' });
      } else if (!mod && k === 'j') {
        s.seek(Math.max(0, s.playhead - 3));
        s.setPlaying(true);
      } else if (!mod && k === 'k') s.setPlaying(false);
      else if (!mod && k === 'l') s.setPlaying(true);
      else if (!mod && k === 'i') s.setMarks({ in: s.playhead, out: s.marks.out !== undefined && s.marks.out > s.playhead ? s.marks.out : undefined });
      else if (!mod && k === 'o') s.setMarks({ in: s.marks.in !== undefined && s.marks.in < s.playhead ? s.marks.in : 0, out: s.playhead });
      else if (!mod && k === 'x') s.setMarks({});
      else if (!mod && k === 'n') s.setMagnet(!s.magnet);
      else if (e.key === '?') s.setShortcutsOpen(!s.shortcutsOpen);
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        const { marks } = s;
        if (s.wordSel) void cutSelection(projectId, s.wordSel.assetId, Math.min(s.wordSel.from, s.wordSel.to), Math.max(s.wordSel.from, s.wordSel.to));
        else if (!s.selection && marks.in !== undefined && marks.out !== undefined && marks.out - marks.in > 0.05) {
          if (locked('V1')) return;
          s.sendOp({ op: { type: 'cut_timeline', start: marks.in, end: marks.out, reason: 'intervalo I–O cortado pelo editor' }, note: `Cortou ${formatTime(marks.in)}–${formatTime(marks.out)} (I–O)` });
          s.setMarks({});
          s.seek(marks.in);
        } else if (s.selection?.kind === 'caption') {
          const [assetId, at] = s.selection.id.split('@');
          if (assetId && at) s.sendOp({ op: { type: 'edit_captions', edits: [{ assetId, at: Number(at), patch: { hidden: true } }] }, note: 'Apagou uma legenda' });
          return;
        } else if (s.selection) {
          // Seleção principal + grupo: clipes e overlays, respeitando trilhas travadas.
          const clipIds = [...(s.selection.kind === 'clip' ? [s.selection.id] : []), ...s.multiClips].filter((id) => !locked('V1') && tl?.main.some((c) => c.id === id));
          const ovIds = [...(s.selection.kind === 'overlay' ? [s.selection.id] : []), ...s.multi].filter((id) => {
            const o = tl?.overlays.find((x) => x.id === id);
            return o && !locked(o.trackId);
          });
          const n = clipIds.length + ovIds.length;
          ovIds.forEach((id) => s.sendOp({ op: { type: 'remove_overlay', id }, note: n > 1 ? `Removeu ${n} itens` : 'Removeu um overlay' }));
          clipIds.forEach((id) => s.sendOp({ op: { type: 'delete_clip', clipId: id, reason: 'removido pelo editor' }, note: n > 1 ? `Removeu ${n} itens` : 'Removeu um clipe' }));
        }
        s.select(null);
      } else if (e.key === 'ArrowLeft' || e.key === ',') s.seek(s.playhead - (e.shiftKey ? 1 : 1 / fps));
      else if (e.key === 'ArrowRight' || e.key === '.') s.seek(s.playhead + (e.shiftKey ? 1 : 1 / fps));
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (!tl) return;
        const cuts = [...clipStarts(tl), timelineDuration(tl)];
        const t = e.key === 'ArrowUp' ? [...cuts].reverse().find((c) => c < s.playhead - 0.02) : cuts.find((c) => c > s.playhead + 0.02);
        s.seek(t ?? (e.key === 'ArrowUp' ? 0 : timelineDuration(tl)));
      } else if (e.key === 'Home') s.seek(0);
      else if (e.key === 'End') tl && s.seek(timelineDuration(tl));
      else if (e.key === '=' || e.key === '+') s.setPxPerSec(s.pxPerSec * 1.25);
      else if (e.key === '-') s.setPxPerSec(s.pxPerSec / 1.25);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [projectId, actions]);
}
