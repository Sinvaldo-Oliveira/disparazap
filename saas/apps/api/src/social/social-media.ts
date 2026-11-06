import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { MEDIA_LIMITS, socialLibrarySchema, type SocialLibrary } from '@disparazap/contracts';
import { mediaFiles, messageTemplates, type AppDatabase } from '@disparazap/db';
import { canManage, canOperate, type Member } from '../auth/member.ts';
import { ZernioServiceError } from '../zernio/zernio-service.ts';
import { requireSocialManager } from './social-common.ts';

/**
 * Biblioteca de mídia da empresa (PLANO_MODULO_REDES_SOCIAIS §D, decisão R5): as imagens guardadas no DisparaZap, as
 * mesmas do Envio de Mensagens. O envio continua por POST /api/internal/media; vídeo entra na etapa S6.
 */
export async function listLibrary(db: AppDatabase, member: Member): Promise<SocialLibrary> {
  const [items, used] = await Promise.all([
    db
      .select({ id: mediaFiles.id, mimeType: mediaFiles.mimeType, size: mediaFiles.sizeBytes, fileName: mediaFiles.fileName, createdAt: mediaFiles.createdAt })
      .from(mediaFiles)
      .where(eq(mediaFiles.organizationId, member.organizationId))
      .orderBy(desc(mediaFiles.createdAt)),
    db
      .select({ mediaId: messageTemplates.mediaId })
      .from(messageTemplates)
      .where(and(eq(messageTemplates.organizationId, member.organizationId), isNotNull(messageTemplates.mediaId))),
  ]);
  const usedIds = new Set(used.map((row) => row.mediaId));
  return socialLibrarySchema.parse({
    items: items.map((item) => ({ ...item, createdAt: item.createdAt.toISOString(), usedByTemplate: usedIds.has(item.id) })),
    limit: MEDIA_LIMITS.perOrganization,
    canUpload: canOperate(member),
    canDelete: canManage(member),
  });
}

/** Exclui da biblioteca (dono e administradores). Imagem usada por um modelo de mensagem fica até o modelo mudar */
export async function deleteLibraryItem(db: AppDatabase, member: Member, id: string): Promise<void> {
  requireSocialManager(member);
  if (!id || id.length > 100) throw new ZernioServiceError(404, 'Imagem não encontrada.');
  const [template] = await db
    .select({ name: messageTemplates.name })
    .from(messageTemplates)
    .where(and(eq(messageTemplates.organizationId, member.organizationId), eq(messageTemplates.mediaId, id)))
    .limit(1);
  if (template) throw new ZernioServiceError(409, `Esta imagem é usada pelo modelo de mensagem "${template.name}". Troque a imagem do modelo antes de excluir.`);
  const deleted = await db
    .delete(mediaFiles)
    .where(and(eq(mediaFiles.organizationId, member.organizationId), eq(mediaFiles.id, id)))
    .returning({ id: mediaFiles.id });
  if (!deleted.length) throw new ZernioServiceError(404, 'Imagem não encontrada.');
}
