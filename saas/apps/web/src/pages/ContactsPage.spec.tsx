import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Contact, ContactInput, ContactListSummary, ContactSearchResult, SessionInfo } from '@disparazap/contracts';
import { App } from '../app/App';
import type { AuthApi } from '../auth/auth-api';
import type { MessagingApi } from '../messaging/messaging-api';
import type { ReadSpreadsheet } from '../messaging/spreadsheet';

afterEach(cleanup);

// Tudo fictício
const OWNER: SessionInfo = { user: { id: 'u1', name: 'Maria Teste', email: 'maria@empresa.test' }, userType: 'company_admin', organization: { id: 'o1', name: 'Empresa Teste', role: 'owner' } };
const VIEWER: SessionInfo = { ...OWNER, organization: { id: 'o1', name: 'Empresa Teste', role: 'viewer' } };
const SUPER_NO_ORG: SessionInfo = { user: { id: 'u0', name: 'Dono Plataforma', email: 'dono@disparazap.test' }, userType: 'super_admin', organization: null };
const WHEN = '2026-11-01T12:00:00.000Z';

interface FakeList {
  id: string;
  name: string;
  contacts: Contact[];
}

const seed = (): FakeList[] => [
  {
    id: 'l1',
    name: 'Clientes de São Paulo',
    contacts: [
      { name: 'Ana', phone: '5511988887777' },
      { name: 'Bruno', phone: '5511977776666' },
      { name: '', phone: '5511966665555' },
    ],
  },
  {
    id: 'l2',
    name: 'Leads da feira',
    contacts: [
      { name: 'Carla', phone: '5521998765432' },
      { name: 'Ana Paula', phone: '5531988880000' },
    ],
  },
];

/** API falsa com estado: o que a página grava aparece na próxima leitura */
function messagingFake(lists: FakeList[] = seed()) {
  const store = new Map(lists.map((list) => [list.id, { ...list, contacts: [...list.contacts] }]));
  const summary = (list: FakeList): ContactListSummary => ({ id: list.id, name: list.name, contactCount: list.contacts.length, createdAt: WHEN, updatedAt: WHEN });
  const ok = <T,>(data: T) => ({ ok: true as const, data });
  const missing = { ok: false as const, message: 'Lista não encontrada.', status: 404 };
  const api = {
    lists: vi.fn(async () => ok({ lists: [...store.values()].map(summary), canSend: true })),
    getList: vi.fn(async (id: string) => {
      const list = store.get(id);
      return list ? ok({ ...summary(list), contacts: [...list.contacts] }) : missing;
    }),
    createList: vi.fn(async (name: string, contacts: readonly Contact[]) => {
      const list = { id: `l${store.size + 1}`, name, contacts: [...contacts] };
      store.set(list.id, list);
      return ok({ list: summary(list), ignored: { invalid: 0, duplicate: 0 } });
    }),
    updateList: vi.fn(),
    deleteList: vi.fn(async (id: string) => (store.delete(id) ? ok(null) : missing)),
    renameList: vi.fn(async (id: string, name: string) => {
      const list = store.get(id);
      if (!list) return missing;
      list.name = name;
      return ok(summary(list));
    }),
    addContacts: vi.fn(async (id: string, contacts: readonly ContactInput[]) => {
      const list = store.get(id);
      if (!list) return missing;
      let duplicate = 0;
      let added = 0;
      for (const contact of contacts) {
        if (list.contacts.some((c) => c.phone === contact.phone)) duplicate++;
        else {
          list.contacts.push({ name: contact.name ?? '', phone: contact.phone });
          added++;
        }
      }
      return ok({ list: summary(list), added, ignored: { invalid: 0, duplicate, overLimit: 0 } });
    }),
    updateContact: vi.fn(async (id: string, phone: string, name: string, newPhone: string) => {
      const list = store.get(id);
      if (!list) return missing;
      const contact = { name, phone: newPhone.replace(/\D/g, '') };
      list.contacts = list.contacts.map((c) => (c.phone === phone ? contact : c));
      return ok({ list: summary(list), contact });
    }),
    removeContacts: vi.fn(async (id: string, phones: readonly string[]) => {
      const list = store.get(id);
      if (!list) return missing;
      const before = list.contacts.length;
      list.contacts = list.contacts.filter((c) => !phones.includes(c.phone));
      return ok({ list: summary(list), removed: before - list.contacts.length });
    }),
    searchContacts: vi.fn(async (query: string) => {
      const wanted = query.toLowerCase();
      const digits = query.replace(/\D/g, '');
      const results: ContactSearchResult[] = [];
      for (const list of store.values()) {
        for (const c of list.contacts) {
          if (c.name.toLowerCase().includes(wanted) || (digits.length >= 3 && c.phone.includes(digits))) results.push({ listId: list.id, listName: list.name, name: c.name, phone: c.phone });
        }
      }
      return ok({ results, truncated: false });
    }),
    send: vi.fn(),
    uploadMedia: vi.fn(),
    templates: vi.fn(),
    createTemplate: vi.fn(),
    updateTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
  };
  return api;
}

type Fake = ReturnType<typeof messagingFake>;

async function open({ path = '/contatos', session = OWNER, messaging = messagingFake(), readSpreadsheet }: { path?: string; session?: SessionInfo; messaging?: Fake; readSpreadsheet?: ReadSpreadsheet } = {}) {
  const authApi = { getSession: vi.fn(async () => session), signIn: vi.fn(), signUp: vi.fn(), signOut: vi.fn(async () => {}) } as unknown as AuthApi;
  render(
    <MemoryRouter initialEntries={[path]}>
      <App authApi={authApi} messagingApi={messaging as unknown as MessagingApi} contactSearchDelayMs={0} {...(readSpreadsheet ? { readSpreadsheet } : {})} fetchHealth={async () => ({ status: 'ok', service: 'x', timestamp: WHEN })} fetchReady={async () => true} />
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { level: 1, name: 'Contatos' });
  return messaging;
}

const section = (name: string) => within(screen.getByRole('region', { name }));
const status = (text: string) => screen.getAllByRole('status').find((el) => el.textContent?.includes(text));
const openList = async (id = 'l1', options: Parameters<typeof open>[0] = {}) => {
  const messaging = await open({ ...options, path: `/contatos/${id}` });
  await screen.findByRole('table');
  return messaging;
};
const rows = () => within(screen.getByRole('region', { name: 'Contatos da lista' })).getAllByRole('row').slice(1);

describe('Contatos: listas da empresa', () => {
  it('fica disponível no menu e mostra as listas com os totais; a busca filtra pelo nome da lista, sem acentos', async () => {
    await open();
    expect(screen.getByRole('navigation', { name: 'Menu principal' }).textContent).not.toMatch(/Contatos\s*Em desenvolvimento/);
    expect(await screen.findByRole('link', { name: 'Clientes de São Paulo' })).toBeTruthy();
    expect(screen.getByText('2 de 100')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar listas e contatos' }), { target: { value: 'sao paulo' } });
    expect(screen.getByRole('link', { name: 'Clientes de São Paulo' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Leads da feira' })).toBeNull();
  });

  it('busca contatos em todas as listas e abre a lista certa, já filtrada pelo número', async () => {
    const messaging = await open();
    await screen.findByRole('link', { name: 'Leads da feira' });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar listas e contatos' }), { target: { value: 'ana' } });
    const found = within(await screen.findByRole('region', { name: 'Contatos encontrados' }));
    await found.findByText('Ana Paula');
    expect(messaging.searchContacts).toHaveBeenLastCalledWith('ana', expect.anything());
    expect(found.getByText('+55 31 98888-0000')).toBeTruthy();

    fireEvent.click(within(found.getByText('Ana Paula').closest('tr') as HTMLElement).getByRole('link', { name: 'Leads da feira' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Leads da feira' })).toBeTruthy();
    // A subpágina mantém o nome do módulo no topo e o item do menu marcado
    expect(document.querySelector('.topbar__title')?.textContent).toBe('Contatos');
    expect(within(screen.getByRole('navigation', { name: 'Menu principal' })).getByRole('link', { name: /Contatos/ }).className).toContain('sidebar__link--active');
    expect((screen.getByRole('searchbox', { name: 'Buscar nesta lista' }) as HTMLInputElement).value).toBe('5531988880000');
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.textContent).toContain('Ana Paula');
  });

  it('cria uma lista nova e abre a página dela para adicionar contatos', async () => {
    const messaging = await open();
    fireEvent.click(await screen.findByRole('button', { name: /Nova lista/ }));
    fireEvent.change(screen.getByLabelText('Nome da nova lista'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar lista' }));
    expect(screen.getByRole('alert').textContent).toContain('Dê um nome à lista');
    expect(messaging.createList).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Nome da nova lista'), { target: { value: 'Clientes VIP' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar lista' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Clientes VIP' })).toBeTruthy();
    expect(messaging.createList).toHaveBeenCalledWith('Clientes VIP', []);
    expect(status('Lista criada')).toBeTruthy();
    expect(screen.getByText(/Esta lista ainda não tem contatos/)).toBeTruthy();
  });

  it('exclui uma lista pela tabela, com confirmação', async () => {
    const messaging = await open();
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir a lista Leads da feira' }));
    const dialog = within(screen.getByRole('alertdialog', { name: 'Confirmar exclusão da lista' }));
    expect(dialog.getByText(/2 contatos serão apagados/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(dialog.getByRole('button', { name: 'Excluir definitivamente' }));
    });
    expect(messaging.deleteList).toHaveBeenCalledWith('l2');
    expect(status('Lista "Leads da feira" excluída.')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Leads da feira' })).toBeNull());
  });
});

describe('Contatos: gestão de uma lista', () => {
  it('adiciona à mão e salva na hora; recusa telefone inválido ou repetido sem chamar a API', async () => {
    const messaging = await openList();
    fireEvent.change(screen.getByLabelText('Nome do contato'), { target: { value: 'Diego' } });
    fireEvent.change(screen.getByLabelText('Telefone com DDI'), { target: { value: '11955554444' } });
    fireEvent.click(screen.getByRole('button', { name: /Adicionar$/ }));
    expect(screen.getByRole('alert').textContent).toContain('Telefone inválido');

    fireEvent.change(screen.getByLabelText('Telefone com DDI'), { target: { value: '+55 11 98888-7777' } });
    fireEvent.click(screen.getByRole('button', { name: /Adicionar$/ }));
    expect(screen.getByRole('alert').textContent).toContain('já está na lista');
    expect(messaging.addContacts).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Telefone com DDI'), { target: { value: '5511955554444' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Adicionar$/ }));
    });
    expect(messaging.addContacts).toHaveBeenCalledWith('l1', [{ name: 'Diego', phone: '5511955554444' }]);
    expect(status('Contato adicionado e salvo')).toBeTruthy();
    expect(await screen.findByText('Diego')).toBeTruthy();
    expect(screen.getByText('4 de 10.000')).toBeTruthy();
    expect((screen.getByLabelText('Telefone com DDI') as HTMLInputElement).value).toBe('');
  });

  it('importa planilha: só os contatos novos vão para a API e o resumo diz o que ficou de fora', async () => {
    const readSpreadsheet = vi.fn<ReadSpreadsheet>(async () => ({
      fileName: 'novos.xlsx',
      ncols: 2,
      rows: [['Nome', 'Celular'], ['Ana', 5511988887777], ['Eva', '5511944443333'], ['Sem DDI', '11944443333']],
    }));
    const messaging = await openList('l1', { readSpreadsheet });
    fireEvent.click(screen.getByRole('tab', { name: /Excel/ }));
    await act(async () => {
      fireEvent.change(screen.getByTestId('spreadsheet-input'), { target: { files: [new File(['x'], 'novos.xlsx')] } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Importar contatos' }));
    });
    expect(messaging.addContacts).toHaveBeenCalledWith('l1', [{ name: 'Eva', phone: '5511944443333' }]);
    expect(status('Importação de "novos.xlsx" concluída')?.textContent).toContain('1 contato adicionado, 1 linha ignorada (1 sem DDI), 1 repetido');
    expect(await screen.findByText('Eva')).toBeTruthy();
  });

  it('edita nome e telefone de um contato (com a mesma regra de telefone)', async () => {
    const messaging = await openList();
    fireEvent.click(screen.getByRole('button', { name: 'Editar Bruno (+55 11 97777-6666)' }));
    const name = screen.getByLabelText('Nome do contato em edição') as HTMLInputElement;
    const phone = screen.getByLabelText('Telefone do contato em edição') as HTMLInputElement;
    expect([name.value, phone.value]).toEqual(['Bruno', '+55 11 97777-6666']);

    fireEvent.change(phone, { target: { value: '5511988887777' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(screen.getByRole('alert').textContent).toContain('já está na lista');
    expect(messaging.updateContact).not.toHaveBeenCalled();

    fireEvent.change(name, { target: { value: 'Bruno Lima' } });
    fireEvent.change(phone, { target: { value: '5511912341234' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    });
    expect(messaging.updateContact).toHaveBeenCalledWith('l1', '5511977776666', 'Bruno Lima', '5511912341234');
    expect(rows()[1]?.textContent).toContain('Bruno Lima');
    expect(rows()[1]?.textContent).toContain('+55 11 91234-1234');
    expect(status('Contato atualizado.')).toBeTruthy();
  });

  it('remove um contato e depois vários selecionados, sempre com confirmação', async () => {
    const messaging = await openList();
    fireEvent.click(screen.getByRole('button', { name: 'Remover Ana (+55 11 98888-7777)' }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole('alertdialog', { name: 'Confirmar remoção de contatos' })).getByRole('button', { name: 'Remover definitivamente' }));
    });
    expect(messaging.removeContacts).toHaveBeenCalledWith('l1', ['5511988887777']);
    expect(status('1 contato removido da lista.')).toBeTruthy();
    expect(rows()).toHaveLength(2);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar Bruno (+55 11 97777-6666)' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar +55 11 96666-5555' }));
    expect(section('Contatos selecionados').getByText('2 contatos selecionados')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Remover selecionados/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remover definitivamente' }));
    });
    expect(messaging.removeContacts).toHaveBeenLastCalledWith('l1', ['5511977776666', '5511966665555']);
    expect(screen.getByText(/Esta lista ainda não tem contatos/)).toBeTruthy();
  });

  it('renomeia e exclui a lista; ao excluir volta para Contatos com o aviso', async () => {
    const messaging = await openList();
    fireEvent.click(screen.getByRole('button', { name: /Renomear/ }));
    fireEvent.change(screen.getByLabelText('Nome da lista'), { target: { value: 'Clientes SP' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Salvar nome/ }));
    });
    expect(messaging.renameList).toHaveBeenCalledWith('l1', 'Clientes SP');
    expect(screen.getByRole('heading', { level: 2, name: 'Clientes SP' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Excluir lista/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Excluir definitivamente' }));
    });
    expect(messaging.deleteList).toHaveBeenCalledWith('l1');
    expect(await screen.findByRole('region', { name: 'Listas de contatos' })).toBeTruthy();
    expect(status('Lista "Clientes SP" excluída.')).toBeTruthy();
  });

  it('busca por nome ou telefone dentro da lista e mostra 50 contatos por página', async () => {
    const many: Contact[] = Array.from({ length: 120 }, (_, i) => ({ name: `Pessoa ${i + 1}`, phone: `55119${String(10_000_000 + i).padStart(8, '0')}` }));
    await openList('l9', { messaging: messagingFake([{ id: 'l9', name: 'Grande', contacts: many }]) });
    expect(rows()).toHaveLength(50);
    expect(screen.getByText(/120 contatos · página 1 de 3/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Próxima/ }));
    expect(screen.getByText(/página 2 de 3/)).toBeTruthy();
    expect(rows()[0]?.textContent).toContain('Pessoa 51');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar todos desta página' }));
    expect(section('Contatos selecionados').getByText('50 contatos selecionados')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar seleção' }));

    const search = screen.getByRole('searchbox', { name: 'Buscar nesta lista' });
    fireEvent.change(search, { target: { value: 'pessoa 11' } });
    expect(screen.getByText('11 contatos encontrados de 120')).toBeTruthy();
    fireEvent.change(search, { target: { value: '1000 0119' } });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.textContent).toContain('Pessoa 120');
    fireEvent.change(search, { target: { value: 'ninguém' } });
    expect(screen.getByText('Nenhum contato com "ninguém" nesta lista.')).toBeTruthy();
    // 120 linhas desenhadas no jsdom: com a suíte inteira rodando junto (API, Inbox), passa de 5 s em máquinas mais lentas
  }, 20_000);
});

describe('Contatos: permissões', () => {
  it('quem só visualiza vê e busca, mas não tem como criar, alterar nem excluir', async () => {
    await open({ session: VIEWER });
    await screen.findByRole('link', { name: 'Leads da feira' });
    expect(screen.queryByRole('button', { name: /Nova lista/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Excluir a lista/ })).toBeNull();
    cleanup();

    await openList('l1', { session: VIEWER });
    expect(screen.queryByRole('region', { name: 'Adicionar contatos' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Renomear|Excluir lista|Editar|Remover/ })).toBeNull();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar nesta lista' }), { target: { value: 'bruno' } });
    expect(rows()).toHaveLength(1);
  });

  it('conta sem empresa vê o aviso; lista de outra empresa ou inexistente aparece como "não encontrada"', async () => {
    await open({ session: SUPER_NO_ORG });
    expect(screen.getByRole('heading', { name: 'Sem empresa nesta conta' })).toBeTruthy();
    cleanup();

    await open({ path: '/contatos/de-outra-empresa' });
    expect(await screen.findByRole('heading', { name: 'Lista não encontrada' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Todas as listas/ })).toBeTruthy();
  });
});
