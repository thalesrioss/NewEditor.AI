/**
 * Quem pode falar com o servidor pelo navegador (BL-0123). O servidor escuta só em 127.0.0.1, mas qualquer site
 * aberto num navegador do Mac alcança essa porta: com CORS aberto ele lia e alterava projetos de cliente.
 * Agora só a própria tela passa: o Vite de desenvolvimento (5173), a central da NewStudios (5410), a web servida
 * pelo próprio servidor (app de desktop) e as origens extras de `NEWEDITOR_ALLOWED_ORIGINS` (separadas por vírgula).
 * Pedido sem `Origin` (curl, agentes, scripts dos editores) continua passando: o navegador sempre manda `Origin`
 * em pedido de outro site que muda estado e na abertura do WebSocket.
 */
import type { FastifyInstance } from 'fastify';

/** Portas da tela: Vite do `npm run dev` e a central da NewStudios (`~/newstudios/bin/editor-brain`). */
const PORTAS_DA_TELA = [5173, 5410];
const HOSTS_LOCAIS = ['localhost', '127.0.0.1', '[::1]'];
const MUDA_ESTADO = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Normaliza uma origem (`esquema://host[:porta]`, sem barra no fim); entrada inválida vira null. */
function normalizar(origem: string): string | null {
  try {
    const u = new URL(origem.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Origens aceitas para um servidor na porta `porta`, mais as de `extras` (texto de `NEWEDITOR_ALLOWED_ORIGINS`). */
export function origensPermitidas(porta: number, extras = ''): Set<string> {
  const set = new Set<string>();
  for (const p of [...PORTAS_DA_TELA, porta]) for (const h of HOSTS_LOCAIS) set.add(`http://${h}:${p}`);
  for (const e of extras.split(',')) {
    const o = e.trim() ? normalizar(e) : null;
    if (o) set.add(o);
  }
  return set;
}

/** Pedido sem `Origin` passa; com `Origin`, só se estiver na lista (`null`, de arquivo ou iframe isolado, não passa). */
export function origemAceita(origem: string | undefined, permitidas: Set<string>): boolean {
  if (origem === undefined) return true;
  const o = normalizar(origem);
  return o !== null && permitidas.has(o);
}

/**
 * Responde 403 antes de qualquer efeito quando um pedido de outro site tenta mudar estado (POST, PUT, PATCH, DELETE)
 * ou abrir o WebSocket (que aceita operações e desfazer). Leitura (GET) de outro site segue sem cabeçalho CORS,
 * então o navegador não entrega a resposta à página.
 */
export function protegerOrigem(app: FastifyInstance, permitidas: Set<string>): void {
  app.addHook('onRequest', async (req, reply) => {
    const origem = req.headers.origin;
    if (origemAceita(origem, permitidas)) return;
    const ws = req.headers.upgrade?.toLowerCase() === 'websocket';
    if (!ws && !MUDA_ESTADO.has(req.method)) return;
    return reply.code(403).send({ error: `Origem não permitida: ${origem}. Use a tela do Editor Brain ou adicione a origem em NEWEDITOR_ALLOWED_ORIGINS.` });
  });
}
