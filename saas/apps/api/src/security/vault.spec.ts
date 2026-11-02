import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Vault, VaultError, createVault, lastFour } from './vault.ts';

const key = () => randomBytes(32);

describe('cofre de credenciais (AES-256-GCM)', () => {
  it('cifra e abre de volta; o texto cifrado não contém o segredo e muda a cada vez', () => {
    const vault = new Vault(key());
    const first = vault.seal('chave-global-ficticia-123', 'evolution_go:global_api_key');
    const second = vault.seal('chave-global-ficticia-123', 'evolution_go:global_api_key');
    expect(first.ciphertext).not.toContain('chave-global');
    expect(Buffer.from(first.ciphertext, 'base64').toString('utf8')).not.toContain('chave-global');
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(vault.open(first, 'evolution_go:global_api_key')).toBe('chave-global-ficticia-123');
  });

  it('recusa dado adulterado, contexto trocado, chave-mestra diferente e outra versão', () => {
    const vault = new Vault(key());
    const sealed = vault.seal('segredo-ficticio', 'evolution_go:global_api_key');
    const tampered = { ...sealed, ciphertext: Buffer.from('outra-coisa').toString('base64') };
    expect(() => vault.open(tampered, 'evolution_go:global_api_key')).toThrow(VaultError);
    expect(() => vault.open(sealed, 'zernio:oauth_token')).toThrow(VaultError);
    expect(() => new Vault(key()).open(sealed, 'evolution_go:global_api_key')).toThrow(VaultError);
    expect(() => vault.open({ ...sealed, keyVersion: 99 }, 'evolution_go:global_api_key')).toThrow(VaultError);
  });

  it('sem chave-mestra não há cofre; chave-mestra de tamanho errado é recusada', () => {
    expect(createVault(undefined)).toBeNull();
    expect(() => new Vault(randomBytes(16))).toThrow(VaultError);
    expect(lastFour('abcdefgh1234')).toBe('1234');
  });
});
