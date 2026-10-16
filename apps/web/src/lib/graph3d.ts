/**
 * Grafo de força em 3D desenhado em Canvas 2D (sem dependência): simulação (repulsão, molas, gravidade),
 * câmera em órbita com perspectiva, névoa por profundidade, rótulos que aparecem conforme a escala —
 * o visual do grafo do Obsidian, em 3D. Para algumas centenas de nós é mais que suficiente.
 */
import type { CerebroCamada, CerebroEdge, CerebroNode } from '@neweditor/core';

export interface Body {
  id: string;
  node: CerebroNode;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  r: number;
  deg: number;
  color: string;
  /** Camadas presentes no nó (num hub: as dos filhos) — decide se aparece no filtro de camada. */
  camadas: Set<CerebroCamada>;
  // projeção do último quadro
  sx: number;
  sy: number;
  sz: number;
  ss: number;
}

export interface Spring {
  a: Body;
  b: Body;
  edge: CerebroEdge;
  len: number;
  k: number;
}

export interface Forces {
  repel: number;
  linkDistance: number;
  center: number;
  /** Distância do centro de cada cérebro ao centro da cena (dois cérebros = duas galáxias). */
  spread: number;
}

export const DEFAULT_FORCES: Forces = { repel: 1500, linkDistance: 84, center: 0.014, spread: 230 };

const HUB_KINDS = new Set<CerebroNode['kind']>(['pasta', 'projeto', 'filme', 'cerebro']);
export const isHub = (n: CerebroNode): boolean => HUB_KINDS.has(n.kind) && !/\.(md|canvas)$/i.test(n.path);
/** Para onde cada cérebro é puxado (x): o Editor à esquerda, o Motion à direita. */
export const anchorX = (vault: string, spread: number): number => (vault === 'motion' ? spread : vault === 'editor' ? -spread : 0);

/** Pseudo-aleatório estável por id: a mesma nota nasce no mesmo lugar a cada abertura. */
function seeded(id: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

export function makeBodies(nodes: CerebroNode[], edges: CerebroEdge[], colorOf: (n: CerebroNode) => string): { bodies: Body[]; springs: Spring[]; byId: Map<string, Body> } {
  const deg = new Map<string, number>();
  for (const e of edges) {
    deg.set(e.s, (deg.get(e.s) ?? 0) + 1);
    deg.set(e.t, (deg.get(e.t) ?? 0) + 1);
  }
  const bodies: Body[] = nodes.map((n) => {
    const rnd = seeded(n.id);
    const u = rnd() * 2 - 1;
    const th = rnd() * Math.PI * 2;
    const rad = 120 + rnd() * 160;
    const sq = Math.sqrt(1 - u * u);
    const d = deg.get(n.id) ?? 0;
    const hub = isHub(n);
    return {
      id: n.id,
      node: n,
      x: rad * sq * Math.cos(th) + anchorX(n.vault, 230),
      y: rad * sq * Math.sin(th),
      z: rad * u,
      vx: 0,
      vy: 0,
      vz: 0,
      r: n.kind === 'cerebro' ? 11 + Math.sqrt(d) * 0.9 : hub ? 4.5 + Math.sqrt(d) * 1.3 : 2.6 + Math.sqrt(d) * 1.35,
      deg: d,
      color: colorOf(n),
      camadas: new Set([n.camada]),
      sx: 0,
      sy: 0,
      sz: 0,
      ss: 1,
    };
  });
  const byId = new Map(bodies.map((b) => [b.id, b]));
  // Um hub herda as camadas de quem está dentro dele (aresta 'pasta'), para seguir o filtro.
  for (const e of edges) {
    if (e.kind !== 'pasta') continue;
    const a = byId.get(e.s);
    const b = byId.get(e.t);
    if (!a || !b) continue;
    if (isHub(a.node) && !isHub(b.node)) for (const c of b.camadas) a.camadas.add(c);
    if (isHub(b.node) && !isHub(a.node)) for (const c of a.camadas) b.camadas.add(c);
  }
  // Depois, de hub filho para hub pai (o caminho do pai é prefixo do filho), para a pasta seguir o que tem dentro.
  for (const e of edges) {
    if (e.kind !== 'pasta') continue;
    const a = byId.get(e.s);
    const b = byId.get(e.t);
    if (!a || !b || !isHub(a.node) || !isHub(b.node)) continue;
    const [parent, child] = a.node.kind === 'cerebro' || b.node.path.startsWith(`${a.node.path}/`) ? [a, b] : [b, a];
    for (const c of child.camadas) parent.camadas.add(c);
  }
  const springs: Spring[] = [];
  for (const e of edges) {
    const a = byId.get(e.s);
    const b = byId.get(e.t);
    if (!a || !b) continue;
    const loose = e.kind === 'pasta' || e.kind === 'cliente';
    const len = e.kind === 'ponte' ? 2.6 : loose ? 1.35 : e.kind === 'perfil' ? 0.7 : 1;
    const k = e.kind === 'ponte' ? 0.25 : loose ? 0.35 : e.kind === 'decisao' || e.kind === 'correcao' ? 0.6 + Math.min(1, e.w / 10) : 0.9;
    springs.push({ a, b, edge: e, len, k });
  }
  return { bodies, springs, byId };
}

/** Um passo da simulação. `alpha` esfria com o tempo (1 → 0). */
export function step(bodies: Body[], springs: Spring[], f: Forces, alpha: number, active?: Set<string> | null): void {
  const n = bodies.length;
  // Repulsão (O(n²): ok para centenas).
  for (let i = 0; i < n; i++) {
    const a = bodies[i]!;
    for (let j = i + 1; j < n; j++) {
      const b = bodies[j]!;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dz = b.z - a.z;
      let d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 1) {
        dx = (Math.random() - 0.5) * 2;
        dy = (Math.random() - 0.5) * 2;
        dz = (Math.random() - 0.5) * 2;
        d2 = dx * dx + dy * dy + dz * dz;
      }
      if (d2 > 160_000) continue;
      const inv = (f.repel * alpha) / (d2 * Math.sqrt(d2));
      const fx = dx * inv;
      const fy = dy * inv;
      const fz = dz * inv;
      a.vx -= fx;
      a.vy -= fy;
      a.vz -= fz;
      b.vx += fx;
      b.vy += fy;
      b.vz += fz;
    }
  }
  // Molas.
  for (const s of springs) {
    if (active && !(active.has(s.a.id) && active.has(s.b.id))) continue;
    const dx = s.b.x - s.a.x;
    const dy = s.b.y - s.a.y;
    const dz = s.b.z - s.a.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01;
    const target = f.linkDistance * s.len + (s.a.r + s.b.r);
    const force = ((d - target) / d) * s.k * alpha * 0.12;
    const fx = dx * force;
    const fy = dy * force;
    const fz = dz * force;
    // Hubs pesam mais: mexem menos.
    const wa = 1 / (1 + s.a.deg * 0.08);
    const wb = 1 / (1 + s.b.deg * 0.08);
    s.a.vx += fx * wa;
    s.a.vy += fy * wa;
    s.a.vz += fz * wa;
    s.b.vx -= fx * wb;
    s.b.vy -= fy * wb;
    s.b.vz -= fz * wb;
  }
  // Gravidade para o centro do próprio cérebro + amortecimento.
  for (const b of bodies) {
    const ax = anchorX(b.node.vault, f.spread);
    const g = b.node.kind === 'cerebro' ? f.center * 6 : f.center;
    b.vx -= (b.x - ax) * g * alpha;
    b.vy -= b.y * g * alpha;
    b.vz -= b.z * g * alpha;
    b.vx *= 0.82;
    b.vy *= 0.82;
    b.vz *= 0.82;
    b.x += b.vx;
    b.y += b.vy;
    b.z += b.vz;
  }
}

export interface Camera {
  yaw: number;
  pitch: number;
  dist: number;
  /** deslocamento do alvo (pan) em coordenadas de mundo */
  tx: number;
  ty: number;
  tz: number;
}

/** Projeta os corpos para a tela (preenche sx, sy, sz, ss). `sz` cresce para longe da câmera. */
export function project(bodies: Body[], cam: Camera, w: number, h: number): void {
  const cy = Math.cos(cam.yaw);
  const sy = Math.sin(cam.yaw);
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  const f = Math.max(w, h) * 0.9;
  for (const b of bodies) {
    const x0 = b.x - cam.tx;
    const y0 = b.y - cam.ty;
    const z0 = b.z - cam.tz;
    // gira em Y (yaw) depois em X (pitch)
    const x1 = x0 * cy - z0 * sy;
    const z1 = x0 * sy + z0 * cy;
    const y2 = y0 * cp - z1 * sp;
    const z2 = y0 * sp + z1 * cp;
    const depth = z2 + cam.dist;
    const s = f / Math.max(40, depth);
    b.sx = w / 2 + x1 * s;
    b.sy = h / 2 + y2 * s;
    b.sz = depth;
    b.ss = s;
  }
}

export interface DrawOpts {
  hover: Body | null;
  selected: Body | null;
  /** nós que batem com a busca (null = sem busca) */
  match: Set<string> | null;
  /** grupos escondidos */
  hidden: Set<string>;
  /** 'todas' | 'padrao' (só ofício: o que todo editor recebe) | 'meu' (pessoal + clientes) */
  camada: 'todas' | 'padrao' | 'meu';
  showFolderEdges: boolean;
  labels: 'auto' | 'all' | 'hover';
  dpr: number;
}

const EDGE_COLOR: Record<CerebroEdge['kind'], string> = {
  wikilink: '232,234,239',
  ponte: '251,146,60',
  mencao: '199,204,214',
  pasta: '125,134,154',
  decisao: '196,181,253',
  correcao: '251,191,36',
  oficio: '249,168,212',
  cliente: '251,191,36',
  canvas: '253,230,138',
  perfil: '52,211,153',
};

export function draw(ctx: CanvasRenderingContext2D, bodies: Body[], springs: Spring[], w: number, h: number, o: DrawOpts): void {
  ctx.save();
  ctx.scale(o.dpr, o.dpr);
  ctx.clearRect(0, 0, w, h);
  // Fundo com vinheta.
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
  g.addColorStop(0, '#0f1320');
  g.addColorStop(1, '#07080b');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const vis = (b: Body) => visible(b, o.hidden, o.camada);
  const focus = o.hover ?? o.selected;
  const near = new Set<string>();
  if (focus) {
    near.add(focus.id);
    for (const s of springs) {
      if (s.a === focus) near.add(s.b.id);
      if (s.b === focus) near.add(s.a.id);
    }
  }
  const dimmed = (b: Body) => (focus ? !near.has(b.id) : o.match ? !o.match.has(b.id) : false);
  const zs = bodies.map((b) => b.sz);
  const zMin = Math.min(...zs);
  const zMax = Math.max(...zs);
  const fog = (z: number) => 1 - Math.min(0.75, Math.max(0, (z - zMin) / Math.max(1, zMax - zMin)) * 0.75);

  // Arestas (mais longe primeiro).
  const sorted = [...springs].filter((s) => vis(s.a) && vis(s.b) && (o.showFolderEdges || s.edge.kind !== 'pasta')).sort((p, q) => q.a.sz + q.b.sz - (p.a.sz + p.b.sz));
  ctx.lineCap = 'round';
  for (const s of sorted) {
    const hot = focus && (s.a === focus || s.b === focus);
    const dim = dimmed(s.a) || dimmed(s.b);
    const base = s.edge.kind === 'pasta' ? 0.1 : s.edge.kind === 'cliente' ? 0.16 : s.edge.kind === 'ponte' ? 0.62 : 0.28;
    const a = (hot ? 0.9 : dim ? base * 0.18 : base) * fog((s.a.sz + s.b.sz) / 2);
    ctx.strokeStyle = `rgba(${EDGE_COLOR[s.edge.kind]},${a.toFixed(3)})`;
    const wgt = s.edge.kind === 'ponte' ? 1.4 + Math.min(1.5, s.edge.w * 0.4) : s.edge.kind === 'decisao' || s.edge.kind === 'correcao' ? Math.min(3.5, 0.8 + Math.sqrt(s.edge.w) * 0.5) : s.edge.kind === 'perfil' ? 1.6 : 0.8;
    ctx.lineWidth = (hot ? wgt + 0.6 : wgt) * Math.min(1.4, (s.a.ss + s.b.ss) / 2);
    ctx.setLineDash(s.edge.kind === 'cliente' ? [3, 5] : s.edge.kind === 'ponte' ? [7, 5] : []);
    ctx.beginPath();
    ctx.moveTo(s.a.sx, s.a.sy);
    ctx.lineTo(s.b.sx, s.b.sy);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Nós (mais longe primeiro).
  const order = bodies.filter(vis).sort((p, q) => q.sz - p.sz);
  for (const b of order) {
    const r = Math.max(1.2, b.r * b.ss);
    const dim = dimmed(b);
    const alpha = (dim ? 0.18 : 1) * fog(b.sz);
    const hub = isHub(b.node);
    const core = b.node.kind === 'cerebro';
    ctx.globalAlpha = alpha;
    if (!dim && (core || b === o.hover || b === o.selected || b.node.casa)) {
      ctx.shadowColor = b.node.casa ? '#34d399' : b.color;
      ctx.shadowBlur = core ? 26 : b === o.hover || b === o.selected ? 18 : 10;
    } else {
      ctx.shadowBlur = 0;
    }
    ctx.beginPath();
    ctx.arc(b.sx, b.sy, r, 0, Math.PI * 2);
    if (core) {
      // O centro de um cérebro: anel grosso com núcleo, na cor dele.
      ctx.fillStyle = '#0b0d12';
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, 2.4 * b.ss);
      ctx.strokeStyle = b.color;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(b.sx, b.sy, Math.max(1.5, r * 0.38), 0, Math.PI * 2);
      ctx.fillStyle = b.color;
      ctx.fill();
    } else if (hub) {
      ctx.fillStyle = '#0f1218';
      ctx.fill();
      ctx.lineWidth = Math.max(1, 1.6 * b.ss);
      ctx.strokeStyle = b.color;
      ctx.stroke();
    } else {
      ctx.fillStyle = b.color;
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    if (b.node.teste && !hub) {
      // Teste que não ficou bom: anel tracejado âmbar.
      ctx.setLineDash([2, 2]);
      ctx.strokeStyle = 'rgba(251,191,36,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(b.sx, b.sy, r + 2.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (b === o.selected) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(b.sx, b.sy, r + 3.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // Rótulos: aparecem conforme a escala (como o textFade do Obsidian), sempre no foco/busca.
  ctx.font = '500 11px ui-sans-serif, system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const b of order) {
    const r = b.r * b.ss;
    const inFocus = focus ? near.has(b.id) : o.match ? o.match.has(b.id) : false;
    let a: number;
    if (o.labels === 'hover') a = inFocus ? 1 : 0;
    else if (o.labels === 'all') a = dimmed(b) ? 0.15 : 1;
    else a = inFocus || b.node.kind === 'cerebro' ? 1 : dimmed(b) ? 0 : Math.max(0, Math.min(1, (r - 7.5) / 6));
    a *= fog(b.sz);
    if (a < 0.04) continue;
    if (b.node.kind === 'cerebro') ctx.font = '600 13px ui-sans-serif, system-ui, -apple-system, sans-serif';
    const text = b.node.label.length > 34 ? `${b.node.label.slice(0, 32)}…` : b.node.label;
    const y = b.sy + r + 3;
    ctx.globalAlpha = a * 0.75;
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#07080b';
    ctx.strokeText(text, b.sx, y);
    ctx.globalAlpha = a;
    ctx.fillStyle = b === focus || b.node.kind === 'cerebro' ? '#ffffff' : '#c7ccd6';
    ctx.fillText(text, b.sx, y);
    if (b.node.kind === 'cerebro') ctx.font = '500 11px ui-sans-serif, system-ui, -apple-system, sans-serif';
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

export function visible(b: Body, hidden: Set<string>, camada: DrawOpts['camada']): boolean {
  const n = b.node;
  if (hidden.has(n.group)) return false;
  if (n.kind === 'cerebro') return true;
  if (camada === 'padrao') return b.camadas.has('oficio');
  if (camada === 'meu') return b.camadas.has('pessoal') || b.camadas.has('cliente');
  return true;
}

/** O corpo mais próximo do ponteiro (em px de tela), ou null. */
export function pick(bodies: Body[], x: number, y: number, hidden: Set<string>, camada: DrawOpts['camada'] = 'todas'): Body | null {
  let best: Body | null = null;
  let bd = Infinity;
  for (const b of bodies) {
    if (!visible(b, hidden, camada)) continue;
    const dx = b.sx - x;
    const dy = b.sy - y;
    const d = Math.sqrt(dx * dx + dy * dy) - Math.max(3, b.r * b.ss);
    if (d < 6 && (d < bd || (Math.abs(d - bd) < 0.5 && b.sz < (best?.sz ?? Infinity)))) {
      bd = d;
      best = b;
    }
  }
  return best;
}
