import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** Segredo cifrado como fica no banco (todos os campos em base64) */
export interface SealedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultError';
  }
}

const ALGORITHM = 'aes-256-gcm';
const CURRENT_KEY_VERSION = 1;

/**
 * Cofre de credenciais: AES-256-GCM com chave-mestra fora do banco (SECRETS_MASTER_KEY).
 * O "contexto" (ex.: "evolution_go:global_api_key") entra como dado autenticado: um valor cifrado
 * não pode ser copiado para outro tipo de credencial sem falhar ao abrir.
 */
export class Vault {
  readonly #key: Buffer;
  readonly keyVersion = CURRENT_KEY_VERSION;

  constructor(masterKey: Buffer) {
    if (masterKey.length !== 32) throw new VaultError('A chave-mestra precisa ter 32 bytes.');
    this.#key = masterKey;
  }

  seal(plaintext: string, context: string): SealedSecret {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.#key, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      keyVersion: this.keyVersion,
    };
  }

  open(sealed: SealedSecret, context: string): string {
    if (sealed.keyVersion !== this.keyVersion) throw new VaultError('Credencial cifrada com outra versão da chave-mestra.');
    try {
      const decipher = createDecipheriv(ALGORITHM, this.#key, Buffer.from(sealed.iv, 'base64'));
      decipher.setAAD(Buffer.from(context, 'utf8'));
      decipher.setAuthTag(Buffer.from(sealed.authTag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, 'base64')), decipher.final()]).toString('utf8');
    } catch {
      // Chave-mestra trocada, dado adulterado ou contexto errado: nunca devolve conteúdo parcial
      throw new VaultError('Não foi possível abrir a credencial guardada.');
    }
  }
}

/** Cofre a partir da configuração; null quando SECRETS_MASTER_KEY não foi definido */
export function createVault(masterKey: string | undefined): Vault | null {
  return masterKey ? new Vault(Buffer.from(masterKey, 'base64url')) : null;
}

/** Só os 4 últimos caracteres, para a tela identificar a chave sem revelá-la */
export function lastFour(secret: string): string {
  return secret.slice(-4);
}
