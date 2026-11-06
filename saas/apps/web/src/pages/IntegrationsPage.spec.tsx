import type { ZernioInboxAccessResult } from '@disparazap/contracts';
import { StrictMode, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionInfo, ZernioAccount, ZernioOutsideAccount, ZernioPlatform, ZernioReturnInput, ZernioStatus } from '@disparazap/contracts';
import { App } from '../app/App';
import type { AuthApi } from '../auth/auth-api';
import type { ZernioApi } from '../integrations/zernio-api';
import type { WhatsAppApi } from '../whatsapp/whatsapp-api';

afterEach(cleanup);

// Tudo fictício: sessões, chave, contas e endereços (.test)
const OWNER: SessionInfo = { user: { id: 'u1', name: 'Maria Teste', email: 'maria@empresa.test' }, userType: 'company_admin', organization: { id: 'o1', name: 'Empresa Teste', role: 'owner' } };
const VIEWER: SessionInfo = { ...OWNER, organization: { id: 'o1', name: 'Empresa Teste', role: 'viewer' } };
const SUPER_NO_ORG: SessionInfo = { user: { id: 'u0', name: 'Dono Plataforma', email: 'dono@disparazap.test' }, userType: 'super_admin', organization: null };
const WHEN = '2026-11-02T12:00:00.000Z';
const KEY = `sk_${'0123456789abcdef'.repeat(3)}fictic9f3c`;
const REFUSED_KEY = `sk_${'f'.repeat(48)}recusada`;

const UNCONFIGURED: ZernioStatus = { available: true, configured: false, status: null, keyLast4: null, accountName: null, profileName: null, lastCheckAt: null, canManage: true };
const configuredStatus = (last4: string, status: 'active' | 'invalid' = 'active'): ZernioStatus => ({
  available: true,
  configured: true,
  status,
  keyLast4: last4,
  accountName: 'Conta Zernio Teste',
  profileName: 'DisparaZap — Empresa Teste',
  lastCheckAt: WHEN,
  canManage: true,
});

const IG: ZernioAccount = { id: 'acc-ig', platform: 'instagram', username: 'loja', displayName: null, profileUrl: 'https://rede.exemplo.test/loja', state: 'ok' };
const FB: ZernioAccount = { id: 'acc-fb', platform: 'facebook', username: 'minhapagina', displayName: 'Minha Página', profileUrl: null, state: 'needs_reconnect' };
const BSKY: ZernioAccount = { id: 'acc-bs', platform: 'bluesky', username: 'loja.bsky.test', displayName: null, profileUrl: null, state: 'warning' };

const ok = <T,>(data: T) => ({ ok: true as const, data });
const fail = (message: string, status: number) => ({ ok: false as const, message, status });

interface FakeOptions {
  status?: ZernioStatus;
  accounts?: ZernioAccount[];
  /** Resposta do teste de acesso à Inbox (padrão: acesso confirmado) */
  inbox?: ZernioInboxAccessResult;
  inboxError?: string;
}

/** API falsa com estado: o que a página grava aparece na próxima leitura */
function zernioFake({ status = UNCONFIGURED, accounts = [], inbox = INBOX_CONFIRMED, inboxError }: FakeOptions = {}) {
  let current = status;
  let list = [...accounts];
  const api = {
    status: vi.fn(async () => ok(current)),
    saveKey: vi.fn(async (apiKey: string) => {
      if (apiKey === REFUSED_KEY) return fail('A Zernio recusou a chave. Confira se ela foi copiada inteira.', 400);
      current = { ...configuredStatus(apiKey.slice(-4)), canManage: current.canManage };
      return ok(current);
    }),
    removeKey: vi.fn(async () => {
      current = { ...UNCONFIGURED, canManage: current.canManage };
      return ok(null);
    }),
    accounts: vi.fn(async () => (current.configured ? ok({ accounts: list, teamAccountCount: list.length, outsideAccounts: [] as ZernioOutsideAccount[], canManage: current.canManage }) : fail('A integração com a Zernio ainda não foi configurada.', 409))),
    connect: vi.fn(async (platform: ZernioPlatform, _reconnect: string | null) =>
      platform === 'twitter' ? fail('O X (Twitter) exige um cartão cadastrado na sua conta Zernio desde a primeira conta.', 402) : ok({ authUrl: `https://zernio.exemplo.test/autorizar/${platform}` }),
    ),
    completeConnect: vi.fn(async (input: ZernioReturnInput) => {
      if (input.dz === 'vencido') return fail('O comprovante da conexão venceu. Conecte de novo.', 400);
      if (input.error) return ok({ ok: false, platform: 'instagram' as const, account: null, message: 'Você cancelou a autorização na rede.' });
      return ok({ ok: true, platform: 'instagram' as const, account: IG, message: 'Instagram @loja conectado.' });
    }),
    disconnect: vi.fn(async (id: string) => {
      list = list.filter((account) => account.id !== id);
      return ok(null);
    }),
    testInboxAccess: vi.fn(async () => (inboxError ? fail(inboxError, 503) : ok(inbox))),
  };
  return api;
}

type Fake = ReturnType<typeof zernioFake>;

const INBOX_CONFIRMED: ZernioInboxAccessResult = { outcome: 'confirmed', message: 'Acesso confirmado: a Zernio respondeu à consulta de leitura.', code: null, hasConversations: false, checkedAt: WHEN };

// WhatsApp sem instâncias: a seção dele aparece na mesma página, sem chamar servidor nenhum
const whatsappIdle = (canManage: boolean) =>
  ({
    list: vi.fn(async () => ({ ok: true as const, data: { instances: [], limit: 1, canManage, integration: 'ready' as const } })),
    listAll: vi.fn(async () => ({ ok: true as const, data: { instances: [] } })),
  }) as unknown as WhatsAppApi;

function authFake(session: SessionInfo | null): AuthApi {
  return {
    getSession: vi.fn(async () => session),
    signIn: vi.fn(async () => ({ ok: true as const, session: OWNER })),
    signUp: vi.fn(),
    signOut: vi.fn(async () => {}),
  } as unknown as AuthApi;
}

async function open({ path = '/integracoes', session = OWNER, zernio = zernioFake(), strict = false }: { path?: string; session?: SessionInfo | null; zernio?: Fake; strict?: boolean } = {}) {
  const redirect = vi.fn();
  const tree: ReactNode = (
    <MemoryRouter initialEntries={[path]}>
      <App
        authApi={authFake(session)}
        zernioApi={zernio as unknown as ZernioApi}
        whatsappApi={whatsappIdle(session?.organization?.role === 'owner' || session?.organization?.role === 'admin')}
        zernioRedirect={redirect}
        fetchHealth={async () => ({ status: 'ok', service: 'x', timestamp: WHEN })}
        fetchReady={async () => true}
      />
    </MemoryRouter>
  );
  render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  if (session) {
    await screen.findByRole('heading', { level: 1, name: 'Integrações' });
    // Espera a situação da Zernio chegar (as seções dependem dela)
    await waitFor(() => expect(screen.queryByText('Carregando a integração…')).toBeNull());
  }
  return { zernio, redirect };
}

const zernioSection = () => within(screen.getByRole('region', { name: 'Zernio' }));
const networks = () => within(screen.getByRole('region', { name: 'Redes sociais' }));
const statusText = (text: string) => screen.getAllByRole('status').find((el) => el.textContent?.includes(text));
const typeKey = (value: string) => fireEvent.change(screen.getByLabelText('Chave de API da Zernio'), { target: { value } });

describe('Integrações: catálogo e chave da Zernio', () => {
  it('mostra o catálogo: Zernio, WhatsApp (atalho) e API/MyLinksss em desenvolvimento', async () => {
    await open();
    const catalog = within(screen.getByRole('region', { name: 'Catálogo de integrações' }));
    expect(catalog.getByText('Zernio')).toBeTruthy();
    expect(await catalog.findByText('Não configurada')).toBeTruthy();
    expect(catalog.getByRole('link', { name: 'Ver instâncias' }).getAttribute('href')).toBe('#whatsapp');
    expect(catalog.getByRole('link', { name: 'Ver redes sociais' }).getAttribute('href')).toBe('#zernio');
    // Ordem dos cards: WhatsApp, Zernio e depois API/MyLinksss
    expect(catalog.getAllByRole('listitem').map((card) => card.querySelector('strong')?.textContent)).toEqual(['WhatsApp', 'Zernio', 'API e webhooks (MyLinksss)']);
    // A seção do WhatsApp (Evolution Go) vem logo abaixo dos cards, antes da Zernio
    const sections = [...document.querySelectorAll('main section[aria-label]')].map((section) => section.getAttribute('aria-label'));
    expect(sections.indexOf('WhatsApp')).toBeGreaterThan(sections.indexOf('Catálogo de integrações'));
    expect(sections.indexOf('WhatsApp')).toBeLessThan(sections.indexOf('Zernio'));
    const myLinksss = catalog.getByText('API e webhooks (MyLinksss)').closest('li') as HTMLElement;
    expect(within(myLinksss).getByText('Em desenvolvimento')).toBeTruthy();
    // O menu deixa de marcar Integrações como "Em desenvolvimento"
    expect(within(screen.getByRole('navigation', { name: 'Menu principal' })).getByRole('link', { name: /Integrações/ }).textContent).not.toContain('Em desenvolvimento');
  });

  it('chave em formato errado é recusada no painel, sem chamar a API', async () => {
    const { zernio } = await open();
    await zernioSection().findByLabelText('Chave de API da Zernio');
    typeKey('minha chave');
    fireEvent.click(screen.getByRole('button', { name: /Testar e salvar/ }));
    expect(screen.getByRole('alert').textContent).toContain('começa com sk_');
    expect(zernio.saveKey).not.toHaveBeenCalled();
  });

  it('salva a chave: mostra só o final, a conta e o perfil; a chave digitada some da tela', async () => {
    const { zernio } = await open();
    await zernioSection().findByLabelText('Chave de API da Zernio');
    typeKey(`  ${KEY} `);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Testar e salvar/ }));
    });
    expect(zernio.saveKey).toHaveBeenCalledWith(KEY);
    expect(statusText('Conta Zernio conectada')).toBeTruthy();
    expect(zernioSection().getByText('••••9f3c')).toBeTruthy();
    expect(zernioSection().getByText('Conta Zernio Teste')).toBeTruthy();
    expect(zernioSection().getByText('DisparaZap — Empresa Teste')).toBeTruthy();
    expect(document.body.innerHTML).not.toContain(KEY);
    expect(zernioSection().queryByLabelText('Chave de API da Zernio')).toBeNull();
    expect(await networks().findByText('Nenhuma rede conectada ainda.', { exact: false })).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Catálogo de integrações' })).getByText('Conectada')).toBeTruthy();
  });

  it('chave recusada pela Zernio: mostra o motivo e não salva nada', async () => {
    const { zernio } = await open();
    await zernioSection().findByLabelText('Chave de API da Zernio');
    typeKey(REFUSED_KEY);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Testar e salvar/ }));
    });
    expect(zernio.saveKey).toHaveBeenCalledWith(REFUSED_KEY);
    expect(screen.getByRole('alert').textContent).toContain('A Zernio recusou a chave');
    expect(screen.queryByRole('region', { name: 'Redes sociais' })).toBeNull();
  });

  it('trocar chave e remover a integração, com confirmação', async () => {
    const zernio = zernioFake({ status: configuredStatus('1a2b'), accounts: [IG] });
    await open({ zernio });
    fireEvent.click(await zernioSection().findByRole('button', { name: /Trocar chave/ }));
    expect(zernioSection().getByLabelText('Chave de API da Zernio')).toBeTruthy();
    fireEvent.click(zernioSection().getByRole('button', { name: 'Cancelar' }));
    expect(zernioSection().queryByLabelText('Chave de API da Zernio')).toBeNull();

    fireEvent.click(zernioSection().getByRole('button', { name: /Remover integração/ }));
    const dialog = within(screen.getByRole('alertdialog', { name: 'Confirmar remoção da integração' }));
    expect(dialog.getByText(/Nada muda na sua conta Zernio/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(dialog.getByRole('button', { name: 'Remover integração' }));
    });
    expect(zernio.removeKey).toHaveBeenCalledTimes(1);
    expect(statusText('Integração removida')).toBeTruthy();
    expect(await zernioSection().findByLabelText('Chave de API da Zernio')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Redes sociais' })).toBeNull();
  });

  it('chave recusada depois de salva (revogada na Zernio): aviso e conexões bloqueadas', async () => {
    await open({ zernio: zernioFake({ status: configuredStatus('1a2b', 'invalid') }) });
    expect((await zernioSection().findByRole('alert')).textContent).toContain('A Zernio recusou a chave guardada');
    expect(within(screen.getByRole('region', { name: 'Catálogo de integrações' })).getByText('Chave recusada')).toBeTruthy();
    expect((networks().getByRole('button', { name: 'Conectar Instagram' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Integrações: redes sociais', () => {
  it('conectar leva o navegador ao link de autorização; erro da API aparece sem sair da página', async () => {
    const { zernio, redirect } = await open({ zernio: zernioFake({ status: configuredStatus('1a2b') }) });
    await act(async () => {
      fireEvent.click(await networks().findByRole('button', { name: 'Conectar Instagram' }));
    });
    expect(zernio.connect).toHaveBeenCalledWith('instagram', null);
    expect(redirect).toHaveBeenCalledWith('https://zernio.exemplo.test/autorizar/instagram');
    cleanup();

    const second = await open({ zernio: zernioFake({ status: configuredStatus('1a2b') }) });
    expect(networks().getByText(/O X cobra por post/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(await networks().findByRole('button', { name: 'Conectar X (Twitter)' }));
    });
    expect(networks().getByRole('alert').textContent).toContain('exige um cartão');
    // Pagamento pedido pela Zernio (402): link para a cobrança da Zernio, em outra aba
    const billing = within(networks().getByRole('alert')).getByRole('link', { name: 'Abrir a cobrança na Zernio' });
    expect(billing.getAttribute('href')).toBe('https://zernio.com/dashboard/billing');
    expect(billing.getAttribute('rel')).toBe('noopener noreferrer');
    expect(second.redirect).not.toHaveBeenCalled();
  });

  it('a situação é relida depois de ler as redes: chave que voltou a funcionar libera os botões', async () => {
    const zernio = zernioFake({ status: configuredStatus('1a2b', 'invalid') });
    // No servidor, ler as redes com sucesso marca a integração como ativa de novo
    zernio.accounts.mockImplementation(async () => {
      zernio.status.mockImplementation(async () => ok(configuredStatus('1a2b')));
      return ok({ accounts: [], teamAccountCount: 0, outsideAccounts: [], canManage: true });
    });
    await open({ zernio });
    expect(await within(screen.getByRole('region', { name: 'Catálogo de integrações' })).findByText('Conectada')).toBeTruthy();
    expect((networks().getByRole('button', { name: 'Conectar Instagram' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('mostra o total de redes da conta Zernio inteira e avisa quando há rede fora do perfil do DisparaZap', async () => {
    const zernio = zernioFake({ status: configuredStatus('1a2b'), accounts: [IG] });
    zernio.accounts.mockImplementation(async () =>
      ok({ accounts: [IG], teamAccountCount: 2, outsideAccounts: [{ platform: 'instagram', username: 'loja', profileName: 'Default' }], canManage: true }),
    );
    await open({ zernio });
    const usage = await screen.findByRole('note', { name: 'Uso da conta Zernio' });
    expect(usage.textContent).toContain('2 redes conectadas');
    expect(usage.textContent).toContain('2 primeiras são grátis');
    expect(usage.textContent).toContain('fora do perfil do DisparaZap');
    expect(usage.textContent).toContain('Instagram @loja — perfil "Default"');
    expect(usage.textContent).toContain('desconecte a cópia');
    expect(usage.className).toContain('zernio-usage--warn');
    cleanup();

    await open({ zernio: zernioFake({ status: configuredStatus('1a2b'), accounts: [IG] }) });
    const same = await screen.findByRole('note', { name: 'Uso da conta Zernio' });
    expect(same.textContent).toContain('1 rede conectada');
    expect(same.textContent).not.toContain('fora do perfil');
  });

  it('rede já conectada fica verde com "Conectado" e ✓; o botão vira "Outra conta" e pede confirmação', async () => {
    const { zernio, redirect } = await open({ zernio: zernioFake({ status: configuredStatus('1a2b'), accounts: [IG, FB] }) });
    const instagram = (await networks().findByRole('button', { name: 'Conectar outra conta Instagram' })).closest('li') as HTMLElement;
    expect(instagram.className).toContain('platform-tile--connected');
    expect(within(instagram).getByText('Conectado')).toBeTruthy();
    expect(instagram.querySelector('svg.lucide-circle-check')).toBeTruthy();
    expect(within(instagram).getByText('@loja')).toBeTruthy();
    // Rede que precisa reconectar: âmbar, com o aviso na etiqueta
    const facebook = networks().getByRole('button', { name: 'Reconectar Facebook' }).closest('li') as HTMLElement;
    expect(facebook.className).toContain('platform-tile--attention');
    expect(within(facebook).getByText('Precisa reconectar')).toBeTruthy();
    // Rede ainda não conectada continua como antes
    expect((networks().getByRole('button', { name: 'Conectar TikTok' }).closest('li') as HTMLElement).className).toBe('platform-tile');

    fireEvent.click(within(instagram).getByRole('button', { name: 'Conectar outra conta Instagram' }));
    const dialog = within(screen.getByRole('alertdialog', { name: 'Confirmar nova conexão' }));
    expect(dialog.getByText(/Você já tem Instagram conectado/)).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: 'Cancelar' }));
    expect(zernio.connect).not.toHaveBeenCalled();

    fireEvent.click(within(instagram).getByRole('button', { name: 'Conectar outra conta Instagram' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Conectar outra conta' }));
    });
    expect(zernio.connect).toHaveBeenCalledWith('instagram', null);
    expect(redirect).toHaveBeenCalled();
  });

  it('card âmbar (precisa reconectar): o botão do card renova a autorização da mesma conta', async () => {
    const { zernio, redirect } = await open({ zernio: zernioFake({ status: configuredStatus('1a2b'), accounts: [IG, FB] }) });
    await act(async () => {
      fireEvent.click(await networks().findByRole('button', { name: 'Reconectar Facebook' }));
    });
    expect(zernio.connect).toHaveBeenCalledWith('facebook', 'acc-fb');
    expect(redirect).toHaveBeenCalled();
  });

  it('rede conectada em outro perfil da Zernio: aviso no card e confirmação antes de conectar aqui', async () => {
    const zernio = zernioFake({ status: configuredStatus('1a2b') });
    zernio.accounts.mockImplementation(async () =>
      ok({ accounts: [], teamAccountCount: 1, outsideAccounts: [{ platform: 'tiktok', username: 'loja', profileName: 'Default' }], canManage: true }),
    );
    await open({ zernio });
    const tiktok = (await networks().findByText(/Já conectado na sua conta Zernio em outro perfil/)).closest('li') as HTMLElement;
    expect(within(tiktok).getByText(/"Default"/)).toBeTruthy();
    fireEvent.click(within(tiktok).getByRole('button', { name: 'Conectar TikTok' }));
    expect(screen.getByRole('alertdialog', { name: 'Confirmar nova conexão' }).textContent).toContain('conta como mais uma rede');
    expect(zernio.connect).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Conectar mesmo assim' }));
    });
    expect(zernio.connect).toHaveBeenCalledWith('tiktok', null);
  });

  it('voltar da Zernio pelo botão Voltar do navegador (página restaurada do cache) destrava os botões', async () => {
    const { redirect } = await open({ zernio: zernioFake({ status: configuredStatus('1a2b') }) });
    await act(async () => {
      fireEvent.click(await networks().findByRole('button', { name: 'Conectar Instagram' }));
    });
    expect(redirect).toHaveBeenCalled();
    expect((networks().getByRole('button', { name: 'Conectar Facebook' }) as HTMLButtonElement).disabled).toBe(true);
    const restored = new Event('pageshow');
    Object.defineProperty(restored, 'persisted', { value: true });
    act(() => {
      window.dispatchEvent(restored);
    });
    expect((networks().getByRole('button', { name: 'Conectar Facebook' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('lista as redes com a situação; reconectar usa a conta certa; rede fora da lista só desconecta', async () => {
    const zernio = zernioFake({ status: configuredStatus('1a2b'), accounts: [IG, FB, BSKY] });
    await open({ zernio });
    const table = within(await networks().findByRole('table'));
    expect(table.getByText('Conectada')).toBeTruthy();
    expect(table.getByText('Precisa reconectar')).toBeTruthy();
    expect(table.getByText('Atenção')).toBeTruthy();
    const link = table.getByRole('link', { name: /Abrir perfil/ });
    expect([link.getAttribute('href'), link.getAttribute('target'), link.getAttribute('rel')]).toEqual(['https://rede.exemplo.test/loja', '_blank', 'noopener noreferrer']);
    expect(within(screen.getByRole('region', { name: 'Catálogo de integrações' })).getByText('3 redes conectadas')).toBeTruthy();

    await act(async () => {
      fireEvent.click(table.getByRole('button', { name: 'Reconectar Facebook Minha Página' }));
    });
    expect(zernio.connect).toHaveBeenCalledWith('facebook', 'acc-fb');
    expect(table.queryByRole('button', { name: /Reconectar bluesky/ })).toBeNull();
    expect(table.getByRole('button', { name: 'Desconectar bluesky @loja.bsky.test' })).toBeTruthy();
  });

  it('desconectar pede confirmação e atualiza a lista', async () => {
    const zernio = zernioFake({ status: configuredStatus('1a2b'), accounts: [IG, FB] });
    await open({ zernio });
    await screen.findByRole('region', { name: 'Redes sociais' });
    fireEvent.click(await networks().findByRole('button', { name: 'Desconectar Instagram @loja' }));
    const dialog = within(screen.getByRole('alertdialog', { name: 'Confirmar desconexão da rede' }));
    await act(async () => {
      fireEvent.click(dialog.getByRole('button', { name: 'Desconectar' }));
    });
    expect(zernio.disconnect).toHaveBeenCalledWith('acc-ig');
    expect(statusText('Instagram @loja desconectado.')).toBeTruthy();
    await waitFor(() => expect(networks().getAllByRole('row')).toHaveLength(2));
  });
});

describe('Integrações: volta da autorização', () => {
  it('conclui uma vez só (mesmo no modo estrito) e volta para Integrações com a mensagem', async () => {
    const zernio = zernioFake({ status: configuredStatus('1a2b'), accounts: [IG] });
    await open({ path: '/integracoes/zernio/retorno?dz=comprovante-1&connected=instagram&profileId=p1&accountId=acc-ig&username=loja&error_message=%3Cb%3Eoi%3C%2Fb%3E', zernio, strict: true });
    expect(await screen.findByText('Instagram @loja conectado.')).toBeTruthy();
    expect(zernio.completeConnect).toHaveBeenCalledTimes(1);
    expect(zernio.completeConnect).toHaveBeenCalledWith({ dz: 'comprovante-1', connected: 'instagram', accountId: 'acc-ig', error: null });
    expect(screen.getByRole('region', { name: 'Zernio' })).toBeTruthy();
    expect(document.body.innerHTML).not.toContain('<b>oi</b>');
  });

  it('falha na rede, comprovante vencido e volta sem comprovante viram mensagens em Integrações', async () => {
    let zernio = zernioFake({ status: configuredStatus('1a2b') });
    await open({ path: '/integracoes/zernio/retorno?dz=comprovante-2&error=oauth_denied&platform=instagram', zernio });
    expect((await screen.findByText('Você cancelou a autorização na rede.')).getAttribute('role')).toBe('alert');
    expect(zernio.completeConnect).toHaveBeenCalledWith({ dz: 'comprovante-2', connected: null, accountId: null, error: 'oauth_denied' });
    cleanup();

    zernio = zernioFake({ status: configuredStatus('1a2b') });
    await open({ path: '/integracoes/zernio/retorno?dz=vencido&connected=instagram', zernio });
    expect((await screen.findByText('O comprovante da conexão venceu. Conecte de novo.')).getAttribute('role')).toBe('alert');
    cleanup();

    zernio = zernioFake({ status: configuredStatus('1a2b') });
    await open({ path: '/integracoes/zernio/retorno?connected=instagram&accountId=acc-ig', zernio });
    expect(await screen.findByText(/chegou sem o comprovante/)).toBeTruthy();
    expect(zernio.completeConnect).not.toHaveBeenCalled();
  });

  it('sessão vencida durante a autorização: pede login e volta ao mesmo endereço, com o comprovante', async () => {
    const zernio = zernioFake({ status: configuredStatus('1a2b') });
    await open({ path: '/integracoes/zernio/retorno?dz=comprovante-3&connected=instagram&accountId=acc-ig', session: null, zernio });
    await screen.findByRole('heading', { level: 1, name: 'Entre na sua conta' });
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'maria@empresa.test' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'senha-forte-de-teste' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Entrar/ }));
    });
    expect(await screen.findByText('Instagram @loja conectado.')).toBeTruthy();
    expect(zernio.completeConnect).toHaveBeenCalledWith({ dz: 'comprovante-3', connected: 'instagram', accountId: 'acc-ig', error: null });
  });
});

describe('Integrações: permissões e situações especiais', () => {
  it('quem só visualiza vê a situação e as redes, sem campos nem botões que alteram', async () => {
    const zernio = zernioFake({ status: { ...configuredStatus('1a2b'), canManage: false }, accounts: [IG] });
    await open({ session: VIEWER, zernio });
    await networks().findByRole('table');
    const main = screen.getByRole('main');
    expect(within(main).queryAllByRole('button')).toHaveLength(0);
    expect(main.querySelectorAll('input')).toHaveLength(0);
    expect(networks().getByText(/Só o dono e os administradores conectam/)).toBeTruthy();
    cleanup();

    await open({ session: VIEWER, zernio: zernioFake({ status: { ...UNCONFIGURED, canManage: false } }) });
    expect(await zernioSection().findByText(/Peça ao dono ou a um administrador/)).toBeTruthy();
    expect(screen.getByRole('main').querySelectorAll('input')).toHaveLength(0);
  });

  it('conta sem empresa vê o aviso; cofre do servidor desligado impede guardar a chave', async () => {
    await open({ session: SUPER_NO_ORG });
    // Sem empresa: a Zernio avisa; o WhatsApp mostra a tabela de todas as empresas (Super-Admin)
    expect(screen.getByRole('heading', { name: 'Zernio: sem empresa nesta conta' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: /Todas as instâncias/ })).toBeTruthy();
    cleanup();

    await open({ zernio: zernioFake({ status: { ...UNCONFIGURED, available: false } }) });
    expect((await zernioSection().findByRole('alert')).textContent).toContain('Cofre de credenciais não configurado');
    expect(screen.getByRole('main').querySelectorAll('input')).toHaveLength(0);
    expect(within(screen.getByRole('region', { name: 'Catálogo de integrações' })).getByText('Indisponível')).toBeTruthy();
  });
});

describe('Integrações: teste de acesso à Inbox (Zernio)', () => {
  const CONFIGURED = configuredStatus('0001');

  it('administrador: o teste pede confirmação, faz a consulta e mostra o resultado com o código da Zernio', async () => {
    const zernio = zernioFake({ status: CONFIGURED, inbox: { outcome: 'unavailable', message: 'Recurso indisponível: a Zernio informou falta de permissão ou de complemento para a Inbox desta conta.', code: 'feature_not_available', hasConversations: null, checkedAt: WHEN } });
    await open({ zernio });
    const group = within(await screen.findByRole('group', { name: 'Teste de acesso à Inbox' }));
    await act(async () => fireEvent.click(group.getByRole('button', { name: 'Testar acesso à Inbox' })));
    expect(zernio.testInboxAccess).not.toHaveBeenCalled();
    const confirm = within(screen.getByRole('alertdialog', { name: 'Confirmar consulta à Zernio' }));
    await act(async () => fireEvent.click(confirm.getByRole('button', { name: 'Fazer a consulta' })));
    expect(zernio.testInboxAccess).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Recurso indisponível')).toBeTruthy();
    expect(screen.getByText('feature_not_available')).toBeTruthy();
    expect(screen.getByText(/falta de permissão ou de complemento/)).toBeTruthy();
  });

  it('visualizador: não vê o botão, só a explicação', async () => {
    await open({ session: VIEWER, zernio: zernioFake({ status: { ...CONFIGURED, canManage: false } }) });
    const group = within(await screen.findByRole('group', { name: 'Teste de acesso à Inbox' }));
    expect(group.queryByRole('button', { name: 'Testar acesso à Inbox' })).toBeNull();
    expect(group.getByText('Só o dono e os administradores fazem o teste.')).toBeTruthy();
  });

  it('sem a Zernio configurada, o teste nem aparece', async () => {
    await open({ zernio: zernioFake() });
    await screen.findByRole('region', { name: 'Zernio' });
    expect(screen.queryByRole('group', { name: 'Teste de acesso à Inbox' })).toBeNull();
  });

  it('erro da API aparece na seção sem sair da página', async () => {
    const zernio = zernioFake({ status: CONFIGURED, inboxError: 'Muitas tentativas seguidas. Aguarde um pouco e tente de novo.' });
    await open({ zernio });
    const group = within(await screen.findByRole('group', { name: 'Teste de acesso à Inbox' }));
    await act(async () => fireEvent.click(group.getByRole('button', { name: 'Testar acesso à Inbox' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Fazer a consulta' })));
    expect(await screen.findByText('Muitas tentativas seguidas. Aguarde um pouco e tente de novo.')).toBeTruthy();
  });
});
