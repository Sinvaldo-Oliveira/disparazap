import { describe, expect, it } from 'vitest';
import { healthLiveSchema, problemDetailsSchema } from './index.ts';

describe('contrato do health check', () => {
  it('aceita a resposta pública mínima', () => {
    const ok = healthLiveSchema.safeParse({ status: 'ok', service: 'disparazap-api', timestamp: new Date().toISOString() });
    expect(ok.success).toBe(true);
  });

  it('recusa campos extras, para nada sensível entrar por acidente', () => {
    const extra = healthLiveSchema.safeParse({
      status: 'ok',
      service: 'disparazap-api',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    });
    expect(extra.success).toBe(false);
  });
});

describe('contrato de erro (RFC 9457)', () => {
  it('aceita um problema sem detalhes internos', () => {
    const ok = problemDetailsSchema.safeParse({ type: 'about:blank', title: 'Erro interno', status: 500, requestId: 'r1' });
    expect(ok.success).toBe(true);
  });

  it('recusa stack trace e status fora da faixa de erro', () => {
    expect(problemDetailsSchema.safeParse({ type: 'about:blank', title: 'x', status: 500, requestId: 'r', stack: 'at …' }).success).toBe(false);
    expect(problemDetailsSchema.safeParse({ type: 'about:blank', title: 'x', status: 200, requestId: 'r' }).success).toBe(false);
  });
});
