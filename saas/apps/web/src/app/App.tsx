import { Route, Routes } from 'react-router';
import { httpAuthApi, type AuthApi } from '../auth/auth-api';
import { AuthProvider } from '../auth/AuthProvider';
import { LOGIN_PATH, PublicOnly, RequireAuth, SIGNUP_ROUTE } from '../auth/guards';
import { AppLayout } from '../layouts/AppLayout';
import { AuthLayout } from '../layouts/AuthLayout';
import { ContactListPage } from '../pages/ContactListPage';
import { ContactsPage } from '../pages/ContactsPage';
import { LoginPage } from '../pages/LoginPage';
import { ModulePage } from '../pages/ModulePage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { OverviewPage } from '../pages/OverviewPage';
import { SendMessagesPage } from '../pages/SendMessagesPage';
import { SettingsPage } from '../pages/SettingsPage';
import { SignupPage } from '../pages/SignupPage';
import { WhatsAppPage } from '../pages/WhatsAppPage';
import { httpWhatsAppApi, type WhatsAppApi } from '../whatsapp/whatsapp-api';
import { httpMessagingApi, type MessagingApi } from '../messaging/messaging-api';
import type { ReadSpreadsheet } from '../messaging/spreadsheet';
import type { Wait } from '../pages/SendMessagesPage';
import { httpPlatformApi, type PlatformApi } from '../platform/platform-api';
import { fetchHealth as defaultFetchHealth, fetchReady as defaultFetchReady, type FetchHealth, type FetchReady } from './health-client';
import { NAVIGATION, visibleNavigation } from './navigation';

export interface AppProps {
  authApi?: AuthApi;
  platformApi?: PlatformApi;
  whatsappApi?: WhatsAppApi;
  messagingApi?: MessagingApi;
  /** Leitura de planilhas e espera entre envios do Envio de Mensagens (os testes trocam) */
  readSpreadsheet?: ReadSpreadsheet;
  sendWait?: Wait;
  /** Espera da busca de contatos depois da última tecla (os testes usam 0) */
  contactSearchDelayMs?: number;
  /** Intervalo de acompanhamento da conexão (os testes usam um valor curto) */
  whatsappPollMs?: number;
  fetchHealth?: FetchHealth;
  fetchReady?: FetchReady;
}

// Por enquanto os três tipos de usuário veem o mesmo menu; o que cada um pode fazer é decidido na API e nas páginas.
// (ex.: WhatsApp: dono e administradores da empresa gerenciam; os demais só veem).
const allowAll = () => true;

export function App({ authApi = httpAuthApi, platformApi = httpPlatformApi, whatsappApi = httpWhatsAppApi, messagingApi = httpMessagingApi, readSpreadsheet, sendWait, contactSearchDelayMs, whatsappPollMs = 3000, fetchHealth = defaultFetchHealth, fetchReady = defaultFetchReady }: AppProps) {
  const items = visibleNavigation(NAVIGATION, allowAll);
  const modules = items.filter((item) => item.path !== '/');
  const contactsItem = modules.find((item) => item.id === 'contacts');

  return (
    <AuthProvider api={authApi}>
      <Routes>
        <Route element={<PublicOnly />}>
          <Route element={<AuthLayout />}>
            <Route path={LOGIN_PATH} element={<LoginPage />} />
            <Route path={SIGNUP_ROUTE} element={<SignupPage />} />
          </Route>
        </Route>
        <Route element={<RequireAuth />}>
          <Route element={<AppLayout items={items} />}>
            <Route index element={<OverviewPage modules={modules} fetchHealth={fetchHealth} fetchReady={fetchReady} />} />
            {modules.map((item) => (
              <Route
                key={item.id}
                path={item.path.slice(1)}
                element={
                  item.id === 'settings' ? (
                    <SettingsPage item={item} platformApi={platformApi} />
                  ) : item.id === 'whatsapp' ? (
                    <WhatsAppPage item={item} api={whatsappApi} pollMs={whatsappPollMs} />
                  ) : item.id === 'contacts' ? (
                    <ContactsPage item={item} api={messagingApi} {...(contactSearchDelayMs !== undefined ? { searchDelayMs: contactSearchDelayMs } : {})} />
                  ) : item.id === 'send' ? (
                    <SendMessagesPage item={item} whatsappApi={whatsappApi} messagingApi={messagingApi} {...(readSpreadsheet ? { readSpreadsheet } : {})} {...(sendWait ? { wait: sendWait } : {})} />
                  ) : (
                    <ModulePage item={item} />
                  )
                }
              />
            ))}
            {contactsItem && <Route path={`${contactsItem.path.slice(1)}/:listId`} element={<ContactListPage item={contactsItem} api={messagingApi} {...(readSpreadsheet ? { readSpreadsheet } : {})} />} />}
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  );
}
