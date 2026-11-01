import { NavLink } from 'react-router';
import type { NavigationItem } from '../app/navigation';
import { BrandMark } from './BrandMark';

interface SidebarProps {
  items: readonly NavigationItem[];
  open: boolean;
  onNavigate: () => void;
}

export function Sidebar({ items, open, onNavigate }: SidebarProps) {
  return (
    <aside id="sidebar" className={`sidebar${open ? ' sidebar--open' : ''}`}>
      <div className="sidebar__brand">
        <BrandMark />
        <span>DisparaZap</span>
      </div>
      <nav aria-label="Menu principal">
        <ul className="sidebar__list">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.id}>
                <NavLink
                  to={item.path}
                  end={item.path === '/'}
                  className={({ isActive }) => `sidebar__link${isActive ? ' sidebar__link--active' : ''}`}
                  onClick={onNavigate}
                >
                  <Icon className="sidebar__icon" aria-hidden="true" />
                  <span className="sidebar__text">
                    <span className="sidebar__label">{item.label}</span>
                    {item.status === 'in_development' && <span className="sidebar__status">Em desenvolvimento</span>}
                  </span>
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>
      <p className="sidebar__footer">Fase 4 · fundação técnica</p>
    </aside>
  );
}
