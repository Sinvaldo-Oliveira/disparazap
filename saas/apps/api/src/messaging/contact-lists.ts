import { randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, ilike, inArray, like, ne, or, sql } from 'drizzle-orm';
import {
  CONTACT_SEARCH_LIMITS,
  MESSAGING_LIMITS,
  contactListDetailSchema,
  contactListSummarySchema,
  validatePhone,
  type ContactListDetail,
  type ContactListSaveResult,
  type ContactListSummary,
  type ContactSearchResponse,
  type ContactUpdateResult,
  type ContactsAddResult,
  type ContactsRemoveResult,
} from '@disparazap/contracts';
import { contactLists, contacts, type AppDatabase } from '@disparazap/db';
import { canOperate, type Member } from '../auth/member.ts';

/** Falha com status HTTP e mensagem fixa para a tela */
export class MessagingError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'MessagingError';
    this.status = status;
  }
}

export const OPERATOR_ONLY = 'Só o dono, os administradores e os operadores da empresa podem fazer isso.';
const NOT_FOUND = 'Lista não encontrada.';
const NAME_TAKEN = 'Já existe uma lista com esse nome na sua empresa.';
const CONTACT_NOT_FOUND = 'Contato não encontrado nesta lista. Atualize a página.';
const PHONE_TAKEN = 'Este número já está na lista.';
const INSERT_CHUNK = 1000;

type ListRow = typeof contactLists.$inferSelect;

export function requireOperator(member: Member): void {
  if (!canOperate(member)) throw new MessagingError(403, OPERATOR_ONLY);
}

function toSummary(row: ListRow, contactCount: number): ContactListSummary {
  return contactListSummarySchema.parse({
    id: row.id,
    name: row.name,
    contactCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

// Nome: sem caracteres de controle, espaços simples, no máximo o limite
function cleanName(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Valida cada telefone de novo (a regra do painel é a mesma) e tira repetidos, mantendo a ordem */
export function normalizeContacts(input: readonly { name?: string | undefined; phone: string }[]) {
  const seen = new Set<string>();
  const rows: { name: string; phone: string }[] = [];
  let invalid = 0;
  let duplicate = 0;
  for (const item of input) {
    const phone = validatePhone(item.phone);
    if (!phone.ok) {
      invalid++;
      continue;
    }
    if (seen.has(phone.number)) {
      duplicate++;
      continue;
    }
    seen.add(phone.number);
    rows.push({ name: cleanName(item.name ?? '', MESSAGING_LIMITS.contactNameMax), phone: phone.number });
  }
  return { rows, ignored: { invalid, duplicate } };
}

async function loadList(db: AppDatabase, member: Member, id: string): Promise<ListRow> {
  const [row] = await db
    .select()
    .from(contactLists)
    .where(and(eq(contactLists.id, id), eq(contactLists.organizationId, member.organizationId)))
    .limit(1);
  // Lista de outra empresa responde igual a inexistente
  if (!row) throw new MessagingError(404, NOT_FOUND);
  return row;
}

async function ensureNameFree(db: AppDatabase, member: Member, name: string, exceptId?: string) {
  const conditions = [eq(contactLists.organizationId, member.organizationId), sql`lower(${contactLists.name}) = lower(${name})`];
  if (exceptId) conditions.push(ne(contactLists.id, exceptId));
  const [taken] = await db.select({ id: contactLists.id }).from(contactLists).where(and(...conditions)).limit(1);
  if (taken) throw new MessagingError(409, NAME_TAKEN);
}

type Tx = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];

async function insertContacts(tx: Tx, member: Member, listId: string, rows: { name: string; phone: string }[], firstPosition = 0) {
  // Em blocos: o PostgreSQL aceita até 65.535 parâmetros por comando
  for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
    await tx
      .insert(contacts)
      .values(
        rows.slice(start, start + INSERT_CHUNK).map((row, index) => ({
          organizationId: member.organizationId,
          listId,
          phoneE164: row.phone,
          name: row.name,
          position: firstPosition + start + index,
        })),
      )
      .onConflictDoNothing();
  }
}

/** Contatos da lista, sempre com a empresa na condição */
const listScope = (member: Member, listId: string) => and(eq(contacts.listId, listId), eq(contacts.organizationId, member.organizationId));

/** Trava a lista até o fim da transação: duas alterações na mesma lista não se misturam */
async function lockList(tx: Tx, member: Member, id: string): Promise<ListRow> {
  const [row] = await tx
    .select()
    .from(contactLists)
    .where(and(eq(contactLists.id, id), eq(contactLists.organizationId, member.organizationId)))
    .limit(1)
    .for('update');
  if (!row) throw new MessagingError(404, NOT_FOUND);
  return row;
}

async function countContacts(tx: Tx | AppDatabase, member: Member, listId: string): Promise<number> {
  const [row] = await tx.select({ total: count() }).from(contacts).where(listScope(member, listId));
  return row?.total ?? 0;
}

/** Marca a lista como alterada agora */
async function touchList(tx: Tx, member: Member, list: ListRow): Promise<ListRow> {
  const [updated] = await tx
    .update(contactLists)
    .set({ updatedAt: new Date() })
    .where(and(eq(contactLists.id, list.id), eq(contactLists.organizationId, member.organizationId)))
    .returning();
  return updated ?? list;
}

export async function listContactLists(db: AppDatabase, member: Member) {
  const rows = await db
    .select({ list: contactLists, total: count(contacts.phoneE164) })
    .from(contactLists)
    .leftJoin(contacts, and(eq(contacts.listId, contactLists.id), eq(contacts.organizationId, contactLists.organizationId)))
    .where(eq(contactLists.organizationId, member.organizationId))
    .groupBy(contactLists.id)
    .orderBy(desc(contactLists.updatedAt));
  return { lists: rows.map((row) => toSummary(row.list, row.total)), canSend: canOperate(member) };
}

export async function getContactList(db: AppDatabase, member: Member, id: string): Promise<ContactListDetail> {
  const list = await loadList(db, member, id);
  const rows = await db
    .select({ name: contacts.name, phone: contacts.phoneE164 })
    .from(contacts)
    .where(and(eq(contacts.listId, list.id), eq(contacts.organizationId, member.organizationId)))
    .orderBy(asc(contacts.position));
  return contactListDetailSchema.parse({ ...toSummary(list, rows.length), contacts: rows });
}

export async function createContactList(db: AppDatabase, member: Member, input: { name: string; contacts: { name?: string | undefined; phone: string }[] }): Promise<ContactListSaveResult> {
  requireOperator(member);
  const name = cleanName(input.name, MESSAGING_LIMITS.listNameMax);
  const [used] = await db.select({ total: count() }).from(contactLists).where(eq(contactLists.organizationId, member.organizationId));
  if ((used?.total ?? 0) >= MESSAGING_LIMITS.listsPerOrganization) {
    throw new MessagingError(409, `Sua empresa já tem ${MESSAGING_LIMITS.listsPerOrganization} listas. Exclua alguma para criar outra.`);
  }
  await ensureNameFree(db, member, name);
  const { rows, ignored } = normalizeContacts(input.contacts);
  const id = randomUUID();
  const list = await db.transaction(async (tx) => {
    const [created] = await tx.insert(contactLists).values({ id, organizationId: member.organizationId, name, createdBy: member.userId }).returning();
    if (!created) throw new Error('lista não gravada');
    await insertContacts(tx, member, id, rows);
    return created;
  });
  return { list: toSummary(list, rows.length), ignored };
}

/** Substitui o nome e todos os contatos da lista (o painel envia a lista inteira) */
export async function updateContactList(db: AppDatabase, member: Member, id: string, input: { name: string; contacts: { name?: string | undefined; phone: string }[] }): Promise<ContactListSaveResult> {
  requireOperator(member);
  const current = await loadList(db, member, id);
  const name = cleanName(input.name, MESSAGING_LIMITS.listNameMax);
  await ensureNameFree(db, member, name, current.id);
  const { rows, ignored } = normalizeContacts(input.contacts);
  const list = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(contactLists)
      .set({ name, updatedAt: new Date() })
      .where(and(eq(contactLists.id, current.id), eq(contactLists.organizationId, member.organizationId)))
      .returning();
    await tx.delete(contacts).where(and(eq(contacts.listId, current.id), eq(contacts.organizationId, member.organizationId)));
    await insertContacts(tx, member, current.id, rows);
    return updated ?? current;
  });
  return { list: toSummary(list, rows.length), ignored };
}

/** Exclusão definitiva: contatos são dado pessoal */
export async function deleteContactList(db: AppDatabase, member: Member, id: string): Promise<void> {
  requireOperator(member);
  const deleted = await db
    .delete(contactLists)
    .where(and(eq(contactLists.id, id), eq(contactLists.organizationId, member.organizationId)))
    .returning({ id: contactLists.id });
  if (!deleted.length) throw new MessagingError(404, NOT_FOUND);
}

/** Troca só o nome da lista */
export async function renameContactList(db: AppDatabase, member: Member, id: string, input: { name: string }): Promise<ContactListSummary> {
  requireOperator(member);
  const current = await loadList(db, member, id);
  const name = cleanName(input.name, MESSAGING_LIMITS.listNameMax);
  await ensureNameFree(db, member, name, current.id);
  const [updated] = await db
    .update(contactLists)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(contactLists.id, current.id), eq(contactLists.organizationId, member.organizationId)))
    .returning();
  return toSummary(updated ?? current, await countContacts(db, member, current.id));
}

/** Acrescenta contatos no fim da lista: telefone validado de novo; os que já estão na lista ficam como estão */
export async function addContacts(db: AppDatabase, member: Member, id: string, input: { contacts: { name?: string | undefined; phone: string }[] }): Promise<ContactsAddResult> {
  requireOperator(member);
  const { rows, ignored } = normalizeContacts(input.contacts);
  return db.transaction(async (tx) => {
    const list = await lockList(tx, member, id);
    const current = await tx.select({ phone: contacts.phoneE164 }).from(contacts).where(listScope(member, list.id));
    const have = new Set(current.map((row) => row.phone));
    const fresh = rows.filter((row) => !have.has(row.phone));
    const accepted = fresh.slice(0, Math.max(0, MESSAGING_LIMITS.contactsPerList - have.size));
    const notAdded = { invalid: ignored.invalid, duplicate: ignored.duplicate + rows.length - fresh.length, overLimit: fresh.length - accepted.length };
    if (!accepted.length) return { list: toSummary(list, have.size), added: 0, ignored: notAdded };
    const [last] = await tx.select({ position: sql<number | null>`max(${contacts.position})` }).from(contacts).where(listScope(member, list.id));
    await insertContacts(tx, member, list.id, accepted, Number(last?.position ?? -1) + 1);
    const updated = await touchList(tx, member, list);
    return { list: toSummary(updated, await countContacts(tx, member, list.id)), added: accepted.length, ignored: notAdded };
  });
}

/** Altera nome e telefone de um contato (o telefone novo passa pela regra de telefone) */
export async function updateContact(db: AppDatabase, member: Member, id: string, input: { phone: string; name: string; newPhone: string }): Promise<ContactUpdateResult> {
  requireOperator(member);
  const check = validatePhone(input.newPhone);
  if (!check.ok) throw new MessagingError(400, `Telefone inválido: ${check.error}`);
  const name = cleanName(input.name, MESSAGING_LIMITS.contactNameMax);
  return db.transaction(async (tx) => {
    const list = await lockList(tx, member, id);
    const findPhone = (phone: string) => tx.select({ phone: contacts.phoneE164 }).from(contacts).where(and(listScope(member, list.id), eq(contacts.phoneE164, phone))).limit(1);
    const [current] = await findPhone(input.phone);
    if (!current) throw new MessagingError(404, CONTACT_NOT_FOUND);
    if (check.number !== input.phone && (await findPhone(check.number)).length) throw new MessagingError(409, PHONE_TAKEN);
    await tx.update(contacts).set({ name, phoneE164: check.number }).where(and(listScope(member, list.id), eq(contacts.phoneE164, input.phone)));
    const updated = await touchList(tx, member, list);
    return { list: toSummary(updated, await countContacts(tx, member, list.id)), contact: { name, phone: check.number } };
  });
}

/** Exclusão definitiva dos contatos escolhidos (dado pessoal) */
export async function removeContacts(db: AppDatabase, member: Member, id: string, input: { phones: string[] }): Promise<ContactsRemoveResult> {
  requireOperator(member);
  return db.transaction(async (tx) => {
    const list = await lockList(tx, member, id);
    const removed = await tx
      .delete(contacts)
      .where(and(listScope(member, list.id), inArray(contacts.phoneE164, [...new Set(input.phones)])))
      .returning({ phone: contacts.phoneE164 });
    const updated = removed.length ? await touchList(tx, member, list) : list;
    return { list: toSummary(updated, await countContacts(tx, member, list.id)), removed: removed.length };
  });
}

// Curinga do LIKE vira texto comum: "50%" procura "50%", não "50 seguido de qualquer coisa"
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/**
 * Busca contatos em todas as listas da empresa: parte do nome (sem diferenciar maiúsculas) ou, com 3 dígitos ou mais,
 * parte do telefone. A consulta parte das listas da empresa e nunca cruza empresas.
 */
export async function searchContacts(db: AppDatabase, member: Member, query: string): Promise<ContactSearchResponse> {
  const term = query.trim();
  const digits = term.replace(/\D/g, '');
  const matches = [ilike(contacts.name, `%${escapeLike(term)}%`)];
  if (digits.length >= CONTACT_SEARCH_LIMITS.phoneDigitsMin) matches.push(like(contacts.phoneE164, `%${digits}%`));
  const rows = await db
    .select({ listId: contactLists.id, listName: contactLists.name, name: contacts.name, phone: contacts.phoneE164 })
    .from(contactLists)
    .innerJoin(contacts, and(eq(contacts.listId, contactLists.id), eq(contacts.organizationId, contactLists.organizationId)))
    .where(and(eq(contactLists.organizationId, member.organizationId), or(...matches)))
    .orderBy(asc(contactLists.name), asc(contacts.position))
    .limit(CONTACT_SEARCH_LIMITS.results + 1);
  return { results: rows.slice(0, CONTACT_SEARCH_LIMITS.results), truncated: rows.length > CONTACT_SEARCH_LIMITS.results };
}
