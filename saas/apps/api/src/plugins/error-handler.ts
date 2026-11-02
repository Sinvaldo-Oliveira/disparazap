import type { FastifyError, FastifyInstance, FastifyRequest } from 'fastify';
import { PROBLEM_CONTENT_TYPE, type ProblemDetails } from '@disparazap/contracts';
import { pathOnly } from './logger.ts';

const TITLES: Readonly<Record<number, string>> = {
  400: 'Requisição inválida',
  401: 'Não autenticado',
  403: 'Acesso negado',
  404: 'Recurso não encontrado',
  405: 'Método não permitido',
  406: 'Formato de resposta não suportado',
  409: 'Conflito',
  413: 'Requisição muito grande',
  415: 'Tipo de conteúdo não suportado',
  429: 'Muitas requisições',
  500: 'Erro interno',
  503: 'Serviço indisponível',
};

export function problem(request: FastifyRequest, status: number, detail?: string): ProblemDetails {
  return {
    type: 'about:blank',
    title: TITLES[status] ?? (status >= 500 ? 'Erro interno' : 'Erro na requisição'),
    status,
    instance: pathOnly(request.url),
    requestId: String(request.id),
    ...(detail ? { detail } : {}),
  };
}

/**
 * Toda resposta de erro sai em RFC 9457 com título fixo por status.
 * A mensagem original do erro e o stack trace ficam só no log do servidor.
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const status = error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500;
    if (status >= 500) request.log.error({ err: error }, 'erro não tratado');
    else request.log.info({ statusCode: status, code: error.code }, 'requisição recusada');
    const detail = error.validation ? 'Os dados enviados não passaram na validação.' : undefined;
    return reply.status(status).type(PROBLEM_CONTENT_TYPE).send(problem(request, status, detail));
  });

  app.setNotFoundHandler((request, reply) => reply.status(404).type(PROBLEM_CONTENT_TYPE).send(problem(request, 404)));
}
