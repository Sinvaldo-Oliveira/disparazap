import {
  ZERNIO_ACCOUNTS_PATH,
  ZERNIO_CONNECT_PATH,
  ZERNIO_CONNECT_RETURN_PATH,
  ZERNIO_INBOX_ACCESS_PATH,
  ZERNIO_KEY_PATH,
  ZERNIO_PATH,
  zernioAccountPath,
  zernioAccountsResponseSchema,
  zernioConnectResultSchema,
  zernioInboxAccessResultSchema,
  zernioReturnResultSchema,
  zernioStatusSchema,
  type ZernioAccountsResponse,
  type ZernioConnectResult,
  type ZernioInboxAccessResult,
  type ZernioPlatform,
  type ZernioReturnInput,
  type ZernioReturnResult,
  type ZernioStatus,
} from '@disparazap/contracts';
import { request, type ApiResult } from '../platform/platform-api';

/** Integração da empresa com a Zernio (redes sociais). A chave fica só no servidor. Os testes trocam por uma versão falsa. */
export interface ZernioApi {
  status(signal?: AbortSignal): Promise<ApiResult<ZernioStatus>>;
  /** Testa a chave na Zernio e, se aceita, guarda cifrada no servidor */
  saveKey(apiKey: string): Promise<ApiResult<ZernioStatus>>;
  /** Apaga a chave do DisparaZap (a conta Zernio não muda) */
  removeKey(): Promise<ApiResult<null>>;
  accounts(signal?: AbortSignal): Promise<ApiResult<ZernioAccountsResponse>>;
  /** Link de autorização da rede; reconnectAccountId renova uma conta já conectada */
  connect(platform: ZernioPlatform, reconnectAccountId: string | null): Promise<ApiResult<ZernioConnectResult>>;
  /** Volta da autorização: a API confere o comprovante e relê as contas na Zernio */
  completeConnect(input: ZernioReturnInput): Promise<ApiResult<ZernioReturnResult>>;
  disconnect(accountId: string): Promise<ApiResult<null>>;
  /** Consulta de leitura à Inbox da Zernio (só administradores; a API pede a confirmação) */
  testInboxAccess(): Promise<ApiResult<ZernioInboxAccessResult>>;
}

const withSignal = (signal?: AbortSignal) => (signal ? { signal } : {});

export const httpZernioApi: ZernioApi = {
  status: (signal) => request(ZERNIO_PATH, { method: 'GET', ...withSignal(signal) }, (body) => zernioStatusSchema.parse(body)),
  saveKey: (apiKey) => request(ZERNIO_KEY_PATH, { method: 'PUT', body: JSON.stringify({ apiKey }) }, (body) => zernioStatusSchema.parse(body)),
  removeKey: () => request(ZERNIO_KEY_PATH, { method: 'DELETE' }, () => null),
  accounts: (signal) => request(ZERNIO_ACCOUNTS_PATH, { method: 'GET', ...withSignal(signal) }, (body) => zernioAccountsResponseSchema.parse(body)),
  connect: (platform, reconnectAccountId) =>
    request(ZERNIO_CONNECT_PATH, { method: 'POST', body: JSON.stringify({ platform, reconnectAccountId }) }, (body) => zernioConnectResultSchema.parse(body)),
  completeConnect: (input) => request(ZERNIO_CONNECT_RETURN_PATH, { method: 'POST', body: JSON.stringify(input) }, (body) => zernioReturnResultSchema.parse(body)),
  disconnect: (accountId) => request(zernioAccountPath(accountId), { method: 'DELETE' }, () => null),
  testInboxAccess: () =>
    request(ZERNIO_INBOX_ACCESS_PATH, { method: 'POST', body: JSON.stringify({ confirmed: true }) }, (body) => zernioInboxAccessResultSchema.parse(body)),
};
