import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTIVITY_REFRESH_MS, type AutomationDetail, type AutomationSummary, type AutomationsOverview, type FlowSummary, type SessionInfo } from '@disparazap/contracts';
import { App } from '../../app/App';
import type { AuthApi } from '../../auth/auth-api';
import type { AutomationsApi } from '../../automations/automations-api';
import { keywordsText } from '../../automations/automation-text';
import { personalize } from './AutomationBuilder';

afterEach(cleanup);
// A primeira tela do arquivo carrega o painel inteiro: sob a carga da suíte completa, 5 s às vezes não bastam
vi.setConfig({ testTimeout: 20_000 });

// Tudo fictício: sessão, contas, textos e endereços (.test)
const OWNER: SessionInfo = { user: { id: 'u1', name: 'Maria Teste', email: 'maria@empresa.test' }, userType: 'company_admin', organization: { id: 'o1', name: 'Empresa Teste', role: 'owner' } };
const NOW = new Date().toISOString();
const ok = <T,>(data: T) => ({ ok: true as const, data });
const fail = (message: string, status: number) => ({ ok: false as const, message, status });

const COMMENT: AutomationSummary = {
  id: 'auto_1',
  kind: 'comment',
  name: 'Catálogo por DM',
  platform: 'instagram',
  accountId: 'acc-ig',
  accountName: '@loja',
  trigger: 'comment',
  keywords: ['preço', 'valor'],
  matchMode: 'word',
  postBound: false,
  postTitle: null,
  isActive: false,
  repeat: { mode: 'once', cooldownHours: null },
  followersOnly: false,
  hasDm: true,
  hasPublicReply: true,
  stats: { triggered: 12, dmsSent: 10, dmsFailed: 1, uniqueContacts: 9, linkClicks: 4, followGateSent: 0, followGatePassed: 0 },
  createdAt: NOW,
};
const STORY: AutomationSummary = {
  ...COMMENT,
  id: 'auto_2',
  name: 'Obrigado pela menção',
  trigger: 'story_mention',
  keywords: [],
  isActive: true,
  repeat: { mode: 'every_comment', cooldownHours: 24 },
  followersOnly: true,
  hasPublicReply: false,
  stats: { triggered: 0, dmsSent: 0, dmsFailed: 0, uniqueContacts: 0, linkClicks: 0, followGateSent: 0, followGatePassed: 0 },
};
const TIKTOK: AutomationSummary = { ...COMMENT, id: 'auto_3', name: 'Resposta no TikTok', platform: 'tiktok', accountId: 'acc-tt', accountName: '@lojatt', isActive: true, postBound: true, postTitle: 'Vídeo de lançamento', hasDm: false };

function overviewOf(extra: Partial<AutomationsOverview> = {}): AutomationsOverview {
  return {
    accounts: [
      { id: 'acc-ig', platform: 'instagram', name: '@loja', capability: 'full' },
      { id: 'acc-tt', platform: 'tiktok', name: '@lojatt', capability: 'public_reply' },
    ],
    automations: [COMMENT, STORY, TIKTOK],
    totals: { active: 2, dmsSent: 1234, linkClicks: 8 },
    writeEnabled: false,
    canManage: true,
    ...extra,
  };
}
function detailOf(extra: Partial<AutomationDetail> = {}): AutomationDetail {
  return {
    automation: COMMENT,
    writeEnabled: false,
    canManage: true,
    dmMessage: 'Oi {{first_name}}, aqui está o catálogo!',
    buttons: [{ type: 'url', title: 'Ver catálogo', url: 'https://loja.exemplo.test/catalogo' }],
    commentReply: 'Te mandei no direct!',
    publicReplyPolicy: 'after_dm',
    alsoMatchInDms: false,
    followGate: null,
    ...extra,
  };
}

function fakeAuth(session: SessionInfo): AuthApi {
  return { getSession: vi.fn(async () => session), signIn: vi.fn(), signUp: vi.fn(), signOut: vi.fn(async () => {}) } as unknown as AuthApi;
}

function fakeApi(overrides: Partial<AutomationsApi> = {}, writeEnabled = false): AutomationsApi {
  return {
    overview: vi.fn(async () => ok(overviewOf({ writeEnabled }))),
    detail: vi.fn(async (id: string) => (id === 'auto_1' ? ok(detailOf({ writeEnabled })) : fail('Automação não encontrada nesta empresa.', 404))),
    create: vi.fn(async () => ok(detailOf({ writeEnabled }))),
    update: vi.fn(async () => ok(detailOf({ writeEnabled }))),
    setState: vi.fn(async (_id: string, active: boolean) => ok(detailOf({ writeEnabled, automation: { ...COMMENT, isActive: active } }))),
    remove: vi.fn(async () => ok(null)),
    flows: vi.fn(async () => ok({ flows: [], writeEnabled, canManage: true })),
    createFlow: vi.fn(async (input: { name: string; ref: string }) => ok(flowOf({ name: input.name, ref: input.ref, link: `https://ig.me/m/loja?ref=${input.ref}` }))),
    setFlowState: vi.fn(async (_id: string, active: boolean) => ok(flowOf({ isActive: active, status: active ? 'active' : 'paused' }))),
    removeFlow: vi.fn(async () => ok(null)),
    flowQr: vi.fn(async () => ok({ link: 'https://ig.me/m/loja?ref=boas-vindas', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' })),
    createQuestionFlow: vi.fn(async (input: { name: string }) => ok(flowOf({ kind: 'question', name: input.name, ref: null, link: null }))),
    activity: vi.fn(async () => ok({ entries: [], total: 0, misses: null, canManage: true })),
    ...overrides,
  };
}

function flowOf(extra: Partial<FlowSummary> = {}): FlowSummary {
  return { id: 'wf_1', name: 'Link de boas-vindas', accountId: 'acc-ig', accountName: '@loja', kind: 'link', ref: 'boas-vindas', link: 'https://ig.me/m/loja?ref=boas-vindas', status: 'paused', isActive: false, nodeCount: 4, totalStarted: 0, totalCompleted: 0, ...extra };
}

function renderAt(path: string, api: AutomationsApi) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App authApi={fakeAuth(OWNER)} automationsApi={api} fetchHealth={async () => ({ status: 'ok', service: 'x', timestamp: NOW })} fetchReady={async () => true} />
    </MemoryRouter>,
  );
}

const click = async (element: HTMLElement) => {
  await act(async () => {
    fireEvent.click(element);
  });
};
const type = (element: HTMLElement, value: string) => fireEvent.change(element, { target: { value } });
const builder = async () => within(await screen.findByRole('form', { name: 'Construtor de automação' }));

describe('Automações (A1): consulta das automações de redes', () => {
  it('lista cada automação com a frase do que faz, conta, repetição e situação; números no topo; aviso da trava', async () => {
    renderAt('/automacoes', fakeApi());
    const list = within(await screen.findByRole('list', { name: 'Automações' }));
    expect(list.getByText('Quando alguém comentar “preço” ou “valor” em qualquer publicação → envia uma DM e responde em público')).toBeTruthy();
    expect(list.getByText('Quando alguém mencionar a conta num story → envia uma DM (só para seguidores)')).toBeTruthy();
    expect(list.getByText('Quando alguém comentar “preço” ou “valor” na publicação “Vídeo de lançamento” → responde em público')).toBeTruthy();
    expect(list.getAllByText('Ativa')).toHaveLength(2);
    expect(list.getByText('Pausada')).toBeTruthy();
    expect(list.getByText(/Sempre, com espera de 24 h/)).toBeTruthy();
    expect(screen.getByText('1.234')).toBeTruthy();
    expect(screen.getByText(/está desligado nesta plataforma até a homologação/)).toBeTruthy();
  });

  it('mostra o que cada rede permite; modelos da A2 disponíveis para o dono, os demais como próxima etapa; nenhum botão de ativar na lista', async () => {
    renderAt('/automacoes', fakeApi());
    const section = within(await screen.findByRole('region', { name: 'Redes sociais' }));
    expect(await section.findByText('Instagram: DM, botões, só seguidores e story')).toBeTruthy();
    expect(section.getByText('TikTok: só resposta pública')).toBeTruthy();
    expect(section.getByRole('link', { name: /Nova automação/ })).toBeTruthy();
    expect(section.getByRole('link', { name: 'Usar o modelo Comentário → DM' })).toBeTruthy();
    expect(section.getByRole('link', { name: 'Usar o modelo Comentário → resposta pública' })).toBeTruthy();
    expect(section.getByRole('link', { name: 'Usar o modelo Só seguidores' })).toBeTruthy();
    expect(section.getByRole('link', { name: 'Usar o modelo Menção em story → DM' })).toBeTruthy();
    expect(section.getByRole('link', { name: 'Usar o modelo Link ou QR → conversa' })).toBeTruthy();
    expect(section.getByRole('link', { name: 'Usar o modelo Comentário → perguntar antes' })).toBeTruthy();
    expect(section.queryAllByText('Próxima etapa')).toHaveLength(0);
    expect(section.queryAllByRole('button', { name: /ativar|pausar|excluir/i })).toHaveLength(0);
  });

  it('quem não gerencia não vê criar nem usar modelo', async () => {
    renderAt('/automacoes', fakeApi({ overview: vi.fn(async () => ok(overviewOf({ canManage: false }))) }));
    const section = within(await screen.findByRole('region', { name: 'Redes sociais' }));
    await section.findByText('TikTok: só resposta pública');
    expect(section.queryByRole('link', { name: /Nova automação/ })).toBeNull();
    expect(section.queryByRole('link', { name: /Usar o modelo/ })).toBeNull();
    expect(section.getAllByText('Dono e administradores')).toHaveLength(6);
  });

  it('abre o detalhe (como funciona, o que a pessoa recebe e números) e volta para a lista', async () => {
    const api = fakeApi();
    renderAt('/automacoes', api);
    await click(await screen.findByRole('link', { name: /Catálogo por DM/ }));
    const detail = within(await screen.findByRole('region', { name: 'Automação' }));
    expect(await detail.findByText('Oi {{first_name}}, aqui está o catálogo!')).toBeTruthy();
    expect(api.detail).toHaveBeenCalledWith('auto_1', expect.anything());
    expect(detail.getByText('“preço” ou “valor”, como palavra inteira')).toBeTruthy();
    expect(within(detail.getByRole('list', { name: 'Botões da mensagem' })).getByText('Ver catálogo')).toBeTruthy();
    expect(detail.getByText('Resposta pública (depois da DM)')).toBeTruthy();
    expect(detail.getByText('Uma vez por pessoa')).toBeTruthy();
    await click(detail.getByRole('link', { name: 'Automações' }));
    expect(await screen.findByRole('list', { name: 'Automações' })).toBeTruthy();
  });

  it('detalhe que não é da empresa mostra a mensagem do servidor; lista vazia e erro da API', async () => {
    renderAt('/automacoes/auto_outra', fakeApi());
    expect((await screen.findByRole('alert')).textContent).toBe('Automação não encontrada nesta empresa.');
    cleanup();
    renderAt('/automacoes', fakeApi({ overview: vi.fn(async () => ok(overviewOf({ automations: [], totals: { active: 0, dmsSent: 0, linkClicks: 0 } }))) }));
    expect(await screen.findByText('Nenhuma automação nas contas desta empresa ainda.')).toBeTruthy();
    cleanup();
    renderAt('/automacoes', fakeApi({ overview: vi.fn(async () => fail('A integração com a Zernio ainda não foi configurada nesta empresa.', 409)) }));
    expect((await screen.findByRole('alert')).textContent).toContain('ainda não foi configurada');
  });

  it('textos: palavras-chave (até 3) e prévia com nome de exemplo', () => {
    expect(keywordsText([])).toBe('qualquer coisa');
    expect(keywordsText(['link'])).toBe('“link”');
    expect(keywordsText(['a', 'b', 'c', 'd', 'e'])).toBe('“a”, “b” ou “c” (e mais 2)');
    expect(personalize('Oi {{first_name}} ({{ username }}), {{NAME}}')).toBe('Oi Ana (ana.cliente), Ana Souza');
  });
});

describe('Automações (A2): construtor, criação pausada e ações', () => {
  it('com a trava desligada, monta e mostra a prévia, mas salvar fica desligado', async () => {
    const api = fakeApi();
    renderAt('/automacoes/nova?modelo=dm', api);
    const form = await builder();
    expect(form.getByText(/Salvar está desligado nesta plataforma até a homologação/)).toBeTruthy();
    type(form.getByLabelText(/^Texto da DM/), 'Oi {{first_name}}! Segue o link.');
    expect(within(form.getByRole('complementary', { name: 'Prévia no celular' })).getByText('Oi Ana! Segue o link.')).toBeTruthy();
    expect((form.getByRole('button', { name: 'Salvar pausada' }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.create).not.toHaveBeenCalled();
  });

  it('com a trava ligada: valida antes de enviar, cria pausada e abre a página da automação', async () => {
    const api = fakeApi({}, true);
    renderAt('/automacoes/nova?modelo=dm', api);
    const form = await builder();
    expect((form.getByLabelText(/^Conta/) as HTMLSelectElement).value).toBe('acc-ig');
    type(form.getByLabelText('Nome da automação'), 'Catálogo por DM');
    type(form.getByLabelText(/^Texto da DM/), 'Oi {{first_name}}, aqui está o catálogo!');
    await click(form.getByRole('button', { name: 'Salvar pausada' }));
    expect(form.getByRole('alert').textContent).toBe('Informe pelo menos uma palavra-chave.');
    expect(api.create).not.toHaveBeenCalled();

    type(form.getByLabelText(/^Palavras-chave/), 'preço, valor');
    await click(form.getByRole('button', { name: /Adicionar botão/ }));
    type(form.getByLabelText('Rótulo do botão 1'), 'Ver catálogo');
    type(form.getByLabelText('Link do botão 1'), 'https://loja.exemplo.test/catalogo');
    await click(form.getByRole('button', { name: 'Salvar pausada' }));
    expect(api.create).toHaveBeenCalledWith({
      accountId: 'acc-ig',
      name: 'Catálogo por DM',
      trigger: 'comment',
      keywords: ['preço', 'valor'],
      matchMode: 'word',
      dmMessage: 'Oi {{first_name}}, aqui está o catálogo!',
      buttons: [{ title: 'Ver catálogo', url: 'https://loja.exemplo.test/catalogo' }],
      commentReply: null,
      followGate: null,
      repeat: { mode: 'once', cooldownHours: null },
    });
    expect(await screen.findByRole('region', { name: 'Automação' })).toBeTruthy();
  });

  it('modelo de resposta pública (TikTok): sem campo de DM e envio sem DM', async () => {
    const api = fakeApi({}, true);
    renderAt('/automacoes/nova?modelo=resposta', api);
    const form = await builder();
    expect((form.getByLabelText(/^Conta/) as HTMLSelectElement).value).toBe('acc-tt');
    expect(form.queryByLabelText(/^Texto da DM/)).toBeNull();
    type(form.getByLabelText(/^Palavras-chave/), 'preço');
    type(form.getByLabelText(/^Resposta pública/), 'Te respondemos no perfil!');
    await click(form.getByRole('button', { name: 'Salvar pausada' }));
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'acc-tt', name: 'Resposta pública', dmMessage: null, buttons: [], commentReply: 'Te respondemos no perfil!' }));
  });

  it('ativar pede confirmação (mensagens reais) e só então chama a API; pausar não pede', async () => {
    const api = fakeApi({}, true);
    renderAt('/automacoes/auto_1', api);
    const detail = within(await screen.findByRole('region', { name: 'Automação' }));
    await click(await detail.findByRole('button', { name: 'Ativar' }));
    expect(detail.getByRole('alertdialog').textContent).toContain('São mensagens reais, enviadas pela conta @loja.');
    expect(api.setState).not.toHaveBeenCalled();
    await click(detail.getByRole('button', { name: 'Confirmar ativação' }));
    expect(api.setState).toHaveBeenCalledWith('auto_1', true);
    expect(await detail.findByText('Automação ativada.')).toBeTruthy();
    await click(detail.getByRole('button', { name: 'Pausar' }));
    expect(api.setState).toHaveBeenLastCalledWith('auto_1', false);
    expect(await detail.findByText('Automação pausada.')).toBeTruthy();
  });

  it('excluir pede confirmação e volta para a lista; com a trava desligada, as ações ficam desligadas', async () => {
    const api = fakeApi({}, true);
    renderAt('/automacoes/auto_1', api);
    const detail = within(await screen.findByRole('region', { name: 'Automação' }));
    await click(await detail.findByRole('button', { name: 'Excluir' }));
    expect(api.remove).not.toHaveBeenCalled();
    await click(detail.getByRole('button', { name: 'Confirmar exclusão' }));
    expect(api.remove).toHaveBeenCalledWith('auto_1');
    expect(await screen.findByRole('list', { name: 'Automações' })).toBeTruthy();
    cleanup();

    renderAt('/automacoes/auto_1', fakeApi());
    const locked = within(await screen.findByRole('region', { name: 'Automação' }));
    expect(((await locked.findByRole('button', { name: 'Ativar' })) as HTMLButtonElement).disabled).toBe(true);
    expect((locked.getByRole('button', { name: 'Excluir' }) as HTMLButtonElement).disabled).toBe(true);
    expect(locked.getByText(/desligados nesta plataforma até a homologação/)).toBeTruthy();
  });

  it('editar: campos preenchidos, conta travada e salvar sem mudar a conta', async () => {
    const api = fakeApi({}, true);
    renderAt('/automacoes/auto_1/editar', api);
    const form = await builder();
    expect(((await form.findByLabelText('Nome da automação')) as HTMLInputElement).value).toBe('Catálogo por DM');
    expect((form.getByLabelText(/^Conta/) as HTMLSelectElement).disabled).toBe(true);
    expect((form.getByLabelText(/^Palavras-chave/) as HTMLInputElement).value).toBe('preço, valor');
    type(form.getByLabelText('Nome da automação'), 'Catálogo (novo)');
    await click(form.getByRole('button', { name: 'Salvar alterações' }));
    expect(api.update).toHaveBeenCalledWith('auto_1', expect.objectContaining({ name: 'Catálogo (novo)', keywords: ['preço', 'valor'], commentReply: 'Te mandei no direct!' }));
    expect(api.update).toHaveBeenCalledWith('auto_1', expect.not.objectContaining({ accountId: expect.anything() }));
  });
});

describe('Automações (A3): só seguidores e menção em story (Instagram)', () => {
  it('modelo só seguidores: cartão de verificação, prévia com o botão de confirmação e criação com a verificação', async () => {
    const api = fakeApi({}, true);
    renderAt('/automacoes/nova?modelo=seguidores', api);
    const form = await builder();
    expect((form.getByRole('checkbox', { name: /Só para quem segue a conta/ }) as HTMLInputElement).checked).toBe(true);
    type(form.getByLabelText(/^Palavras-chave/), 'cupom');
    type(form.getByLabelText(/^Texto da DM/), 'Seu cupom, {{first_name}}: SEGUIDOR10');
    const preview = within(form.getByRole('complementary', { name: 'Prévia no celular' }));
    expect(within(preview.getByLabelText('Prévia da verificação')).getByText('Já sigo')).toBeTruthy();
    expect(preview.getByText('Seu cupom, Ana: SEGUIDOR10')).toBeTruthy();
    await click(form.getByRole('button', { name: 'Salvar pausada' }));
    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-ig',
        trigger: 'comment',
        keywords: ['cupom'],
        followGate: {
          message: 'Quase lá! Toque no botão para confirmar que você segue a conta.',
          buttonLabel: 'Já sigo',
          notFollowingMessage: 'Ainda não encontramos você entre os seguidores. Siga a conta e toque no botão de novo.',
        },
      }),
    );
  });

  it('modelo menção em story: sem palavra-chave nem resposta pública e com espera de 24 h', async () => {
    const api = fakeApi({}, true);
    renderAt('/automacoes/nova?modelo=story', api);
    const form = await builder();
    expect((form.getByLabelText('O que dispara') as HTMLSelectElement).value).toBe('story_mention');
    expect(form.queryByLabelText(/^Palavras-chave/)).toBeNull();
    expect(form.queryByLabelText(/^Resposta pública no comentário/)).toBeNull();
    expect(form.queryByRole('checkbox', { name: /Só para quem segue a conta/ })).toBeNull();
    expect(form.getByText('mencionou você num story')).toBeTruthy();
    await click(form.getByRole('button', { name: 'Salvar pausada' }));
    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'story_mention', keywords: [], commentReply: null, followGate: null, repeat: { mode: 'every_comment', cooldownHours: 24 }, dmMessage: 'Obrigado por mencionar a gente no seu story, {{first_name}}!' }),
    );
  });

  it('trocar para uma conta que não é do Instagram volta ao comentário e mostra só a resposta pública', async () => {
    renderAt('/automacoes/nova?modelo=story', fakeApi({}, true));
    const form = await builder();
    fireEvent.change(form.getByLabelText(/^Conta/), { target: { value: 'acc-tt' } });
    expect(form.queryByLabelText('O que dispara')).toBeNull();
    expect(form.getByLabelText(/^Palavras-chave/)).toBeTruthy();
    expect(form.getByLabelText(/^Resposta pública/)).toBeTruthy();
  });

  it('detalhe de só seguidores mostra a verificação e os números dela; gatilho criado fora não tem Editar', async () => {
    const gated = detailOf({
      automation: { ...COMMENT, followersOnly: true, stats: { ...COMMENT.stats, followGateSent: 7, followGatePassed: 5 } },
      followGate: { message: 'Confirme que segue a conta.', buttonLabel: 'Já sigo', notFollowingMessage: 'Siga e toque de novo.' },
      publicReplyPolicy: 'always',
    });
    renderAt('/automacoes/auto_1', fakeApi({ detail: vi.fn(async () => ok(gated)) }));
    const detail = within(await screen.findByRole('region', { name: 'Automação' }));
    const gate = within(await detail.findByLabelText('Verificação de seguidor'));
    expect(gate.getByText('Confirme que segue a conta.')).toBeTruthy();
    expect(gate.getByText('Já sigo')).toBeTruthy();
    expect(detail.getByText(/Quem ainda não segue recebe: “Siga e toque de novo.”/)).toBeTruthy();
    expect(detail.getByText('Liberadas por seguidores')).toBeTruthy();
    expect(detail.getByText('Resposta pública (sempre)')).toBeTruthy();
    cleanup();

    renderAt('/automacoes/auto_1', fakeApi({ detail: vi.fn(async () => ok(detailOf({ automation: { ...COMMENT, trigger: 'story_reply', keywords: [] } }))) }));
    const foreign = within(await screen.findByRole('region', { name: 'Automação' }));
    expect(await foreign.findByText(/gatilho que o DisparaZap ainda não edita/)).toBeTruthy();
    expect(foreign.queryByRole('link', { name: 'Editar' })).toBeNull();
  });
});

describe('Automações (A5): link → conversa', () => {
  it('construtor: só contas do Instagram, prévia do link com o código em minúsculas e criação pausada', async () => {
    const api = fakeApi({}, true);
    renderAt('/automacoes/nova-fluxo', api);
    const form = within(await screen.findByRole('form', { name: 'Construtor de link' }));
    expect(form.getByLabelText(/^Conta/).querySelectorAll('option')).toHaveLength(1);
    type(form.getByLabelText(/^Nome do fluxo/), 'Promo de natal');
    type(form.getByLabelText(/^Código do link/), 'Promo-Natal');
    expect(form.getByText('ig.me/m/loja?ref=promo-natal')).toBeTruthy();
    await click(form.getByRole('button', { name: 'Criar pausado' }));
    expect(api.createFlow).toHaveBeenCalledWith({
      accountId: 'acc-ig',
      name: 'Promo de natal',
      ref: 'promo-natal',
      message: 'Oi! Obrigado por chegar pelo nosso link. Em que podemos ajudar?',
      tag: 'veio-do-link',
      cooldownHours: 24,
    });
  });

  it('código curto ou nome vazio: mostra o motivo e não envia', async () => {
    const api = fakeApi({}, true);
    renderAt('/automacoes/nova-fluxo', api);
    const form = within(await screen.findByRole('form', { name: 'Construtor de link' }));
    type(form.getByLabelText(/^Nome do fluxo/), 'Teste');
    type(form.getByLabelText(/^Código do link/), 'ab');
    await click(form.getByRole('button', { name: 'Criar pausado' }));
    expect(form.getByRole('alert').textContent).toContain('pelo menos 3');
    expect(api.createFlow).not.toHaveBeenCalled();
  });

  it('lista os links com o código e o botão de copiar; ativar pede confirmação e chama a API', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const api = fakeApi({ flows: vi.fn(async () => ok({ flows: [flowOf()], writeEnabled: true, canManage: true })) }, true);
    renderAt('/automacoes', api);
    const list = within(await screen.findByRole('list', { name: 'Links de conversa' }));
    expect(list.getByText('https://ig.me/m/loja?ref=boas-vindas')).toBeTruthy();
    expect(list.getByRole('button', { name: 'Copiar link de Link de boas-vindas' })).toBeTruthy();
    await click(list.getByRole('button', { name: 'Ativar' }));
    expect(confirm).toHaveBeenCalled();
    expect(api.setFlowState).toHaveBeenCalledWith('wf_1', true);
    confirm.mockRestore();
  });

  it('mostra o QR code do link ao pedir e esconde ao pedir de novo', async () => {
    const api = fakeApi({ flows: vi.fn(async () => ok({ flows: [flowOf()], writeEnabled: true, canManage: true })) }, true);
    renderAt('/automacoes', api);
    const list = within(await screen.findByRole('list', { name: 'Links de conversa' }));
    await click(list.getByRole('button', { name: 'Ver QR code' }));
    expect(api.flowQr).toHaveBeenCalledWith('wf_1');
    expect(list.getByRole('img', { name: 'QR code do link de Link de boas-vindas' }).getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=');
    await click(list.getByRole('button', { name: 'Ocultar QR code' }));
    expect(list.queryByRole('img', { name: /QR code do link/ })).toBeNull();
  });

  it('quem não gerencia vê o link, mas não tem ativar, pausar, excluir nem criar', async () => {
    const api = fakeApi(
      {
        overview: vi.fn(async () => ok(overviewOf({ canManage: false }))),
        flows: vi.fn(async () => ok({ flows: [flowOf()], writeEnabled: true, canManage: false })),
      },
      true,
    );
    renderAt('/automacoes', api);
    const list = within(await screen.findByRole('list', { name: 'Links de conversa' }));
    expect(list.getByText('https://ig.me/m/loja?ref=boas-vindas')).toBeTruthy();
    expect(list.queryByRole('button', { name: /Ativar|Pausar|Excluir/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Novo link/ })).toBeNull();
  });
});

describe('Automações (A4): atividade no detalhe', () => {
  it('mostra os registros com texto fixo e, para quem gerencia, os comentários que não casaram', async () => {
    const api = fakeApi(
      {
        activity: vi.fn(async () =>
          ok({ entries: [{ id: 'l1', status: 'sent', label: 'DM enviada', source: 'comment', at: NOW, clicks: 1 }], total: 1, misses: { total: 2, samples: [{ commentText: 'oi tudo bem', commenterName: 'Bia', excludedBy: null, at: NOW }] }, canManage: true }),
        ),
      },
      true,
    );
    renderAt('/automacoes/auto_1', api);
    const detail = within(await screen.findByRole('region', { name: 'Automação' }));
    const list = within(await detail.findByRole('list', { name: 'Registros de envio' }));
    expect(list.getByText('DM enviada')).toBeTruthy();
    expect(detail.getByRole('heading', { name: 'Comentários que não casaram (2)' })).toBeTruthy();
    expect(detail.getByText(/oi tudo bem/)).toBeTruthy();
    expect(api.activity).toHaveBeenCalledWith('auto_1', expect.anything());
  });

  it('quem só lê não recebe os comentários que não casaram', async () => {
    const api = fakeApi(
      {
        activity: vi.fn(async () => ok({ entries: [{ id: 'l1', status: 'skipped', label: 'Não enviada: regra de repetição ou intervalo entre respostas', source: 'comment', at: NOW, clicks: 0 }], total: 1, misses: null, canManage: false })),
      },
      true,
    );
    renderAt('/automacoes/auto_1', api);
    const detail = within(await screen.findByRole('region', { name: 'Automação' }));
    expect(await detail.findByText('Não enviada: regra de repetição ou intervalo entre respostas')).toBeTruthy();
    expect(detail.queryByRole('heading', { name: /Comentários que não casaram/ })).toBeNull();
  });

  it('a atividade se atualiza a cada 15 segundos', () => {
    expect(ACTIVITY_REFRESH_MS).toBe(15_000);
  });
});

describe('Automações (A6): comentário → perguntar antes do link', () => {
  it('construtor: palavras-chave separadas por vírgula, pergunta em texto e criação pausada', async () => {
    const api = fakeApi({}, true);
    renderAt('/automacoes/nova-pergunta', api);
    const form = within(await screen.findByRole('form', { name: 'Construtor de pergunta antes do link' }));
    type(form.getByLabelText(/^Nome do fluxo/), 'Pergunta do guia');
    type(form.getByLabelText(/^Palavras-chave/), 'guia, material');
    type(form.getByLabelText(/^Link do botão/), 'https://loja.exemplo.test/guia.pdf');
    await click(form.getByRole('button', { name: 'Criar pausado' }));
    expect(api.createQuestionFlow).toHaveBeenCalledWith({
      accountId: 'acc-ig',
      name: 'Pergunta do guia',
      keywords: ['guia', 'material'],
      question: 'Oi! Quer receber o material? Responda SIM que eu envio o link.',
      reward: 'Aqui está o link que você pediu:',
      buttonTitle: 'Quero o link',
      url: 'https://loja.exemplo.test/guia.pdf',
    });
  });

  it('sem palavra-chave ou com link sem https: mostra o motivo e não envia', async () => {
    const api = fakeApi({}, true);
    renderAt('/automacoes/nova-pergunta', api);
    const form = within(await screen.findByRole('form', { name: 'Construtor de pergunta antes do link' }));
    type(form.getByLabelText(/^Nome do fluxo/), 'Pergunta do guia');
    type(form.getByLabelText(/^Link do botão/), 'http://loja.exemplo.test/guia');
    await click(form.getByRole('button', { name: 'Criar pausado' }));
    expect(form.getByRole('alert').textContent).toContain('Informe pelo menos uma palavra-chave.');
    type(form.getByLabelText(/^Palavras-chave/), 'guia');
    await click(form.getByRole('button', { name: 'Criar pausado' }));
    expect(form.getByRole('alert').textContent).toContain('https://');
    expect(api.createQuestionFlow).not.toHaveBeenCalled();
  });

  it('a lista mostra a pergunta com o texto próprio, sem link para copiar', async () => {
    const api = fakeApi({ flows: vi.fn(async () => ok({ flows: [flowOf({ kind: 'question', name: 'Pergunta do guia', ref: null, link: null })], writeEnabled: true, canManage: true })) }, true);
    renderAt('/automacoes', api);
    const list = within(await screen.findByRole('list', { name: 'Links de conversa' }));
    expect(list.getByText('Pergunta do guia')).toBeTruthy();
    expect(list.getByText(/Pergunta antes do link: a conversa começa com um comentário/)).toBeTruthy();
    expect(list.queryByRole('button', { name: /Copiar link/ })).toBeNull();
    expect(list.queryByRole('button', { name: 'Ver QR code' })).toBeNull();
  });
});
