import { Route, Routes } from 'react-router';
import { AppLayout } from '../layouts/AppLayout';
import { ModulePage } from '../pages/ModulePage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { OverviewPage } from '../pages/OverviewPage';
import { fetchHealth as defaultFetchHealth, type FetchHealth } from './health-client';
import { NAVIGATION, visibleNavigation } from './navigation';

export interface AppProps {
  fetchHealth?: FetchHealth;
}

// Sem autenticação nesta fase: todos os itens ficam visíveis. Na Fase 5, canView consulta as permissões do usuário.
const allowAll = () => true;

export function App({ fetchHealth = defaultFetchHealth }: AppProps) {
  const items = visibleNavigation(NAVIGATION, allowAll);
  const modules = items.filter((item) => item.path !== '/');

  return (
    <Routes>
      <Route element={<AppLayout items={items} />}>
        <Route index element={<OverviewPage modules={modules} fetchHealth={fetchHealth} />} />
        {modules.map((item) => (
          <Route key={item.id} path={item.path.slice(1)} element={<ModulePage item={item} />} />
        ))}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
