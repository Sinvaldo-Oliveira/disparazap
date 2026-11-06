import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  zonedDateKey,
  zonedLocalToDate,
  type SessionInfo,
  type SocialAccount,
  type SocialAnalytics,
  type SocialLibrary,
  type SocialOverview,
  type SocialPost,
  type SocialPostInput,
  type SocialPostsQuery,
} from '@disparazap/contracts';
import { App } from '../../app/App';
import type { AuthApi } from '../../auth/auth-api';
import type { SocialApi } from '../../social/social-api';

afterEach(cleanup);

// Tudo fictício: sessões, contas, publicações e endereços (.test)
const OWNER: SessionInfo = { user: { id: 'u1', name: 'Maria Teste', email: 'maria@empresa.test' }, userType: 'company_admin', organization: { id: 'o1', name: 'Empresa Teste', role: 'owner' } };
const VIEWER: SessionInfo = { ...OWNER, organization: { id: 'o1', name: 'Empresa Teste', role: 'viewer' } };
const SUPER_NO_ORG: SessionInfo = { user: { id: 'u0', name: 'Dono Plataforma', email: 'dono@disparazap.test' }, userType: 'super_admin', organization: null };
const TZ = 'America/Sao_Paulo';
const WHEN = '2026-11-02T12:00:00.000Z';

const account = (id: string, platform: string, username: string, extra: Partial<SocialAccount> = {}): SocialAccount => ({ id, platform, username, displayName: null, state: 'ok', publishable: true, reason: null, ...extra });
const ACCOUNTS: SocialAccount[] = [
  account('acc-ig', 'instagram', 'loja'),
  account('acc-li', 'linkedin', 'empresa'),
  account('acc-x', 'twitter', 'loja_x'),
  account('acc-tt', 'tiktok', 'loja_tt', { publishable: false, reason: 'Esta rede publica só vídeo, que chega na próxima etapa do módulo.' }),
  account('acc-fb', 'facebook', 'pagina', { state: 'needs_reconnect', publishable: false, reason: 'Precisa ser reconectada em Integrações.' }),
];

const LIBRARY: SocialLibrary = {
  items: [
    { id: 'img-1', mimeType: 'image/png', size: 120_000, fileName: 'banner.png', createdAt: WHEN, usedByTemplate: false },
    { id: 'img-2', mimeType: 'image/webp', size: 2_400_000, fileName: 'foto-loja.webp', createdAt: WHEN, usedByTemplate: true },
  ],
  limit: 200,
  canUpload: true,
  canDelete: true,
};

const todayAt = (time: string) => (zonedLocalToDate(`${zonedDateKey(new Date(), TZ)}T${time}`, TZ) as Date).toISOString();

function makePost(id: string, extra: Partial<SocialPost> = {}): SocialPost {
  return {
    id,
    status: 'scheduled',
    content: `Texto da publicação ${id}`,
    scheduledFor: '2030-12-01T13:00:00.000Z',
    publishedAt: null,
    occursAt: '2030-12-01T13:00:00.000Z',
    timezone: TZ,
    targets: [{ platform: 'linkedin', accountId: 'acc-li', accountLabel: '@empresa', format: 'post', customContent: null, status: 'pending', url: null, publishedAt: null, error: null, pinterest: null }],
    media: [],
    createdInApp: true,
    createdByName: 'Maria Teste',
    updatedAt: WHEN,
    ...extra,
  };
}

const FAILED = makePost('p-falhou', {
  status: 'partial',
  scheduledFor: null,
  publishedAt: WHEN,
  occursAt: WHEN,
  targets: [
    { platform: 'linkedin', accountId: 'acc-li', accountLabel: '@empresa', format: 'post', customContent: null, status: 'published', url: 'https://social.exemplo.test/li/1', publishedAt: WHEN, error: null, pinterest: null },
    {
      platform: 'instagram',
      accountId: 'acc-ig',
      accountLabel: '@loja',
      format: 'post',
      customContent: null,
      status: 'failed',
      url: null,
      publishedAt: null,
      error: { category: 'user_content', message: 'A rede recusou o conteúdo (formato, tamanho ou texto fora das regras dela). Ajuste e tente de novo.', action: 'fix_content' },
      pinterest: null,
    },
  ],
});

const ok = <T,>(data: T) => ({ ok: true as const, data });
const fail = (message: string, status: number) => ({ ok: false as const, message, status });

function overviewOf(extra: Partial<SocialOverview> = {}): SocialOverview {
  return {
    connection: 'ok',
    timezone: TZ,
    canPublish: true,
    canManage: true,
    accounts: ACCOUNTS,
    counts: { published: 12, scheduled: 3, failed: 1, drafts: 2 },
    upcoming: [makePost('p-proxima')],
    alerts: [
      { kind: 'reconnect', message: 'Facebook @pagina: a autorização venceu. Reconecte em Integrações para voltar a publicar.' },
      { kind: 'failed_posts', message: '1 publicação com falha nos últimos 30 dias. Veja no Histórico.' },
    ],
    performance: {
      state: 'available',
      days: 30,
      from: '2026-10-04',
      to: '2026-11-02',
      postCount: 4,
      totals: { impressions: 4800, reach: 3200, likes: 410, comments: 37, shares: 12, saves: 9, clicks: 51, views: 5100 },
      byPlatform: [],
      daily: [],
      topPosts: [],
    },
    syncedAt: WHEN,
    ...extra,
  };
}

interface FakeOptions {
  overview?: SocialOverview;
  posts?: SocialPost[];
  analytics?: SocialAnalytics;
  canPublish?: boolean;
  library?: SocialLibrary;
}

function socialFake({ overview = overviewOf(), posts = [FAILED, makePost('p-agendada'), makePost('p-hoje', { occursAt: todayAt('15:00'), scheduledFor: todayAt('15:00') })], analytics, canPublish = true, library = LIBRARY }: FakeOptions = {}) {
  let list = [...posts];
  const resultOf = (post: SocialPost) => ok({ post, replayed: false });
  const api = {
    overview: vi.fn(async () => ok(overview)),
    accounts: vi.fn(async () => ok({ connection: overview.connection, accounts: overview.accounts, timezone: TZ, canPublish, canManage: canPublish })),
    posts: vi.fn(async (_query: SocialPostsQuery) => ok({ posts: list, total: list.length, page: 1, pageSize: 50, timezone: TZ, syncedAt: WHEN, syncError: null, canPublish, canManage: canPublish })),
    getPost: vi.fn(async (id: string) => {
      const found = list.find((post) => post.id === id);
      return found ? ok(found) : fail('Publicação não encontrada.', 404);
    }),
    create: vi.fn(async (input: SocialPostInput) =>
      resultOf(
        makePost('p-nova', {
          status: input.mode === 'now' ? 'partial' : input.mode === 'schedule' ? 'scheduled' : 'draft',
          content: input.content ?? '',
          targets: [FAILED.targets[0], FAILED.targets[1]] as SocialPost['targets'],
        }),
      ),
    ),
    update: vi.fn(async (id: string, input: SocialPostInput) => resultOf(makePost(id, { content: input.content ?? '' }))),
    reschedule: vi.fn(async (id: string, _at: string) => resultOf(makePost(id, { scheduledFor: '2030-12-05T15:00:00.000Z', occursAt: '2030-12-05T15:00:00.000Z' }))),
    remove: vi.fn(async (id: string) => {
      list = list.filter((post) => post.id !== id);
      return ok(null);
    }),
    retry: vi.fn(async (id: string) => resultOf(makePost(id, { status: 'published', targets: FAILED.targets.map((target) => ({ ...target, status: 'published' as const, error: null })) }))),
    unpublish: vi.fn(async (id: string) => resultOf(makePost(id))),
    settings: vi.fn(async () => ok({ timezone: TZ, canManage: canPublish })),
    saveSettings: vi.fn(async (timezone: string) => ok({ timezone, canManage: true })),
    analytics: vi.fn(async (_days: number) => ok(analytics ?? (overview.performance as SocialAnalytics))),
    library: vi.fn(async () => ok(library)),
    uploadMedia: vi.fn(async (_file: File) => ok({ id: 'img-nova', mimeType: 'image/png' as const, size: 1000 })),
    deleteMedia: vi.fn(async () => ok(null)),
    pinterestBoards: vi.fn(async () => ok({ boards: [{ id: 'b1', name: 'Promoções' }] })),
  } satisfies SocialApi;
  return api;
}

function fakeAuth(session: SessionInfo): AuthApi {
  return {
    getSession: vi.fn(async () => session),
    signIn: vi.fn(async () => ({ ok: true as const, session })),
    signUp: vi.fn(async () => ({ ok: true as const, session })),
    signOut: vi.fn(async () => {}),
  };
}

function renderAt(path: string, api: SocialApi, session: SessionInfo = OWNER) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App authApi={fakeAuth(session)} socialApi={api} contactSearchDelayMs={0} fetchHealth={async () => ({ status: 'ok', service: 'disparazap-api', timestamp: WHEN })} fetchReady={async () => true} />
    </MemoryRouter>,
  );
}

const click = async (element: HTMLElement) => {
  await act(async () => {
    fireEvent.click(element);
  });
};

describe('Redes Sociais: seção e visão geral', () => {
  it('o menu leva à seção, com as abas, e a visão geral mostra números, alertas, próximas publicações e contas', async () => {
    const api = socialFake();
    renderAt('/redes-sociais', api);
    expect(await screen.findByRole('heading', { level: 1, name: 'Redes Sociais' })).toBeTruthy();
    const tabs = within(screen.getByRole('navigation', { name: 'Seções de Redes Sociais' }));
    expect(tabs.getAllByRole('link').map((link) => link.textContent)).toEqual(['Visão Geral', 'Criar publicação', 'Calendário', 'Histórico', 'Biblioteca', 'Resultados', 'Interações']);
    const summary = within(await screen.findByRole('region', { name: 'Resumo das publicações' }));
    expect(summary.getByText('Publicadas').nextSibling?.textContent).toBe('12');
    expect(summary.getByText('Com falha').nextSibling?.textContent).toBe('1');
    expect(screen.getByText(/Facebook @pagina: a autorização venceu/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ver no Histórico' }).getAttribute('href')).toBe('/redes-sociais/historico?status=failed');
    expect(within(screen.getByRole('region', { name: 'Próximas publicações' })).getByText(/Texto da publicação p-proxima/)).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Contas conectadas' })).getByText(/só vídeo/)).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Desempenho dos últimos 30 dias' })).getByText('4.800')).toBeTruthy();
    expect(summary.getByRole('link', { name: /Criar publicação/ }).getAttribute('href')).toBe('/redes-sociais/criar');
  });

  it('o dono troca o fuso horário da empresa', async () => {
    const api = socialFake();
    renderAt('/redes-sociais', api);
    const select = (await screen.findByLabelText('Fuso horário da empresa')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'America/Manaus' } });
    await click(screen.getByRole('button', { name: 'Salvar' }));
    expect(api.saveSettings).toHaveBeenCalledWith('America/Manaus');
    expect(await screen.findByText('Fuso horário salvo.')).toBeTruthy();
  });

  it('sem Zernio configurada, leva a Integrações e não mostra números inventados', async () => {
    const api = socialFake({ overview: overviewOf({ connection: 'not_configured', accounts: [], counts: { published: 0, scheduled: 0, failed: 0, drafts: 0 }, upcoming: [], alerts: [], performance: null }) });
    renderAt('/redes-sociais', api);
    expect(await screen.findByRole('heading', { name: 'Conecte as redes sociais' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ir para Integrações' }).getAttribute('href')).toBe('/integracoes#zernio');
    expect(within(screen.getByRole('region', { name: 'Resumo das publicações' })).queryByRole('link', { name: /Criar publicação/ })).toBeNull();
  });

  it('visualizador não vê o botão de publicar e o formulário avisa quem pode; conta sem empresa vê o aviso', async () => {
    const api = socialFake({ overview: overviewOf({ canPublish: false, canManage: false }), canPublish: false });
    renderAt('/redes-sociais', api, VIEWER);
    expect(within(await screen.findByRole('region', { name: 'Resumo das publicações' })).queryByRole('link', { name: /Criar publicação/ })).toBeNull();
    expect(screen.getByText(/Só o dono e os administradores mudam o fuso/)).toBeTruthy();
    cleanup();

    renderAt('/redes-sociais/criar', api, VIEWER);
    expect(await screen.findByText(/só o dono, os administradores e os operadores da empresa publicam/)).toBeTruthy();
    cleanup();

    renderAt('/redes-sociais', socialFake(), SUPER_NO_ORG);
    expect(await screen.findByText('Sem empresa nesta conta')).toBeTruthy();
  });
});

describe('Redes Sociais: criar publicação', () => {
  it('regras de cada rede ao vivo; publicar agora pede confirmação e mostra o resultado de cada rede', async () => {
    const api = socialFake();
    renderAt('/redes-sociais/criar', api);
    await screen.findByRole('heading', { name: '1. Onde publicar' });
    expect((screen.getByRole('checkbox', { name: /TikTok @loja_tt/ }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('checkbox', { name: /Facebook @pagina/ }) as HTMLInputElement).disabled).toBe(true);

    await click(screen.getByRole('checkbox', { name: /Instagram @loja/ }));
    fireEvent.change(screen.getByLabelText('Texto da publicação'), { target: { value: 'Novidade na loja #promo' } });
    expect(screen.getByText('Instagram @loja: precisa de uma imagem.')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Publicar agora/ }) as HTMLButtonElement).disabled).toBe(true);

    await click(screen.getByRole('button', { name: /Escolher da biblioteca/ }));
    // WebP não serve no Instagram
    await click(screen.getByRole('button', { name: 'Usar foto-loja.webp' }));
    expect(screen.getByText(/Instagram @loja: aceita só JPEG, PNG/)).toBeTruthy();
    await click(screen.getByRole('button', { name: 'Tirar foto-loja.webp' }));
    await click(screen.getByRole('button', { name: 'Usar banner.png' }));
    expect(screen.queryByRole('list', { name: 'O que falta ajustar' })).toBeNull();

    await click(screen.getByRole('checkbox', { name: /LinkedIn @empresa/ }));
    await click(screen.getByRole('checkbox', { name: 'Texto próprio para LinkedIn @empresa' }));
    fireEvent.change(screen.getByLabelText('Texto para LinkedIn @empresa'), { target: { value: 'Versão para o LinkedIn' } });
    expect(within(screen.getByRole('complementary', { name: 'Prévia por rede' })).getByText('Versão para o LinkedIn')).toBeTruthy();

    await click(screen.getByRole('button', { name: /Publicar agora/ }));
    expect(api.create).not.toHaveBeenCalled();
    await click(within(screen.getByRole('alertdialog', { name: 'Confirmar publicação' })).getByRole('button', { name: /Confirmar e publicar/ }));
    expect(api.create).toHaveBeenCalledTimes(1);
    const input = api.create.mock.calls[0]?.[0] as SocialPostInput;
    expect(input.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(input).toMatchObject({
      content: 'Novidade na loja #promo',
      media: [{ kind: 'library', id: 'img-1' }],
      mode: 'now',
      scheduledAt: null,
      targets: [
        { accountId: 'acc-ig', platform: 'instagram', format: 'post', customContent: null, pinterest: null },
        { accountId: 'acc-li', platform: 'linkedin', format: 'post', customContent: 'Versão para o LinkedIn', pinterest: null },
      ],
    });
    const result = within(await screen.findByRole('region', { name: 'Resultado da publicação' }));
    expect(result.getByText('Publicado em parte: algumas redes falharam')).toBeTruthy();
    expect(result.getByText(/A rede recusou o conteúdo/)).toBeTruthy();
    expect(result.getByRole('link', { name: 'Ver na rede' }).getAttribute('href')).toBe('https://social.exemplo.test/li/1');
  });

  it('X: aviso de custo e limite de 280 caracteres; agendar manda a data no fuso da empresa (sem confirmação)', async () => {
    const api = socialFake();
    renderAt('/redes-sociais/criar', api);
    await screen.findByRole('heading', { name: '1. Onde publicar' });
    await click(screen.getByRole('checkbox', { name: /X \(Twitter\) @loja_x/ }));
    expect(screen.getByText(/O X cobra por post na conta Zernio da empresa/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Texto da publicação'), { target: { value: 'x'.repeat(281) } });
    expect(screen.getByText(/passa de 280 caracteres/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Texto da publicação'), { target: { value: 'Promoção da semana' } });

    await click(screen.getByRole('radio', { name: 'Agendar' }));
    fireEvent.change(screen.getByLabelText(/Data e hora/), { target: { value: '2030-12-01T10:00' } });
    await click(screen.getByRole('button', { name: /Agendar publicação/ }));
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ mode: 'schedule', scheduledAt: '2030-12-01T10:00', content: 'Promoção da semana' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('editar um rascunho vem preenchido e salva pela mesma publicação', async () => {
    const draft = makePost('p-rascunho', {
      status: 'draft',
      scheduledFor: null,
      content: 'Ideia guardada',
      media: [{ kind: 'library', id: 'img-1', url: '/api/internal/media/img-1' }],
      targets: [{ platform: 'linkedin', accountId: 'acc-li', accountLabel: '@empresa', format: 'post', customContent: 'Só no LinkedIn', status: 'pending', url: null, publishedAt: null, error: null, pinterest: null }],
    });
    const api = socialFake({ posts: [draft] });
    renderAt('/redes-sociais/criar/p-rascunho', api);
    expect(await screen.findByText(/Editando a publicação em rascunho/)).toBeTruthy();
    expect((screen.getByLabelText('Texto da publicação') as HTMLTextAreaElement).value).toBe('Ideia guardada');
    expect((screen.getByLabelText('Texto para LinkedIn @empresa') as HTMLTextAreaElement).value).toBe('Só no LinkedIn');
    expect((screen.getByRole('radio', { name: 'Salvar como rascunho' }) as HTMLInputElement).checked).toBe(true);
    await click(screen.getByRole('button', { name: /Salvar alterações/ }));
    expect(api.update).toHaveBeenCalledWith('p-rascunho', expect.objectContaining({ mode: 'draft', content: 'Ideia guardada', media: [{ kind: 'library', id: 'img-1' }] }));
  });
});

describe('Redes Sociais: histórico e calendário', () => {
  it('histórico com o motivo da falha; filtro na URL; tentar de novo e excluir pedem confirmação', async () => {
    const api = socialFake();
    renderAt('/redes-sociais/historico?status=partial', api);
    expect(await screen.findByText(/Instagram: A rede recusou o conteúdo/)).toBeTruthy();
    expect(api.posts).toHaveBeenCalledWith(expect.objectContaining({ status: 'partial', page: 1 }), expect.anything());

    fireEvent.change(screen.getByLabelText('Filtrar por rede'), { target: { value: 'instagram' } });
    await waitFor(() => expect(api.posts).toHaveBeenLastCalledWith(expect.objectContaining({ platform: 'instagram' }), expect.anything()));

    const rows = screen.getAllByRole('button', { name: /Detalhes da publicação/ });
    await click(rows[0] as HTMLElement);
    const dialog = within(await screen.findByRole('dialog', { name: 'Detalhes da publicação' }));
    expect(dialog.getByText('Criada no DisparaZap por Maria Teste · horário de Brasília')).toBeTruthy();
    await click(dialog.getByRole('button', { name: /Tentar de novo/ }));
    expect(api.retry).not.toHaveBeenCalled();
    await click(within(screen.getByRole('alertdialog', { name: 'Confirmar ação' })).getByRole('button', { name: 'Tentar de novo' }));
    expect(api.retry).toHaveBeenCalledWith('p-falhou');
    expect(await screen.findByText(/Nova tentativa feita/)).toBeTruthy();
    await click(screen.getByRole('button', { name: 'Fechar detalhes' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cancelar um agendado pelos detalhes', async () => {
    const api = socialFake();
    renderAt('/redes-sociais/historico', api);
    await screen.findAllByRole('button', { name: /Detalhes da publicação/ });
    const scheduledRow = screen.getByText('Texto da publicação p-agendada').closest('tr') as HTMLElement;
    await click(within(scheduledRow).getByRole('button', { name: /Detalhes/ }));
    await click(await screen.findByRole('button', { name: /Cancelar agendamento/ }));
    await click(within(screen.getByRole('alertdialog', { name: 'Confirmar ação' })).getByRole('button', { name: 'Excluir publicação' }));
    expect(api.remove).toHaveBeenCalledWith('p-agendada');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('calendário no fuso da empresa: a publicação de hoje aparece no dia; reagendar pelos detalhes; visão de dia', async () => {
    const api = socialFake();
    renderAt('/redes-sociais/calendario', api);
    const today = zonedDateKey(new Date(), TZ);
    await waitFor(() => expect(api.posts).toHaveBeenCalled());
    const query = api.posts.mock.calls.at(-1)?.[0] as SocialPostsQuery;
    expect(Date.parse(query.from ?? '')).toBeLessThanOrEqual(Date.parse(todayAt('00:00')));
    const cell = (await screen.findAllByRole('gridcell')).find((item) => item.className.includes('calendar__cell--today')) as HTMLElement;
    expect(cell.getAttribute('aria-label')).toContain(`${Number(today.slice(8))} de`);
    await click(await within(cell).findByRole('button', { name: /15:00/ }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Detalhes da publicação' }));
    await click(dialog.getByRole('button', { name: /Reagendar/ }));
    fireEvent.change(screen.getByLabelText(/Nova data e hora/), { target: { value: '2030-12-05T12:00' } });
    await click(screen.getByRole('button', { name: 'Salvar novo horário' }));
    expect(api.reschedule).toHaveBeenCalledWith('p-hoje', '2030-12-05T12:00');
    await click(screen.getByRole('button', { name: 'Fechar detalhes' }));

    await click(screen.getByRole('radio', { name: 'Dia' }));
    expect(await screen.findByRole('list', { name: /Publicações de/ })).toBeTruthy();
  });
});

describe('Redes Sociais: biblioteca e resultados', () => {
  it('biblioteca: busca pelo nome, envio e exclusão com confirmação', async () => {
    const api = socialFake();
    renderAt('/redes-sociais/biblioteca', api);
    expect(await screen.findByText('banner.png')).toBeTruthy();
    expect(screen.getByText('Usada em modelo de mensagem')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Buscar pelo nome do arquivo'), { target: { value: 'LOJA' } });
    expect(screen.queryByText('banner.png')).toBeNull();
    expect(screen.getByText('foto-loja.webp')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Buscar pelo nome do arquivo'), { target: { value: '' } });

    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'nova.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Enviar imagens para a biblioteca'), { target: { files: [file] } });
    });
    expect(api.uploadMedia).toHaveBeenCalledWith(file);
    expect(await screen.findByText('Imagem enviada.')).toBeTruthy();

    await click(screen.getByRole('button', { name: 'Excluir banner.png' }));
    await click(within(screen.getByRole('alertdialog', { name: 'Confirmar exclusão da imagem' })).getByRole('button', { name: 'Excluir imagem' }));
    expect(api.deleteMedia).toHaveBeenCalledWith('img-1');
  });

  it('quem não administra não vê os botões de excluir', async () => {
    const api = socialFake({ library: { ...LIBRARY, canDelete: false } });
    renderAt('/redes-sociais/biblioteca', api);
    await screen.findByText('banner.png');
    expect(screen.queryByRole('button', { name: /Excluir/ })).toBeNull();
  });

  it('resultados: só números reais, "—" onde a rede não informa; período troca a consulta; plano sem métricas avisa', async () => {
    const analytics: SocialAnalytics = {
      state: 'available',
      days: 30,
      from: '2026-10-04',
      to: '2026-11-02',
      postCount: 2,
      totals: { impressions: 240, reach: 160, likes: 24, comments: 6, shares: 4, saves: 2, clicks: 4, views: 300 },
      byPlatform: [{ platform: 'instagram', postCount: 2, metrics: { impressions: 240, reach: 160, likes: 24, comments: 6, shares: 4, saves: 2, clicks: 0, views: 300 } }],
      daily: [],
      topPosts: [{ platform: 'instagram', content: 'Post campeão', publishedAt: WHEN, url: 'https://social.exemplo.test/ig/1', metrics: { impressions: 120, reach: 80, likes: 12, comments: 3, shares: 2, saves: 1, clicks: 0, views: 150 } }],
    };
    const api = socialFake({ analytics });
    renderAt('/redes-sociais/resultados', api);
    const byNetwork = within(await screen.findByRole('region', { name: 'Por rede' }));
    const row = byNetwork.getAllByRole('row')[1] as HTMLElement;
    // Instagram não informa cliques: "—", nunca 0
    expect(within(row).getAllByRole('cell').map((cell) => cell.textContent)).toContain('—');
    expect(screen.getByText('Post campeão')).toBeTruthy();
    await click(screen.getByRole('radio', { name: '7 dias' }));
    expect(api.analytics).toHaveBeenLastCalledWith(7, expect.anything());
    cleanup();

    const locked = socialFake({ analytics: { state: 'unavailable', reason: 'plan', message: 'A sua conta Zernio não inclui as métricas.' } });
    renderAt('/redes-sociais/resultados', locked);
    expect(await screen.findByText('A sua conta Zernio não inclui as métricas.')).toBeTruthy();
  });
});
