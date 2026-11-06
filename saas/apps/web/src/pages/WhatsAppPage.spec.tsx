import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionInfo, WhatsAppInstance, WhatsAppInstanceList } from '@disparazap/contracts';
import { App } from '../app/App';
import type { AuthApi } from '../auth/auth-api';
import type { WhatsAppApi } from '../whatsapp/whatsapp-api';
import type { ZernioApi } from '../integrations/zernio-api';

afterEach(cleanup);

// Tudo fictício
const OWNER: SessionInfo = { user: { id: 'u1', name: 'Maria Teste', email: 'maria@empresa.test' }, userType: 'company_admin', organization: { id: 'o1', name: 'Empresa Teste', role: 'owner' } };
const VIEWER: SessionInfo = { ...OWNER, user: { id: 'u2', name: 'Visitante', email: 'v@empresa.test' }, organization: { id: 'o1', name: 'Empresa Teste', role: 'viewer' } };
const SUPER_NO_ORG: SessionInfo = { user: { id: 'u0', name: 'Dono Plataforma', email: 'dono@disparazap.test' }, userType: 'super_admin', organization: null };

const instance = (overrides: Partial<WhatsAppInstance> = {}): WhatsAppInstance => ({
  id: 'i1',
  displayName: 'Vendas',
  status: 'created',
  phone: null,
  createdAt: '2026-11-01T12:00:00.000Z',
  connectedAt: null,
  ...overrides,
});
const CONNECTED = instance({ status: 'connected', phone: '5511988887777', connectedAt: '2026-11-01T12:05:00.000Z' });
const QR = 'data:image/png;base64,UVJTSU1VTEFETw==';

function list(overrides: Partial<WhatsAppInstanceList> = {}): WhatsAppInstanceList {
  return { instances: [], limit: 1, canManage: true, integration: 'ready', ...overrides };
}

function fakeApi(initial: WhatsAppInstanceList, overrides: Partial<WhatsAppApi> = {}): WhatsAppApi {
  return {
    list: vi.fn(async () => ({ ok: true as const, data: initial })),
    create: vi.fn(async (displayName: string) => ({ ok: true as const, data: instance({ displayName }) })),
    connect: vi.fn(async () => ({ ok: true as const, data: { instance: instance({ status: 'connecting' }), qrCode: QR } })),
    qr: vi.fn(async () => ({ ok: true as const, data: { instance: CONNECTED, qrCode: null } })),
    pair: vi.fn(async () => ({ ok: true as const, data: { instance: instance({ status: 'connecting' }), code: 'ABCD1234' } })),
    status: vi.fn(async () => ({ ok: true as const, data: CONNECTED })),
    logout: vi.fn(async () => ({ ok: true as const, data: instance({ status: 'disconnected' }) })),
    remove: vi.fn(async () => ({ ok: true as const, data: null })),
    listAll: vi.fn(async () => ({ ok: true as const, data: { instances: [{ ...CONNECTED, organization: { id: 'o1', name: 'Empresa Teste' } }] } })),
    ...overrides,
  };
}

// Zernio sem configurar: a seção dela fica quieta e não atrapalha os testes do WhatsApp
const zernioIdle = {
  status: vi.fn(async () => ({ ok: true as const, data: { available: true, configured: false, status: null, keyLast4: null, accountName: null, profileName: null, lastCheckAt: null, canManage: false } })),
  accounts: vi.fn(async () => ({ ok: false as const, message: 'A integração com a Zernio ainda não foi configurada.', status: 409 })),
} as unknown as ZernioApi;

/** O endereço antigo /whatsapp leva à seção WhatsApp da página Integrações */
async function openWhatsApp(session: SessionInfo, whatsappApi: WhatsAppApi) {
  const authApi = { getSession: vi.fn(async () => session), signIn: vi.fn(), signUp: vi.fn(), signOut: vi.fn(async () => {}) } as unknown as AuthApi;
  render(
    <MemoryRouter initialEntries={['/whatsapp']}>
      <App authApi={authApi} whatsappApi={whatsappApi} zernioApi={zernioIdle} whatsappPollMs={10} fetchHealth={async () => ({ status: 'ok', service: 'x', timestamp: '2026-11-01T00:00:00.000Z' })} fetchReady={async () => true} />
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { level: 1, name: 'Integrações' });
  await screen.findByRole('region', { name: 'WhatsApp' });
}

const company = async () => within((await screen.findByRole('heading', { name: /Instâncias da empresa/ })).closest('section') as HTMLElement);

describe('WhatsApp da empresa', () => {
  it('sem instâncias: mostra o contador, o aviso e o botão "Nova instância"', async () => {
    await openWhatsApp(OWNER, fakeApi(list()));
    const card = await company();
    expect(card.getByRole('heading', { name: 'Instâncias da empresa (0 de 1)' })).toBeTruthy();
    expect(card.getByText(/Nenhuma instância ainda/)).toBeTruthy();
    expect((card.getByRole('button', { name: /Nova instância/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('cria uma instância (nome obrigatório) e respeita o limite', async () => {
    const api = fakeApi(list());
    await openWhatsApp(OWNER, api);
    const card = await company();
    fireEvent.click(card.getByRole('button', { name: /Nova instância/ }));
    fireEvent.click(card.getByRole('button', { name: 'Criar instância' }));
    expect(card.getByRole('alert').textContent).toContain('Dê um nome');
    fireEvent.change(card.getByLabelText('Nome da instância'), { target: { value: 'Vendas' } });
    await act(async () => {
      fireEvent.click(card.getByRole('button', { name: 'Criar instância' }));
    });
    expect(api.create).toHaveBeenCalledWith('Vendas');
    expect(card.getByRole('heading', { name: 'Vendas' })).toBeTruthy();
    expect(card.getByText('Aguardando conexão')).toBeTruthy();
    expect((card.getByRole('button', { name: /Nova instância/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(card.getByText('Sua empresa pode ter 1 instância.')).toBeTruthy();
  });

  it('conecta por QR Code: mostra a imagem e passa para "Conectado" com o número', async () => {
    const api = fakeApi(list({ instances: [instance()] }));
    await openWhatsApp(OWNER, api);
    const card = await company();
    await act(async () => {
      fireEvent.click(card.getByRole('button', { name: /Conectar/ }));
    });
    expect(api.connect).toHaveBeenCalledWith('i1');
    expect(card.getByRole('img', { name: 'QR Code para conectar o WhatsApp' }).getAttribute('src')).toBe(QR);
    expect(card.getByText(/Aparelhos conectados › Conectar aparelho/)).toBeTruthy();
    expect(await card.findByText('WhatsApp conectado.')).toBeTruthy();
    expect(card.getByText('Conectado')).toBeTruthy();
    expect(card.getByText(/\+55 11 98888-7777/)).toBeTruthy();
  });

  it('código de pareamento: valida o número antes de enviar e mostra o código', async () => {
    const api = fakeApi(list({ instances: [instance()] }));
    await openWhatsApp(OWNER, api);
    const card = await company();
    await act(async () => {
      fireEvent.click(card.getByRole('button', { name: /Conectar/ }));
    });
    fireEvent.click(card.getByRole('tab', { name: /Código de pareamento/ }));
    fireEvent.change(card.getByLabelText('Número do WhatsApp (com DDI)'), { target: { value: '11988887777' } });
    fireEvent.click(card.getByRole('button', { name: 'Gerar código' }));
    expect(card.getByRole('alert').textContent).toContain('DDI 55');
    expect(api.pair).not.toHaveBeenCalled();
    fireEvent.change(card.getByLabelText('Número do WhatsApp (com DDI)'), { target: { value: '5511988887777' } });
    await act(async () => {
      fireEvent.click(card.getByRole('button', { name: 'Gerar código' }));
    });
    expect(api.pair).toHaveBeenCalledWith('i1', '5511988887777');
    expect(card.getByLabelText('Código de pareamento').textContent).toBe('ABCD-1234');
    expect(await card.findByText('WhatsApp conectado.')).toBeTruthy();
  });

  it('desconecta e exclui com confirmação (excluir exige digitar o nome)', async () => {
    const api = fakeApi(list({ instances: [CONNECTED] }));
    await openWhatsApp(OWNER, api);
    const card = await company();
    fireEvent.click(card.getByRole('button', { name: /Desconectar/ }));
    await act(async () => {
      fireEvent.click(card.getByRole('button', { name: 'Confirmar desconexão' }));
    });
    expect(api.logout).toHaveBeenCalledWith('i1');
    expect(card.getByText('WhatsApp desconectado.')).toBeTruthy();
    expect(card.getByText('Desconectado')).toBeTruthy();

    fireEvent.click(card.getByRole('button', { name: /Excluir/ }));
    const remove = card.getByRole('button', { name: 'Excluir definitivamente' }) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    fireEvent.change(card.getByLabelText('Nome da instância'), { target: { value: 'Vendas' } });
    expect(remove.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(remove);
    });
    expect(api.remove).toHaveBeenCalledWith('i1');
    expect(card.queryByRole('heading', { name: 'Vendas' })).toBeNull();
  });

  it('mostra o erro da API ao conectar', async () => {
    const api = fakeApi(list({ instances: [instance()] }), { connect: vi.fn(async () => ({ ok: false as const, message: 'O servidor de WhatsApp não respondeu. Tente de novo em instantes.', status: 502 })) });
    await openWhatsApp(OWNER, api);
    const card = await company();
    await act(async () => {
      fireEvent.click(card.getByRole('button', { name: /Conectar/ }));
    });
    expect(card.getByRole('alert').textContent).toContain('não respondeu');
  });

  it('integração não configurada: avisa e não deixa criar', async () => {
    await openWhatsApp(OWNER, fakeApi(list({ integration: 'missing' })));
    const card = await company();
    expect(card.getByRole('note').textContent).toContain('ainda não foi configurada');
    expect(card.getByRole('note').textContent).toContain('Fale com o administrador');
    expect((card.getByRole('button', { name: /Nova instância/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('quem só visualiza vê as instâncias, sem botões de ação', async () => {
    await openWhatsApp(VIEWER, fakeApi(list({ instances: [CONNECTED], canManage: false })));
    const card = await company();
    expect(card.getByText('Conectado')).toBeTruthy();
    expect(card.queryByRole('button')).toBeNull();
    expect(card.getByText(/Só o dono e os administradores/)).toBeTruthy();
  });
});

describe('WhatsApp para o Super-Admin', () => {
  it('sem empresa: vê só a lista de todas as instâncias, com a empresa', async () => {
    const api = fakeApi(list());
    await openWhatsApp(SUPER_NO_ORG, api);
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Empresa Teste')).toBeTruthy();
    expect(within(table).getByText('Vendas')).toBeTruthy();
    expect(within(table).getByText('+55 11 98888-7777')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Instâncias da empresa/ })).toBeNull();
    expect(screen.getByText('Acompanhe as instâncias de WhatsApp de todas as empresas da plataforma.')).toBeTruthy();
    expect(screen.queryByText(/da sua empresa/)).toBeNull();
    expect(api.list).not.toHaveBeenCalled();
  });
});
