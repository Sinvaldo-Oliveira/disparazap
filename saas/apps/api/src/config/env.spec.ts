import { describe, expect, it } from 'vitest';
import { IN_MEMORY } from '@disparazap/db';
import { ConfigError } from '@disparazap/shared';
import { DEFAULT_EMBEDDED_DIR, DEV_PANEL_ORIGIN, databaseOptions, loadApiConfig, trustedOrigins } from './env.ts';

function configError(env: Record<string, string>): string {
  try {
    loadApiConfig(env);
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return (err as ConfigError).message;
  }
  throw new Error('a configuração deveria ter sido recusada');
}

describe('configuração da API', () => {
  it('usa padrões seguros: só esta máquina, porta 3100, nenhuma origem CORS e banco embutido', () => {
    expect(loadApiConfig({})).toEqual({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      API_HOST: '127.0.0.1',
      API_PORT: 3100,
      API_CORS_ORIGINS: [],
      API_SHUTDOWN_TIMEOUT_MS: 10_000,
      // Sem proxy reverso e sem painel: a API sozinha, como em desenvolvimento
      API_TRUST_PROXY: false,
      WEB_DIST_DIR: undefined,
      DATABASE_URL: undefined,
      DATABASE_CA_FILE: undefined,
      DATABASE_POOL_MAX: 10,
      DATABASE_EMBEDDED_DIR: undefined,
      AUTH_SECRET: undefined,
      AUTH_BASE_URL: DEV_PANEL_ORIGIN,
      AUTH_TRUSTED_ORIGINS: [],
      AUTH_SIGNUP_ENABLED: true,
      SUPER_ADMIN_EMAIL: undefined,
      // Inbox desligada por padrão: nada se conecta à Evolution nem altera instâncias
      INBOX_EVENTS_ENABLED: false,
      INBOX_ACTIVATION_ENABLED: false,
      INBOX_SOCIAL_SEND_ENABLED: false,
      // Automações: nada é criado nem ativado na Zernio até a homologação (decisão A5)
      AUTOMATIONS_WRITE_ENABLED: false,
    });
    expect(databaseOptions(loadApiConfig({}))).toEqual({ kind: 'embedded', dataDir: DEFAULT_EMBEDDED_DIR });
    expect(databaseOptions(loadApiConfig({ NODE_ENV: 'test' }))).toEqual({ kind: 'embedded', dataDir: IN_MEMORY });
  });

  it('campos vazios no .env contam como não preenchidos', () => {
    const config = loadApiConfig({ DATABASE_URL: '', DATABASE_CA_FILE: '  ', AUTH_SECRET: '', SUPER_ADMIN_EMAIL: '' });
    expect(config.DATABASE_URL).toBeUndefined();
    expect(config.AUTH_SECRET).toBeUndefined();
    expect(config.SUPER_ADMIN_EMAIL).toBeUndefined();
  });

  it('com DATABASE_URL, exige o certificado (TLS nunca desligado) e usa PostgreSQL', () => {
    const url = 'postgresql://dz_app.ref:segredo-do-banco@aws-0-sa-east-1.pooler.supabase.com:5432/postgres';
    const message = configError({ DATABASE_URL: url });
    expect(message).toContain('DATABASE_CA_FILE');
    expect(message).not.toContain('segredo-do-banco');
    const options = databaseOptions(loadApiConfig({ DATABASE_URL: url, DATABASE_CA_FILE: 'C:/certs/ca.crt' }));
    expect(options).toMatchObject({ kind: 'postgres', caFile: 'C:/certs/ca.crt', poolMax: 10, applicationName: 'disparazap-api' });
  });

  it('recusa DATABASE_URL que não é PostgreSQL, sem ecoar o valor', () => {
    const message = configError({ DATABASE_URL: 'https://projeto-secreto.exemplo.test', DATABASE_CA_FILE: 'ca.crt' });
    expect(message).toContain('DATABASE_URL');
    expect(message).not.toContain('projeto-secreto');
  });

  it('em produção, exige banco, segredo de autenticação e https', () => {
    const message = configError({ NODE_ENV: 'production' });
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('AUTH_SECRET');
    expect(message).toContain('AUTH_BASE_URL');
  });

  it('recusa segredo curto e e-mail de Super-Admin inválido, sem ecoar os valores', () => {
    const message = configError({ AUTH_SECRET: 'curto-demais', SUPER_ADMIN_EMAIL: 'nao-e-email' });
    expect(message).toContain('AUTH_SECRET');
    expect(message).toContain('SUPER_ADMIN_EMAIL');
    expect(message).not.toContain('curto-demais');
    expect(message).not.toContain('nao-e-email');
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

describe('origens confiáveis em desenvolvimento', () => {
  it('o painel de desenvolvimento (porta 3000, com 127.0.0.1 e localhost) é aceito fora de produção, mesmo com AUTH_BASE_URL em outro endereço', () => {
    const dev = loadApiConfig({ AUTH_BASE_URL: 'http://127.0.0.1:5173' });
    expect(trustedOrigins(dev)).toEqual(expect.arrayContaining(['http://127.0.0.1:3000', 'http://localhost:3000']));
  });

  it('em produção só vale o que está configurado (sem o endereço de desenvolvimento)', () => {
    const prod = loadApiConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://usuario:senha@banco.exemplo.test:5432/postgres',
      DATABASE_CA_FILE: 'certificado-de-exemplo.crt',
      AUTH_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres',
      SECRETS_MASTER_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      AUTH_BASE_URL: 'https://painel.exemplo.test',
    });
    expect(trustedOrigins(prod)).toEqual(['https://painel.exemplo.test']);
  });
});
