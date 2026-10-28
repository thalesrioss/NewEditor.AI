/**
 * Fonte dos scopes (BL-0159 C2): o player avisa aqui cada quadro que desenhou (canvas + área do vídeo, sem o
 * letterbox) e o ColorPanel lê os pixels desse mesmo canvas. Assim o scope mede exatamente o que o player mostra,
 * já com a grade.
 */
export interface ScopeFrame {
  canvas: HTMLCanvasElement;
  /** Área do vídeo no canvas, em pixels do canvas (y para baixo); null = canvas inteiro. */
  rect: { x: number; y: number; w: number; h: number } | null;
  /** Cresce a cada quadro desenhado. */
  version: number;
  /** performance.now() do desenho. */
  at: number;
}

let frame: ScopeFrame | null = null;
let version = 0;

export function publishScopeFrame(canvas: HTMLCanvasElement, rect: ScopeFrame['rect']): void {
  frame = { canvas, rect, version: ++version, at: performance.now() };
}

export function scopeFrame(): ScopeFrame | null {
  return frame && frame.canvas.isConnected ? frame : null;
}
