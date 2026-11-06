import { NavLink, Route, Routes } from 'react-router';
import { SOCIAL_ROUTES } from '@disparazap/contracts';
import type { NavigationItem } from '../../app/navigation';
import { useSession } from '../../auth/AuthProvider';
import { Card } from '../../components/Card';
import { PageHeader } from '../../components/PageHeader';
import type { SocialApi } from '../../social/social-api';
import { NotFoundPage } from '../NotFoundPage';
import { SocialCalendarTab } from './SocialCalendarTab';
import { SocialComposer } from './SocialComposer';
import { SocialHistoryTab } from './SocialHistoryTab';
import { SocialLibraryTab } from './SocialLibraryTab';
import { SocialOverviewTab } from './SocialOverviewTab';
import { SocialResultsTab } from './SocialResultsTab';

export const SOCIAL_DESCRIPTION = 'Publique, agende e acompanhe as redes da empresa. As contas são conectadas na página Integrações.';

const TABS: readonly { label: string; path: string }[] = [
  { label: 'Visão Geral', path: SOCIAL_ROUTES.overview },
  { label: 'Criar publicação', path: SOCIAL_ROUTES.create },
  { label: 'Calendário', path: SOCIAL_ROUTES.calendar },
  { label: 'Histórico', path: SOCIAL_ROUTES.history },
  { label: 'Biblioteca', path: SOCIAL_ROUTES.library },
  { label: 'Resultados', path: SOCIAL_ROUTES.results },
  { label: 'Interações', path: SOCIAL_ROUTES.interactions },
];

export interface SocialSectionProps {
  item: NavigationItem;
  api: SocialApi;
  /** Espera depois da última tecla na busca do histórico (os testes usam 0) */
  searchDelayMs?: number;
}

/** Módulo Redes Sociais: operação diária das contas conectadas em Integrações (PLANO_MODULO_REDES_SOCIAIS) */
export function SocialSection({ item, api, searchDelayMs = 300 }: SocialSectionProps) {
  const session = useSession();
  if (!session.organization) {
    return (
      <>
        <PageHeader title={item.label} icon={item.icon} description={SOCIAL_DESCRIPTION} />
        <Card title="Sem empresa nesta conta">
          <p className="card__text">As redes sociais pertencem às empresas. Sua conta não está ligada a uma empresa.</p>
        </Card>
      </>
    );
  }
  return (
    <>
      <PageHeader title={item.label} icon={item.icon} description={SOCIAL_DESCRIPTION} />
      <nav className="social-tabs" aria-label="Seções de Redes Sociais">
        {TABS.map((tab) => (
          <NavLink key={tab.path} to={tab.path} end={tab.path === SOCIAL_ROUTES.overview} className={({ isActive }) => `social-tabs__link${isActive ? ' social-tabs__link--active' : ''}`}>
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<SocialOverviewTab api={api} />} />
        <Route path="criar" element={<SocialComposer api={api} />} />
        <Route path="criar/:postId" element={<SocialComposer api={api} />} />
        <Route path="calendario" element={<SocialCalendarTab api={api} />} />
        <Route path="historico" element={<SocialHistoryTab api={api} searchDelayMs={searchDelayMs} />} />
        <Route path="biblioteca" element={<SocialLibraryTab api={api} />} />
        <Route path="resultados" element={<SocialResultsTab api={api} />} />
        <Route
          path="interacoes"
          element={
            <section className="under-construction" aria-label="Interações">
              <h2>Interações: em desenvolvimento</h2>
              <p>
                Comentários (Instagram, Facebook, LinkedIn, YouTube, Threads e X) e avaliações (Google e Facebook) chegam numa próxima etapa. Eles dependem dos avisos
                automáticos da Zernio, que exigem o sistema publicado com HTTPS, e de uma política para os dados de terceiros (LGPD).
              </p>
            </section>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
