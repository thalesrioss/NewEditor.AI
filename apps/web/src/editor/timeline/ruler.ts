/** Passo da régua em função do zoom: no zoom alto, marcas por quadro; no baixo, por minuto. */
export function rulerStep(pps: number, fps: number): { major: number; minor: number; frames: boolean } {
  const frame = 1 / (fps || 30);
  const cands = [frame, 2 * frame, 5 * frame, 10 * frame, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200];
  const major = cands.find((s) => s * pps >= 84) ?? 1800;
  const frames = major < 0.5;
  const minor = frames ? (major === frame ? 0 : frame) : major / 5;
  return { major, minor, frames };
}
