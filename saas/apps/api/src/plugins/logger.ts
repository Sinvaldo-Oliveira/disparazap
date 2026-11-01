import type { DestinationStream, LoggerOptions } from 'pino';
import { baseLoggerOptions } from '@disparazap/shared';

interface LoggedRequest {
  id?: unknown;
  method?: string;
  url?: string;
}

interface LoggedReply {
  statusCode?: number;
}

// Sem query string: tokens em parâmetros de URL não chegam aos logs. Cabeçalhos nunca são registrados.
export function pathOnly(url: string | undefined): string {
  return (url ?? '').split('?')[0] ?? '';
}

export function apiLoggerOptions(level: string, stream?: DestinationStream): LoggerOptions & { stream?: DestinationStream } {
  return {
    ...baseLoggerOptions('disparazap-api', level),
    serializers: {
      req: (req: LoggedRequest) => ({ id: req.id, method: req.method, url: pathOnly(req.url) }),
      res: (res: LoggedReply) => ({ statusCode: res.statusCode }),
    },
    ...(stream ? { stream } : {}),
  };
}
