import { z } from 'zod';
import { INTERNAL_API_PREFIX } from './auth.ts';

// Integração com a Zernio (redes sociais): cada empresa liga a PRÓPRIA conta Zernio e conecta as redes que quiser.
// Plano: saas/docs/PLANO_MODULO_ZERNIO.md; referência da API: saas/docs/REFERENCIA_ZERNIO.md
export const ZERNIO_PATH = `${INTERNAL_API_PREFIX}/integrations/zernio`;
export const ZERNIO_KEY_PATH = `${ZERNIO_PATH}/key`;
export const ZERNIO_ACCOUNTS_PATH = `${ZERNIO_PATH}/accounts`;
export const zernioAccountPath = (accountId: string) => `${ZERNIO_ACCOUNTS_PATH}/${encodeURIComponent(accountId)}`;
export const ZERNIO_CONNECT_PATH = `${ZERNIO_PATH}/connect`;
export const ZERNIO_CONNECT_RETURN_PATH = `${ZERNIO_CONNECT_PATH}/return`;

/** Página do painel para onde a Zernio devolve a pessoa depois da autorização na rede */
export const ZERNIO_RETURN_ROUTE = '/integracoes/zernio/retorno';
/** Redes grátis por conta Zernio (REFERENCIA_ZERNIO §2): contam a conta inteira, e o X exige cartão desde a 1ª */
export const ZERNIO_FREE_ACCOUNTS = 2;

/** Página de cobrança da conta Zernio (endereço oficial fixo; o painel mostra o link quando a Zernio pede pagamento, HTTP 402) */
export const ZERNIO_BILLING_URL = 'https://zernio.com/dashboard/billing';

/** Parâmetro do comprovante assinado pelo DisparaZap no endereço de volta */
export const ZERNIO_RETURN_PARAM = 'dz';

/** Redes da primeira etapa (decisão Z5), com o nome que a Zernio usa no caminho /v1/connect/{platform} */
export const ZERNIO_PLATFORMS = ['instagram', 'facebook', 'tiktok', 'linkedin', 'youtube', 'threads', 'pinterest', 'googlebusiness', 'twitter'] as const;
export type ZernioPlatform = (typeof ZERNIO_PLATFORMS)[number];

export const ZERNIO_PLATFORM_LABELS: Readonly<Record<ZernioPlatform, string>> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  threads: 'Threads',
  pinterest: 'Pinterest',
  googlebusiness: 'Google Business',
  twitter: 'X (Twitter)',
};

/** Condições de cada rede na Zernio, mostradas antes de conectar (REFERENCIA_ZERNIO §1, §2 e §8) */
export const ZERNIO_PLATFORM_NOTES: Readonly<Partial<Record<ZernioPlatform, string>>> = {
  instagram: 'Só contas Business ou Creator.',
  facebook: 'Só Páginas (não perfis pessoais). A Zernio pede para escolher a Página.',
  linkedin: 'A Zernio pede para escolher o perfil ou a página da empresa.',
  pinterest: 'A Zernio pede para escolher a pasta.',
  googlebusiness: 'A Zernio pede para escolher o local.',
  twitter: 'O X cobra por post na sua conta Zernio e exige cartão cadastrado lá.',
};

export const zernioKeySchema = z
  .string()
  .trim()
  .min(1, 'Cole a chave de API da Zernio.')
  .max(300, 'Chave longa demais.')
  .regex(/^(sk|zrk)_[A-Za-z0-9_-]{16,}$/, 'A chave da Zernio começa com sk_ (ou zrk_) e não tem espaços.');

export const zernioKeyInputSchema = z.strictObject({ apiKey: zernioKeySchema });
export type ZernioKeyInput = z.input<typeof zernioKeyInputSchema>;

export const zernioStatusSchema = z.strictObject({
  /** Cofre de credenciais ligado no servidor (SECRETS_MASTER_KEY); sem ele não dá para guardar a chave */
  available: z.boolean(),
  configured: z.boolean(),
  /** active = chave aceita na última verificação; invalid = a Zernio recusou a chave guardada */
  status: z.enum(['active', 'invalid']).nullable(),
  /** Só os 4 últimos caracteres da chave */
  keyLast4: z.string().nullable(),
  /** Nome da conta na Zernio (do /v1/auth/verify) */
  accountName: z.string().nullable(),
  /** Perfil da empresa dentro da conta Zernio (decisão Z4) */
  profileName: z.string().nullable(),
  lastCheckAt: z.iso.datetime().nullable(),
  /** Dono e administradores configuram e conectam; os demais só veem (decisão Z3) */
  canManage: z.boolean(),
});
export type ZernioStatus = z.infer<typeof zernioStatusSchema>;

/** ok = pode publicar; needs_reconnect = autorização vencida ou revogada; warning = a Zernio aponta algum problema */
export const ZERNIO_ACCOUNT_STATES = ['ok', 'needs_reconnect', 'warning'] as const;
export type ZernioAccountState = (typeof ZERNIO_ACCOUNT_STATES)[number];

export const zernioAccountSchema = z.strictObject({
  id: z.string().min(1),
  /** Rede como a Zernio informa (pode vir uma rede conectada direto no painel da Zernio, fora da lista acima) */
  platform: z.string(),
  username: z.string().nullable(),
  displayName: z.string().nullable(),
  /** Endereço público do perfil na rede (só https) */
  profileUrl: z.string().nullable(),
  state: z.enum(ZERNIO_ACCOUNT_STATES),
});
export type ZernioAccount = z.infer<typeof zernioAccountSchema>;

/** Rede conectada na conta Zernio da empresa, mas em outro perfil (ex.: o "Default" do painel da Zernio) */
export const zernioOutsideAccountSchema = z.strictObject({
  platform: z.string(),
  username: z.string().nullable(),
  /** Nome do perfil na Zernio onde ela está (null se a Zernio não informar) */
  profileName: z.string().nullable(),
});
export type ZernioOutsideAccount = z.infer<typeof zernioOutsideAccountSchema>;

export const zernioAccountsResponseSchema = z.strictObject({
  accounts: z.array(zernioAccountSchema),
  /**
   * Redes conectadas na conta Zernio INTEIRA (todos os perfis), contadas na lista de contas da Zernio: é esse total que vale
   * para as redes grátis. null quando a Zernio não informa. (O /v1/usage foi descartado: respondeu 0 com 2 redes ativas.)
   */
  teamAccountCount: z.number().int().nonnegative().nullable(),
  /** Redes da conta Zernio fora do perfil do DisparaZap (até 20), para a tela explicar o que está contando */
  outsideAccounts: z.array(zernioOutsideAccountSchema).max(20),
  canManage: z.boolean(),
});
export type ZernioAccountsResponse = z.infer<typeof zernioAccountsResponseSchema>;

export const zernioConnectInputSchema = z.strictObject({
  platform: z.enum(ZERNIO_PLATFORMS),
  /** Para renovar a autorização de uma conta já conectada (mantém o id e o histórico na Zernio) */
  reconnectAccountId: z.string().min(1).max(100).nullable().default(null),
});
export type ZernioConnectInput = z.input<typeof zernioConnectInputSchema>;

export const zernioConnectResultSchema = z.strictObject({
  /** Endereço de autorização (Zernio/rede): o navegador vai para lá */
  authUrl: z.url({ protocol: /^https$/ }),
});
export type ZernioConnectResult = z.infer<typeof zernioConnectResultSchema>;

/** O que o painel repassa da volta da Zernio. O resto da URL (inclusive mensagens de erro em texto) é ignorado */
export const zernioReturnInputSchema = z.strictObject({
  dz: z.string().min(1).max(200),
  connected: z.string().max(40).nullable().default(null),
  accountId: z.string().max(100).nullable().default(null),
  error: z.string().max(100).nullable().default(null),
});
export type ZernioReturnInput = z.input<typeof zernioReturnInputSchema>;

export const zernioReturnResultSchema = z.strictObject({
  ok: z.boolean(),
  platform: z.enum(ZERNIO_PLATFORMS),
  account: zernioAccountSchema.nullable(),
  /** Mensagem pronta para a tela (motivos fixos; nunca o texto que veio na URL) */
  message: z.string(),
});
export type ZernioReturnResult = z.infer<typeof zernioReturnResultSchema>;

// ----- Teste de acesso à Inbox (Z1, 2026-11-04): só leitura, só administradores, com confirmação -----

export const ZERNIO_INBOX_ACCESS_PATH = `${ZERNIO_PATH}/inbox-access`;

/**
 * Resultado do teste. "unavailable" junta a falta de permissão e a falta de complemento (a Zernio nem sempre diz qual):
 * o código que ela devolveu aparece junto, para o administrador conferir no painel da Zernio.
 */
export const ZERNIO_INBOX_ACCESS_OUTCOMES = ['confirmed', 'unavailable', 'auth_failed', 'temporary', 'inconclusive'] as const;
export type ZernioInboxAccessOutcome = (typeof ZERNIO_INBOX_ACCESS_OUTCOMES)[number];

export const zernioInboxAccessInputSchema = z.strictObject({ confirmed: z.literal(true) });
export type ZernioInboxAccessInput = z.infer<typeof zernioInboxAccessInputSchema>;

export const zernioInboxAccessResultSchema = z.strictObject({
  outcome: z.enum(ZERNIO_INBOX_ACCESS_OUTCOMES),
  message: z.string(),
  /** Código curto devolvido pela Zernio (ex.: feature_not_available), quando houver; nunca o texto dela */
  code: z.string().nullable(),
  /** Se a Zernio listou conversas (só a existência; nenhum conteúdo é lido nem guardado) */
  hasConversations: z.boolean().nullable(),
  checkedAt: z.iso.datetime(),
});
export type ZernioInboxAccessResult = z.infer<typeof zernioInboxAccessResultSchema>;
