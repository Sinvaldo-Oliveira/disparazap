import { z } from 'zod';
import { INTERNAL_API_PREFIX } from './auth.ts';

// Envio de Mensagens: listas de contatos salvas e envio de texto pela instância da empresa ativa (sessão)
export const CONTACT_LISTS_PATH = `${INTERNAL_API_PREFIX}/contact-lists`;
export const contactListPath = (id: string) => `${CONTACT_LISTS_PATH}/${encodeURIComponent(id)}`;
export const MESSAGING_SEND_PATH = `${INTERNAL_API_PREFIX}/messaging/send`;

/** Limites do módulo (a API aplica os mesmos; o painel avisa antes) */
export const MESSAGING_LIMITS = {
  /** Contatos por lista */
  contactsPerList: 10_000,
  /** Listas por empresa */
  listsPerOrganization: 100,
  contactNameMax: 120,
  listNameMax: 80,
  /** Tamanho máximo de uma mensagem (texto já com o {nome} trocado) */
  messageMax: 4096,
} as const;

export const contactSchema = z.strictObject({
  name: z.string().max(MESSAGING_LIMITS.contactNameMax),
  /** Só dígitos, já validado pela regra de telefone (ex.: "5511988887777") */
  phone: z.string().regex(/^\d{10,15}$/),
});
export type Contact = z.infer<typeof contactSchema>;

export const contactListSummarySchema = z.strictObject({
  id: z.string().min(1),
  name: z.string(),
  contactCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ContactListSummary = z.infer<typeof contactListSummarySchema>;

export const contactListsResponseSchema = z.strictObject({
  lists: z.array(contactListSummarySchema),
  /** owner, admin e operator da empresa salvam listas e enviam; viewer só vê */
  canSend: z.boolean(),
});
export type ContactListsResponse = z.infer<typeof contactListsResponseSchema>;

export const contactListDetailSchema = z.strictObject({
  ...contactListSummarySchema.shape,
  contacts: z.array(contactSchema),
});
export type ContactListDetail = z.infer<typeof contactListDetailSchema>;

const listNameSchema = z.string().trim().min(2, 'Dê um nome à lista (ex.: "Clientes de maio").').max(MESSAGING_LIMITS.listNameMax, `Use no máximo ${MESSAGING_LIMITS.listNameMax} caracteres no nome.`);
/** Contato como foi digitado/importado: a API valida o telefone de novo com a regra de telefone */
const contactInputSchema = z.strictObject({ name: z.string().max(MESSAGING_LIMITS.contactNameMax).default(''), phone: z.string().max(40) });
export type ContactInput = z.input<typeof contactInputSchema>;
const tooManyContacts = `Uma lista pode ter no máximo ${MESSAGING_LIMITS.contactsPerList.toLocaleString('pt-BR')} contatos.`;
/** Telefone já gravado (só dígitos), usado para apontar um contato da lista */
const storedPhoneSchema = z.string().regex(/^\d{10,15}$/, 'Contato inválido.');

// Entrada: o telefone chega como foi digitado/importado e a API valida de novo com a regra de telefone
export const contactListInputSchema = z.strictObject({
  name: listNameSchema,
  contacts: z.array(contactInputSchema).max(MESSAGING_LIMITS.contactsPerList, tooManyContacts),
});
export type ContactListInput = z.input<typeof contactListInputSchema>;

export const contactListSaveResultSchema = z.strictObject({
  list: contactListSummarySchema,
  /** Linhas não gravadas: telefone inválido ou repetido */
  ignored: z.strictObject({ invalid: z.number().int().nonnegative(), duplicate: z.number().int().nonnegative() }),
});
export type ContactListSaveResult = z.infer<typeof contactListSaveResultSchema>;

// ----- Página Contatos: gestão das listas salvas, uma alteração por vez (gravada na hora) -----
export const contactListContactsPath = (id: string) => `${contactListPath(id)}/contacts`;
export const contactListRemoveContactsPath = (id: string) => `${contactListContactsPath(id)}/remove`;
/** Busca de contatos em todas as listas da empresa: GET com ?q= (a query string não vai para o log) */
export const CONTACTS_SEARCH_PATH = `${INTERNAL_API_PREFIX}/contacts/search`;

/** phoneDigitsMin: a partir de quantos dígitos a busca também procura no telefone */
export const CONTACT_SEARCH_LIMITS = { queryMin: 2, queryMax: 60, results: 50, phoneDigitsMin: 3 } as const;
/** Contatos removidos num pedido só (seleção da página Contatos) */
export const REMOVE_CONTACTS_MAX = 1000;

export const contactListRenameSchema = z.strictObject({ name: listNameSchema });

export const contactsAddInputSchema = z.strictObject({
  contacts: z.array(contactInputSchema).min(1, 'Nenhum contato para adicionar.').max(MESSAGING_LIMITS.contactsPerList, tooManyContacts),
});

export const contactsAddResultSchema = z.strictObject({
  list: contactListSummarySchema,
  added: z.number().int().nonnegative(),
  /** invalid: telefone inválido; duplicate: repetido no pedido ou já na lista; overLimit: passaria do limite da lista */
  ignored: z.strictObject({
    invalid: z.number().int().nonnegative(),
    duplicate: z.number().int().nonnegative(),
    overLimit: z.number().int().nonnegative(),
  }),
});
export type ContactsAddResult = z.infer<typeof contactsAddResultSchema>;

/** Altera nome e telefone de um contato; o número vai no corpo, nunca na URL */
export const contactUpdateInputSchema = z.strictObject({
  phone: storedPhoneSchema,
  name: z.string().max(MESSAGING_LIMITS.contactNameMax, `Use no máximo ${MESSAGING_LIMITS.contactNameMax} caracteres no nome.`),
  newPhone: z.string().trim().min(1, 'Informe o telefone.').max(40),
});

export const contactUpdateResultSchema = z.strictObject({ list: contactListSummarySchema, contact: contactSchema });
export type ContactUpdateResult = z.infer<typeof contactUpdateResultSchema>;

export const contactsRemoveInputSchema = z.strictObject({
  phones: z.array(storedPhoneSchema).min(1, 'Nenhum contato selecionado.').max(REMOVE_CONTACTS_MAX, `Remova no máximo ${REMOVE_CONTACTS_MAX.toLocaleString('pt-BR')} contatos por vez.`),
});

export const contactsRemoveResultSchema = z.strictObject({ list: contactListSummarySchema, removed: z.number().int().nonnegative() });
export type ContactsRemoveResult = z.infer<typeof contactsRemoveResultSchema>;

export const contactSearchQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(CONTACT_SEARCH_LIMITS.queryMin, `Digite pelo menos ${CONTACT_SEARCH_LIMITS.queryMin} caracteres para buscar.`)
    .max(CONTACT_SEARCH_LIMITS.queryMax, `Use no máximo ${CONTACT_SEARCH_LIMITS.queryMax} caracteres na busca.`),
});

export const contactSearchResultSchema = z.strictObject({ listId: z.string().min(1), listName: z.string(), name: z.string(), phone: z.string() });
export type ContactSearchResult = z.infer<typeof contactSearchResultSchema>;

export const contactSearchResponseSchema = z.strictObject({
  results: z.array(contactSearchResultSchema),
  /** Há mais resultados além dos mostrados: refine a busca */
  truncated: z.boolean(),
});
export type ContactSearchResponse = z.infer<typeof contactSearchResponseSchema>;

// ----- Imagem da mensagem (uma por mensagem; o texto vai como legenda) -----
export const MEDIA_PATH = `${INTERNAL_API_PREFIX}/media`;
export const mediaPath = (id: string) => `${MEDIA_PATH}/${encodeURIComponent(id)}`;

export const MEDIA_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  /** Formatos que a Evolution Go aceita como imagem (pkg/sendMessage: jpeg, png e webp) */
  mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  /** Imagens guardadas por empresa */
  perOrganization: 200,
} as const;
export type ImageMimeType = (typeof MEDIA_LIMITS.mimeTypes)[number];

export const mediaFileSchema = z.strictObject({
  id: z.string().min(1),
  mimeType: z.enum(MEDIA_LIMITS.mimeTypes),
  size: z.number().int().positive(),
});
export type MediaFile = z.infer<typeof mediaFileSchema>;

// ----- CTA (chamada para ação): vai no fim do texto, como link -----
export const CTA_LIMITS = { textMax: 60, urlMax: 500 } as const;
const CTA_URL_RE = /^https?:\/\/[^\s/$.?#][^\s]*$/i;

/** Linha do CTA acrescentada ao fim da mensagem (o que o contato recebe) */
export function ctaLine(text: string, url: string): string {
  return `👉 ${text.trim()}: ${url.trim()}`;
}

/** Texto final: mensagem com {nome} já trocado + linha do CTA, se houver */
export function composeMessage(body: string, cta: { text: string; url: string } | null): string {
  return cta && cta.text.trim() && cta.url.trim() ? `${body.trimEnd()}\n\n${ctaLine(cta.text, cta.url)}` : body;
}

/** Valida o par texto + link do CTA; os dois vazios = sem CTA */
export function ctaProblem(text: string, url: string): string | null {
  const t = text.trim();
  const u = url.trim();
  if (!t && !u) return null;
  if (!t) return 'Escreva o texto do CTA (ex.: "Quero aproveitar").';
  if (!u) return 'Informe o link do CTA (ex.: https://sualoja.com/promo).';
  if (t.length > CTA_LIMITS.textMax) return `O texto do CTA pode ter até ${CTA_LIMITS.textMax} caracteres.`;
  if (u.length > CTA_LIMITS.urlMax || !CTA_URL_RE.test(u)) return 'O link do CTA precisa começar com https:// (ou http://) e não pode ter espaços.';
  return null;
}

// ----- Modelos de mensagem salvos (imagem + texto + CTA + variações) -----
export const MESSAGE_TEMPLATES_PATH = `${INTERNAL_API_PREFIX}/message-templates`;
export const messageTemplatePath = (id: string) => `${MESSAGE_TEMPLATES_PATH}/${encodeURIComponent(id)}`;

export const TEMPLATE_LIMITS = { perOrganization: 100, nameMax: 80, variationsMax: 10 } as const;

export const messageTemplateSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string(),
  body: z.string(),
  variations: z.array(z.string()),
  mediaId: z.string().nullable(),
  ctaText: z.string().nullable(),
  ctaUrl: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type MessageTemplate = z.infer<typeof messageTemplateSchema>;

export const messageTemplatesResponseSchema = z.strictObject({ templates: z.array(messageTemplateSchema) });
export type MessageTemplatesResponse = z.infer<typeof messageTemplatesResponseSchema>;

const messageText = z.string().max(MESSAGING_LIMITS.messageMax, `Cada mensagem pode ter até ${MESSAGING_LIMITS.messageMax} caracteres.`);

export const messageTemplateInputSchema = z
  .strictObject({
    name: z.string().trim().min(2, 'Dê um nome ao modelo (ex.: "Promoção de novembro").').max(TEMPLATE_LIMITS.nameMax, `Use no máximo ${TEMPLATE_LIMITS.nameMax} caracteres no nome.`),
    body: messageText.refine((value) => value.trim().length > 0, 'Escreva a mensagem principal.'),
    variations: z.array(messageText).max(TEMPLATE_LIMITS.variationsMax, `No máximo ${TEMPLATE_LIMITS.variationsMax} variações.`).default([]),
    mediaId: z.string().min(1).max(100).nullable().default(null),
    ctaText: z.string().max(CTA_LIMITS.textMax * 2).nullable().default(null),
    ctaUrl: z.string().max(CTA_LIMITS.urlMax * 2).nullable().default(null),
  })
  .superRefine((value, ctx) => {
    const problem = ctaProblem(value.ctaText ?? '', value.ctaUrl ?? '');
    if (problem) ctx.addIssue({ code: 'custom', message: problem, path: ['ctaUrl'] });
  });
export type MessageTemplateInput = z.input<typeof messageTemplateInputSchema>;

export const sendTextInputSchema = z.strictObject({
  instanceId: z.string().min(1).max(100),
  phone: z.string().trim().min(1, 'Telefone vazio.').max(40),
  text: z.string().refine((value) => value.trim().length > 0, 'Mensagem vazia.').pipe(z.string().max(MESSAGING_LIMITS.messageMax, `A mensagem passa de ${MESSAGING_LIMITS.messageMax} caracteres.`)),
  /** Imagem já enviada para a API (o texto vira a legenda) */
  mediaId: z.string().min(1).max(100).nullable().default(null),
});
export type SendTextInput = z.infer<typeof sendTextInputSchema>;

/**
 * Por que um envio falhou (sem repassar a resposta da Evolution):
 * - instance_disconnected / instance_unauthorized: todos os próximos falhariam → o painel interrompe o disparo;
 * - invalid_number: só este contato; o disparo segue;
 * - unreachable / failed: falha deste envio; o disparo segue (o painel para depois de várias falhas seguidas).
 */
export const SEND_FAILURE_REASONS = ['instance_disconnected', 'instance_unauthorized', 'invalid_number', 'unreachable', 'failed'] as const;
export type SendFailureReason = (typeof SEND_FAILURE_REASONS)[number];

export const sendTextResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), messageId: z.string().nullable() }),
  z.strictObject({ ok: z.literal(false), reason: z.enum(SEND_FAILURE_REASONS), message: z.string(), stop: z.boolean() }),
]);
export type SendTextResult = z.infer<typeof sendTextResultSchema>;
