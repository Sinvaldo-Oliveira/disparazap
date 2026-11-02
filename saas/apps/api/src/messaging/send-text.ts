import { validatePhone, type SendFailureReason, type SendTextInput, type SendTextResult } from '@disparazap/contracts';
import type { Member } from '../auth/member.ts';
import { ProviderError, type ProviderErrorKind } from '../integrations/whatsapp-provider.ts';
import { loadInstance, markDisconnected, openToken, readyProvider, type WhatsAppContext } from '../whatsapp/whatsapp-service.ts';
import { MessagingError, requireOperator } from './contact-lists.ts';
import { mediaBase64 } from './media.ts';

interface Failure {
  reason: SendFailureReason;
  message: string;
  /** Os próximos envios também falhariam: o painel interrompe o disparo */
  stop: boolean;
}

const FAILURES: Readonly<Record<ProviderErrorKind, Failure>> = {
  disconnected: { reason: 'instance_disconnected', stop: true, message: 'O WhatsApp desta instância está desconectado. Conecte de novo na página WhatsApp e reinicie o disparo.' },
  not_found: { reason: 'instance_disconnected', stop: true, message: 'Esta instância não existe mais no servidor de WhatsApp. Crie outra na página WhatsApp.' },
  unauthorized: { reason: 'instance_unauthorized', stop: true, message: 'O servidor de WhatsApp recusou a credencial desta instância. Exclua e crie a instância de novo na página WhatsApp.' },
  invalid_number: { reason: 'invalid_number', stop: false, message: 'Número não aceito pelo WhatsApp (inexistente ou sem WhatsApp).' },
  unreachable: { reason: 'unreachable', stop: false, message: 'O servidor de WhatsApp não respondeu a tempo. Não dá para saber se esta mensagem saiu.' },
  rejected: { reason: 'failed', stop: false, message: 'O servidor de WhatsApp não aceitou este envio.' },
  invalid_response: { reason: 'failed', stop: false, message: 'O servidor de WhatsApp respondeu de um jeito inesperado a este envio.' },
};

/**
 * Envia um texto (ou uma imagem com o texto como legenda) pela instância da empresa.
 * A chave e o token ficam na API; o navegador só manda instância, número, texto e o ID da imagem.
 * Falhas da Evolution voltam como resultado (HTTP 200, ok: false) com um motivo fixo: o disparo decide se continua.
 */
export async function sendText(ctx: WhatsAppContext, member: Member, input: SendTextInput): Promise<SendTextResult> {
  requireOperator(member);
  const phone = validatePhone(input.phone);
  if (!phone.ok) throw new MessagingError(400, `Telefone inválido: ${phone.error}`);

  const { vault, provider } = await readyProvider(ctx);
  const row = await loadInstance(ctx, member, input.instanceId);
  const token = await openToken(ctx, vault, row);
  // Imagem da própria empresa (de outra responde 404 e o disparo para, porque falharia para todos)
  const image = input.mediaId ? await mediaBase64(ctx.db, member.organizationId, input.mediaId) : null;
  try {
    const { messageId } = image ? await provider.sendImage(token, phone.number, { base64: image, caption: input.text }) : await provider.sendText(token, phone.number, input.text);
    return { ok: true, messageId };
  } catch (err) {
    if (!(err instanceof ProviderError)) throw err;
    const failure = FAILURES[err.kind];
    if (failure.reason === 'instance_disconnected') await markDisconnected(ctx, row);
    return { ok: false, ...failure };
  }
}
