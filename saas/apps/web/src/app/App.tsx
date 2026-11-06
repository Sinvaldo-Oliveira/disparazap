import { Navigate, Route, Routes } from 'react-router';
import { ZERNIO_RETURN_ROUTE } from '@disparazap/contracts';
import { httpAuthApi, type AuthApi } from '../auth/auth-api';
import { AuthProvider } from '../auth/AuthProvider';
import { LOGIN_PATH, PublicOnly, RequireAuth, SIGNUP_ROUTE } from '../auth/guards';
import { AppLayout } from '../layouts/AppLayout';
import { AuthLayout } from '../layouts/AuthLayout';
import { ContactListPage } from '../pages/ContactListPage';
import { ContactsPage } from '../pages/ContactsPage';
import { IntegrationsPage } from '../pages/IntegrationsPage';
import { LoginPage } from '../pages/LoginPage';
import { ModulePage } from '../pages/ModulePage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { OverviewPage } from '../pages/OverviewPage';
import { SendMessagesPage } from '../pages/SendMessagesPage';
import { SettingsPage } from '../pages/SettingsPage';
import { SignupPage } from '../pages/SignupPage';
import { SocialSection } from '../pages/social/SocialSection';
import { ZernioReturnPage } from '../pages/ZernioReturnPage';
import { httpZernioApi, type ZernioApi } from '../integrations/zernio-api';
import { httpWhatsAppApi, type WhatsAppApi } from '../whatsapp/whatsapp-api';
import { httpMessagingApi, type MessagingApi } from '../messaging/messaging-api';
import type { ReadSpreadsheet } from '../messaging/spreadsheet';
import type { Wait } from '../pages/SendMessagesPage';
import { httpPlatformApi, type PlatformApi } from '../platform/platform-api';
import { httpSocialApi, type SocialApi } from '../social/social-api';
import { httpInboxApi, type InboxApi } from '../inbox/inbox-api';
import { InboxPage } from '../pages/inbox/InboxPage';
import { httpAutomationsApi, type AutomationsApi } from '../automations/automations-api';
import { AutomationsPage } from '../pages/automations/AutomationsPage';
import { fetchHealth as defaultFetchHealth, fetchReady as defaultFetchReady, type FetchHealth, type FetchReady } from './health-client';
import { NAVIGATION, visibleNavigation } from './navigation';

export interface AppProps {
  authApi?: AuthApi;
  platformApi?: PlatformApi;
  whatsappApi?: WhatsAppApi;
  messagingApi?: MessagingApi;
  zernioApi?: ZernioApi;
  socialApi?: SocialApi;
  inboxApi?: InboxApi;
  automationsApi?: AutomationsApi;
  /** Consulta periódica da Inbox sem o canal em tempo real (os testes usam um valor curto) */
  inboxPollMs?: number;
  /** Leva o navegador ao link de autorização da Zernio (os testes trocam) */
  zernioRedirect?: (url: string) => void;
  /** Leitura de planilhas e espera entre envios do Envio de Mensagens (os testes trocam) */
  readSpreadsheet?: ReadSpreadsheet;
  sendWait?: Wait;
  /** Espera da busca de contatos (e do histórico das Redes Sociais) depois da última tecla (os testes usam 0) */
  contactSearchDelayMs?: number;
  /** Intervalo de acompanhamento da conexão (os testes usam um valor curto) */
  whatsappPollMs?: number;
  fetchHealth?: FetchHealth;
  fetchReady?: FetchReady;
}

// Por enquanto os três tipos de usuário veem o mesmo menu; o que cada um pode fazer é decidido na API e nas páginas.
// (ex.: WhatsApp: dono e administradores da empresa gerenciam; os demais só veem).
const allowAll = () => true;

export function App({ authApi = httpAuthApi, platformApi = httpPlatformApi, whatsappApi = httpWhatsAppApi, messagingApi = httpMessagingApi, zernioApi = httpZernioApi, socialApi = httpSocialApi, inboxApi = httpInboxApi, automationsApi = httpAutomationsApi, inboxPollMs, zernioRedirect, readSpreadsheet, sendWait, contactSearchDelayMs, whatsappPollMs = 3000, fetchHealth = defaultFetchHealth, fetchReady = defaultFetchReady }: AppProps) {
  const items = visibleNavigation(NAVIGATION, allowAll);
  const modules = items.filter((item) => item.path !== '/');
  const contactsItem = modules.find((item) => item.id === 'contacts');
  const integrationsItem = modules.find((item) => item.id === 'integrations');

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
                // Redes Sociais tem abas próprias (subpáginas): /redes-sociais/criar, /calendario…; a Inbox, /inbox/:conversa[/detalhes];
                // Automações, /automacoes/:id
                path={item.id === 'social' || item.id === 'inbox' || item.id === 'automations' ? `${item.path.slice(1)}/*` : item.path.slice(1)}
                element={
                  item.id === 'inbox' ? (
                    <InboxPage item={item} api={inboxApi} socialApi={socialApi} {...(inboxPollMs !== undefined ? { pollMs: inboxPollMs } : {})} {...(contactSearchDelayMs !== undefined ? { searchDelayMs: contactSearchDelayMs } : {})} />
                  ) : item.id === 'social' ? (
                    <SocialSection item={item} api={socialApi} {...(contactSearchDelayMs !== undefined ? { searchDelayMs: contactSearchDelayMs } : {})} />
                  ) : item.id === 'automations' ? (
                    <AutomationsPage item={item} api={automationsApi} />
                  ) : item.id === 'settings' ? (
                    <SettingsPage item={item} platformApi={platformApi} />
                  ) : item.id === 'contacts' ? (
                    <ContactsPage item={item} api={messagingApi} {...(contactSearchDelayMs !== undefined ? { searchDelayMs: contactSearchDelayMs } : {})} />
                  ) : item.id === 'integrations' ? (
                    <IntegrationsPage item={item} api={zernioApi} whatsappApi={whatsappApi} inboxApi={inboxApi} whatsappPollMs={whatsappPollMs} {...(zernioRedirect ? { redirect: zernioRedirect } : {})} />
                  ) : item.id === 'send' ? (
                    <SendMessagesPage item={item} whatsappApi={whatsappApi} messagingApi={messagingApi} {...(readSpreadsheet ? { readSpreadsheet } : {})} {...(sendWait ? { wait: sendWait } : {})} />
                  ) : (
                    <ModulePage item={item} />
                  )
                }
              />
            ))}
            {contactsItem && <Route path={`${contactsItem.path.slice(1)}/:listId`} element={<ContactListPage item={contactsItem} api={messagingApi} {...(readSpreadsheet ? { readSpreadsheet } : {})} />} />}
            {integrationsItem && <Route path={ZERNIO_RETURN_ROUTE.slice(1)} element={<ZernioReturnPage item={integrationsItem} api={zernioApi} />} />}
            {/* O WhatsApp (Evolution Go) mudou para a página Integrações: o endereço antigo leva até a seção */}
            <Route path="whatsapp" element={<Navigate to={{ pathname: '/integracoes', hash: '#whatsapp' }} replace />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  );
}
