import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { formatDuration, formatWhatsApp, randomBetween, renderMessage } from './message-format';

afterEach(cleanup);

describe('mensagem (regras do disparador atual)', () => {
  it('{nome} vira o nome do contato; sem nome, sai junto com o espaço anterior', () => {
    expect(renderMessage('Olá {nome}! Tudo bem, {NOME}?', 'Ana')).toBe('Olá Ana! Tudo bem, Ana?');
    expect(renderMessage('Olá {nome}!', '')).toBe('Olá!');
  });

  it('pré-visualização com *negrito*, _itálico_ e ~riscado~, sem interpretar HTML do texto', () => {
    const { container } = render(<p>{formatWhatsApp('*Promoção* só _hoje_, ~ontem~ não. 2*3 <b>x</b>')}</p>);
    expect(container.querySelector('strong')?.textContent).toBe('Promoção');
    expect(container.querySelector('em')?.textContent).toBe('hoje');
    expect(container.querySelector('s')?.textContent).toBe('ontem');
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('2*3 <b>x</b>');
  });

  it('tempo e sorteio do intervalo', () => {
    expect(formatDuration(125_000)).toBe('02:05');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
    expect(randomBetween(1000, 2000, () => 0)).toBe(1000);
    expect(randomBetween(1000, 2000, () => 0.9999)).toBe(2000);
  });
});
