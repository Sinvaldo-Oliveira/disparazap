import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  badge?: ReactNode;
}

export function PageHeader({ title, description, icon: Icon, badge }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header__title">
        {Icon && <Icon className="page-header__icon" aria-hidden="true" />}
        <h1>{title}</h1>
        {badge}
      </div>
      {description && <p className="page-header__description">{description}</p>}
    </header>
  );
}
