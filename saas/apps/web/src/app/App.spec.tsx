import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { FetchHealth } from './health-client';
import { NAVIGATION, visibleNavigation } from './navigation';

afterEach(cleanup);

const healthy: FetchHealth = async () => ({ status: 'ok', service: 'disparazap-api', timestamp: '2026-10-31T12:00:00.000Z' });
const offline: FetchHealth = async () => {
  throw new Error('sem conexão');
};

function renderAt(path: string, fetchHealth: FetchHealth = healthy) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App fetchHealth={fetchHealth} />
    </MemoryRouter>,
  );
}

const menu = () => within(screen.getByRole('navigation', { name: 'Menu principal' }));
const MODULES = NAVIGATION.filter((item) => item.path !== '/');

describe('layout', () => {
  it('mostra a marca, o cabeçalho com o aviso de construção e o menu com as 9 seções na ordem', () => {
    renderAt('/');
    expect(screen.getByText('DisparaZap')).toBeTruthy();
    expect(screen.getByText('Em construção')).toBeTruthy();
    expect(screen.getByText('Ambiente de desenvolvimento')).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
    const labels = menu().getAllByRole('link').map((link) => link.querySelector('.sidebar__label')?.textContent);
    expect(labels).toEqual([
      'Visão Geral', 'WhatsApp', 'Campanhas', 'Contatos', 'Agentes de IA',
      'Automações', 'Redes Sociais', 'Integrações', 'Configurações',
    ]);
    expect(menu().getAllByText('Em desenvolvimento')).toHaveLength(8);
  });

  it('não existe tela, botão ou campo de login', () => {
    renderAt('/');
    expect(screen.queryByText(/entrar|login|senha|sair da conta/i)).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });
});

describe('Visão Geral', () => {
  it('avisa que a plataforma está em construção e lista os módulos como em desenvolvimento', () => {
    renderAt('/');
    expect(screen.getByRole('heading', { level: 1, name: 'Visão Geral' })).toBeTruthy();
    expect(screen.getByRole('note').textContent).toMatch(/Plataforma em construção/);
    const lista = within(screen.getByRole('heading', { name: 'Módulos planejados' }).closest('section') as HTMLElement);
    expect(lista.getAllByRole('listitem')).toHaveLength(8);
    expect(lista.getAllByText('Em desenvolvimento')).toHaveLength(8);
  });

  it('não exibe estatísticas, contas ou campanhas inventadas', () => {
    renderAt('/');
    const texto = screen.getByRole('main').textContent ?? '';
    expect(texto).not.toMatch(/\d+\s*(mensagens|contatos|campanhas|enviad|instâncias conectadas|conversas)/i);
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
    expect(screen.queryAllByRole('meter')).toHaveLength(0);
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('status da API: "Online" quando o health check responde', async () => {
    renderAt('/');
    expect(await screen.findByText('Online')).toBeTruthy();
  });

  it('status da API: "Indisponível" quando falha, e permite verificar de novo', async () => {
    const fetchHealth = vi.fn(offline);
    renderAt('/', fetchHealth);
    expect(await screen.findByText('Indisponível')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Verificar novamente/ }));
    await vi.waitFor(() => expect(fetchHealth).toHaveBeenCalledTimes(2));
  });
});

describe('módulos ainda não implementados', () => {
  it.each(MODULES.map((item) => [item.label, item] as const))('%s mostra "Em desenvolvimento", sem dados nem ações', (_label, item) => {
    renderAt(item.path);
    expect(screen.getByRole('heading', { level: 1, name: item.label })).toBeTruthy();
    const main = within(screen.getByRole('main'));
    expect(main.getByText('Em desenvolvimento')).toBeTruthy();
    expect(main.getByText('Este módulo ainda não foi implementado')).toBeTruthy();
    expect(main.getByText(item.plannedFor)).toBeTruthy();
    expect(main.queryAllByRole('button')).toHaveLength(0);
    expect(main.queryAllByRole('textbox')).toHaveLength(0);
    expect(main.queryAllByRole('table')).toHaveLength(0);
  });
});

describe('navegação', () => {
  it('clicar em um item do menu abre o módulo e marca o link como atual', () => {
    renderAt('/');
    fireEvent.click(menu().getByRole('link', { name: /Campanhas/ }));
    expect(screen.getByRole('heading', { level: 1, name: 'Campanhas' })).toBeTruthy();
    expect(menu().getByRole('link', { name: /Campanhas/ }).getAttribute('aria-current')).toBe('page');
    expect(menu().getByRole('link', { name: /Visão Geral/ }).getAttribute('aria-current')).toBeNull();
  });

  it('o link do módulo na Visão Geral leva à página dele', () => {
    renderAt('/');
    const lista = within(screen.getByRole('heading', { name: 'Módulos planejados' }).closest('section') as HTMLElement);
    fireEvent.click(lista.getByRole('link', { name: 'Integrações' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Integrações' })).toBeTruthy();
  });

  it('rota desconhecida mostra "Página não encontrada"', () => {
    renderAt('/rota-que-nao-existe');
    expect(screen.getByRole('heading', { level: 1, name: 'Página não encontrada' })).toBeTruthy();
  });

  it('menu no celular: o botão alterna o estado e escolher um item fecha o menu', () => {
    renderAt('/');
    const toggle = screen.getByRole('button', { name: 'Abrir menu' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Fechar menu' }).getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById('sidebar')?.className).toContain('sidebar--open');
    fireEvent.click(menu().getByRole('link', { name: /Contatos/ }));
    expect(screen.getByRole('button', { name: 'Abrir menu' }).getAttribute('aria-expanded')).toBe('false');
  });
});

describe('permissões (estrutura preparada)', () => {
  it('visibleNavigation mostra só os itens permitidos', () => {
    const visiveis = visibleNavigation(NAVIGATION, (permission) => permission === 'overview:view' || permission === 'whatsapp:view');
    expect(visiveis.map((item) => item.id)).toEqual(['overview', 'whatsapp']);
  });

  it('cada item declara uma permissão única', () => {
    const permissions = NAVIGATION.map((item) => item.permission);
    expect(new Set(permissions).size).toBe(permissions.length);
  });
});
