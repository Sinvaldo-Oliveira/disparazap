import { LogOut, Menu, X } from 'lucide-react';
import { useState } from 'react';
import { USER_TYPE_LABELS } from '@disparazap/contracts';
import { useAuth, useSession } from '../auth/AuthProvider';
import { StatusBadge } from './StatusBadge';

interface HeaderProps {
  title: string;
  menuOpen: boolean;
  onToggleMenu: () => void;
}

export function Header({ title, menuOpen, onToggleMenu }: HeaderProps) {
  const session = useSession();
  const { signOut } = useAuth();
  const [leaving, setLeaving] = useState(false);

  async function handleSignOut() {
    setLeaving(true);
    await signOut();
  }

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
      <div className="topbar__user" aria-label="Usuário conectado">
        <span className="topbar__user-text">
          <span className="topbar__user-name">{session.user.name}</span>
          <span className="topbar__user-type">{USER_TYPE_LABELS[session.userType]}</span>
        </span>
        <button type="button" className="topbar__signout" onClick={handleSignOut} disabled={leaving}>
          <LogOut aria-hidden="true" />
          <span>Sair</span>
        </button>
      </div>
    </header>
  );
}
