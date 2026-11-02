import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, ne, sql } from 'drizzle-orm';
import { TEMPLATE_LIMITS, messageTemplateSchema, type MessageTemplate, type MessageTemplateInput } from '@disparazap/contracts';
import { messageTemplates, type AppDatabase } from '@disparazap/db';
import type { Member } from '../auth/member.ts';
import { MessagingError, requireOperator } from './contact-lists.ts';
import { mediaExists } from './media.ts';

const NOT_FOUND = 'Modelo não encontrado.';
const NAME_TAKEN = 'Já existe um modelo com esse nome na sua empresa.';

type TemplateRow = typeof messageTemplates.$inferSelect;
type CleanInput = { name: string; body: string; variations: string[]; mediaId: string | null; ctaText: string | null; ctaUrl: string | null };

function toPublic(row: TemplateRow): MessageTemplate {
  return messageTemplateSchema.parse({
    id: row.id,
    name: row.name,
    body: row.body,
    variations: row.variations,
    mediaId: row.mediaId,
    ctaText: row.ctaText,
    ctaUrl: row.ctaUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/** Entrada já validada pelo contrato: nome em uma linha, variações sem as vazias, CTA aparado ou nulo */
async function clean(db: AppDatabase, member: Member, input: Required<Pick<MessageTemplateInput, 'name' | 'body'>> & Partial<MessageTemplateInput>): Promise<CleanInput> {
  const mediaId = input.mediaId ?? null;
  if (mediaId && !(await mediaExists(db, member.organizationId, mediaId))) throw new MessagingError(400, 'A imagem do modelo não foi encontrada. Envie a imagem de novo.');
  const ctaText = input.ctaText?.trim() || null;
  const ctaUrl = input.ctaUrl?.trim() || null;
  return {
    name: input.name.replace(/\s+/g, ' ').trim(),
    body: input.body,
    variations: (input.variations ?? []).filter((text) => text.trim()),
    mediaId,
    ctaText: ctaText && ctaUrl ? ctaText : null,
    ctaUrl: ctaText && ctaUrl ? ctaUrl : null,
  };
}

async function ensureNameFree(db: AppDatabase, member: Member, name: string, exceptId?: string) {
  const conditions = [eq(messageTemplates.organizationId, member.organizationId), sql`lower(${messageTemplates.name}) = lower(${name})`];
  if (exceptId) conditions.push(ne(messageTemplates.id, exceptId));
  const [taken] = await db.select({ id: messageTemplates.id }).from(messageTemplates).where(and(...conditions)).limit(1);
  if (taken) throw new MessagingError(409, NAME_TAKEN);
}

export async function listTemplates(db: AppDatabase, member: Member) {
  const rows = await db.select().from(messageTemplates).where(eq(messageTemplates.organizationId, member.organizationId)).orderBy(desc(messageTemplates.updatedAt));
  return { templates: rows.map(toPublic) };
}

export async function createTemplate(db: AppDatabase, member: Member, input: MessageTemplateInput): Promise<MessageTemplate> {
  requireOperator(member);
  const values = await clean(db, member, input);
  const [used] = await db.select({ total: count() }).from(messageTemplates).where(eq(messageTemplates.organizationId, member.organizationId));
  if ((used?.total ?? 0) >= TEMPLATE_LIMITS.perOrganization) throw new MessagingError(409, `Sua empresa já tem ${TEMPLATE_LIMITS.perOrganization} modelos. Exclua algum para criar outro.`);
  await ensureNameFree(db, member, values.name);
  const [row] = await db
    .insert(messageTemplates)
    .values({ id: randomUUID(), organizationId: member.organizationId, createdBy: member.userId, ...values })
    .returning();
  if (!row) throw new Error('modelo não gravado');
  return toPublic(row);
}

export async function updateTemplate(db: AppDatabase, member: Member, id: string, input: MessageTemplateInput): Promise<MessageTemplate> {
  requireOperator(member);
  const values = await clean(db, member, input);
  await ensureNameFree(db, member, values.name, id);
  const [row] = await db
    .update(messageTemplates)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(messageTemplates.id, id), eq(messageTemplates.organizationId, member.organizationId)))
    .returning();
  // Modelo de outra empresa responde igual a inexistente
  if (!row) throw new MessagingError(404, NOT_FOUND);
  return toPublic(row);
}

export async function deleteTemplate(db: AppDatabase, member: Member, id: string): Promise<void> {
  requireOperator(member);
  const deleted = await db
    .delete(messageTemplates)
    .where(and(eq(messageTemplates.id, id), eq(messageTemplates.organizationId, member.organizationId)))
    .returning({ id: messageTemplates.id });
  if (!deleted.length) throw new MessagingError(404, NOT_FOUND);
}
