import { Check, CheckCheck, CircleAlert, Clock, MessageCircle } from 'lucide-react';
import type { InboxConversation, InboxMessage, InboxMessageStatus } from '@disparazap/contracts';
import { formatPhone } from '../pages/WhatsAppPage';

/** Nome do contato, ou o número formatado, ou "Contato sem número" (identificador interno do WhatsApp) */
export function contactLabel(contact: InboxConversation['contact']): string {
  return contact.name?.trim() || (contact.phone ? formatPhone(contact.phone) : 'Contato sem número');
}

export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return ((words[0]?.[0] ?? '') + (words.length > 1 ? (words.at(-1)?.[0] ?? '') : '')).toUpperCase();
}

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Hora de hoje, "Ontem" ou a data curta (lista de conversas) */
export function listTime(iso: string | null, now = new Date()): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (sameDay(date, now)) return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return 'Ontem';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export const messageTime = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function dayLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (sameDay(date, now)) return 'Hoje';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return 'Ontem';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

export const dateTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Quem enviou (só mensagens de saída): o atendente, o celular do número, outro sistema… */
export function authorLabel(message: InboxMessage): string | null {
  if (message.direction === 'inbound') return null;
  switch (message.author) {
    case 'user':
      return message.authorName ?? 'Atendente';
    case 'phone':
      return 'Pelo celular';
    case 'api':
      return 'Outro sistema';
    case 'ai':
      return 'Agente de IA';
    case 'automation':
      return 'Automação';
    default:
      return 'Sistema';
  }
}

const STATUS_LABELS: Readonly<Record<InboxMessageStatus, string>> = {
  received: 'Recebida',
  pending: 'Enviando',
  sent: 'Enviada',
  delivered: 'Entregue',
  read: 'Lida',
  failed: 'Não enviada',
};

/** Enviada (✓), entregue (✓✓), lida (✓✓ destacado), enviando (relógio) ou não enviada */
export function MessageStatusIcon({ status }: { status: InboxMessageStatus }) {
  if (status === 'received') return null;
  const Icon = status === 'pending' ? Clock : status === 'sent' ? Check : status === 'failed' ? CircleAlert : CheckCheck;
  return (
    <span className={`msg-status msg-status--${status}`} role="img" aria-label={STATUS_LABELS[status]} title={STATUS_LABELS[status]}>
      <Icon aria-hidden="true" />
    </span>
  );
}

const MEDIA_LABELS: Readonly<Record<string, string>> = { image: 'Imagem', video: 'Vídeo', audio: 'Áudio', document: 'Documento', sticker: 'Figurinha' };

/** Conteúdo da mensagem: texto; mídia só com o tipo e a legenda (arquivos chegam numa próxima etapa) */
export function MessageContent({ message }: { message: InboxMessage }) {
  if (message.contentType === 'text') return <p className="msg__text">{message.text}</p>;
  if (message.contentType === 'media') {
    return (
      <>
        <p className="msg__media">[{MEDIA_LABELS[message.mediaKind ?? ''] ?? 'Mídia'}] <span>a Inbox ainda não mostra arquivos; veja no celular</span></p>
        {message.text && <p className="msg__text">{message.text}</p>}
      </>
    );
  }
  return <p className="msg__media">Mensagem de um tipo que a Inbox ainda não mostra. Veja no celular.</p>;
}

/** Ícone do canal (nesta etapa, só WhatsApp); `decorative` quando o nome do canal já está escrito ao lado */
export function ChannelIcon({ className = '', decorative = false }: { className?: string; decorative?: boolean }) {
  const classes = `channel-icon channel-icon--whatsapp ${className}`.trim();
  if (decorative) {
    return (
      <span className={classes} aria-hidden="true">
        <MessageCircle />
      </span>
    );
  }
  return (
    <span className={classes} role="img" aria-label="WhatsApp" title="WhatsApp">
      <MessageCircle aria-hidden="true" />
    </span>
  );
}
