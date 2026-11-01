import { Menu, X } from 'lucide-react';
import { StatusBadge } from './StatusBadge';

interface HeaderProps {
  title: string;
  menuOpen: boolean;
  onToggleMenu: () => void;
}

// Sem área de usuário nem botão de entrar: não existe autenticação nesta fase
export function Header({ title, menuOpen, onToggleMenu }: HeaderProps) {
  return (
    <header className="topbar">
      <button
        type="button"
        className="topbar__menu"
        aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
        aria-expanded={menuOpen}
        aria-controls="sidebar"
        onClick={onToggleMenu}
      >
        {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
      </button>
      <span className="topbar__title">{title}</span>
      <div className="topbar__badges">
        <StatusBadge tone="neutral">Ambiente de desenvolvimento</StatusBadge>
        <StatusBadge tone="development">Em construção</StatusBadge>
      </div>
    </header>
  );
}
