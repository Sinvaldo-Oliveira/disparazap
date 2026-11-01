import { useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import type { NavigationItem } from '../app/navigation';
import { Header } from '../components/Header';
import { Sidebar } from '../components/Sidebar';

export function AppLayout({ items }: { items: readonly NavigationItem[] }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  const current = items.find((item) => item.path === pathname);

  return (
    <div className="layout">
      <a className="skip-link" href="#conteudo">Pular para o conteúdo</a>
      <Sidebar items={items} open={menuOpen} onNavigate={() => setMenuOpen(false)} />
      {menuOpen && <div className="layout__backdrop" aria-hidden="true" onClick={() => setMenuOpen(false)} />}
      <div className="layout__main">
        <Header title={current?.label ?? 'DisparaZap'} menuOpen={menuOpen} onToggleMenu={() => setMenuOpen((open) => !open)} />
        <main id="conteudo" className="content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
