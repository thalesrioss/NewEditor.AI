/**
 * Gera a folha de sprites do avatar (apps/web/public/avatar/editor.png) a partir da referência do Thales
 * (referencia-editor.png: pixel art estilo Habbo, moletom azul e fone, numa grade de 6 px).
 *
 *   node design/avatar/sprites.mjs
 *
 * 1. Acha os 6 quadros de caminhada (primeira fileira da referência).
 * 2. Lê cada célula da grade de 6 px (mediana do miolo) e tira o fundo preto ligado à borda.
 * 3. Reduz a paleta (k-means) e aviva os azuis do moletom (azul da marca).
 * 4. Corrige a perna de trás que some na sombra (quadros 3 e 4) e carimba a logo da NewContent no peito.
 * 5. Monta as fileiras: andando, andando com tesoura, andando com pincel, parado + sentado, parado cortando/pintando.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const here = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.join(here, 'referencia-editor.png');
const OUT = path.resolve(here, '../../apps/web/public/avatar/editor.png');

// --- 1. Imagem crua -----------------------------------------------------------------------------
const [W, H] = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', SRC]).toString().trim().split(',').map(Number);
const px = execFileSync('ffmpeg', ['-v', 'error', '-i', SRC, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 });
const at = (x, y) => {
  const i = (y * W + x) * 3;
  return [px[i], px[i + 1], px[i + 2]];
};
const P = 6;

// Caixas dos quadros da primeira fileira (componentes conexos do que não é fundo).
function boxes() {
  const on = (x, y) => Math.max(...at(x, y)) > 22;
  const seen = new Uint8Array(W * H);
  const out = [];
  for (let y = 0; y < H / 3; y++)
    for (let x = 0; x < W; x++) {
      if (seen[y * W + x] || !on(x, y)) continue;
      let x0 = x, x1 = x, y0 = y, y1 = y, n = 0;
      const st = [[x, y]];
      seen[y * W + x] = 1;
      while (st.length) {
        const [cx, cy] = st.pop();
        n++;
        x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[ny * W + nx] || !on(nx, ny)) continue;
          seen[ny * W + nx] = 1;
          st.push([nx, ny]);
        }
      }
      if (n > 15000) out.push({ x0, y0, x1, y1 });
    }
  return out.sort((a, b) => a.x0 - b.x0);
}

/** Deslocamento da grade de 6 px dentro da caixa (onde as bordas de cor mais coincidem). */
function gridOffset(b, axis) {
  const len = axis === 'x' ? b.x1 - b.x0 : b.y1 - b.y0;
  const e = new Float64Array(len);
  for (let y = b.y0; y < b.y1; y++)
    for (let x = b.x0; x < b.x1; x++) {
      const [a0, a1, a2] = at(x, y);
      const [c0, c1, c2] = axis === 'x' ? at(x + 1, y) : at(x, y + 1);
      e[axis === 'x' ? x - b.x0 : y - b.y0] += Math.abs(a0 - c0) + Math.abs(a1 - c1) + Math.abs(a2 - c2);
    }
  let best = 0, score = -1;
  for (let o = 0; o < P; o += 0.25) {
    let s = 0;
    for (let k = o; k < len; k += P) s += e[Math.round(k)] ?? 0;
    if (s > score) (score = s), (best = o);
  }
  return best;
}

// --- 2. Células -----------------------------------------------------------------------------------
const med = (a) => a.sort((p, q) => p - q)[a.length >> 1];
const TH = 12;
const frames = boxes().map((b) => {
  const gx0 = b.x0 + gridOffset(b, 'x') - P * 2, gy0 = b.y0 + gridOffset(b, 'y') - P * 2;
  const cols = Math.ceil((b.x1 - gx0) / P) + 2, rows = Math.ceil((b.y1 - gy0) / P) + 2;
  const cells = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const cx = gx0 + c * P, cy = gy0 + r * P;
      const R = [], G = [], B = [];
      for (let y = Math.round(cy + 1.5); y < cy + P - 1.5; y++)
        for (let x = Math.round(cx + 1.5); x < cx + P - 1.5; x++) {
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const [rr, gg, bb] = at(x, y);
          R.push(rr); G.push(gg); B.push(bb);
        }
      row.push(R.length ? [med(R), med(G), med(B)] : [0, 0, 0]);
    }
    cells.push(row);
  }
  const dark = (v) => Math.max(...v) < TH;
  const bg = cells.map((row) => row.map(() => false));
  const st = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if ((r === 0 || c === 0 || r === rows - 1 || c === cols - 1) && dark(cells[r][c])) (bg[r][c] = true), st.push([r, c]);
  while (st.length) {
    const [r, c] = st.pop();
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= rows || nc >= cols || bg[nr][nc] || !dark(cells[nr][nc])) continue;
      bg[nr][nc] = true;
      st.push([nr, nc]);
    }
  }
  // Sujeira solta na borda (borrão do fundo).
  for (let pass = 0; pass < 2; pass++)
    for (let r = 1; r < rows - 1; r++)
      for (let c = 1; c < cols - 1; c++) {
        if (bg[r][c]) continue;
        const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dr, dc]) => !bg[r + dr][c + dc]).length;
        if (nb <= 1 && Math.max(...cells[r][c]) < 60) bg[r][c] = true;
      }
  return { cells, bg };
});
if (frames.length !== 6) throw new Error(`esperava 6 quadros de caminhada, achei ${frames.length}`);

// --- 3. Paleta ------------------------------------------------------------------------------------
const all = [];
for (const f of frames) f.cells.forEach((row, r) => row.forEach((v, c) => !f.bg[r][c] && all.push(v)));
const K = 20;
let pal = Array.from({ length: K }, (_, i) => all[Math.floor(((i + 0.5) * all.length) / K)].slice());
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const nearest = (v, list = pal) => {
  let bi = 0, bd = Infinity;
  list.forEach((c, i) => {
    const d = d2(v, c);
    if (d < bd) (bd = d), (bi = i);
  });
  return bi;
};
for (let it = 0; it < 30; it++) {
  const sum = pal.map(() => [0, 0, 0, 0]);
  for (const v of all) {
    const s = sum[nearest(v)];
    s[0] += v[0]; s[1] += v[1]; s[2] += v[2]; s[3]++;
  }
  pal = sum.map((s, i) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : pal[i]));
}
pal = pal.map((c) => c.map(Math.round));
// Azuis do moletom mais vivos (puxa para o azul da marca, sem mudar o desenho).
const vivid = pal.map(([r, g, b]) => {
  if (!(b > r + 25 && b > g)) return [r, g, b];
  const m = (r + g + b) / 3;
  const k = 1.3;
  return [r, g, b].map((v, i) => Math.max(0, Math.min(255, Math.round((m + (v - m) * k) * (i === 2 ? 1.12 : 1.04)))));
});

// Grades recortadas na silhueta (índice da paleta; -1 = transparente).
let grids = frames.map((f) => {
  let r0 = Infinity, r1 = -1, c0 = Infinity, c1 = -1;
  f.bg.forEach((row, r) => row.forEach((b, c) => !b && ((r0 = Math.min(r0, r)), (r1 = Math.max(r1, r)), (c0 = Math.min(c0, c)), (c1 = Math.max(c1, c)))));
  const g = [];
  for (let r = r0; r <= r1; r++) {
    const row = [];
    for (let c = c0; c <= c1; c++) row.push(f.bg[r][c] ? -1 : nearest(f.cells[r][c]));
    g.push(row);
  }
  return g;
});

// --- 4. Correções -----------------------------------------------------------------------------------
const PANTS = nearest([0x2a, 0x31, 0x43]);
const paint = (g, col, r0, r1, color) => {
  for (let r = r0; r <= r1; r++) if (g[r]) g[r][col] = color;
};
// Perna de trás levantada (some na sombra da referência): liga o pé solto ao quadril.
paint(grids[2], 6, 42, 48, PANTS);
paint(grids[2], 5, 42, 43, PANTS);
paint(grids[3], 6, 42, 45, PANTS);
paint(grids[3], 7, 46, 50, PANTS);

// Cores extras (logo, ferramentas) entram no fim da paleta.
const EXTRA = { W: [0xff, 0xff, 0xff], C: [0x00, 0xb4, 0xff], B: [0xf2, 0xf5, 0xfa], R: [0xff, 0x4d, 0x6d], K: [0x14, 0x10, 0x0c], G: [0xb8, 0xc0, 0xcc], D: [0x4a, 0x2e, 0x1a] };
const colors = [...vivid];
const idx = {};
for (const [k, v] of Object.entries(EXTRA)) idx[k] = colors.push(v) - 1;
const stamp = (g, art, x, y) =>
  art.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      if (ch === '.') return;
      const yy = y + r, xx = x + c;
      if (yy < 0 || yy >= g.length) return;
      while (xx >= g[yy].length) g[yy].push(-1);
      if (xx >= 0) g[yy][xx] = idx[ch];
    }),
  );

// Logo da NewContent (play + ponto) no peito, ao lado do cordão do moletom.
const LIGHT = [nearest([0xc8, 0xd4, 0xd8]), nearest([0x9c, 0xb3, 0xbc])];
const LOGO = ['W.C', 'WW.', 'W..'];
for (const g of grids) {
  let pos = null;
  for (let r = 18; r < 34 && !pos; r++) for (let c = 0; c < g[r].length; c++) if (LIGHT.includes(g[r][c])) (pos = [r, c]), (c = 99);
  if (pos) stamp(g, LOGO, pos[1] - 4, pos[0] + 2);
}

// --- 5. Montagem -----------------------------------------------------------------------------------
const clone = (g) => g.map((r) => r.slice());
const blue = new Set(vivid.map((c, i) => (c[2] > c[0] + 25 && c[2] > c[1] ? i : -1)).filter((i) => i >= 0));
const center = (g) => {
  let s = 0, n = 0;
  g.forEach((row) => row.forEach((p, c) => blue.has(p) && ((s += c), n++)));
  return n ? s / n : g[0].length / 2;
};

const SKIN = [nearest([0xba, 0x7f, 0x54]), nearest([0x94, 0x60, 0x45]), nearest([0x78, 0x4a, 0x36])];
/** Mão da frente: o pixel de pele mais à direita na altura das mãos, do lado da frente do corpo. */
const hand = (g) => {
  const front = center(g) + 3;
  let best = null;
  for (let r = 28; r < Math.min(g.length, 44); r++) for (let c = Math.ceil(front); c < g[r].length; c++) if (SKIN.includes(g[r][c]) && (!best || c >= best[1])) best = [r, c];
  return best ?? [36, Math.round(front) + 3];
};
const SCISSORS_OPEN = ['B...B', 'B...B', '.B.B.', '..K..', '.R.R.', 'R.R.R', 'RR.RR'];
const SCISSORS_SHUT = ['.BB..', '.BB..', '.BB..', '..K..', '.R.R.', 'R.R.R', 'RR.RR'];
const BRUSH = ['.CC.', 'CCCC', 'CCCC', 'GGGG', '.GG.', '.DD.', '.DD.', '.DD.', '.DD.', '.DD.'];

const CW = 32, CH = 64, AX = 13; // célula, e onde fica o centro do moletom
const walk = grids;
const scissors = grids.map((g, i) => {
  const h = clone(g);
  const [r, c] = hand(g);
  stamp(h, i % 2 ? SCISSORS_SHUT : SCISSORS_OPEN, c - 1, r - 5);
  return h;
});
const brush = grids.map((g, i) => {
  const h = clone(g);
  const [r, c] = hand(g);
  stamp(h, BRUSH, c - 1, r - 8 + (i % 2));
  return h;
});

// Parado: o quadro de pernas juntas. Sentado: tronco dele + pernas penduradas (senta na borda do clipe).
const idle = grids[4];
const pantsRows = idle.map((row) => row.filter((p) => p === PANTS || p === nearest([0x3d, 0x4b, 0x54])).length);
const hip = pantsRows.findIndex((n, r) => r > 30 && n >= 4);
const top = clone(idle.slice(0, hip + 1));
const xs = top[hip].map((p, c) => (p >= 0 ? c : -1)).filter((c) => c >= 0);
const L0 = Math.min(...xs) + 1, L1 = Math.max(...xs) - 1;
const MID = nearest([0x3d, 0x4b, 0x54]), DARK = nearest([0x10, 0x13, 0x1f]), SOLE = nearest([0xc8, 0xd4, 0xd8]), SHOE = nearest([0x58, 0x64, 0x72]);
// Sentado na borda do clipe, de 3/4: coxas para a frente (direita), canelas penduradas, tênis para a frente.
const SIT = [
  'PPPPPPPPPPPPPP..',
  'PMMMMMMMMMMMMMP.',
  'PMMMMMMMMMMMMMMP',
  '.PPPPPPPPPMMMMMP',
  '........PKKPMMMP',
  '........PKKPMMMP',
  '........PKKPMMMP',
  '........PKKPMMMP',
  '.......SSSSSSSSSS',
  '.......OOOOOOOOOO',
];
const sit = top;
for (const line of SIT) {
  const row = Array(Math.max(top[0].length, L0 + line.length)).fill(-1);
  [...line].forEach((ch, i) => {
    if (ch === '.') return;
    row[L0 - 1 + i] = { P: PANTS, M: MID, K: DARK, S: SHOE, O: SOLE }[ch];
  });
  sit.push(row);
}
const SEAT = hip + 4; // linha do assento (embaixo das coxas) no quadro sentado

// Parado no ponto de trabalho: tesoura abrindo/fechando e pincel pintando.
const [hr, hc] = hand(idle);
const idleCut = [SCISSORS_OPEN, SCISSORS_SHUT].map((art) => {
  const h = clone(idle);
  stamp(h, art, hc - 1, hr - 5);
  return h;
});
const idlePaint = [0, 1].map((i) => {
  const h = clone(idle);
  stamp(h, BRUSH, hc - 1 + i, hr - 8 - i);
  return h;
});

const rows = [walk, scissors, brush, [idle, sit], [...idleCut, ...idlePaint]];
const SW = CW * 6, SH = CH * rows.length;
const buf = Buffer.alloc(SW * SH * 4);
const meta = [];
rows.forEach((list, ri) =>
  list.forEach((g, fi) => {
    const ox = fi * CW + Math.round(AX - center(g));
    const oy = ri * CH + CH - 1 - g.length;
    if (ri === 3) meta.push({ frame: fi, top: CH - 1 - g.length, height: g.length });
    g.forEach((row, r) =>
      row.forEach((p, c) => {
        if (p < 0) return;
        const x = ox + c, y = oy + r;
        if (x < fi * CW || x >= (fi + 1) * CW) return;
        const k = (y * SW + x) * 4;
        const col = colors[p];
        buf[k] = col[0]; buf[k + 1] = col[1]; buf[k + 2] = col[2]; buf[k + 3] = 255;
      }),
    );
  }),
);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${SW}x${SH}`, '-i', '-', '-frames:v', '1', OUT], { input: buf });
console.log(JSON.stringify({ out: path.relative(process.cwd(), OUT), cell: [CW, CH], sheet: [SW, SH], seatFromBottom: CH - 1 - (CH - 1 - sit.length + SEAT), sit: meta[1] }));
