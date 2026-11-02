import {
  PLATFORM_WHATSAPP_INSTANCES_PATH,
  WHATSAPP_INSTANCES_PATH,
  pairCodeSchema,
  platformInstanceListSchema,
  qrCodeSchema,
  whatsappInstanceListSchema,
  whatsappInstancePath,
  whatsappInstanceSchema,
  type PairCodeResponse,
  type PlatformInstanceList,
  type QrCodeResponse,
  type WhatsAppInstance,
  type WhatsAppInstanceList,
} from '@disparazap/contracts';
import { request, type ApiResult } from '../platform/platform-api';

/** Módulo WhatsApp da empresa. Os testes trocam por uma versão falsa. */
export interface WhatsAppApi {
  list(signal?: AbortSignal): Promise<ApiResult<WhatsAppInstanceList>>;
  create(displayName: string): Promise<ApiResult<WhatsAppInstance>>;
  connect(id: string): Promise<ApiResult<QrCodeResponse>>;
  qr(id: string): Promise<ApiResult<QrCodeResponse>>;
  pair(id: string, phone: string): Promise<ApiResult<PairCodeResponse>>;
  status(id: string): Promise<ApiResult<WhatsAppInstance>>;
  logout(id: string): Promise<ApiResult<WhatsAppInstance>>;
  remove(id: string): Promise<ApiResult<null>>;
  /** Super-Admin: todas as instâncias de todas as empresas */
  listAll(signal?: AbortSignal): Promise<ApiResult<PlatformInstanceList>>;
}

const withSignal = (signal?: AbortSignal) => (signal ? { signal } : {});

export const httpWhatsAppApi: WhatsAppApi = {
  list: (signal) => request(WHATSAPP_INSTANCES_PATH, { method: 'GET', ...withSignal(signal) }, (body) => whatsappInstanceListSchema.parse(body)),
  create: (displayName) => request(WHATSAPP_INSTANCES_PATH, { method: 'POST', body: JSON.stringify({ displayName }) }, (body) => whatsappInstanceSchema.parse(body)),
  connect: (id) => request(`${whatsappInstancePath(id)}/connect`, { method: 'POST', body: '{}' }, (body) => qrCodeSchema.parse(body)),
  qr: (id) => request(`${whatsappInstancePath(id)}/qr`, { method: 'GET' }, (body) => qrCodeSchema.parse(body)),
  pair: (id, phone) => request(`${whatsappInstancePath(id)}/pair`, { method: 'POST', body: JSON.stringify({ phone }) }, (body) => pairCodeSchema.parse(body)),
  status: (id) => request(`${whatsappInstancePath(id)}/status`, { method: 'GET' }, (body) => whatsappInstanceSchema.parse(body)),
  logout: (id) => request(`${whatsappInstancePath(id)}/logout`, { method: 'POST', body: '{}' }, (body) => whatsappInstanceSchema.parse(body)),
  remove: (id) => request(whatsappInstancePath(id), { method: 'DELETE' }, () => null),
  listAll: (signal) => request(PLATFORM_WHATSAPP_INSTANCES_PATH, { method: 'GET', ...withSignal(signal) }, (body) => platformInstanceListSchema.parse(body)),
};
