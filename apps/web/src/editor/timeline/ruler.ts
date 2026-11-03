/**
 * Passo da régua em função do zoom: no zoom alto, marcas por quadro; no baixo, por minuto.
 *
 * O timecode conta em base `round(fps)` (non-drop), então em 29,97 e 23,976 o "segundo" do timecode dura
 * `round(fps)/fps` s de relógio (1,001 s). As marcas maiores andam nesse segundo de timecode para cair sempre
 * em segundo cheio (a de 1 min mostra 00:01:00:00, e não 00:00:59:28).
 */
export function rulerStep(pps: number, fps: number): { major: number; minor: number; frames: boolean } {
  const f = fps || 30;
  const frame = 1 / f;
  const tcSec = Math.max(1, Math.round(f)) / f;
  const cands = [frame, 2 * frame, 5 * frame, 10 * frame, ...[0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200].map((s) => s * tcSec)];
  const major = cands.find((s) => s * pps >= 84) ?? 1800 * tcSec;
  const frames = major < 0.5 * tcSec - 1e-9;
  const minor = frames ? (major === frame ? 0 : frame) : major / 5;
  return { major, minor, frames };
}
