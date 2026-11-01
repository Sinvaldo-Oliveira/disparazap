import { describe, expect, it } from 'vitest';
import { ConfigError } from '@disparazap/shared';
import { loadApiConfig } from './env.ts';

describe('configuração da API', () => {
  it('usa padrões seguros: só esta máquina, porta 3100 e nenhuma origem CORS', () => {
    expect(loadApiConfig({})).toEqual({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      API_HOST: '127.0.0.1',
      API_PORT: 3100,
      API_CORS_ORIGINS: [],
      API_SHUTDOWN_TIMEOUT_MS: 10_000,
    });
  });

  it('lê uma lista de origens CORS exatas', () => {
    const config = loadApiConfig({ API_CORS_ORIGINS: ' https://app.exemplo.test , http://localhost:5173 ' });
    expect(config.API_CORS_ORIGINS).toEqual(['https://app.exemplo.test', 'http://localhost:5173']);
  });

  it.each([
    ['curinga', '*'],
    ['com caminho', 'https://app.exemplo.test/painel'],
    ['com barra final', 'https://app.exemplo.test/'],
    ['sem esquema', 'app.exemplo.test'],
    ['outro protocolo', 'ftp://app.exemplo.test'],
  ])('recusa origem CORS %s', (_caso, origem) => {
    expect(() => loadApiConfig({ API_CORS_ORIGINS: origem })).toThrow(ConfigError);
  });

  it('recusa porta e nível de log inválidos, sem ecoar o valor', () => {
    let error: unknown;
    try {
      loadApiConfig({ API_PORT: 'porta-com-segredo-123', LOG_LEVEL: 'tudo' });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as ConfigError).message;
    expect(message).toContain('API_PORT');
    expect(message).toContain('LOG_LEVEL');
    expect(message).not.toContain('porta-com-segredo-123');
  });
});
