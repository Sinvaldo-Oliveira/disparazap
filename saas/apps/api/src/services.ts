import { randomBytes } from 'node:crypto';
import { openDatabase, type DatabaseHandle } from '@disparazap/db';
import { createAuth, type Auth, type AuthLogFn } from './auth/auth.ts';
import { databaseOptions, type ApiConfig } from './config/env.ts';
import { createVault, type Vault } from './security/vault.ts';

export interface ApiServices {
  database: DatabaseHandle;
  auth: Auth;
  /** Cofre de credenciais; null quando SECRETS_MASTER_KEY não foi configurado (só fora de produção) */
  vault: Vault | null;
  /** true quando o AUTH_SECRET não foi configurado e um segredo temporário foi gerado (só fora de produção) */
  ephemeralSecret: boolean;
}

/** Abre o banco e cria a autenticação. Em produção, a configuração já garantiu DATABASE_URL, AUTH_SECRET e SECRETS_MASTER_KEY. */
export async function createServices(config: ApiConfig, log: AuthLogFn): Promise<ApiServices> {
  const database = await openDatabase(databaseOptions(config));
  const secret = config.AUTH_SECRET ?? randomBytes(32).toString('base64url');
  const auth = createAuth({ db: database.db, config, secret, log });
  return { database, auth, vault: createVault(config.SECRETS_MASTER_KEY), ephemeralSecret: config.AUTH_SECRET === undefined };
}
