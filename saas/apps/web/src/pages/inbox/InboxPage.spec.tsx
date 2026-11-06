import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  InboxChannelsResponse,
  InboxConversation,
  InboxConversationDetail,
  InboxMessage,
  InboxStreamEvent,
  SessionInfo,
  SocialAccount,
  SocialInboxConversation,
  SocialInboxMessage,
  WhatsAppInstance,
} from '@disparazap/contracts';
import { App } from '../../app/App';
import type { AuthApi } from '../../auth/auth-api';
import type { InboxApi, InboxLiveStatus } from '../../inbox/inbox-api';
import type { SocialApi } from '../../social/social-api';
import type { ZernioApi } from '../../integrations/zernio-api';
import type { WhatsAppApi } from '../../whatsapp/whatsapp-api';

afterEach(cleanup);
// A primeira tela do arquivo carrega o painel inteiro: sob a carga da suíte completa, 5 s às vezes não bastam
vi.setConfig({ testTimeout: 20_000 });

// Tudo fictício: sessões, contatos, números de exemplo e endereços (.test)
const OWNER: SessionInfo = { user: { id: 'u1', name: 'Maria Teste', email: 'maria@empresa.test' }, userType: 'company_admin', organization: { id: 'o1', name: 'Empresa Teste', role: 'owner' } };
const OPERATOR: SessionInfo = { ...OWNER, user: { id: 'u3', name: 'Ana Atendente', email: 'ana@empresa.test' }, organization: { id: 'o1', name: 'Empresa Teste', role: 'operator' } };
const VIEWER: SessionInfo = { ...OWNER, user: { id: 'u2', name: 'Visitante', email: 'v@empresa.test' }, organization: { id: 'o1', name: 'Empresa Teste', role: 'viewer' } };
const SUPER_NO_ORG: SessionInfo = { user: { id: 'u0', name: 'Dono Plataforma', email: 'dono@disparazap.test' }, userType: 'super_admin', organization: null };
const NOW = new Date().toISOString();
const ENABLED_AT = '2026-11-03T12:00:00.000Z';

const ok = <T,>(data: T) => ({ ok: true as const, data });
const fail = (message: string, status: number) => ({ ok: false as const, message, status });

function channelsOf(extra: Partial<InboxChannelsResponse> = {}): InboxChannelsResponse {
  return {
    channels: [{ id: 'i1', type: 'whatsapp', name: 'Atendimento', phone: '5511955550001', connected: true, inboxEnabledAt: ENABLED_AT, unreadCount: 3 }],
    reception: { state: 'connected', since: NOW },
    gaps: [],
    activationAvailable: true,
    canManage: true,
    ...extra,
  };
}

const conversation = (id: string, extra: Partial<InboxConversation> = {}): InboxConversation => ({
  id,
  channel: 'whatsapp',
  accountId: 'i1',
  accountName: 'Atendimento',
  contact: { id: `k-${id}`, name: 'Cliente Um', phone: '5511900000001' },
  status: 'open',
  controlMode: 'human',
  controlVersion: 0,
  assignedTo: null,
  unreadCount: 0,
  lastMessageAt: NOW,
  lastMessagePreview: 'Preciso de ajuda com o pedido',
  lastMessageDirection: 'inbound',
  ...extra,
});

const C1 = conversation('c1', { unreadCount: 2 });
const C2 = conversation('c2', { contact: { id: 'k2', name: null, phone: '5511900000002' }, lastMessagePreview: 'Obrigado!', lastMessageDirection: 'outbound', assignedTo: { id: 'u1', name: 'Maria Teste' } });

const message = (id: string, extra: Partial<InboxMessage>): InboxMessage => ({
  id,
  direction: 'inbound',
  author: 'contact',
  authorName: null,
  contentType: 'text',
  mediaKind: null,
  text: `texto ${id}`,
  status: 'received',
  error: null,
  sentAt: NOW,
  ...extra,
});

const MESSAGES: InboxMessage[] = [
  message('m1', { text: 'Olá, preciso de ajuda com o pedido' }),
  message('m2', { direction: 'outbound', author: 'user', authorName: 'Maria Teste', text: 'Oi! Vou verificar.', status: 'read' }),
  message('m3', { direction: 'outbound', author: 'phone', text: 'Mandei pelo celular', status: 'delivered' }),
  message('m4', { contentType: 'media', mediaKind: 'image', text: 'foto do produto' }),
  message('m5', { direction: 'outbound', author: 'user', authorName: 'Maria Teste', text: 'Mensagem que falhou', status: 'failed', error: 'O WhatsApp desta conta está desconectado. Reconecte em Integrações e tente de novo.' }),
];

const detailOf = (item: InboxConversation, messages = MESSAGES): InboxConversationDetail => ({ conversation: item, messages, hasMore: false, canSend: true });

interface Fake {
  api: InboxApi;
  emit(event: InboxStreamEvent): void;
  live(status: InboxLiveStatus): void;
}

function inboxFake(overrides: Partial<InboxApi> = {}, channels = channelsOf()): Fake {
  let onEvent: ((event: InboxStreamEvent) => void) | null = null;
  let onStatus: ((status: InboxLiveStatus) => void) | null = null;
  // Como o servidor: o que foi enviado aparece nas releituras da conversa
  const stored = [...MESSAGES];
  const api: InboxApi = {
    channels: vi.fn(async () => ok(channels)),
    conversations: vi.fn(async () => ok({ conversations: [C1, C2], hasMore: false, canSend: true })),
    conversation: vi.fn(async (id: string) => (id === 'c1' ? ok(detailOf(C1, [...stored])) : id === 'c2' ? ok(detailOf(C2, [])) : fail('Conversa não encontrada.', 404))),
    markRead: vi.fn(async () => ok(null)),
    socialConversations: vi.fn(async () => ok({ conversations: SOCIAL_CONVERSATIONS, hasMore: false, nextCursor: null })),
    socialMessages: vi.fn(async () => ok({ messages: SOCIAL_MESSAGES, hasMore: false, nextCursor: null, sortOrderApplied: 'desc' as const, historyReliable: true })),
    socialDateDiagnostic: vi.fn(async () => ok({ readCount: 3, hasMore: false, sortOrderApplied: 'desc' as const, messages: [{ direction: 'incoming' as const, hasText: true, attachmentTypes: [], sentAt: NOW, createdAt: NOW, sentMinusCreatedSeconds: 0 }], orderMatchesSentAt: true, orderMatchesCreatedAt: true, lastIncoming: { sentAt: NOW, createdAt: NOW }, newest: { sentAt: NOW, createdAt: NOW } })),
    socialSend: vi.fn(async () => ok({ status: 'sent' as const, replayed: false, providerMessageId: 'mid_teste_1', message: 'Mensagem enviada ao Instagram.' })),
    send: vi.fn(async (_id: string, input: { requestId: string; text: string }) => {
      const sent = message(`novo-${stored.length}`, { direction: 'outbound', author: 'user', authorName: 'Maria Teste', text: input.text, status: 'sent' });
      stored.push(sent);
      return ok({ message: sent, replayed: false });
    }),
    setReception: vi.fn(async (_accountId: string, enabled: boolean) => ok(channelsOf({ channels: [{ ...channels.channels[0]!, inboxEnabledAt: enabled ? ENABLED_AT : null }], activationAvailable: channels.activationAvailable }))),
    subscribe: vi.fn((event: (item: InboxStreamEvent) => void, status: (item: InboxLiveStatus) => void) => {
      onEvent = event;
      onStatus = status;
      return { close: vi.fn() };
    }),
    ...overrides,
  };
  return {
    api,
    emit: (event) => act(() => onEvent?.(event)),
    live: (status) => act(() => onStatus?.(status)),
  };
}

function fakeAuth(session: SessionInfo): AuthApi {
  return { getSession: vi.fn(async () => session), signIn: vi.fn(), signUp: vi.fn(), signOut: vi.fn(async () => {}) } as unknown as AuthApi;
}

// Conversas do Instagram (fictícias, lidas da Zernio): nomes e textos inventados
const SOCIAL_CONVERSATIONS: SocialInboxConversation[] = [
  { id: 'sc1', platform: 'instagram', accountId: 'acc-ig', accountName: '@loja', contactName: 'Maria da Rede Teste', lastMessage: 'Oi, tudo bem?', updatedAt: NOW, archived: false, unreadCount: 1 },
];
const SOCIAL_MESSAGES: SocialInboxMessage[] = [
  { id: 'sm1', direction: 'incoming', text: 'Oi, tudo bem?', attachmentTypes: [], sentAt: NOW },
  { id: 'sm2', direction: 'outgoing', text: 'Tudo ótimo!', attachmentTypes: [], sentAt: NOW },
  { id: 'sm3', direction: 'incoming', text: null, attachmentTypes: ['image'], sentAt: NOW },
];

// Contas das redes na Zernio (fictícias): uma ativa no Instagram, uma no LinkedIn e uma que precisa reconectar
const SOCIAL_ACCOUNTS: SocialAccount[] = [
  { id: 'acc-ig', platform: 'instagram', username: 'loja', displayName: null, state: 'ok', publishable: true, reason: null },
  { id: 'acc-li', platform: 'linkedin', username: 'empresa', displayName: null, state: 'ok', publishable: true, reason: null },
  { id: 'acc-fb', platform: 'facebook', username: 'pagina', displayName: null, state: 'needs_reconnect', publishable: false, reason: 'Precisa ser reconectada em Integrações.' },
  { id: 'acc-tt', platform: 'tiktok', username: 'lojatt', displayName: null, state: 'ok', publishable: false, reason: null },
];

function socialFake(accounts: SocialAccount[] = SOCIAL_ACCOUNTS): SocialApi {
  return {
    accounts: vi.fn(async () => ok({ connection: 'ok' as const, accounts, timezone: 'America/Sao_Paulo', canPublish: true, canManage: true })),
  } as unknown as SocialApi;
}

function renderAt(path: string, fake: Fake, session: SessionInfo = OWNER, pollMs = 60_000, social: SocialApi = socialFake()) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App authApi={fakeAuth(session)} inboxApi={fake.api} socialApi={social} inboxPollMs={pollMs} contactSearchDelayMs={0} fetchHealth={async () => ({ status: 'ok', service: 'x', timestamp: NOW })} fetchReady={async () => true} />
    </MemoryRouter>,
  );
}

const click = async (element: HTMLElement) => {
  await act(async () => {
    fireEvent.click(element);
  });
};
const view = () => document.querySelector('.inbox')?.getAttribute('data-view');
const listRegion = async () => within(await screen.findByRole('region', { name: 'Conversas' }));
const thread = async () => within(await screen.findByRole('list', { name: 'Mensagens' }));
const details = () => within(screen.getByRole('complementary', { name: 'Detalhes do contato' }));

describe('Inbox: página e lista de conversas', () => {
  it('o menu tem a Inbox; a página mostra as três colunas, a lista com canal, conta e não lidas', async () => {
    const fake = inboxFake();
    renderAt('/', fake);
    await click(await within(await screen.findByRole('navigation', { name: 'Menu principal' })).findByRole('link', { name: /Inbox/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Inbox' })).toBeTruthy();
    const list = await listRegion();
    const first = await list.findByRole('link', { name: /Cliente Um/ });
    expect(first.getAttribute('href')).toBe('/inbox/c1');
    expect(within(first).getByLabelText('2 não lidas')).toBeTruthy();
    expect(within(first).getByRole('img', { name: 'WhatsApp' })).toBeTruthy();
    expect(within(first).getByText('Atendimento')).toBeTruthy();
    // Sem nome: o número formatado; a última mensagem foi nossa
    const second = list.getByRole('link', { name: /\+55 11 90000-0002/ });
    expect(within(second).getByText('Você:')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Conversa' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Detalhes do contato' })).toBeTruthy();
    expect(screen.getByText('Escolha uma conversa na lista.')).toBeTruthy();
    expect(view()).toBe('list');
    expect(fake.api.subscribe).toHaveBeenCalledTimes(1);
  });

  it('filtros: canal, conta, busca por nome ou número e situação', async () => {
    const fake = inboxFake();
    renderAt('/inbox', fake);
    await (await listRegion()).findByRole('link', { name: /Cliente Um/ });
    expect(fake.api.conversations).toHaveBeenLastCalledWith({ filter: 'all' }, expect.anything());

    await click(screen.getByRole('button', { name: /^WhatsApp/ }));
    await waitFor(() => expect(fake.api.conversations).toHaveBeenLastCalledWith({ filter: 'all', channel: 'whatsapp' }, expect.anything()));
    fireEvent.change(screen.getByRole('combobox', { name: 'Filtrar por conta' }), { target: { value: 'i1' } });
    await waitFor(() => expect(fake.api.conversations).toHaveBeenLastCalledWith({ filter: 'all', channel: 'whatsapp', accountId: 'i1' }, expect.anything()));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar conversa por nome ou número' }), { target: { value: ' 90000 ' } });
    await waitFor(() => expect(fake.api.conversations).toHaveBeenLastCalledWith({ filter: 'all', channel: 'whatsapp', accountId: 'i1', search: '90000' }, expect.anything()));
    await click(screen.getByRole('button', { name: 'Não lidas' }));
    await waitFor(() => expect(fake.api.conversations).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'unread' }), expect.anything()));
    expect(screen.getByRole('button', { name: 'Não lidas' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('lista vazia e erro de carregamento aparecem com texto honesto', async () => {
    const empty = inboxFake({ conversations: vi.fn(async () => ok({ conversations: [], hasMore: false, canSend: true })) });
    renderAt('/inbox', empty);
    expect(await screen.findByText(/Nenhuma conversa ainda/)).toBeTruthy();
    cleanup();
    const broken = inboxFake({ conversations: vi.fn(async () => fail('Não foi possível falar com o servidor. Verifique se a API está ligada.', 0)) });
    renderAt('/inbox', broken);
    expect((await screen.findAllByRole('alert')).some((item) => /Não foi possível falar com o servidor/.test(item.textContent ?? ''))).toBe(true);
  });
});

describe('Inbox: conversas do Instagram (Z2, leitura direta da Zernio)', () => {
  it('abre a conversa: histórico em ordem, quem escreveu, anexo sem arquivo e nenhum campo de resposta', async () => {
    const fake = inboxFake();
    renderAt('/inbox', fake);
    await click(await screen.findByRole('button', { name: 'Instagram @loja' }));
    await click(await screen.findByRole('button', { name: /Maria da Rede Teste/ }));
    const messages = within(await screen.findByRole('list', { name: 'Mensagens' }));
    expect(messages.getByText('Oi, tudo bem?')).toBeTruthy();
    expect(messages.getByText('Tudo ótimo!')).toBeTruthy();
    expect(messages.getByText('Empresa')).toBeTruthy();
    expect(messages.getByText(/Imagem/)).toBeTruthy();
    expect(fake.api.socialMessages).toHaveBeenCalledWith('sc1', 'acc-ig', null, expect.anything());
    expect((screen.getByRole('button', { name: 'Enviar' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('complementary', { name: 'Detalhes do contato' }).textContent).toContain('Somente leitura');
  });

  it('erro da Zernio na lista aparece na coluna, sem sair da página', async () => {
    const fake = inboxFake({ socialConversations: vi.fn(async () => fail('A Zernio não liberou a Inbox desta conta (plano, complemento ou permissão). Confira no painel da Zernio.', 403)) });
    renderAt('/inbox', fake);
    await click(await screen.findByRole('button', { name: 'Instagram @loja' }));
    expect(await screen.findByText(/não liberou a Inbox desta conta/)).toBeTruthy();
  });
});

describe('Inbox: canais (ícones das redes da Zernio)', () => {
  it('mostra o WhatsApp e um ícone por conta de rede ativa; a conta que precisa reconectar fica de fora', async () => {
    renderAt('/inbox', inboxFake());
    const channels = within(await screen.findByRole('group', { name: 'Filtrar por canal' }));
    expect(await channels.findByRole('button', { name: 'Instagram @loja' })).toBeTruthy();
    expect(channels.getByRole('button', { name: 'LinkedIn @empresa' })).toBeTruthy();
    expect(channels.getByRole('button', { name: 'WhatsApp' })).toBeTruthy();
    expect(channels.queryByRole('button', { name: /Facebook/ })).toBeNull();
  });

  it('escolher uma rede mostra o aviso (sem conversas do WhatsApp); voltar ao WhatsApp traz as conversas', async () => {
    const fake = inboxFake();
    renderAt('/inbox', fake);
    await click(await screen.findByRole('button', { name: 'Instagram @loja' }));
    expect(await screen.findByRole('button', { name: /Maria da Rede Teste/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Cliente Um/ })).toBeNull();
    expect(fake.api.socialConversations).toHaveBeenCalledWith('acc-ig', null, expect.anything());

    await click(screen.getByRole('button', { name: 'WhatsApp' }));
    expect(await (await listRegion()).findByRole('link', { name: /Cliente Um/ })).toBeTruthy();
  });

  it('sem a Zernio configurada, a Inbox segue só com o WhatsApp', async () => {
    const offline = { accounts: vi.fn(async () => fail('A integração com a Zernio ainda não foi configurada.', 409)) } as unknown as SocialApi;
    renderAt('/inbox', inboxFake(), OWNER, 60_000, offline);
    const channels = within(await screen.findByRole('group', { name: 'Filtrar por canal' }));
    expect(channels.getByRole('button', { name: 'WhatsApp' })).toBeTruthy();
    expect(channels.queryAllByRole('button')).toHaveLength(2);
  });
});

describe('Inbox: conversa e detalhes', () => {
  it('abre a conversa: histórico com quem enviou, situação de cada mensagem, erro e mídia; marca como lida', async () => {
    const fake = inboxFake();
    renderAt('/inbox', fake);
    await click(await (await listRegion()).findByRole('link', { name: /Cliente Um/ }));
    expect(view()).toBe('chat');
    expect(await screen.findByRole('heading', { level: 2, name: 'Cliente Um' })).toBeTruthy();
    const messages = await thread();
    expect(await messages.findByText('Olá, preciso de ajuda com o pedido')).toBeTruthy();
    expect(messages.getAllByText('Maria Teste')).toHaveLength(2);
    expect(messages.getByText('Pelo celular')).toBeTruthy();
    expect(messages.getByRole('img', { name: 'Lida' })).toBeTruthy();
    expect(messages.getByRole('img', { name: 'Entregue' })).toBeTruthy();
    expect(messages.getByRole('img', { name: 'Não enviada' })).toBeTruthy();
    expect(messages.getByText(/O WhatsApp desta conta está desconectado/)).toBeTruthy();
    expect(messages.getByText(/\[Imagem\]/)).toBeTruthy();
    expect(messages.getByText('foto do produto')).toBeTruthy();
    expect(messages.getByText('Hoje')).toBeTruthy();

    await waitFor(() => expect(fake.api.markRead).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Conversas' })).queryByLabelText('2 não lidas')).toBeNull());
  });

  it('a coluna de detalhes mostra contato, canal, conta, responsável, modo e o que vem depois', async () => {
    const fake = inboxFake();
    renderAt('/inbox/c2', fake);
    await screen.findByRole('heading', { level: 2, name: '+55 11 90000-0002' });
    const aside = details();
    expect(aside.getByText('WhatsApp')).toBeTruthy();
    expect(aside.getByText('Atendimento')).toBeTruthy();
    expect(aside.getByText('Maria Teste')).toBeTruthy();
    expect(aside.getByText('Atendimento humano')).toBeTruthy();
    const future = within(aside.getByRole('list', { name: 'Em desenvolvimento' }));
    expect(future.getAllByText('Em desenvolvimento')).toHaveLength(4);
    expect(future.getByText(/Etiquetas/)).toBeTruthy();
    expect(future.getByText(/Agente de IA/)).toBeTruthy();
    expect(future.getByText(/Automações/)).toBeTruthy();
  });

  it('conversa inexistente (ou de outra empresa): mensagem e caminho de volta', async () => {
    renderAt('/inbox/de-outra-empresa', inboxFake());
    expect(await screen.findByText('Conversa não encontrada.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Voltar para as conversas' }).getAttribute('href')).toBe('/inbox');
  });
});

describe('Inbox: navegação no celular (uma coluna por vez)', () => {
  it('lista → conversa → detalhes → conversa → lista, pelo endereço', async () => {
    const fake = inboxFake();
    renderAt('/inbox', fake);
    const first = await (await listRegion()).findByRole('link', { name: /Cliente Um/ });
    expect(view()).toBe('list');
    await click(first);
    expect(view()).toBe('chat');
    await click(await screen.findByRole('link', { name: 'Ver detalhes do contato' }));
    expect(view()).toBe('details');
    expect(document.querySelector('.inbox__details--open')).toBeTruthy();
    await click(screen.getByRole('link', { name: 'Fechar detalhes' }));
    expect(view()).toBe('chat');
    await click(screen.getByRole('link', { name: 'Voltar para as conversas' }));
    expect(view()).toBe('list');
  });

  it('o endereço de detalhes abre direto na coluna de detalhes', async () => {
    renderAt('/inbox/c1/detalhes', inboxFake());
    await screen.findByRole('heading', { level: 2, name: 'Cliente Um' });
    expect(view()).toBe('details');
  });
});

describe('Inbox: responder', () => {
  it('envia com um identificador de pedido, mostra a mensagem e limpa o campo', async () => {
    const fake = inboxFake();
    renderAt('/inbox/c1', fake);
    const field = await screen.findByRole('textbox', { name: 'Mensagem para Cliente Um' });
    fireEvent.change(field, { target: { value: '  Resposta de teste  ' } });
    await click(screen.getByRole('button', { name: 'Enviar' }));
    expect(fake.api.send).toHaveBeenCalledWith('c1', { requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), text: 'Resposta de teste' });
    expect(await (await thread()).findByText('Resposta de teste')).toBeTruthy();
    expect((field as HTMLTextAreaElement).value).toBe('');
  });

  it('falha de rede: avisa e, ao tentar de novo, usa o mesmo pedido (nunca envia duas vezes)', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(fail('Não foi possível falar com o servidor. Verifique se a API está ligada.', 0))
      .mockResolvedValueOnce(ok({ message: message('novo', { direction: 'outbound', author: 'user', authorName: 'Maria Teste', text: 'Tentando de novo', status: 'sent' }), replayed: true }));
    const fake = inboxFake({ send });
    renderAt('/inbox/c1', fake);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Mensagem para Cliente Um' }), { target: { value: 'Tentando de novo' } });
    await click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText(/Não foi possível falar com o servidor/)).toBeTruthy();
    await click(screen.getByRole('button', { name: 'Enviar' }));
    expect(send).toHaveBeenCalledTimes(2);
    const first = send.mock.calls[0]?.[1] as { requestId: string };
    const second = send.mock.calls[1]?.[1] as { requestId: string };
    expect(second.requestId).toBe(first.requestId);
  });

  it('Enter envia; Shift+Enter não envia (quebra a linha)', async () => {
    const fake = inboxFake();
    renderAt('/inbox/c1', fake);
    const field = await screen.findByRole('textbox', { name: 'Mensagem para Cliente Um' });
    fireEvent.change(field, { target: { value: 'Linha um' } });
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });
    expect(fake.api.send).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' });
    });
    expect(fake.api.send).toHaveBeenCalledTimes(1);
  });

  it('sem texto, o botão fica desligado', async () => {
    renderAt('/inbox/c1', inboxFake());
    await screen.findByRole('textbox', { name: 'Mensagem para Cliente Um' });
    expect((screen.getByRole('button', { name: 'Enviar' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Inbox: tempo real e consulta periódica', () => {
  it('aviso de mensagem nova relê a lista e a conversa aberta', async () => {
    const fake = inboxFake();
    renderAt('/inbox/c1', fake);
    await (await thread()).findByText('Olá, preciso de ajuda com o pedido');
    const lists = vi.mocked(fake.api.conversations).mock.calls.length;
    const details = vi.mocked(fake.api.conversation).mock.calls.length;
    fake.emit({ type: 'conversation', conversationId: 'c1' });
    await waitFor(() => expect(vi.mocked(fake.api.conversation).mock.calls.length).toBeGreaterThan(details));
    await waitFor(() => expect(vi.mocked(fake.api.conversations).mock.calls.length).toBeGreaterThan(lists));
  });

  it('aviso de outra conversa relê só a lista; aviso de recebimento relê os canais', async () => {
    const fake = inboxFake();
    renderAt('/inbox/c1', fake);
    await (await thread()).findByText('Olá, preciso de ajuda com o pedido');
    await waitFor(() => expect(fake.api.markRead).toHaveBeenCalled());
    const details = vi.mocked(fake.api.conversation).mock.calls.length;
    const channels = vi.mocked(fake.api.channels).mock.calls.length;
    fake.emit({ type: 'conversation', conversationId: 'c2' });
    fake.emit({ type: 'reception', conversationId: null });
    await waitFor(() => expect(vi.mocked(fake.api.channels).mock.calls.length).toBeGreaterThan(channels));
    expect(vi.mocked(fake.api.conversation).mock.calls.length).toBe(details);
  });

  it('sem o canal em tempo real, o painel consulta de tempos em tempos; com ele, não', async () => {
    const fake = inboxFake();
    renderAt('/inbox', fake, OWNER, 40);
    await (await listRegion()).findByRole('link', { name: /Cliente Um/ });
    const before = vi.mocked(fake.api.conversations).mock.calls.length;
    await waitFor(() => expect(vi.mocked(fake.api.conversations).mock.calls.length).toBeGreaterThanOrEqual(before + 2));

    fake.live('up');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    const settled = vi.mocked(fake.api.conversations).mock.calls.length;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(vi.mocked(fake.api.conversations).mock.calls.length).toBe(settled);
  });

  it('reconectou (novo "ready"): confere o que pode ter chegado no intervalo', async () => {
    const fake = inboxFake();
    renderAt('/inbox', fake);
    await (await listRegion()).findByRole('link', { name: /Cliente Um/ });
    fake.emit({ type: 'ready', conversationId: null });
    const before = vi.mocked(fake.api.conversations).mock.calls.length;
    fake.emit({ type: 'ready', conversationId: null });
    await waitFor(() => expect(vi.mocked(fake.api.conversations).mock.calls.length).toBeGreaterThan(before));
  });
});

describe('Inbox: avisos de recebimento', () => {
  it('recebimento desligado na plataforma (antes da homologação)', async () => {
    renderAt('/inbox', inboxFake({}, channelsOf({ reception: { state: 'disabled', since: null }, activationAvailable: false })));
    expect(await screen.findByText(/ainda não foi ligado nesta plataforma/)).toBeTruthy();
  });

  it('chave recusada e período sem recebimento', async () => {
    const channels = channelsOf({ reception: { state: 'auth_failed', since: NOW }, gaps: [{ accountId: 'i1', startedAt: '2026-11-03T10:00:00.000Z', endedAt: null }] });
    renderAt('/inbox', inboxFake({}, channels));
    expect(await screen.findByText(/recusou a chave da plataforma/)).toBeTruthy();
    expect(screen.getByText(/Atendimento: o recebimento está interrompido desde/)).toBeTruthy();
  });

  it('nenhum número recebendo: o dono é levado a Integrações', async () => {
    const channels = channelsOf({ channels: [{ ...channelsOf().channels[0]!, inboxEnabledAt: null }] });
    renderAt('/inbox', inboxFake({}, channels));
    expect((await screen.findByRole('link', { name: 'Integrações → WhatsApp' })).getAttribute('href')).toBe('/integracoes#whatsapp');
  });
});

describe('Inbox: permissões', () => {
  it('o visualizador não usa a Inbox (nenhuma chamada à API)', async () => {
    const fake = inboxFake();
    renderAt('/inbox', fake, VIEWER);
    expect(await screen.findByText(/A Inbox é usada pelo dono, pelos administradores e pelos atendentes/)).toBeTruthy();
    expect(fake.api.conversations).not.toHaveBeenCalled();
    expect(fake.api.subscribe).not.toHaveBeenCalled();
  });

  it('conta sem empresa (Super-Admin da plataforma)', async () => {
    const fake = inboxFake();
    renderAt('/inbox', fake, SUPER_NO_ORG);
    expect(await screen.findByText('Sem empresa nesta conta')).toBeTruthy();
    expect(fake.api.channels).not.toHaveBeenCalled();
  });

  it('o atendente usa a Inbox normalmente', async () => {
    const fake = inboxFake();
    renderAt('/inbox/c1', fake, OPERATOR);
    expect(await screen.findByRole('textbox', { name: 'Mensagem para Cliente Um' })).toBeTruthy();
  });
});

// ----- Integrações → WhatsApp: botão "Receber mensagens na Inbox" -----

const CONNECTED: WhatsAppInstance = { id: 'i1', displayName: 'Atendimento', status: 'connected', phone: '5511955550001', createdAt: ENABLED_AT, connectedAt: ENABLED_AT };

function whatsappFake(canManage = true): WhatsAppApi {
  return {
    list: vi.fn(async () => ok({ instances: [CONNECTED], limit: 1, canManage, integration: 'ready' as const })),
    listAll: vi.fn(async () => ok({ instances: [] })),
  } as unknown as WhatsAppApi;
}

const zernioIdle = {
  status: vi.fn(async () => ok({ available: true, configured: false, status: null, keyLast4: null, accountName: null, profileName: null, lastCheckAt: null, canManage: false })),
  accounts: vi.fn(async () => fail('A integração com a Zernio ainda não foi configurada.', 409)),
} as unknown as ZernioApi;

function renderIntegrations(fake: Fake, session: SessionInfo = OWNER, canManage = true) {
  render(
    <MemoryRouter initialEntries={['/integracoes']}>
      <App authApi={fakeAuth(session)} inboxApi={fake.api} whatsappApi={whatsappFake(canManage)} zernioApi={zernioIdle} fetchHealth={async () => ({ status: 'ok', service: 'x', timestamp: NOW })} fetchReady={async () => true} />
    </MemoryRouter>,
  );
}

describe('Integrações: receber mensagens na Inbox', () => {
  it('antes da homologação o botão aparece desligado, com o motivo, e nada é chamado', async () => {
    const fake = inboxFake({}, channelsOf({ channels: [{ ...channelsOf().channels[0]!, inboxEnabledAt: null }], activationAvailable: false, reception: { state: 'disabled', since: null } }));
    renderIntegrations(fake);
    const group = within(await screen.findByRole('group', { name: 'Inbox de Atendimento' }));
    const button = group.getByRole('button', { name: 'Receber mensagens na Inbox' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(group.getByText('Liberado depois da homologação com uma instância de teste.')).toBeTruthy();
    expect(fake.api.setReception).not.toHaveBeenCalled();
  });

  it('liberado: o dono confirma e o número passa a receber; depois pode parar', async () => {
    const fake = inboxFake({}, channelsOf({ channels: [{ ...channelsOf().channels[0]!, inboxEnabledAt: null }] }));
    renderIntegrations(fake);
    const group = within(await screen.findByRole('group', { name: 'Inbox de Atendimento' }));
    await click(group.getByRole('button', { name: 'Receber mensagens na Inbox' }));
    expect(fake.api.setReception).not.toHaveBeenCalled();
    const confirm = within(screen.getByRole('group', { name: 'Confirmar recebimento na Inbox' }));
    expect(confirm.getByText(/O número continua conectado/)).toBeTruthy();
    await click(confirm.getByRole('button', { name: 'Confirmar' }));
    expect(fake.api.setReception).toHaveBeenCalledWith('i1', true);
    expect(await screen.findByText(/Recebendo mensagens na/)).toBeTruthy();

    await click(screen.getByRole('button', { name: 'Parar de receber na Inbox' }));
    await click(within(screen.getByRole('group', { name: 'Confirmar parada do recebimento' })).getByRole('button', { name: 'Parar de receber' }));
    expect(fake.api.setReception).toHaveBeenLastCalledWith('i1', false);
    expect(await screen.findByText('Este número ainda não recebe mensagens na Inbox.')).toBeTruthy();
  });

  it('o atendente vê a situação, mas não tem o botão; o visualizador nem consulta a Inbox', async () => {
    const fake = inboxFake();
    renderIntegrations(fake, OPERATOR, false);
    const group = within(await screen.findByRole('group', { name: 'Inbox de Atendimento' }));
    expect(group.getByText(/Recebendo mensagens na/)).toBeTruthy();
    expect(group.queryByRole('button')).toBeNull();
    cleanup();

    const forViewer = inboxFake();
    renderIntegrations(forViewer, VIEWER, false);
    await screen.findByRole('heading', { name: /Instâncias da empresa/ });
    expect(forViewer.api.channels).not.toHaveBeenCalled();
    expect(screen.queryByRole('group', { name: 'Inbox de Atendimento' })).toBeNull();
  });
});

describe('Inbox: correções Z2.2 (canais, filtros, avisos e identificação)', () => {
  it('TikTok (autorizado em 2026-11-05): lista as conversas, sem abrir mensagens nem permitir resposta', async () => {
    const fake = inboxFake();
    renderAt('/inbox', fake);
    await click(await screen.findByRole('button', { name: 'TikTok @lojatt' }));
    expect(await screen.findByText(/As conversas do TikTok aparecem na lista/)).toBeTruthy();
    expect(fake.api.socialConversations).toHaveBeenCalledWith('acc-tt', null, expect.anything());
    expect(screen.queryByRole('textbox', { name: /Resposta para/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Diagnosticar datas' })).toBeNull();
  });

  it('com uma rede escolhida, os filtros que não se aplicam somem; a conta aparece com o rótulo de conta conectada', async () => {
    renderAt('/inbox', inboxFake());
    await click(await screen.findByRole('button', { name: 'Instagram @loja' }));
    expect(await screen.findByText('Conta conectada')).toBeTruthy();
    expect(screen.queryByRole('searchbox', { name: 'Buscar conversa por nome ou número' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Filtrar por conta' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Filtrar conversas' })).toBeNull();
  });

  it('o aviso de recebimento do WhatsApp aparece em "Todos" e some quando a rede é escolhida', async () => {
    const fake = inboxFake({}, channelsOf({ reception: { state: 'disabled', since: null }, activationAvailable: false }));
    renderAt('/inbox', fake);
    expect(await screen.findByText(/ainda não foi ligado nesta plataforma/)).toBeTruthy();
    await click(await screen.findByRole('button', { name: 'Instagram @loja' }));
    await screen.findByText('Conta conectada');
    expect(screen.queryByText(/ainda não foi ligado nesta plataforma/)).toBeNull();
  });

  it('"Todos os canais" reúne as conversas do WhatsApp e as do Instagram, cada uma com a conta de origem', async () => {
    renderAt('/inbox', inboxFake());
    const list = await listRegion();
    expect(await list.findByRole('link', { name: /Cliente Um/ })).toBeTruthy();
    expect(await list.findByRole('button', { name: /Maria da Rede Teste/ })).toBeTruthy();
    expect(list.getByText('Conversa com cliente · @loja')).toBeTruthy();
  });

  it('"Todos": escolher a conta do Instagram mostra só as conversas dela', async () => {
    renderAt('/inbox', inboxFake());
    await screen.findByRole('link', { name: /Cliente Um/ });
    fireEvent.change(screen.getByRole('combobox', { name: 'Filtrar por conta' }), { target: { value: 'social:acc-ig' } });
    const list = await listRegion();
    expect(await list.findByRole('button', { name: /Maria da Rede Teste/ })).toBeTruthy();
    expect(list.queryByRole('link', { name: /Cliente Um/ })).toBeNull();
  });

  it('a conversa do Instagram aberta mostra o histórico, e o contato não aparece como conta', async () => {
    renderAt('/inbox', inboxFake());
    await click(await screen.findByRole('button', { name: 'Instagram @loja' }));
    await click(await screen.findByRole('button', { name: /Maria da Rede Teste/ }));
    const chat = within(await screen.findByRole('region', { name: 'Conversa' }));
    expect(chat.getByRole('heading', { level: 2, name: 'Maria da Rede Teste' })).toBeTruthy();
    expect(chat.getByText(/@loja/)).toBeTruthy();
  });
});

describe('Inbox: diagnóstico temporário das datas (Z2.4)', () => {
  it('dono escolhe "Diagnosticar datas" na lista: o resultado traz só datas, e nenhuma página de mensagens é lida', async () => {
    const fake = inboxFake();
    renderAt('/inbox', fake, OWNER);
    await click(await screen.findByRole('button', { name: 'Instagram @loja' }));
    await click(await screen.findByRole('button', { name: 'Diagnosticar datas' }));
    expect(await screen.findByText(/Ordem da Zernio bate com sentAt: sim/)).toBeTruthy();
    expect(fake.api.socialDateDiagnostic).toHaveBeenCalledWith('sc1', 'acc-ig');
    expect(fake.api.socialMessages).not.toHaveBeenCalled();
  });

  it('atendente não vê o botão de diagnóstico', async () => {
    renderAt('/inbox', inboxFake(), OPERATOR);
    await click(await screen.findByRole('button', { name: 'Instagram @loja' }));
    await screen.findByRole('button', { name: /Maria da Rede Teste/ });
    expect(screen.queryByRole('button', { name: 'Diagnosticar datas' })).toBeNull();
  });
});

describe('Inbox: janela de resposta e histórico confiável (Z3.1)', () => {
  it('mostra o estado da janela e o campo de resposta; o botão só fica ligado com texto', async () => {
    renderAt('/inbox', inboxFake());
    await click(await screen.findByRole('button', { name: 'Instagram @loja' }));
    await click(await screen.findByRole('button', { name: /Maria da Rede Teste/ }));
    expect(await screen.findByText(/Janela aberta: resposta sem tag/)).toBeTruthy();
    const field = screen.getByRole('textbox', { name: /Resposta para/ }) as HTMLTextAreaElement;
    expect(field.disabled).toBe(false);
    expect(field.maxLength).toBe(1000);
    expect((screen.getByRole('button', { name: 'Enviar' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('envia a resposta pela caixa com um pedido novo e mostra a confirmação', async () => {
    const fake = inboxFake();
    renderAt('/inbox', fake);
    await click(await screen.findByRole('button', { name: 'Instagram @loja' }));
    await click(await screen.findByRole('button', { name: /Maria da Rede Teste/ }));
    await screen.findByText(/Janela aberta: resposta sem tag/);
    fireEvent.change(screen.getByRole('textbox', { name: /Resposta para/ }), { target: { value: '  Olá, tudo bem?  ' } });
    await click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText('Mensagem enviada ao Instagram.')).toBeTruthy();
    expect(fake.api.socialSend).toHaveBeenCalledTimes(1);
    expect(fake.api.socialSend).toHaveBeenCalledWith({ accountId: 'acc-ig', conversationId: 'sc1', requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), text: 'Olá, tudo bem?' });
    expect((screen.getByRole('textbox', { name: /Resposta para/ }) as HTMLTextAreaElement).value).toBe('');
  });

  it('falha de rede: repetir o envio usa o mesmo pedido, então não duplica a mensagem', async () => {
    const socialSend = vi
      .fn()
      .mockResolvedValueOnce(fail('Sem conexão com o servidor.', 0))
      .mockResolvedValueOnce(ok({ status: 'sent', replayed: true, providerMessageId: 'mid_teste_1', message: 'Mensagem enviada ao Instagram.' }));
    const fake = inboxFake({ socialSend });
    renderAt('/inbox', fake);
    await click(await screen.findByRole('button', { name: 'Instagram @loja' }));
    await click(await screen.findByRole('button', { name: /Maria da Rede Teste/ }));
    await screen.findByText(/Janela aberta: resposta sem tag/);
    fireEvent.change(screen.getByRole('textbox', { name: /Resposta para/ }), { target: { value: 'Oi' } });
    await click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText('Sem conexão com o servidor.')).toBeTruthy();
    await click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText('Mensagem enviada ao Instagram.')).toBeTruthy();
    expect(socialSend).toHaveBeenCalledTimes(2);
    const calls = socialSend.mock.calls as unknown as Array<[{ requestId: string }]>;
    expect(calls[0]?.[0].requestId).toBeTruthy();
    expect(calls[0]?.[0].requestId).toBe(calls[1]?.[0].requestId);
  });

  it('atendente (operator) também pode responder pelo Instagram', async () => {
    renderAt('/inbox', inboxFake(), OPERATOR);
    await click(await screen.findByRole('button', { name: 'Instagram @loja' }));
    await click(await screen.findByRole('button', { name: /Maria da Rede Teste/ }));
    await screen.findByText(/Janela aberta: resposta sem tag/);
    expect((screen.getByRole('textbox', { name: /Resposta para/ }) as HTMLTextAreaElement).disabled).toBe(false);
  });

  it('histórico não confirmado: avisa, esconde "ver anteriores" e bloqueia a janela', async () => {
    const unreliable = inboxFake({ socialMessages: vi.fn(async () => ok({ messages: SOCIAL_MESSAGES, hasMore: true, nextCursor: 'c2', sortOrderApplied: 'asc' as const, historyReliable: false })) });
    renderAt('/inbox', unreliable);
    await click(await screen.findByRole('button', { name: 'Instagram @loja' }));
    await click(await screen.findByRole('button', { name: /Maria da Rede Teste/ }));
    expect(await screen.findByText(/A ordem do histórico não foi confirmada/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ver mensagens anteriores' })).toBeNull();
    expect(screen.getByText(/Histórico não confirmado: envio bloqueado/)).toBeTruthy();
  });
});
