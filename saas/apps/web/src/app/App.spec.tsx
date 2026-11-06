import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionInfo } from '@disparazap/contracts';
import type { AuthApi } from '../auth/auth-api';
import { safeReturnPath } from '../auth/guards';
import { SHOWCASE_SLIDES } from '../components/AuthShowcase';
import { App } from './App';
import type { FetchHealth, FetchReady } from './health-client';
import { NAVIGATION, visibleNavigation } from './navigation';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const healthy: FetchHealth = async () => ({ status: 'ok', service: 'disparazap-api', timestamp: '2026-11-01T12:00:00.000Z' });
const offline: FetchHealth = async () => {
  throw new Error('sem conexão');
};
const ready: FetchReady = async () => true;

// Sessões fictícias (domínios .test)
const COMPANY_ADMIN: SessionInfo = {
  user: { id: 'u1', name: 'Maria Teste', email: 'maria@empresa.test' },
  userType: 'company_admin',
  organization: { id: 'o1', name: 'Clínica Exemplo', role: 'owner' },
};
const SUPER_ADMIN: SessionInfo = { user: { id: 'u0', name: 'Dono Plataforma', email: 'dono@disparazap.test' }, userType: 'super_admin', organization: null };
const MYLINKSSS_ADMIN: SessionInfo = {
  user: { id: 'u2', name: 'João Parceiro', email: 'joao@parceiro.test' },
  userType: 'mylinksss_admin',
  organization: { id: 'o2', name: 'Loja Parceira', role: 'owner' },
};

function fakeAuth(session: SessionInfo | null, overrides: Partial<AuthApi> = {}): AuthApi {
  return {
    getSession: vi.fn(async () => session),
    signIn: vi.fn(async () => ({ ok: true as const, session: COMPANY_ADMIN })),
    signUp: vi.fn(async () => ({ ok: true as const, session: COMPANY_ADMIN })),
    signOut: vi.fn(async () => {}),
    ...overrides,
  };
}

function renderAt(path: string, { authApi = fakeAuth(COMPANY_ADMIN), fetchHealth = healthy, fetchReady = ready }: { authApi?: AuthApi; fetchHealth?: FetchHealth; fetchReady?: FetchReady } = {}) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App authApi={authApi} fetchHealth={fetchHealth} fetchReady={fetchReady} />
    </MemoryRouter>,
  );
  return authApi;
}

const menu = () => within(screen.getByRole('navigation', { name: 'Menu principal' }));
// Módulos ainda sem implementação (WhatsApp, Envio de Mensagens, Contatos e Integrações têm páginas próprias, com testes próprios)
// Módulos parciais continuam "Em desenvolvimento" no menu, mas têm página própria (testada no arquivo do módulo):
// Automações mostra a consulta das automações de redes (PLANO_MODULO_AUTOMACOES, etapa A1)
const PARTIAL_MODULES: readonly string[] = ['automations'];
const MODULES = NAVIGATION.filter((item) => item.path !== '/' && item.status === 'in_development' && !PARTIAL_MODULES.includes(item.id));
const panelReady = () => screen.findByRole('navigation', { name: 'Menu principal' });
const loginReady = () => screen.findByRole('heading', { level: 1, name: 'Entre na sua conta' });

function type(label: RegExp | string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('acesso ao painel', () => {
  it('sem login, o painel leva para a tela de entrar', async () => {
    renderAt('/', { authApi: fakeAuth(null) });
    expect(await loginReady()).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Menu principal' })).toBeNull();
  });

  it('tela de entrar segue o layout de referência: marca, ícone, campos, lembrar, botão e link de cadastro', async () => {
    renderAt('/entrar', { authApi: fakeAuth(null) });
    await loginReady();
    expect(screen.getAllByText('DisparaZap').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('E-mail').getAttribute('type')).toBe('email');
    expect(screen.getByLabelText('Senha').getAttribute('type')).toBe('password');
    expect((screen.getByLabelText('Lembrar de mim') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('button', { name: /^Entrar/ })).toBeTruthy();
    expect(screen.getByText('Não tem uma conta?')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Criar conta/ }).getAttribute('href')).toBe('/cadastro');
  });

  it('não mostra login social nem recuperação de senha que ainda não funcionam', async () => {
    renderAt('/entrar', { authApi: fakeAuth(null) });
    await loginReady();
    expect(screen.queryByText(/google|facebook|esqueceu|recuperar/i)).toBeNull();
  });

  it('o botão do olho mostra e esconde a senha', async () => {
    renderAt('/entrar', { authApi: fakeAuth(null) });
    await loginReady();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar senha' }));
    expect(screen.getByLabelText('Senha').getAttribute('type')).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar senha' }));
    expect(screen.getByLabelText('Senha').getAttribute('type')).toBe('password');
  });

  it('entrar envia e-mail, senha e "lembrar de mim" e abre o painel na página pedida', async () => {
    const authApi = renderAt('/campanhas', { authApi: fakeAuth(null) });
    await loginReady();
    type('E-mail', '  maria@empresa.test ');
    type('Senha', 'senha-forte-de-teste');
    fireEvent.click(screen.getByLabelText('Lembrar de mim'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Entrar/ }));
    });
    expect(authApi.signIn).toHaveBeenCalledWith({ email: 'maria@empresa.test', password: 'senha-forte-de-teste', rememberMe: false });
    expect(await screen.findByRole('heading', { level: 1, name: 'Campanhas' })).toBeTruthy();
  });

  it('login recusado mostra a mensagem e continua na tela de entrar', async () => {
    renderAt('/entrar', { authApi: fakeAuth(null, { signIn: vi.fn(async () => ({ ok: false as const, message: 'E-mail ou senha incorretos.' })) }) });
    await loginReady();
    type('E-mail', 'maria@empresa.test');
    type('Senha', 'senha-errada-qualquer');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Entrar/ }));
    });
    expect(screen.getByRole('alert').textContent).toBe('E-mail ou senha incorretos.');
    expect(screen.getByRole('heading', { level: 1, name: 'Entre na sua conta' })).toBeTruthy();
  });

  it('quem já está logado e abre /entrar vai direto para o painel', async () => {
    renderAt('/entrar');
    expect(await panelReady()).toBeTruthy();
  });

  it('API fora do ar ao verificar a sessão: mostra o aviso e permite tentar de novo', async () => {
    const getSession = vi.fn(async () => {
      throw new Error('sem conexão');
    });
    renderAt('/', { authApi: fakeAuth(null, { getSession }) });
    expect(await screen.findByRole('heading', { name: 'Servidor indisponível' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await vi.waitFor(() => expect(getSession).toHaveBeenCalledTimes(2));
  });

  it('o retorno depois do login só aceita caminhos internos', () => {
    expect(safeReturnPath('/campanhas')).toBe('/campanhas');
    expect(safeReturnPath('https://malicioso.test')).toBe('/');
    expect(safeReturnPath('//malicioso.test')).toBe('/');
    expect(safeReturnPath('/entrar')).toBe('/');
    expect(safeReturnPath(null)).toBe('/');
  });
});

describe('criar conta', () => {
  async function openSignup(authApi = fakeAuth(null)) {
    renderAt('/entrar', { authApi });
    await loginReady();
    fireEvent.click(screen.getByRole('link', { name: /Criar conta/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Crie sua conta' })).toBeTruthy();
    return authApi;
  }

  function fillSignup(password = 'senha-forte-de-teste', confirmation = password) {
    type('Seu nome', 'Maria Teste');
    type('Nome da empresa', 'Clínica Exemplo');
    type('E-mail', 'maria@empresa.test');
    type(/^Senha$/, password);
    type('Repita a senha', confirmation);
  }

  it('valida antes de enviar: senha curta e senhas diferentes', async () => {
    const authApi = await openSignup();
    fillSignup('curta');
    fireEvent.click(screen.getByRole('button', { name: /Criar conta/ }));
    expect(screen.getByRole('alert').textContent).toContain('12 caracteres');
    fillSignup('senha-forte-de-teste', 'outra-senha-de-teste');
    fireEvent.click(screen.getByRole('button', { name: /Criar conta/ }));
    expect(screen.getByRole('alert').textContent).toBe('As senhas não conferem.');
    expect(authApi.signUp).not.toHaveBeenCalled();
  });

  it('cria a conta com a empresa e abre o painel', async () => {
    const authApi = await openSignup();
    fillSignup();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Criar conta/ }));
    });
    expect(authApi.signUp).toHaveBeenCalledWith({ name: 'Maria Teste', companyName: 'Clínica Exemplo', email: 'maria@empresa.test', password: 'senha-forte-de-teste' });
    expect(await panelReady()).toBeTruthy();
    expect(screen.getByText('Clínica Exemplo')).toBeTruthy();
  });

  it('mostra a recusa da API (ex.: e-mail já usado)', async () => {
    await openSignup(fakeAuth(null, { signUp: vi.fn(async () => ({ ok: false as const, message: 'Não foi possível criar a conta com este e-mail.' })) }));
    fillSignup();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Criar conta/ }));
    });
    expect(screen.getByRole('alert').textContent).toBe('Não foi possível criar a conta com este e-mail.');
  });

  it('o painel de apresentação não traz números nem resultados inventados, e os pontos trocam a mensagem', async () => {
    renderAt('/entrar', { authApi: fakeAuth(null) });
    await loginReady();
    const showcase = screen.getByRole('region', { name: 'Sobre o DisparaZap' });
    expect(showcase.textContent).not.toMatch(/\d/);
    expect(within(showcase).getByRole('heading', { name: SHOWCASE_SLIDES[0].title })).toBeTruthy();
    fireEvent.click(within(showcase).getByRole('button', { name: 'Mostrar mensagem 3 de 3' }));
    expect(within(showcase).getByRole('heading', { name: SHOWCASE_SLIDES[2].title })).toBeTruthy();
  });
});

describe('usuário conectado', () => {
  it.each([
    ['Admin-Empresa', COMPANY_ADMIN, 'Clínica Exemplo'],
    ['Super-Admin', SUPER_ADMIN, 'Plataforma DisparaZap'],
    ['Admin-MyLinksss', MYLINKSSS_ADMIN, 'Loja Parceira'],
  ])('%s: o cabeçalho mostra o nome e o tipo; o menu mostra o espaço de trabalho', async (label, session, workspace) => {
    renderAt('/', { authApi: fakeAuth(session) });
    await panelReady();
    const user = within(screen.getByLabelText('Usuário conectado'));
    expect(user.getByText(session.user.name)).toBeTruthy();
    expect(user.getByText(label)).toBeTruthy();
    expect(screen.getByText(workspace)).toBeTruthy();
  });

  it('se o servidor recusar o logout, a pessoa continua logada e vê o aviso (não finge que saiu)', async () => {
    const authApi = renderAt('/', { authApi: fakeAuth(COMPANY_ADMIN, { signOut: vi.fn(async () => { throw new Error('Não foi possível sair agora: sua sessão continua ativa. Recarregue a página e tente de novo.'); }) }) });
    await panelReady();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sair' }));
    });
    expect(authApi.signOut).toHaveBeenCalledTimes(1);
    expect((await screen.findByRole('alert')).textContent).toContain('sua sessão continua ativa');
    expect(screen.queryByRole('heading', { level: 1, name: 'Entre na sua conta' })).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Menu principal' })).toBeTruthy();
  });

  it('sair encerra a sessão e volta para a tela de entrar', async () => {
    const authApi = renderAt('/');
    await panelReady();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sair' }));
    });
    expect(authApi.signOut).toHaveBeenCalledTimes(1);
    expect(await loginReady()).toBeTruthy();
  });
});

describe('layout do painel', () => {
  it('mostra a marca, o aviso de construção e o menu com as 10 seções na ordem', async () => {
    renderAt('/');
    await panelReady();
    expect(screen.getByText('Em construção')).toBeTruthy();
    expect(screen.getByText('Ambiente de desenvolvimento')).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
    const labels = menu().getAllByRole('link').map((link) => link.querySelector('.sidebar__label')?.textContent);
    expect(labels).toEqual(['Visão Geral', 'Inbox', 'Campanhas', 'Envio de Mensagens', 'Contatos', 'Agentes de IA', 'Automações', 'Redes Sociais', 'Integrações', 'Configurações']);
    // Inbox, Envio de Mensagens, Contatos, Redes Sociais e Integrações (com o WhatsApp dentro) já estão disponíveis; os outros 4 seguem em desenvolvimento
    expect(menu().getAllByText('Em desenvolvimento')).toHaveLength(4);
  });
});

describe('Visão Geral', () => {
  it('cumprimenta o usuário, avisa que a plataforma está em construção e lista os módulos', async () => {
    renderAt('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Visão Geral' })).toBeTruthy();
    expect(screen.getByText(/Olá, Maria/)).toBeTruthy();
    expect(screen.getByRole('note').textContent).toMatch(/Plataforma em construção/);
    const lista = within(screen.getByRole('heading', { name: 'Módulos planejados' }).closest('section') as HTMLElement);
    expect(lista.getAllByRole('listitem')).toHaveLength(9);
    expect(lista.getAllByText('Em desenvolvimento')).toHaveLength(4);
    expect(lista.getAllByText('Disponível')).toHaveLength(5);
  });

  it('não exibe estatísticas, contas ou campanhas inventadas', async () => {
    renderAt('/');
    await panelReady();
    const texto = screen.getByRole('main').textContent ?? '';
    expect(texto).not.toMatch(/\d+\s*(mensagens|contatos|campanhas|enviad|instâncias conectadas|conversas)/i);
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('status real: API "Online" e banco "Conectado" quando respondem', async () => {
    renderAt('/');
    expect(await screen.findByText('Online')).toBeTruthy();
    expect(await screen.findByText('Conectado')).toBeTruthy();
  });

  it('status real: "Indisponível" quando a API falha, e permite verificar de novo', async () => {
    const fetchHealth = vi.fn(offline);
    renderAt('/', { fetchHealth, fetchReady: async () => false });
    expect((await screen.findAllByText('Indisponível')).length).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: /Verificar a API novamente/ }));
    await vi.waitFor(() => expect(fetchHealth).toHaveBeenCalledTimes(2));
  });
});

describe('módulos ainda não implementados', () => {
  it.each(MODULES.map((item) => [item.label, item] as const))('%s mostra "Em desenvolvimento", sem dados nem ações', async (_label, item) => {
    renderAt(item.path);
    expect(await screen.findByRole('heading', { level: 1, name: item.label })).toBeTruthy();
    const main = within(screen.getByRole('main'));
    expect(main.getByText('Em desenvolvimento')).toBeTruthy();
    expect(main.getByText('Este módulo ainda não foi implementado')).toBeTruthy();
    expect(main.getByText(item.plannedFor)).toBeTruthy();
    expect(main.queryAllByRole('button')).toHaveLength(0);
    expect(main.queryAllByRole('textbox')).toHaveLength(0);
  });
});

describe('navegação', () => {
  it('clicar em um item do menu abre o módulo e marca o link como atual', async () => {
    renderAt('/');
    await panelReady();
    fireEvent.click(menu().getByRole('link', { name: /Campanhas/ }));
    expect(screen.getByRole('heading', { level: 1, name: 'Campanhas' })).toBeTruthy();
    expect(menu().getByRole('link', { name: /Campanhas/ }).getAttribute('aria-current')).toBe('page');
  });

  it('rota desconhecida mostra "Página não encontrada"', async () => {
    renderAt('/rota-que-nao-existe');
    expect(await screen.findByRole('heading', { level: 1, name: 'Página não encontrada' })).toBeTruthy();
  });

  it('menu no celular: o botão alterna o estado e escolher um item fecha o menu', async () => {
    renderAt('/');
    await panelReady();
    const toggle = screen.getByRole('button', { name: 'Abrir menu' });
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Fechar menu' }).getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(menu().getByRole('link', { name: /Contatos/ }));
    expect(screen.getByRole('button', { name: 'Abrir menu' }).getAttribute('aria-expanded')).toBe('false');
  });
});

describe('permissões (estrutura preparada)', () => {
  it('visibleNavigation mostra só os itens permitidos', () => {
    const visiveis = visibleNavigation(NAVIGATION, (permission) => permission === 'overview:view' || permission === 'integrations:view');
    expect(visiveis.map((item) => item.id)).toEqual(['overview', 'integrations']);
  });

  it('cada item declara uma permissão única', () => {
    const permissions = NAVIGATION.map((item) => item.permission);
    expect(new Set(permissions).size).toBe(permissions.length);
  });
});
