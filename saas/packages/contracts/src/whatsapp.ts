import { z } from 'zod';
import { INTERNAL_API_PREFIX } from './auth.ts';
import { PLATFORM_API_PREFIX } from './platform.ts';

// Módulo WhatsApp: instâncias da empresa ativa (sessão), sempre pela integração global
export const WHATSAPP_API_PREFIX = `${INTERNAL_API_PREFIX}/whatsapp`;
export const WHATSAPP_INSTANCES_PATH = `${WHATSAPP_API_PREFIX}/instances`;
export const whatsappInstancePath = (id: string) => `${WHATSAPP_INSTANCES_PATH}/${encodeURIComponent(id)}`;
/** Super-Admin: todas as instâncias de todas as empresas, só leitura */
export const PLATFORM_WHATSAPP_INSTANCES_PATH = `${PLATFORM_API_PREFIX}/whatsapp/instances`;

export const INSTANCE_STATUSES = ['created', 'connecting', 'connected', 'disconnected', 'error'] as const;
export type InstanceStatus = (typeof INSTANCE_STATUSES)[number];

export const INSTANCE_STATUS_LABELS: Readonly<Record<InstanceStatus, string>> = {
  created: 'Aguardando conexão',
  connecting: 'Conectando',
  connected: 'Conectado',
  disconnected: 'Desconectado',
  error: 'Erro',
};

/** Situação da integração global vista pela empresa (sem detalhes técnicos) */
export const INTEGRATION_STATES = ['ready', 'missing', 'disabled'] as const;
export type IntegrationState = (typeof INTEGRATION_STATES)[number];

// O que a API devolve de uma instância: nada de token, nome técnico na Evolution ou endereço do servidor
export const whatsappInstanceSchema = z.strictObject({
  id: z.string().min(1),
  displayName: z.string(),
  status: z.enum(INSTANCE_STATUSES),
  phone: z.string().nullable(),
  createdAt: z.iso.datetime(),
  connectedAt: z.iso.datetime().nullable(),
});
export type WhatsAppInstance = z.infer<typeof whatsappInstanceSchema>;

export const whatsappInstanceListSchema = z.strictObject({
  instances: z.array(whatsappInstanceSchema),
  limit: z.number().int().nonnegative(),
  /** owner e admin da empresa criam, conectam e excluem; os demais só veem */
  canManage: z.boolean(),
  integration: z.enum(INTEGRATION_STATES),
});
export type WhatsAppInstanceList = z.infer<typeof whatsappInstanceListSchema>;

export const createInstanceInputSchema = z.strictObject({
  displayName: z.string().trim().min(2, 'Dê um nome à instância (ex.: "Vendas").').max(60, 'Use no máximo 60 caracteres.'),
});
export type CreateInstanceInput = z.infer<typeof createInstanceInputSchema>;

export const pairInputSchema = z.strictObject({ phone: z.string().trim().min(1, 'Informe o número com DDI.').max(40) });
export type PairInput = z.infer<typeof pairInputSchema>;

/** QR Code para conectar: imagem (data URL) enquanto a instância aguarda; null quando já conectou */
export const qrCodeSchema = z.strictObject({
  instance: whatsappInstanceSchema,
  qrCode: z.string().nullable(),
});
export type QrCodeResponse = z.infer<typeof qrCodeSchema>;

export const pairCodeSchema = z.strictObject({
  instance: whatsappInstanceSchema,
  code: z.string().min(1),
});
export type PairCodeResponse = z.infer<typeof pairCodeSchema>;

export const platformInstanceSchema = z.strictObject({
  ...whatsappInstanceSchema.shape,
  organization: z.strictObject({ id: z.string(), name: z.string() }),
});
export const platformInstanceListSchema = z.strictObject({ instances: z.array(platformInstanceSchema) });
export type PlatformInstanceList = z.infer<typeof platformInstanceListSchema>;
