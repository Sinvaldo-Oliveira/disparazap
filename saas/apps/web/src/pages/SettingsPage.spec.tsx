import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EvolutionSettings, SessionInfo } from '@disparazap/contracts';
import { App } from '../app/App';
import type { AuthApi } from '../auth/auth-api';
import type { PlatformApi } from '../platform/platform-api';

afterEach(cleanup);

// Tudo fictício: domínios .test e chaves inventadas
const SUPER_ADMIN: SessionInfo = { user: { id: 'u0', name: 'Dono Plataforma', email: 'dono@disparazap.test' }, userType: 'super_admin', organization: null };
const COMPANY_ADMIN: SessionInfo = { user: { id: 'u1', name: 'Maria Teste', email: 'maria@empresa.test' }, userType: 'company_admin', organization: { id: 'o1', name: 'Empresa Teste', role: 'owner' } };

const EMPTY: EvolutionSettings = { server: null, vaultReady: true };
const CONFIGURED: EvolutionSettings = {
  vaultReady: true,
  server: {
    name: 'Servidor principal',
    baseUrl: 'https://evolution.exemplo.test',
    status: 'active',
    apiKey: { configured: true, last4: 'AB12' },
    lastCheck: { at: '2026-11-01T15:30:00.000Z', status: 'ok', detail: 'Conexão confirmada.' },
    updatedAt: '2026-11-01T15:00:00.000Z',
  },
};

function fakeAuth(session: SessionInfo): AuthApi {
  return { getSession: vi.fn(async () => session), signIn: vi.fn(), signUp: vi.fn(), signOut: vi.fn(async () => {}) } as unknown as AuthApi;
}

function fakePlatform(initial: EvolutionSettings, overrides: Partial<PlatformApi> = {}): PlatformApi {
  return {
    getEvolutionSettings: vi.fn(async () => ({ ok: true as const, data: initial })),
    saveEvolutionSettings: vi.fn(async () => ({ ok: true as const, data: CONFIGURED })),
    testEvolution: vi.fn(async () => ({ ok: true as const, data: { status: 'ok' as const, detail: 'Conexão confirmada: a Evolution Go aceitou a chave global.', instances: 3, at: '2026-11-01T16:00:00.000Z' } })),
    ...overrides,
  };
}

async function openSettings(session: SessionInfo, platformApi: PlatformApi) {
  render(
    <MemoryRouter initialEntries={['/configuracoes']}>
      <App authApi={fakeAuth(session)} platformApi={platformApi} fetchHealth={async () => ({ status: 'ok', service: 'x', timestamp: '2026-11-01T00:00:00.000Z' })} fetchReady={async () => true} />
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { level: 1, name: 'Configurações' });
  // O card aparece depois que a configuração é carregada
  if (session.userType === 'super_admin') await screen.findByRole('heading', { name: 'Integração global · Evolution Go' });
}

const card = () => within(screen.getByRole('heading', { name: 'Integração global · Evolution Go' }).closest('section') as HTMLElement);
const type = (label: RegExp | string, value: string) => fireEvent.change(card().getByLabelText(label), { target: { value } });

describe('Configurações do Super-Admin: integração global com a Evolution Go', () => {
  it('sem configuração: mostra os campos, "Não configurado" e o teste desabilitado', async () => {
    await openSettings(SUPER_ADMIN, fakePlatform(EMPTY));
    expect(await card().findByText('Não configurado')).toBeTruthy();
    expect((card().getByLabelText('Nome do servidor') as HTMLInputElement).value).toBe('Servidor principal');
    expect(card().getByLabelText('URL da API')).toBeTruthy();
    const key = card().getByLabelText(/Chave global da API/) as HTMLInputElement;
    expect(key.type).toBe('password');
    expect(key.value).toBe('');
    expect((card().getByRole('button', { name: /Testar conexão/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('valida antes de enviar: chave obrigatória na primeira vez e https para endereço público', async () => {
    const api = fakePlatform(EMPTY);
    await openSettings(SUPER_ADMIN, api);
    await card().findByText('Não configurado');
    type('URL da API', 'https://evolution.exemplo.test');
    fireEvent.click(card().getByRole('button', { name: /Salvar integração/ }));
    expect(card().getByRole('alert').textContent).toContain('chave global');
    type('URL da API', 'http://evolution.exemplo.test');
    type(/Chave global da API/, 'chave-ficticia-123');
    fireEvent.click(card().getByRole('button', { name: /Salvar integração/ }));
    expect(card().getByRole('alert').textContent).toContain('https');
    expect(api.saveEvolutionSettings).not.toHaveBeenCalled();
  });

  it('salva: envia os campos, limpa a chave da tela e passa a mostrar só o final dela', async () => {
    const api = fakePlatform(EMPTY);
    await openSettings(SUPER_ADMIN, api);
    await card().findByText('Não configurado');
    type('URL da API', 'https://evolution.exemplo.test');
    type(/Chave global da API/, 'chave-ficticia-AB12');
    await act(async () => {
      fireEvent.click(card().getByRole('button', { name: /Salvar integração/ }));
    });
    expect(api.saveEvolutionSettings).toHaveBeenCalledWith({ name: 'Servidor principal', baseUrl: 'https://evolution.exemplo.test', status: 'active', apiKey: 'chave-ficticia-AB12' });
    expect(card().getByRole('status').textContent).toContain('Integração salva');
    expect((card().getByLabelText(/Chave global da API/) as HTMLInputElement).value).toBe('');
    expect(card().getByText(/termina em ••••AB12/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('chave-ficticia-AB12');
  });

  it('configurada: mostra o último teste e testa a conexão de novo', async () => {
    const api = fakePlatform(CONFIGURED);
    await openSettings(SUPER_ADMIN, api);
    expect(await card().findByText('Conectado')).toBeTruthy();
    expect(card().getByText(/Último teste em/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(card().getByRole('button', { name: /Testar conexão/ }));
    });
    expect(api.testEvolution).toHaveBeenCalledTimes(1);
    expect(card().getByText(/Instâncias no servidor: 3/)).toBeTruthy();
  });

  it('salvar sem preencher a chave mantém a guardada; com alteração pendente, o teste fica bloqueado', async () => {
    const api = fakePlatform(CONFIGURED);
    await openSettings(SUPER_ADMIN, api);
    await card().findByText('Conectado');
    type('Nome do servidor', 'Servidor Evolution');
    expect((card().getByRole('button', { name: /Testar conexão/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(card().getByText('Salve as alterações antes de testar.')).toBeTruthy();
    await act(async () => {
      fireEvent.click(card().getByRole('button', { name: /Salvar integração/ }));
    });
    expect(api.saveEvolutionSettings).toHaveBeenCalledWith(expect.objectContaining({ name: 'Servidor Evolution', apiKey: '' }));
  });

  it('mostra o erro da API e o aviso de cofre não configurado', async () => {
    const api = fakePlatform({ ...EMPTY, vaultReady: false }, { saveEvolutionSettings: vi.fn(async () => ({ ok: false as const, message: 'O cofre de credenciais não está configurado no servidor (SECRETS_MASTER_KEY).', status: 503 })) });
    await openSettings(SUPER_ADMIN, api);
    expect(await card().findByText(/Cofre de credenciais não configurado/)).toBeTruthy();
    type('URL da API', 'https://evolution.exemplo.test');
    type(/Chave global da API/, 'chave-ficticia-123');
    await act(async () => {
      fireEvent.click(card().getByRole('button', { name: /Salvar integração/ }));
    });
    expect(card().getAllByRole('alert').some((el) => el.textContent?.includes('SECRETS_MASTER_KEY'))).toBe(true);
  });
});

describe('Configurações para quem não é Super-Admin', () => {
  it('Admin-Empresa vê o módulo em desenvolvimento, sem a integração global', async () => {
    const api = fakePlatform(CONFIGURED);
    await openSettings(COMPANY_ADMIN, api);
    expect(screen.getByText('Este módulo ainda não foi implementado')).toBeTruthy();
    expect(screen.queryByText('Integração global · Evolution Go')).toBeNull();
    expect(api.getEvolutionSettings).not.toHaveBeenCalled();
  });
});
