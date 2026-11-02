import {
  CONTACTS_SEARCH_PATH,
  CONTACT_LISTS_PATH,
  MEDIA_PATH,
  MESSAGE_TEMPLATES_PATH,
  MESSAGING_SEND_PATH,
  contactListContactsPath,
  contactListDetailSchema,
  contactListPath,
  contactListRemoveContactsPath,
  contactListSaveResultSchema,
  contactListSummarySchema,
  contactListsResponseSchema,
  contactSearchResponseSchema,
  contactUpdateResultSchema,
  contactsAddResultSchema,
  contactsRemoveResultSchema,
  mediaFileSchema,
  messageTemplatePath,
  messageTemplateSchema,
  messageTemplatesResponseSchema,
  sendTextResultSchema,
  type Contact,
  type ContactListDetail,
  type ContactInput,
  type ContactListSaveResult,
  type ContactListSummary,
  type ContactListsResponse,
  type ContactSearchResponse,
  type ContactUpdateResult,
  type ContactsAddResult,
  type ContactsRemoveResult,
  type MediaFile,
  type MessageTemplate,
  type MessageTemplateInput,
  type MessageTemplatesResponse,
  type SendTextResult,
} from '@disparazap/contracts';
import { request, type ApiResult } from '../platform/platform-api';

/** Envio de Mensagens e Contatos: listas, imagens, modelos e envio. Os testes trocam por uma versão falsa. */
export interface MessagingApi {
  lists(signal?: AbortSignal): Promise<ApiResult<ContactListsResponse>>;
  getList(id: string): Promise<ApiResult<ContactListDetail>>;
  createList(name: string, contacts: readonly Contact[]): Promise<ApiResult<ContactListSaveResult>>;
  updateList(id: string, name: string, contacts: readonly Contact[]): Promise<ApiResult<ContactListSaveResult>>;
  deleteList(id: string): Promise<ApiResult<null>>;
  // Página Contatos: cada alteração é gravada na hora
  renameList(id: string, name: string): Promise<ApiResult<ContactListSummary>>;
  addContacts(id: string, contacts: readonly ContactInput[]): Promise<ApiResult<ContactsAddResult>>;
  /** phone = número atual (só dígitos); newPhone = como foi digitado */
  updateContact(id: string, phone: string, name: string, newPhone: string): Promise<ApiResult<ContactUpdateResult>>;
  removeContacts(id: string, phones: readonly string[]): Promise<ApiResult<ContactsRemoveResult>>;
  searchContacts(query: string, signal?: AbortSignal): Promise<ApiResult<ContactSearchResponse>>;
  /** Envia o arquivo de imagem (o corpo é o próprio arquivo) */
  uploadMedia(file: File): Promise<ApiResult<MediaFile>>;
  templates(signal?: AbortSignal): Promise<ApiResult<MessageTemplatesResponse>>;
  createTemplate(input: MessageTemplateInput): Promise<ApiResult<MessageTemplate>>;
  updateTemplate(id: string, input: MessageTemplateInput): Promise<ApiResult<MessageTemplate>>;
  deleteTemplate(id: string): Promise<ApiResult<null>>;
  send(instanceId: string, phone: string, text: string, mediaId: string | null): Promise<ApiResult<SendTextResult>>;
}

const withSignal = (signal?: AbortSignal) => (signal ? { signal } : {});

export const httpMessagingApi: MessagingApi = {
  lists: (signal) => request(CONTACT_LISTS_PATH, { method: 'GET', ...withSignal(signal) }, (body) => contactListsResponseSchema.parse(body)),
  getList: (id) => request(contactListPath(id), { method: 'GET' }, (body) => contactListDetailSchema.parse(body)),
  createList: (name, contacts) => request(CONTACT_LISTS_PATH, { method: 'POST', body: JSON.stringify({ name, contacts }) }, (body) => contactListSaveResultSchema.parse(body)),
  updateList: (id, name, contacts) => request(contactListPath(id), { method: 'PUT', body: JSON.stringify({ name, contacts }) }, (body) => contactListSaveResultSchema.parse(body)),
  deleteList: (id) => request(contactListPath(id), { method: 'DELETE' }, () => null),
  renameList: (id, name) => request(contactListPath(id), { method: 'PATCH', body: JSON.stringify({ name }) }, (body) => contactListSummarySchema.parse(body)),
  addContacts: (id, contacts) => request(contactListContactsPath(id), { method: 'POST', body: JSON.stringify({ contacts }) }, (body) => contactsAddResultSchema.parse(body)),
  updateContact: (id, phone, name, newPhone) => request(contactListContactsPath(id), { method: 'PATCH', body: JSON.stringify({ phone, name, newPhone }) }, (body) => contactUpdateResultSchema.parse(body)),
  removeContacts: (id, phones) => request(contactListRemoveContactsPath(id), { method: 'POST', body: JSON.stringify({ phones }) }, (body) => contactsRemoveResultSchema.parse(body)),
  searchContacts: (query, signal) => request(`${CONTACTS_SEARCH_PATH}?q=${encodeURIComponent(query)}`, { method: 'GET', ...withSignal(signal) }, (body) => contactSearchResponseSchema.parse(body)),
  uploadMedia: (file) => request(MEDIA_PATH, { method: 'POST', body: file }, (body) => mediaFileSchema.parse(body), file.type),
  templates: (signal) => request(MESSAGE_TEMPLATES_PATH, { method: 'GET', ...withSignal(signal) }, (body) => messageTemplatesResponseSchema.parse(body)),
  createTemplate: (input) => request(MESSAGE_TEMPLATES_PATH, { method: 'POST', body: JSON.stringify(input) }, (body) => messageTemplateSchema.parse(body)),
  updateTemplate: (id, input) => request(messageTemplatePath(id), { method: 'PUT', body: JSON.stringify(input) }, (body) => messageTemplateSchema.parse(body)),
  deleteTemplate: (id) => request(messageTemplatePath(id), { method: 'DELETE' }, () => null),
  send: (instanceId, phone, text, mediaId) => request(MESSAGING_SEND_PATH, { method: 'POST', body: JSON.stringify({ instanceId, phone, text, mediaId }) }, (body) => sendTextResultSchema.parse(body)),
};
