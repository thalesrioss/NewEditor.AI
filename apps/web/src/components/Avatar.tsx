/**
 * O editor da NewContent: pixel art estilo Habbo, de moletom azul com a logo no peito e fone (referência do
 * Thales no canvas). A folha de sprites sai de design/avatar/sprites.mjs → public/avatar/editor.png.
 *
 * Fileiras da folha (célula 32×64): 0 andando · 1 andando com tesoura · 2 andando com pincel ·
 * 3 parado | sentado · 4 cortando parado (2) | pintando parado (2).
 *
 * Cada estado do agente vira uma pose: anda com a tesoura até onde vai cortar, com o pincel até onde vai fazer
 * motion, senta na borda do clipe olhando para os lados quando pensa, ouve o material de fone e pula quando termina.
 */
import { useEffect, useState } from 'react';
import type { AgentState } from '@neweditor/core';

const SHEET = '/avatar/editor.png';
const CW = 32;
const CH = 64;
const SHEET_W = CW * 6;
const SHEET_H = CH * 5;
/** Centro do corpo dentro da célula (as ferramentas ficam à frente, à direita). */
export const AVATAR_ANCHOR_X = 13;
/** Na pose sentada, do assento até o pé da célula: as pernas ficam penduradas abaixo da borda. */
const SEAT = 7;
/** Linha do topo da cabeça na pose sentada (dentro da célula). */
const SIT_HEAD = 15;

interface Pose {
  row: number;
  frames: number[];
  fps: number;
}

function poseOf(state: AgentState, moving: boolean): Pose {
  const walk = [0, 1, 2, 3, 4, 5];
  if (moving) return { row: state === 'cutting' ? 1 : state === 'motion' ? 2 : 0, frames: walk, fps: 10 };
  if (state === 'cutting') return { row: 4, frames: [0, 1], fps: 5 };
  if (state === 'motion') return { row: 4, frames: [2, 3], fps: 3 };
  if (state === 'thinking') return { row: 3, frames: [1], fps: 0 };
  return { row: 3, frames: [0], fps: 0 };
}

function useFrame(n: number, fps: number): number {
  const [i, setI] = useState(0);
  useEffect(() => {
    setI(0);
    if (n <= 1 || !fps) return;
    const t = setInterval(() => setI((v) => (v + 1) % n), 1000 / fps);
    return () => clearInterval(t);
  }, [n, fps]);
  return i % Math.max(1, n);
}

function sprite(row: number, frame: number, scale: number): React.CSSProperties {
  return {
    width: CW * scale,
    height: CH * scale,
    backgroundImage: `url(${SHEET})`,
    backgroundSize: `${SHEET_W * scale}px ${SHEET_H * scale}px`,
    backgroundPosition: `${-frame * CW * scale}px ${-row * CH * scale}px`,
    imageRendering: 'pixelated',
  };
}

/**
 * Corpo inteiro. A caixa tem 32×64 × `scale`; os pés ficam na base (sentado, o ASSENTO fica na base).
 * `facing` -1 vira para a esquerda (espelha no centro do corpo, então ele não "pula" de lugar).
 */
export function Avatar({ state, scale = 2, moving = false, facing = 1, thought = true, wave = false }: { state: AgentState; scale?: number; moving?: boolean; facing?: 1 | -1; thought?: boolean; wave?: boolean }) {
  const pose = poseOf(state, moving);
  const frame = pose.frames[useFrame(pose.frames.length, pose.fps)]!;
  const sitting = !moving && state === 'thinking';
  const body = moving ? '' : state === 'celebrating' ? 'anim-jump' : state === 'idle' || state === 'analyzing' ? 'anim-bob' : '';
  const origin = `${AVATAR_ANCHOR_X * scale}px 100%`;

  return (
    <div className="relative" style={{ width: CW * scale, height: CH * scale }}>
      {!sitting && <div className="absolute bottom-0 h-[3px] rounded-[50%] bg-black/40" style={{ left: (AVATAR_ANCHOR_X - 7) * scale, width: 14 * scale }} />}
      <div className={body} style={{ transformOrigin: 'bottom' }}>
        <div style={{ transform: facing < 0 ? 'scaleX(-1)' : undefined, transformOrigin: origin }}>
          <div className={sitting ? 'anim-look-flip' : ''} style={{ ...sprite(pose.row, frame, scale), transformOrigin: origin, translate: sitting ? `0 ${SEAT * scale}px` : undefined }} />
        </div>
      </div>
      {wave && !moving && !sitting && <WaveHand scale={scale} facing={facing} />}
      {sitting && thought && <ThoughtBubble style={{ top: (SEAT + SIT_HEAD - 7) * scale - 10, left: (AVATAR_ANCHOR_X + 4) * scale }} />}
      {state === 'celebrating' && <Confetti />}
      {state === 'analyzing' && <SoundWaves />}
    </div>
  );
}

/** Retrato (cabeça e ombros) para o cabeçalho do painel do agente. */
export function AvatarBust({ state, size = 48 }: { state: AgentState; size?: number }) {
  const scale = 2;
  return (
    <div className="relative overflow-hidden" style={{ width: size, height: size }}>
      <div className={state === 'celebrating' ? 'anim-jump' : 'anim-bob'} style={{ transformOrigin: 'bottom', position: 'absolute', left: size / 2 - AVATAR_ANCHOR_X * scale, top: -6 * scale }}>
        <div style={sprite(3, 0, scale)} />
      </div>
    </div>
  );
}

function ThoughtBubble({ style }: { style: React.CSSProperties }) {
  return (
    <div style={style} className="absolute flex items-center gap-1 rounded-full border border-ink-600 bg-ink-800 px-2 py-1 shadow-ui-1">
      {[0, 1, 2].map((i) => (
        <span key={i} className="block h-1.5 w-1.5 rounded-full bg-nc-300" style={{ animation: `dots 1.2s ${i * 0.2}s infinite` }} />
      ))}
    </div>
  );
}

function SoundWaves() {
  return (
    <div className="absolute top-[18%] -right-3 flex h-4 items-center gap-[2px]">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="block h-full w-[3px] rounded-full bg-cyan-nc" style={{ animation: `wave 0.8s ${i * 0.12}s ease-in-out infinite` }} />
      ))}
    </div>
  );
}

const CONFETTI = ['#1f5cff', '#00b4ff', '#feca57', '#ff6b6b', '#ffffff', '#8fb0ff'];
function Confetti() {
  return (
    <div className="pointer-events-none absolute left-[40%] top-2">
      {Array.from({ length: 14 }, (_, i) => {
        const ang = (i / 14) * Math.PI * 2;
        const dist = 34 + (i % 3) * 12;
        return (
          <span
            key={i}
            className="absolute block h-1.5 w-1"
            style={{
              background: CONFETTI[i % CONFETTI.length],
              ['--dx' as string]: `${Math.cos(ang) * dist}px`,
              ['--dy' as string]: `${Math.sin(ang) * dist - 10}px`,
              animation: `confetti 0.9s ${(i % 4) * 0.08}s ease-out infinite`,
            }}
          />
        );
      })}
    </div>
  );
}

/** Aceno de "sua vez": uma mão (pixel art da mesma paleta) balançando ao lado do ombro. */
function WaveHand({ scale, facing }: { scale: number; facing: 1 | -1 }) {
  const px = (x: number, y: number, c: string) => <span key={`${x}-${y}`} className="absolute" style={{ left: x * scale, top: y * scale, width: scale, height: scale, background: c }} />;
  const S = '#ba7f54';
  const D = '#784a36';
  const B = '#2f5f9c';
  const cells = [
    [1, 0, S], [2, 0, S], [0, 1, S], [1, 1, S], [2, 1, S], [3, 1, S], [1, 2, S], [2, 2, D], [1, 3, B], [2, 3, B],
  ] as [number, number, string][];
  return (
    <div className="anim-wave absolute" style={{ left: (AVATAR_ANCHOR_X + (facing > 0 ? 7 : -11)) * scale, top: 24 * scale, width: 4 * scale, height: 4 * scale, transformOrigin: `${2 * scale}px ${4 * scale}px` }} aria-hidden>
      {cells.map(([x, y, c]) => px(x, y, c))}
    </div>
  );
}
