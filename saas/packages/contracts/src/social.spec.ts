import { describe, expect, it } from 'vitest';
import { countChars, socialPostInputSchema, socialRuleIssues, type SocialPostParsed } from './social.ts';
import { isValidTimeZone, zonedDateKey, zonedLocalToDate, zonedLocalValue } from './timezone.ts';

describe('fuso horário da empresa', () => {
  it('converte o horário local para o instante certo (inclusive no horário de verão)', () => {
    expect(zonedLocalToDate('2030-12-01T10:00', 'America/Sao_Paulo')?.toISOString()).toBe('2030-12-01T13:00:00.000Z');
    expect(zonedLocalToDate('2030-12-01T10:00', 'America/Manaus')?.toISOString()).toBe('2030-12-01T14:00:00.000Z');
    expect(zonedLocalToDate('2030-07-01T10:00', 'America/New_York')?.toISOString()).toBe('2030-07-01T14:00:00.000Z');
    expect(zonedLocalToDate('2030-01-01T10:00', 'America/New_York')?.toISOString()).toBe('2030-01-01T15:00:00.000Z');
    expect(zonedLocalToDate('2030-02-30T10:00', 'America/Sao_Paulo')).toBeNull();
    expect(zonedLocalToDate('ontem', 'America/Sao_Paulo')).toBeNull();
  });

  it('mostra o dia e a hora no fuso da empresa (a virada de dia muda a data)', () => {
    const instant = new Date('2030-12-02T01:30:00.000Z');
    expect(zonedDateKey(instant, 'America/Sao_Paulo')).toBe('2030-12-01');
    expect(zonedLocalValue(instant, 'America/Sao_Paulo')).toBe('2030-12-01T22:30');
    expect(zonedDateKey(instant, 'UTC')).toBe('2030-12-02');
  });

  it('aceita só fusos IANA conhecidos', () => {
    expect(isValidTimeZone('America/Sao_Paulo')).toBe(true);
    expect(isValidTimeZone('Marte/Base_Um')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});

describe('regras de cada rede', () => {
  const input = (value: Partial<SocialPostParsed>): SocialPostParsed =>
    socialPostInputSchema.parse({ requestId: '6f1d3a8e-2b9c-4f0a-9d6e-1a2b3c4d5e6f', content: '', targets: [], media: [], mode: 'now', ...value });
  const label = (target: { platform: string }) => target.platform;
  const image = (mimeType = 'image/png', size = 1000) => ({ mimeType, size });

  it('conta emojis e acentos como um caractere', () => {
    expect(countChars('ação 🚀')).toBe(6);
  });

  it('Instagram exige imagem; Story leva 1 imagem; X limita 280; Facebook aceita só texto', () => {
    expect(socialRuleIssues(input({ content: 'oi', targets: [{ accountId: 'a', platform: 'instagram', format: 'post', customContent: null, pinterest: null }] }), [], label)).toEqual([
      'instagram: precisa de uma imagem.',
    ]);
    expect(socialRuleIssues(input({ targets: [{ accountId: 'a', platform: 'instagram', format: 'story', customContent: null, pinterest: null }] }), [image(), image()], label)).toEqual([
      'instagram: o Story leva exatamente 1 imagem.',
    ]);
    expect(socialRuleIssues(input({ content: 'x'.repeat(281), targets: [{ accountId: 'a', platform: 'twitter', format: 'post', customContent: null, pinterest: null }] }), [], label)[0]).toContain('280');
    // Texto personalizado da rede vale no lugar do geral
    expect(socialRuleIssues(input({ content: 'x'.repeat(281), targets: [{ accountId: 'a', platform: 'twitter', format: 'post', customContent: 'curto', pinterest: null }] }), [], label)).toEqual([]);
    expect(socialRuleIssues(input({ content: 'Só texto', targets: [{ accountId: 'a', platform: 'facebook', format: 'post', customContent: null, pinterest: null }] }), [], label)).toEqual([]);
  });

  it('tipo e tamanho da imagem por rede; rascunho pode ficar vazio', () => {
    expect(socialRuleIssues(input({ targets: [{ accountId: 'a', platform: 'instagram', format: 'post', customContent: null, pinterest: null }] }), [image('image/webp')], label)[0]).toContain('JPEG, PNG');
    expect(socialRuleIssues(input({ targets: [{ accountId: 'a', platform: 'facebook', format: 'post', customContent: null, pinterest: null }] }), [image('image/png', 4.5 * 1024 * 1024)], label)[0]).toContain('4 MB');
    expect(socialRuleIssues(input({ mode: 'draft', targets: [{ accountId: 'a', platform: 'linkedin', format: 'post', customContent: null, pinterest: null }] }), [], label)).toEqual([]);
  });

  it('pedido: agendar exige data; publicar exige conta; mesma conta duas vezes é recusada; link do pin só https', () => {
    expect(socialPostInputSchema.safeParse({ requestId: '6f1d3a8e-2b9c-4f0a-9d6e-1a2b3c4d5e6f', mode: 'schedule', targets: [{ accountId: 'a', platform: 'linkedin' }] }).success).toBe(false);
    expect(socialPostInputSchema.safeParse({ requestId: '6f1d3a8e-2b9c-4f0a-9d6e-1a2b3c4d5e6f', mode: 'now', targets: [] }).success).toBe(false);
    expect(
      socialPostInputSchema.safeParse({ requestId: '6f1d3a8e-2b9c-4f0a-9d6e-1a2b3c4d5e6f', mode: 'now', targets: [{ accountId: 'a', platform: 'linkedin' }, { accountId: 'a', platform: 'linkedin' }] }).success,
    ).toBe(false);
    expect(
      socialPostInputSchema.safeParse({
        requestId: '6f1d3a8e-2b9c-4f0a-9d6e-1a2b3c4d5e6f',
        mode: 'now',
        targets: [{ accountId: 'p', platform: 'pinterest', pinterest: { title: 't', link: 'javascript:alert(1)', boardId: null } }],
      }).success,
    ).toBe(false);
    expect(socialPostInputSchema.safeParse({ requestId: '6f1d3a8e-2b9c-4f0a-9d6e-1a2b3c4d5e6f', mode: 'draft', targets: [] }).success).toBe(true);
  });
});
