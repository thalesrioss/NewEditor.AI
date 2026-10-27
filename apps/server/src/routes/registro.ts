/**
 * Registro do Thales no Cérebro (frente R): entrada para os canais que o Editor Brain não vê (Slack, Trello,
 * APROVACOES.md) e a leitura por cliente que o editor faz antes de editar.
 */
import type { FastifyInstance } from 'fastify';
import { fecharSessaoHumana } from '../registro-tela.ts';
import { clienteDoProjeto, contextoThales, lerPerfil, linhasThales, registrarThales, type RegistroThales } from '../registro-thales.ts';
import { store } from '../store.ts';
import { erro } from './_comum.ts';

export async function rotasRegistro(app: FastifyInstance): Promise<void> {
  /** Uma aprovação, reprovação ou alteração do Thales → uma linha na memória da NewStudios e no cofre. */
  app.post<{ Body: RegistroThales }>('/api/cerebro/registro', async (req) => {
    if (!req.body || typeof req.body !== 'object') throw erro('corpo JSON obrigatório');
    return registrarThales(req.body);
  });

  /** Últimas linhas com origem Thales do cliente (as duas fontes, sem repetir) e o perfil dele. */
  app.get<{ Params: { cliente: string }; Querystring: { limit?: string } }>('/api/cerebro/cliente/:cliente/thales', async (req) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 20) || 20));
    return { cliente: req.params.cliente, linhas: await linhasThales(req.params.cliente, limit), perfil: await lerPerfil(req.params.cliente) };
  });

  /** O mesmo para o cliente do projeto, com o bloco de texto que vai no contexto do agente. */
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>('/api/projects/:id/thales', async (req) => {
    const p = store.get(req.params.id);
    const cliente = await clienteDoProjeto(p);
    if (!cliente) return { cliente: null, linhas: [], perfil: null, contexto: '' };
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 20) || 20));
    return { cliente, linhas: await linhasThales(cliente, limit), perfil: await lerPerfil(cliente), contexto: await contextoThales(p) };
  });

  /** Fecha a sessão de edição à mão (o "Devolver ao agente" chama): grava o resumo do que o Thales mudou. */
  app.post<{ Params: { id: string } }>('/api/projects/:id/sessao-humana/fechar', async (req) => ({ gravado: await fecharSessaoHumana(req.params.id) }));
}
