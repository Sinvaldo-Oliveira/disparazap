import { Construction } from 'lucide-react';
import { Link } from 'react-router';
import type { FetchHealth } from '../app/health-client';
import type { NavigationItem } from '../app/navigation';
import { Card } from '../components/Card';
import { EnvironmentStatus } from '../components/EnvironmentStatus';
import { PageHeader } from '../components/PageHeader';
import { InDevelopmentBadge } from '../components/StatusBadge';

interface OverviewPageProps {
  modules: readonly NavigationItem[];
  fetchHealth: FetchHealth;
}

export function OverviewPage({ modules, fetchHealth }: OverviewPageProps) {
  return (
    <>
      <PageHeader title="Visão Geral" description="Ambiente de desenvolvimento do painel DisparaZap." />

      <div className="notice" role="note">
        <Construction className="notice__icon" aria-hidden="true" />
        <p>
          <strong>Plataforma em construção.</strong> Esta é a fundação técnica do SaaS (Fase 4). Nenhum módulo
          funciona ainda: o painel não envia mensagens, não acessa contas e não guarda dados.
        </p>
      </div>

      <div className="grid grid--two">
        <Card title="Status do ambiente">
          <EnvironmentStatus fetchHealth={fetchHealth} />
        </Card>
        <Card title="Próxima fase">
          <p className="card__text">
            <strong>Fase 5 — banco de dados, autenticação e Super Admin.</strong> Aguardando autorização para começar.
          </p>
        </Card>
      </div>

      <Card title="Módulos planejados">
        <ul className="module-list">
          {modules.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.id} className="module-list__item">
                <Icon className="module-list__icon" aria-hidden="true" />
                <div className="module-list__body">
                  <div className="module-list__head">
                    <Link to={item.path} className="module-list__name">{item.label}</Link>
                    <InDevelopmentBadge />
                  </div>
                  <p>{item.summary}</p>
                  <p className="module-list__when">{item.plannedFor}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}
