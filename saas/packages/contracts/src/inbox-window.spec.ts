import { describe, expect, it } from 'vitest';
import { socialReplyWindow } from './inbox.ts';

const NOW = Date.parse('2026-11-10T12:00:00.000Z');
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

describe('janela de resposta do Instagram (Z3.1)', () => {
  it('até 24 horas: resposta sem tag', () => {
    expect(socialReplyWindow(hoursAgo(2), true, NOW).mode).toBe('free');
    expect(socialReplyWindow(hoursAgo(24), true, NOW).mode).toBe('free');
  });

  it('entre 24 horas e 7 dias: HUMAN_AGENT, só para resposta humana', () => {
    expect(socialReplyWindow(hoursAgo(25), true, NOW).mode).toBe('human_agent');
    expect(socialReplyWindow(hoursAgo(7 * 24), true, NOW).mode).toBe('human_agent');
  });

  it('após 7 dias: bloqueado', () => {
    expect(socialReplyWindow(hoursAgo(7 * 24 + 1), true, NOW)).toMatchObject({ mode: 'blocked', reason: 'expired' });
  });

  it('sem data confiável da última mensagem do contato: bloqueado', () => {
    expect(socialReplyWindow(null, true, NOW)).toMatchObject({ mode: 'blocked', reason: 'unknown_last_message' });
    expect(socialReplyWindow('não é uma data', true, NOW)).toMatchObject({ mode: 'blocked', reason: 'unknown_last_message' });
  });

  it('histórico não confirmado: bloqueado mesmo com data recente', () => {
    expect(socialReplyWindow(hoursAgo(1), false, NOW)).toMatchObject({ mode: 'blocked', reason: 'unreliable_history' });
  });
});
