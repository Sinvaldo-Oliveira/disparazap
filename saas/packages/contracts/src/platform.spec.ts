import { describe, expect, it } from 'vitest';
import { evolutionSettingsInputSchema, evolutionUrlProblem, normalizeEvolutionUrl } from './platform.ts';

describe('endereço da Evolution Go', () => {
  it.each([
    ['https público', 'https://evolution.exemplo.test'],
    ['https com porta e caminho', 'https://api.exemplo.test:8443/evolution'],
    ['http nesta máquina', 'http://127.0.0.1:4000'],
    ['http localhost', 'http://localhost:4000'],
    ['http em serviço interno do Docker', 'http://evolution-go:8080'],
  ])('aceita %s', (_caso, url) => {
    expect(evolutionUrlProblem(url)).toBeNull();
  });

  it.each([
    ['http em domínio público', 'http://evolution.exemplo.test', 'https'],
    ['usuário e senha no endereço', 'https://usuario:senha@evolution.exemplo.test', 'usuário ou senha'],
    ['parâmetros', 'https://evolution.exemplo.test?apikey=x', 'parâmetros'],
    ['âncora', 'https://evolution.exemplo.test#x', 'âncora'],
    ['outro protocolo', 'ftp://evolution.exemplo.test', 'http'],
    ['texto solto', 'evolution', 'endereço completo'],
  ])('recusa %s', (_caso, url, motivo) => {
    expect(evolutionUrlProblem(url)).toContain(motivo);
  });

  it('remove a barra final, como o MVP faz com EVOLUTION_URL', () => {
    expect(normalizeEvolutionUrl('https://evolution.exemplo.test/')).toBe('https://evolution.exemplo.test');
    expect(normalizeEvolutionUrl('https://api.exemplo.test/evolution/')).toBe('https://api.exemplo.test/evolution');
  });

  it('o formulário não aceita campos extras', () => {
    const result = evolutionSettingsInputSchema.safeParse({ name: 'Servidor', baseUrl: 'https://evolution.exemplo.test', status: 'active', extra: 1 });
    expect(result.success).toBe(false);
  });
});
