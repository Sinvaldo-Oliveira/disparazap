import { describe, expect, it } from 'vitest';
import type { SocialInboxMessage } from '@disparazap/contracts';
import { mergeFreshMessages } from './SocialInbox';

const msg = (id: string, text: string): SocialInboxMessage =>
  ({ id, direction: 'incoming', text, attachmentTypes: [], sentAt: null, createdAt: null, hasText: true } as unknown as SocialInboxMessage);

describe('Instagram: junção da atualização automática', () => {
  it('acrescenta a mensagem nova embaixo e mantém o histórico antigo carregado em cima', () => {
    const current = [msg('old', 'antiga'), msg('a', 'oi'), msg('b', 'tudo bem')];
    const fresh = [msg('a', 'oi'), msg('b', 'tudo bem'), msg('c', 'nova')];
    expect(mergeFreshMessages(current, fresh).map((item) => item.id)).toEqual(['old', 'a', 'b', 'c']);
  });

  it('sem mudança, devolve a mesma lista (não redesenha nem rola)', () => {
    const current = [msg('a', 'oi'), msg('b', 'tudo bem')];
    const fresh = [msg('a', 'oi'), msg('b', 'tudo bem')];
    expect(mergeFreshMessages(current, fresh)).toBe(current);
  });
});
