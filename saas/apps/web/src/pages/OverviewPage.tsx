import { Construction } from 'lucide-react';
import { Link } from 'react-router';
import type { FetchHealth, FetchReady } from '../app/health-client';
import type { NavigationItem } from '../app/navigation';
import { useSession } from '../auth/AuthProvider';
import { Card } from '../components/Card';
import { EnvironmentStatus } from '../components/EnvironmentStatus';
import { PageHeader } from '../components/PageHeader';
import { InDevelopmentBadge, StatusBadge } from '../components/StatusBadge';

interface OverviewPageProps {
  modules: readonly NavigationItem[];
  fetchHealth: FetchHealth;
  fetchReady: FetchReady;
}

export function OverviewPage({ modules, fetchHealth, fetchReady }: OverviewPageProps) {
  const session = useSession();
  const firstName = session.user.name.split(' ')[0] ?? session.user.name;

  return (
    <>
      <PageHeader title="Visão Geral" description={`Olá, ${firstName}. Este é o ambiente de desenvolvimento do painel DisparaZap.`} />

      <div className="notice" role="note">
        <Construction className="notice__icon" aria-hidden="true" />
        <p>
          <strong>Plataforma em construção.</strong> O login e o cadastro de empresas já funcionam. Os módulos abaixo
          ainda não: o painel não envia mensagens e não acessa contas de WhatsApp.
        </p>
      </div>

      <div className="grid grid--two">
        <Card title="Status do ambiente">
          <EnvironmentStatus fetchHealth={fetchHealth} fetchReady={fetchReady} />
        </Card>
        <Card title="Próximos passos">
          <p className="card__text">
            <strong>Fase 5 — autenticação em andamento.</strong> Faltam a conexão ao Supabase, os convites de usuários, a
            recuperação de senha, a verificação em duas etapas do Super-Admin e a entrada pelo MyLinksss.
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
                    {item.status === 'available' ? <StatusBadge tone="success">Disponível</StatusBadge> : <InDevelopmentBadge />}
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
