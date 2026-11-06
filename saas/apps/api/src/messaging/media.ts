import { createHash, randomUUID } from 'node:crypto';
import { and, count, eq } from 'drizzle-orm';
import { MEDIA_LIMITS, mediaFileSchema, type ImageMimeType, type MediaFile } from '@disparazap/contracts';
import { mediaFiles, type AppDatabase } from '@disparazap/db';
import type { Member } from '../auth/member.ts';
import { MessagingError, requireOperator } from './contact-lists.ts';

const NOT_FOUND = 'Imagem não encontrada.';

/** Tipo pelos primeiros bytes (assinatura do arquivo), nunca pelo que o navegador declara */
export function detectImageType(bytes: Uint8Array): ImageMimeType | null {
  const at = (offset: number, ...values: number[]) => values.every((value, index) => bytes[offset + index] === value);
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp'; // "RIFF" … "WEBP"
  return null;
}

type MediaRow = typeof mediaFiles.$inferSelect;

const toPublic = (row: Pick<MediaRow, 'id' | 'mimeType' | 'sizeBytes'>): MediaFile => mediaFileSchema.parse({ id: row.id, mimeType: row.mimeType, size: row.sizeBytes });

/** Nome do arquivo para a busca da biblioteca: só o nome (sem pasta), sem caracteres de controle, até 120 caracteres */
export function cleanFileName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = (value.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
  return name || null;
}

/** Guarda a imagem da empresa. A mesma imagem enviada de novo devolve o registro existente */
export async function saveMedia(db: AppDatabase, member: Member, bytes: Uint8Array, fileName: string | null = null): Promise<MediaFile> {
  requireOperator(member);
  if (!bytes.length) throw new MessagingError(400, 'Arquivo vazio.');
  if (bytes.length > MEDIA_LIMITS.maxBytes) throw new MessagingError(413, 'A imagem pode ter até 5 MB.');
  const mimeType = detectImageType(bytes);
  if (!mimeType) throw new MessagingError(415, 'Use uma imagem JPG, PNG ou WebP.');

  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const [existing] = await db
    .select({ id: mediaFiles.id, mimeType: mediaFiles.mimeType, sizeBytes: mediaFiles.sizeBytes })
    .from(mediaFiles)
    .where(and(eq(mediaFiles.organizationId, member.organizationId), eq(mediaFiles.sha256, sha256)))
    .limit(1);
  if (existing) return toPublic(existing);

  const [used] = await db.select({ total: count() }).from(mediaFiles).where(eq(mediaFiles.organizationId, member.organizationId));
  if ((used?.total ?? 0) >= MEDIA_LIMITS.perOrganization) throw new MessagingError(409, `Sua empresa já tem ${MEDIA_LIMITS.perOrganization} imagens guardadas.`);

  const [row] = await db
    .insert(mediaFiles)
    .values({ id: randomUUID(), organizationId: member.organizationId, mimeType, sizeBytes: bytes.length, sha256, data: bytes, fileName, createdBy: member.userId })
    .returning({ id: mediaFiles.id, mimeType: mediaFiles.mimeType, sizeBytes: mediaFiles.sizeBytes });
  if (!row) throw new Error('imagem não gravada');
  return toPublic(row);
}

/** Imagem da empresa (para a pré-visualização no painel). De outra empresa responde como inexistente */
export async function readMedia(db: AppDatabase, organizationId: string, id: string): Promise<{ mimeType: string; data: Buffer }> {
  const [row] = await db
    .select({ mimeType: mediaFiles.mimeType, data: mediaFiles.data })
    .from(mediaFiles)
    .where(and(eq(mediaFiles.id, id), eq(mediaFiles.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new MessagingError(404, NOT_FOUND);
  // pg devolve Buffer; o banco embutido, Uint8Array
  return { mimeType: row.mimeType, data: Buffer.from(row.data.buffer, row.data.byteOffset, row.data.byteLength) };
}

export async function mediaExists(db: AppDatabase, organizationId: string, id: string): Promise<boolean> {
  const [row] = await db.select({ id: mediaFiles.id }).from(mediaFiles).where(and(eq(mediaFiles.id, id), eq(mediaFiles.organizationId, organizationId))).limit(1);
  return Boolean(row);
}

// O disparo manda a mesma imagem para cada contato: guarda as últimas em memória (imagens nunca mudam depois de gravadas)
const CACHE_SIZE = 8;
const base64Cache = new Map<string, string>();

export async function mediaBase64(db: AppDatabase, organizationId: string, id: string): Promise<string> {
  const key = `${organizationId}:${id}`;
  const cached = base64Cache.get(key);
  if (cached) return cached;
  const { data } = await readMedia(db, organizationId, id);
  const base64 = data.toString('base64');
  base64Cache.set(key, base64);
  if (base64Cache.size > CACHE_SIZE) base64Cache.delete(base64Cache.keys().next().value as string);
  return base64;
}
