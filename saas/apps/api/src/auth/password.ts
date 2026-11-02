import { hash, verify, type Options } from '@node-rs/argon2';

// `Algorithm` é um const enum da biblioteca (incompatível com erasableSyntaxOnly): 2 = Argon2id
const ARGON2ID = 2 as Options['algorithm'];

// argon2id com os parâmetros mínimos recomendados pela OWASP (19 MiB, 2 iterações, 1 linha de execução)
const ARGON2_OPTIONS: Options = { algorithm: ARGON2ID, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword({ hash: stored, password }: { hash: string; password: string }): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    // Hash corrompido ou de outro formato: nunca autentica
    return false;
  }
}
