import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeftToLine, ArrowRightToLine, LocateFixed, Magnet, Maximize2, MessageSquarePlus, Redo2, Scissors, Trash2, Type, Undo2, ZoomIn, ZoomOut } from 'lucide-react';
import { anchorAt, clipDuration, clipStarts, editorialWarnings, formatTime, locate, timelineDuration, trackFlag } from '@neweditor/core';
import { api } from '../../lib/api.ts';
import { useEditor } from '../../lib/store.ts';
import { Avatar, AVATAR_ANCHOR_X } from '../../components/Avatar.tsx';
import { IconButton } from '../../components/ui.tsx';
import { ROLE_STYLE, ROW, openRightTab, timecode } from '../shared.ts';
import { AgentMarks } from './AgentMarks.tsx';
import { CaptionHeader, CaptionLane, ClipBlock, OverlayTrack, TrackHeader, WaveBlock } from './blocks.tsx';
import { openMenu } from './ContextMenu.tsx';
import { rulerStep } from './ruler.ts';
import { SourceLane } from './SourceLane.tsx';

const PAD = 16;
const HEADER_W = 104;
const MIN_PPS = 0.3;
const MAX_PPS = 600;

/**
 * Timeline (CapCut): barra de ferramentas, cabeçalhos de trilha, régua com quadros, cursor arrastável,
 * laço de seleção, ímã com linha-guia, zoom com ⌘+roda, menu de contexto e o avatar andando pelos cortes.
 * Trilhas: LG (legenda) · V3 (lettering/motion) · V2 (B-roll) · V1 (fala) · A1 (áudio da fala) · A2 (SFX) · A3 (trilha).
 */
export function Timeline() {
  const project = useEditor((s) => s.project);
  const history = useEditor((s) => s.history);
  const pps = useEditor((s) => s.pxPerSec);
  const setPps = useEditor((s) => s.setPxPerSec);
  const playhead = useEditor((s) => s.playhead);
  const playing = useEditor((s) => s.playing);
  const follow = useEditor((s) => s.follow);
  const setFollow = useEditor((s) => s.setFollow);
  const seekReq = useEditor((s) => s.seekReq);
  const activity = useEditor((s) => s.activity);
  const selection = useEditor((s) => s.selection);
  const multi = useEditor((s) => s.multi);
  const multiClips = useEditor((s) => s.multiClips);
  const marks = useEditor((s) => s.marks);
  const magnet = useEditor((s) => s.magnet);
  const guide = useEditor((s) => s.guide);
  const setMagnet = useEditor((s) => s.setMagnet);
  const select = useEditor((s) => s.select);
  const seek = useEditor((s) => s.seek);
  const sendOp = useEditor((s) => s.sendOp);
  const lastOp = useEditor((s) => s.lastOp);

  const scroller = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(800);
  const manualZoom = useRef(false);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [hoverT, setHoverT] = useState<number | null>(null);

  const timeline = project?.timeline;
  const fps = timeline?.fps || 30;
  const total = timeline ? timelineDuration(timeline) : 0;
  const starts = useMemo(() => (timeline ? clipStarts(timeline) : []), [timeline]);
  const width = Math.max(viewW, total * pps + PAD * 2 + Math.max(200, viewW * 0.4));
  const assets = useMemo(() => new Map((project?.assets ?? []).map((a) => [a.id, a])), [project?.assets]);
  const warnings = useMemo(() => (timeline ? editorialWarnings(timeline, (id) => assets.get(id)?.name ?? id) : []), [timeline, assets]);
  const badOverlays = useMemo(() => new Set(warnings.filter((w) => w.level === 'erro').flatMap((w) => w.overlayIds)), [warnings]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Encaixa sozinho (inclusive quando a janela muda) até o editor mexer no zoom à mão.
  const fitPps = () => Math.min(MAX_PPS, Math.max(MIN_PPS, (viewW - PAD * 2 - 48) / Math.max(0.5, total)));
  const fit = () => {
    if (total > 0) setPps(fitPps());
    manualZoom.current = false;
  };
  useEffect(() => {
    if (!manualZoom.current && total > 0 && viewW > 100) setPps(fitPps());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total > 0, viewW]);

  /** Zoom em volta de um ponto da tela (⌘+roda, botões): o instante sob o mouse fica parado. */
  const zoomAround = (factor: number, clientX?: number) => {
    const el = scroller.current;
    const next = Math.min(MAX_PPS, Math.max(MIN_PPS, pps * factor));
    if (el) {
      const rect = el.getBoundingClientRect();
      const cx = clientX !== undefined ? clientX - rect.left : rect.width / 2;
      const t = (cx + el.scrollLeft - PAD) / pps;
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, t * next + PAD - cx);
      });
    }
    manualZoom.current = true;
    setPps(next);
  };
  const zoomRef = useRef(zoomAround);
  zoomRef.current = zoomAround;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomRef.current(Math.exp(-e.deltaY * 0.01), e.clientX);
      } else if (e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Acompanha o cursor no play (pagina quando ele sai da tela) e traz para a tela quando alguém pula.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !playing || !follow) return;
    const x = PAD + playhead * pps;
    if (x > el.scrollLeft + el.clientWidth - 24 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - el.clientWidth * 0.1);
  }, [playhead, playing, follow, pps]);
  useEffect(() => {
    const el = scroller.current;
    if (!el || !seekReq) return;
    const x = PAD + seekReq.t * pps;
    if (x > el.scrollLeft + el.clientWidth - 12 || x < el.scrollLeft + 12) el.scrollTo({ left: Math.max(0, x - el.clientWidth / 2), behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekReq]);

  // Avatar: anda por cima dos clipes até onde o agente trabalha; parado, acompanha o cursor.
  const working = activity.state !== 'idle' && activity.at !== undefined;
  const avatarX = PAD + (working ? activity.at! : playhead) * pps;
  const [walk, setWalk] = useState<{ moving: boolean; facing: 1 | -1 }>({ moving: false, facing: 1 });
  const lastX = useRef(avatarX);
  useEffect(() => {
    const dx = avatarX - lastX.current;
    lastX.current = avatarX;
    if (Math.abs(dx) < 0.5) return;
    setWalk({ moving: true, facing: dx > 0 ? 1 : -1 });
    const t = setTimeout(() => setWalk((w) => ({ ...w, moving: false })), working ? 480 : 160);
    return () => clearTimeout(t);
  }, [avatarX, working]);
  useEffect(() => {
    const el = scroller.current;
    if (!el || !working) return;
    if (avatarX < el.scrollLeft + 40 || avatarX > el.scrollLeft + el.clientWidth - 120) el.scrollTo({ left: avatarX - el.clientWidth / 3, behavior: 'smooth' });
  }, [avatarX, working]);

  // Flash onde o agente acabou de cortar.
  const [flash, setFlash] = useState<{ x: number; key: number } | null>(null);
  useEffect(() => {
    if (!lastOp || lastOp.envelope.by !== 'agent' || activity.at === undefined) return;
    setFlash({ x: PAD + activity.at * pps, key: lastOp.at });
    const t = setTimeout(() => setFlash(null), 650);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastOp]);

  const timeAt = (clientX: number) => {
    const el = scroller.current!;
    return Math.max(0, Math.min(total, (clientX - el.getBoundingClientRect().left + el.scrollLeft - PAD) / pps));
  };
  const snapFrame = (t: number) => Math.round(t * fps) / fps;
  const scrubStart = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    seek(snapFrame(timeAt(e.clientX)));
    const move = (ev: MouseEvent) => seek(snapFrame(timeAt(ev.clientX)));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  /** Clique no vazio: move o cursor; arraste: laço que seleciona clipes e camadas. */
  const laneDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (!target.dataset.lane) return;
    e.preventDefault();
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    const rect = (b: { x0: number; y0: number; x1: number; y1: number }) => ({ l: Math.min(b.x0, b.x1), r: Math.max(b.x0, b.x1), t: Math.min(b.y0, b.y1), b: Math.max(b.y0, b.y1) });
    let last = { x0, y0, x1: x0, y1: y0 };
    const move = (ev: MouseEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      moved = true;
      last = { x0, y0, x1: ev.clientX, y1: ev.clientY };
      setBox(last);
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setBox(null);
      if (!moved) {
        select(null);
        seek(snapFrame(timeAt(ev.clientX)));
        return;
      }
      const r = rect(last);
      const hits = (sel: string, attr: string) =>
        [...(scroller.current?.querySelectorAll<HTMLElement>(sel) ?? [])]
          .filter((el) => {
            const b = el.getBoundingClientRect();
            return b.left < r.r && b.right > r.l && b.top < r.b && b.bottom > r.t;
          })
          .map((el) => el.dataset[attr]!);
      useEditor.getState().selectMany(hits('[data-clip-id]', 'clipId'), hits('[data-overlay-id]', 'overlayId'));
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const laneMenu = (e: React.MouseEvent) => {
    if (!(e.target as HTMLElement).dataset.lane || !timeline) return;
    const at = snapFrame(timeAt(e.clientX));
    openMenu(e, [
      { label: 'Lettering aqui', icon: <Type size={13} />, disabled: !total, onClick: () => addLettering(at) },
      { label: 'Dividir a fala aqui', shortcut: '⌘B', icon: <Scissors size={13} />, disabled: !total || trackFlag(timeline, 'V1', 'locked'), onClick: () => sendOp({ op: { type: 'split', time: at }, note: `Dividiu em ${formatTime(at)}` }) },
      'sep',
      {
        label: 'Pedir ao agente aqui…',
        icon: <MessageSquarePlus size={13} />,
        onClick: () => {
          seek(at);
          useEditor.getState().askAgent(`Em ${formatTime(at, true)}: `);
          openRightTab('agente');
        },
      },
    ]);
  };

  const selClip = selection?.kind === 'clip' ? timeline?.main.find((c) => c.id === selection.id) : undefined;
  const selOverlay = selection?.kind === 'overlay' ? timeline?.overlays.find((o) => o.id === selection.id) : undefined;
  const nSel = (selection ? 1 : 0) + multi.length + multiClips.length;

  const addLettering = (at = playhead) => {
    if (!timeline) return;
    const text = window.prompt('Texto do lettering (palavra-chave entre *asteriscos*)');
    const anchor = anchorAt(timeline, at);
    if (text?.trim() && anchor) sendOp({ op: { type: 'add_overlay', item: { trackId: 'V3', role: 'lettering', anchor, duration: 2.5, source: { type: 'text', text: text.trim() } } }, note: `Lettering "${text.trim()}"` });
  };
  const trimToCursor = (side: 'in' | 'out') => {
    if (!timeline || trackFlag(timeline, 'V1', 'locked')) return;
    const loc = locate(timeline, playhead);
    if (!loc) return;
    if (side === 'in' && loc.sourceTime - loc.clip.in > 0.05) {
      sendOp({ op: { type: 'trim', clipId: loc.clip.id, in: loc.sourceTime }, note: 'Aparou o começo até o cursor (Q)' });
      seek(starts[loc.index] ?? playhead);
    } else if (side === 'out' && loc.clip.out - loc.sourceTime > 0.05) sendOp({ op: { type: 'trim', clipId: loc.clip.id, out: loc.sourceTime }, note: 'Aparou o fim a partir do cursor (W)' });
  };
  const deleteSelected = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));

  const tracksById = new Map((timeline?.tracks ?? []).map((t) => [t.id, t]));
  const overlaysOn = (trackId: string) => (timeline?.overlays ?? []).filter((o) => o.trackId === trackId);
  const fala = project?.assets.find((a) => a.role === 'fala') ?? project?.assets[0];
  const v1Locked = !!timeline && trackFlag(timeline, 'V1', 'locked');

  return (
    <div className="flex h-full min-h-0 flex-col bg-ink-850 select-none">
      {/* Barra de ferramentas (CapCut) */}
      <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-ink-750 px-2">
        <IconButton label={history.canUndo ? `Desfazer: ${history.undoLabel}` : 'Nada para desfazer'} shortcut="⌘Z" disabled={!history.canUndo} onClick={() => project && void api.undo(project.id)}>
          <Undo2 size={15} />
        </IconButton>
        <IconButton label={history.canRedo ? `Refazer: ${history.redoLabel}` : 'Nada para refazer'} shortcut="⇧⌘Z" disabled={!history.canRedo} onClick={() => project && void api.redo(project.id)}>
          <Redo2 size={15} />
        </IconButton>
        <Sep />
        <IconButton label="Dividir no cursor" shortcut="⌘B" disabled={!total || v1Locked} onClick={() => sendOp({ op: { type: 'split', time: playhead }, note: `Dividiu em ${formatTime(playhead)}` })}>
          <Scissors size={15} />
        </IconButton>
        <IconButton label="Aparar o começo até o cursor" shortcut="Q" disabled={!total || v1Locked} onClick={() => trimToCursor('in')}>
          <ArrowLeftToLine size={15} />
        </IconButton>
        <IconButton label="Aparar o fim a partir do cursor" shortcut="W" disabled={!total || v1Locked} onClick={() => trimToCursor('out')}>
          <ArrowRightToLine size={15} />
        </IconButton>
        <IconButton label={nSel > 1 ? `Apagar ${nSel} itens` : 'Apagar selecionado'} shortcut="Delete" disabled={!selection} onClick={deleteSelected}>
          <Trash2 size={15} />
        </IconButton>
        <IconButton label="Lettering no cursor" disabled={!total} onClick={() => addLettering()}>
          <Type size={15} />
        </IconButton>
        <Sep />
        <IconButton label={magnet ? 'Ímã ligado: encaixa no cursor, clipes e palavras' : 'Ímã desligado'} shortcut="N" active={magnet} onClick={() => setMagnet(!magnet)}>
          <Magnet size={15} />
        </IconButton>
        <IconButton label={follow ? 'A timeline acompanha o cursor no play' : 'A timeline fica parada no play'} active={follow} onClick={() => setFollow(!follow)}>
          <LocateFixed size={15} />
        </IconButton>
        <Sep />
        <span className="font-mono text-ui-xs tabular-nums text-ink-400">
          <span className="text-ink-100">{timecode(playhead, fps)}</span> <span className="text-ink-600">/</span> {timecode(total, fps)}
        </span>
        {marks.in !== undefined && marks.out !== undefined && marks.out > marks.in && (
          <span className="ml-2 flex items-center gap-1 rounded-full bg-nc-500/15 px-2 py-0.5 text-ui-2xs whitespace-nowrap text-nc-300" title="Delete corta o intervalo; X limpa as marcas">
            I–O {formatTime(marks.in, true)}–{formatTime(marks.out, true)} · Delete corta
          </span>
        )}
        {nSel > 1 && <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-ui-2xs text-ink-100">{nSel} selecionados</span>}
        {selOverlay && nSel === 1 && (
          <span className="ml-2 flex items-center gap-1 text-ui-2xs text-ink-400">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: ROLE_STYLE[selOverlay.role].solid }} /> {ROLE_STYLE[selOverlay.role].label}
          </span>
        )}
        {selClip && nSel === 1 && <span className="ml-2 text-ui-2xs text-ink-400">clipe {timeline!.main.indexOf(selClip) + 1} · {clipDuration(selClip).toFixed(2)} s</span>}
        {warnings.length > 0 && (
          <span className="ml-2 flex items-center gap-1 rounded-full bg-amber-400/10 px-2 py-0.5 text-ui-2xs text-amber-300" title={warnings.map((w) => `• ${w.message}`).join('\n')}>
            <AlertTriangle size={12} /> {warnings.length} {warnings.length === 1 ? 'alerta' : 'alertas'}
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton label="Diminuir zoom" shortcut="−" onClick={() => zoomAround(1 / 1.4)}>
            <ZoomOut size={15} />
          </IconButton>
          <input aria-label="Zoom da timeline" type="range" min={Math.log(MIN_PPS)} max={Math.log(MAX_PPS)} step={0.01} value={Math.log(pps)} onChange={(e) => (manualZoom.current = true, setPps(Math.exp(+e.target.value)))} className="w-24 accent-nc-500" />
          <IconButton label="Aumentar zoom" shortcut="+" onClick={() => zoomAround(1.4)}>
            <ZoomIn size={15} />
          </IconButton>
          <IconButton label="Encaixar tudo na tela" onClick={fit}>
            <Maximize2 size={14} />
          </IconButton>
        </div>
      </div>

      {/* Rolagem vertical única: cabeçalhos e trilhas andam juntos em qualquer altura. */}
      <div className="scroll-thin flex min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="sticky left-0 z-40 shrink-0 self-start border-r border-ink-750 bg-ink-850" style={{ width: HEADER_W }}>
          <div className="border-b border-ink-750" style={{ height: ROW.ruler + ROW.marks }} />
          <CaptionHeader />
          {(['V3', 'V2'] as const).map((id) => (
            <TrackHeader key={id} id={id} name={tracksById.get(id)?.name ?? ''} h={ROW[id]} kind="video" />
          ))}
          <TrackHeader id="V1" name="Fala" h={ROW.V1} strong kind="main" />
          <TrackHeader id="A1" name="Áudio da fala" h={ROW.A1} kind="audio" />
          {(['A2', 'A3'] as const).map((id) => (
            <TrackHeader key={id} id={id} name={tracksById.get(id)?.name ?? ''} h={ROW[id]} kind="audio" />
          ))}
        </div>

        <div ref={scroller} className="scroll-thin relative flex-1 self-start overflow-x-auto overflow-y-hidden">
          <div className="relative" style={{ width }} onMouseDown={laneDown} onContextMenu={laneMenu}>
            <Ruler pps={pps} width={width} fps={fps} onMouseDown={scrubStart} onHover={setHoverT} />
            <AgentMarks pps={pps} pad={PAD} />
            <CaptionLane pps={pps} pad={PAD} selectedKey={selection?.kind === 'caption' ? selection.id : undefined} />
            {(['V3', 'V2'] as const).map((id) => (
              <OverlayTrack key={id} track={tracksById.get(id)} h={ROW[id]} items={overlaysOn(id)} pps={pps} pad={PAD} timeAt={timeAt} selectedId={selOverlay?.id} bad={badOverlays} assets={assets} />
            ))}

            {/* V1 — fala */}
            <div data-lane="V1" className="relative border-y border-ink-700/60 bg-ink-900/40" style={{ height: ROW.V1, marginLeft: PAD }}>
              {timeline?.main.map((c, i) => (
                <ClipBlock key={c.id} clip={c} index={i} x={starts[i]! * pps} w={clipDuration(c) * pps} pps={pps} selected={c.id === selClip?.id} asset={assets.get(c.assetId)} />
              ))}
              {!timeline?.main.length && <div className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-ui-xs text-ink-500">A fala entra aqui depois da decupagem.</div>}
              {!!timeline?.main.length && (
                <div className="pointer-events-none absolute bottom-full z-40 transition-[left] ease-linear" style={{ left: avatarX - PAD - AVATAR_ANCHOR_X - (working ? 0 : 10), transitionDuration: working ? '450ms' : '0ms' }}>
                  <Avatar state={activity.state} scale={1} moving={walk.moving} facing={walk.facing} thought={!activity.message} wave={activity.state === 'idle' && (project?.status === 'revisao' || project?.status === 'editado')} />
                  {activity.message && activity.state !== 'idle' ? (
                    <SpeechBubble text={activity.message} progress={activity.progress} />
                  ) : project?.status === 'revisao' || project?.status === 'editado' ? (
                    <SpeechBubble text={project.status === 'revisao' ? 'Sua vez! Revise a decupagem 👀' : 'Pronto! Confira e exporte ✨'} />
                  ) : null}
                </div>
              )}
            </div>

            {/* A1 — áudio da fala */}
            <div data-lane="A1" className={`relative bg-ink-900/20 ${timeline && trackFlag(timeline, 'A1', 'muted') ? 'hatch opacity-40' : ''}`} style={{ height: ROW.A1, marginLeft: PAD }}>
              {timeline?.main.map((c, i) => (
                <WaveBlock key={c.id} clip={c} x={starts[i]! * pps} w={clipDuration(c) * pps} />
              ))}
            </div>
            {(['A2', 'A3'] as const).map((id) => (
              <OverlayTrack key={id} track={tracksById.get(id)} h={ROW[id]} items={overlaysOn(id)} pps={pps} pad={PAD} timeAt={timeAt} selectedId={selOverlay?.id} bad={badOverlays} assets={assets} />
            ))}

            {flash && <div key={flash.key} className="pointer-events-none absolute bottom-0 z-10 w-[3px] -translate-x-1/2 rounded bg-cut-retake shadow-[0_0_12px_var(--color-cut-retake)]" style={{ left: flash.x, top: 0, animation: 'dots 650ms ease-out' }} />}
            {marks.in !== undefined && <div className="pointer-events-none absolute bottom-0 z-[5] border-x border-nc-400/70 bg-nc-500/10" style={{ left: PAD + marks.in * pps, width: Math.max(1, ((marks.out ?? marks.in) - marks.in) * pps), top: 0 }} />}
            {guide !== null && <div className="pointer-events-none absolute bottom-0 z-[35] w-px border-l border-dashed border-amber-300" style={{ left: PAD + guide * pps, top: 0 }} />}
            {hoverT !== null && !playing && (
              <div className="pointer-events-none absolute z-[36] -translate-x-1/2 rounded bg-ink-700 px-1 font-mono text-ui-2xs text-ink-100" style={{ left: PAD + hoverT * pps, top: 2 }}>
                {timecode(hoverT, fps, false)}
              </div>
            )}

            {/* Cursor (CapCut): linha fina com a cabeça na régua, arrastável */}
            <div className="pointer-events-none absolute bottom-0 z-[var(--z-cursor)] w-px bg-white" style={{ left: PAD + playhead * pps, top: 0 }}>
              <div className="pointer-events-auto absolute -top-px -left-[7px] h-[14px] w-[15px] cursor-ew-resize rounded-b-[3px] rounded-t-[2px] bg-white shadow-[0_0_6px_rgb(255_255_255/0.5)]" onMouseDown={scrubStart} title="Arraste o cursor" />
            </div>
          </div>
        </div>
      </div>

      {box && (
        <div className="pointer-events-none fixed z-[var(--z-popover)] border border-nc-300 bg-nc-500/15" style={{ left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }} />
      )}

      {fala && timeline && <SourceLane asset={fala} clips={timeline.main} removals={timeline.removals} headerW={HEADER_W} />}
    </div>
  );
}

function Sep() {
  return <div className="mx-1.5 h-4 w-px bg-ink-700" />;
}

function Ruler({ pps, width, fps, onMouseDown, onHover }: { pps: number; width: number; fps: number; onMouseDown: (e: React.MouseEvent) => void; onHover: (t: number | null) => void }) {
  const { major, minor, frames } = rulerStep(pps, fps);
  const ticks: React.ReactNode[] = [];
  const n = Math.ceil((width - PAD) / (major * pps));
  for (let i = 0; i <= n; i++) {
    const t = i * major;
    ticks.push(
      <div key={t} className="absolute top-0 h-full border-l border-ink-600" style={{ left: PAD + t * pps }}>
        <span className="ml-1 font-mono text-ui-2xs text-ink-400">{frames ? timecode(t, fps, false) : formatTime(t)}</span>
      </div>,
    );
    if (minor > 0) for (let k = minor; k < major - 1e-6; k += minor) ticks.push(<div key={`${t}-${k}`} className="absolute bottom-0 h-1.5 border-l border-ink-700" style={{ left: PAD + (t + k) * pps }} />);
  }
  return (
    <div
      className="relative cursor-ew-resize border-b border-ink-750 bg-ink-900/70"
      style={{ height: ROW.ruler }}
      onMouseDown={onMouseDown}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onHover(Math.max(0, (e.clientX - r.left - PAD) / pps));
      }}
      onMouseLeave={() => onHover(null)}
    >
      {ticks}
    </div>
  );
}

function SpeechBubble({ text, progress }: { text: string; progress?: number }) {
  return (
    <div className="anim-pop absolute bottom-[60px] left-6 w-max max-w-[300px] rounded-xl rounded-bl-sm border border-ink-600 bg-ink-800/95 px-2.5 py-1 text-ui-xs leading-snug text-ink-100 shadow-xl backdrop-blur">
      <div className="line-clamp-2">{text}</div>
      {progress !== undefined && (
        <div className="mt-1 h-0.5 overflow-hidden rounded bg-ink-700">
          <div className="h-full nc-gradient transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
    </div>
  );
}
