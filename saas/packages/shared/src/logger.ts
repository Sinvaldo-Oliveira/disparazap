import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';

const CENSOR = '[REDACTED]';

// Caminhos removidos de todo log. Curingas do pino cobrem um nível: "*.token" pega { auth: { token } }.
export const REDACT_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-instance-token"]',
  'res.headers["set-cookie"]',
  'password', 'token', 'apiKey', 'apikey', 'secret', 'authorization', 'cookie',
  '*.password', '*.token', '*.apiKey', '*.apikey', '*.secret', '*.authorization', '*.cookie',
];

export function baseLoggerOptions(service: string, level: string): LoggerOptions {
  return {
    level,
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: [...REDACT_PATHS], censor: CENSOR },
  };
}

export function createLogger(service: string, level: string, destination?: DestinationStream): Logger {
  return destination ? pino(baseLoggerOptions(service, level), destination) : pino(baseLoggerOptions(service, level));
}
