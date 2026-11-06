import { CalendarClock, ExternalLink, Pencil, Plug, RotateCcw, Trash2, Undo2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  SOCIAL_DELETABLE,
  SOCIAL_EDITABLE,
  SOCIAL_FORMAT_LABELS,
  SOCIAL_POST_STATUS_LABELS,
  SOCIAL_RETRYABLE,
  SOCIAL_TARGET_STATUS_LABELS,
  SOCIAL_UNPUBLISHABLE,
  socialEditRoute,
  zonedLocalValue,
  type SocialConnectionState,
  type SocialPost,
  type SocialPostStatus,
  type SocialTarget,
  type SocialTargetStatus,
} from '@disparazap/contracts';
import { PlatformBadge, platformLabel } from '../components/PlatformBadge';
import { StatusBadge, type BadgeTone } from '../components/StatusBadge';
import type { SocialApi } from './social-api';

/** Data e hora no fuso da empresa */
export function formatWhen(iso: string | null, timeZone: string, style: 'full' | 'time' = 'full'): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return style === 'time'
    ? date.toLocaleTimeString('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString('pt-BR', { timeZone, dateStyle: 'short', timeStyle: 'short' });
}

/** Nome curto do fuso para a tela */
export function timeZoneLabel(timeZone: string): string {
  if (timeZone === 'America/Sao_Paulo') return 'horário de Brasília';
  return `fuso ${timeZone.split('/').pop()?.replace(/_/g, ' ') ?? timeZone}`;
}

export const excerpt = (text: string, size = 90) => {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > size ? `${clean.slice(0, size - 1)}…` : clean;
};

const POST_TONES: Readonly<Record<SocialPostStatus, BadgeTone>> = {
  draft: 'neutral',
  pending_approval: 'development',
  scheduled: 'development',
  publishing: 'development',
  published: 'success',
  partial: 'danger',
  failed: 'danger',
  cancelled: 'neutral',
};
const TARGET_TONES: Readonly<Record<SocialTargetStatus, BadgeTone>> = {
  pending: 'development',
  processing: 'development',
  uploading: 'development',
  published: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

export function PostStatusBadge({ status }: { status: SocialPostStatus }) {
  return <StatusBadge tone={POST_TONES[status]}>{SOCIAL_POST_STATUS_LABELS[status]}</StatusBadge>;
}

export function TargetStatusBadge({ status }: { status: SocialTargetStatus }) {
  return <StatusBadge tone={TARGET_TONES[status]}>{SOCIAL_TARGET_STATUS_LABELS[status]}</StatusBadge>;
}

/** Quando a publicação acontece, com o rótulo certo para a situação */
export function whenLabel(post: SocialPost, timeZone: string): string {
  if (post.status === 'draft') return `Rascunho, alterado em ${formatWhen(post.updatedAt, timeZone)}`;
  if (post.status === 'scheduled' || post.status === 'pending_approval') return `Agendada para ${formatWhen(post.scheduledFor ?? post.occursAt, timeZone)}`;
  if (post.publishedAt) return `Publicada em ${formatWhen(post.publishedAt, timeZone)}`;
  return formatWhen(post.occursAt, timeZone);
}

export function PostNetworks({ post }: { post: SocialPost }) {
  return (
    <span className="post-networks">
      {post.targets.map((target) => (
        <span key={`${target.platform}:${target.accountId}`} className="post-networks__item" title={`${platformLabel(target.platform)} ${target.accountLabel ?? ''}`.trim()}>
          <PlatformBadge platform={target.platform} small />
          <span className="sr-only">{platformLabel(target.platform)}</span>
        </span>
      ))}
      {!post.targets.length && <span className="field__hint">Sem contas</span>}
    </span>
  );
}

/** Integração com a Zernio ausente ou com problema: leva a Integrações, onde as contas são conectadas */
export function ConnectionNotice({ connection }: { connection: SocialConnectionState }) {
  if (connection === 'ok') return null;
  const text =
    connection === 'not_configured'
      ? 'Para publicar, conecte a conta Zernio da empresa e as redes sociais na página Integrações.'
      : connection === 'invalid'
        ? 'A Zernio recusou a chave guardada. Cadastre uma chave nova na página Integrações.'
        : 'O cofre de credenciais do servidor não está configurado. Avise o administrador da plataforma.';
  return (
    <section className="card social-connect" aria-label="Conexão com a Zernio">
      <Plug aria-hidden="true" />
      <div>
        <h2 className="card__title">{connection === 'not_configured' ? 'Conecte as redes sociais' : 'Integração com a Zernio precisa de atenção'}</h2>
        <p className="card__text">{text}</p>
      </div>
      {connection !== 'unavailable' && (
        <Link className="action-button action-button--primary" to={{ pathname: '/integracoes', hash: '#zernio' }}>
          Ir para Integrações
        </Link>
      )}
    </section>
  );
}

function TargetRow({ post, target, timeZone, canManage, busy, onUnpublish }: { post: SocialPost; target: SocialTarget; timeZone: string; canManage: boolean; busy: boolean; onUnpublish: (target: SocialTarget) => void }) {
  return (
    <li className="post-target">
      <div className="post-target__head">
        <PlatformBadge platform={target.platform} />
        <span className="post-target__name">
          <strong>{platformLabel(target.platform)}</strong> {target.accountLabel ?? ''}
          {target.format === 'story' && <small> · {SOCIAL_FORMAT_LABELS.story}</small>}
        </span>
        <TargetStatusBadge status={target.status} />
      </div>
      {target.publishedAt && <small className="field__hint">Publicada em {formatWhen(target.publishedAt, timeZone)}</small>}
      {target.customContent !== null && <p className="post-target__custom">Texto desta rede: {excerpt(target.customContent, 160)}</p>}
      {target.error && (
        <p className="post-target__error" role="note">
          {target.error.message}
          {target.error.action === 'reconnect' && (
            <>
              {' '}
              <Link className="text-link" to={{ pathname: '/integracoes', hash: '#zernio' }}>
                Reconectar
              </Link>
            </>
          )}
        </p>
      )}
      <div className="row-actions row-actions--start">
        {target.url && (
          <a className="text-link post-target__link" href={target.url} target="_blank" rel="noopener noreferrer">
            Ver na rede <ExternalLink aria-hidden="true" />
          </a>
        )}
        {canManage && target.status === 'published' && SOCIAL_UNPUBLISHABLE.includes(target.platform) && post.status !== 'cancelled' && (
          <button type="button" className="icon-button icon-button--danger" disabled={busy} onClick={() => onUnpublish(target)}>
            <Undo2 aria-hidden="true" /> Remover da rede
          </button>
        )}
      </div>
    </li>
  );
}

type Confirm = { kind: 'retry' } | { kind: 'delete' } | { kind: 'unpublish'; target: SocialTarget };

/** Detalhes de uma publicação, com as ações que a situação permite. Relê a publicação na Zernio ao abrir */
export function PostDetail({
  initial,
  timeZone,
  api,
  canPublish,
  canManage,
  onChanged,
  onClose,
}: {
  initial: SocialPost;
  timeZone: string;
  api: SocialApi;
  canPublish: boolean;
  canManage: boolean;
  /** Publicação alterada (null = excluída) */
  onChanged: (post: SocialPost | null, id: string) => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [post, setPost] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [newTime, setNewTime] = useState(() => zonedLocalValue(new Date(initial.scheduledFor ?? Date.now()), timeZone));

  useEffect(() => {
    const controller = new AbortController();
    void api.getPost(initial.id, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) {
        setPost(result.data);
        onChanged(result.data, initial.id);
      } else if (result.status === 404) {
        setError(result.message);
        onChanged(null, initial.id);
      }
    });
    return () => controller.abort();
    // Relê só ao abrir (onChanged muda a cada render da página)
  }, [api, initial.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function run(action: () => ReturnType<SocialApi['retry']>, success: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    const result = await action();
    setBusy(false);
    setConfirm(null);
    if (!result.ok) return setError(result.message);
    setPost(result.data.post);
    onChanged(result.data.post, post.id);
    setNote(success);
  }

  async function remove() {
    setBusy(true);
    setError(null);
    const result = await api.remove(post.id);
    setBusy(false);
    setConfirm(null);
    if (!result.ok) return setError(result.message);
    onChanged(null, post.id);
    onClose();
  }

  const can = (list: readonly SocialPostStatus[]) => canPublish && list.includes(post.status);
  const mediaLibrary = post.media.filter((item) => item.kind === 'library');
  const mediaExisting = post.media.length - mediaLibrary.length;

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <aside className="dialog post-detail" role="dialog" aria-modal="true" aria-label="Detalhes da publicação" onClick={(event) => event.stopPropagation()}>
        <header className="dialog__head">
          <div>
            <PostStatusBadge status={post.status} />
            <h2 className="dialog__title">{whenLabel(post, timeZone)}</h2>
            <small className="field__hint">
              {post.createdInApp ? `Criada no DisparaZap${post.createdByName ? ` por ${post.createdByName}` : ''}` : 'Criada direto no painel da Zernio'} · {timeZoneLabel(timeZone)}
            </small>
          </div>
          <button type="button" className="icon-button" aria-label="Fechar detalhes" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>

        {error && <p className="auth-alert" role="alert">{error}</p>}
        {note && <p className="integration__success" role="status">{note}</p>}

        {post.content ? <p className="post-detail__content">{post.content}</p> : <p className="field__hint">Sem texto geral.</p>}
        {(mediaLibrary.length > 0 || mediaExisting > 0) && (
          <div className="post-detail__media">
            {mediaLibrary.map((item) => (
              <img key={item.url} src={item.url} alt="Imagem da publicação" />
            ))}
            {mediaExisting > 0 && <span className="field__hint">{mediaExisting === 1 ? '1 imagem enviada pela Zernio' : `${mediaExisting} imagens enviadas pela Zernio`}</span>}
          </div>
        )}

        <h3 className="post-detail__subtitle">Redes</h3>
        <ul className="post-targets">
          {post.targets.map((target) => (
            <TargetRow key={`${target.platform}:${target.accountId}`} post={post} target={target} timeZone={timeZone} canManage={canManage} busy={busy} onUnpublish={(item) => setConfirm({ kind: 'unpublish', target: item })} />
          ))}
          {!post.targets.length && <li className="field__hint">Rascunho ainda sem contas escolhidas.</li>}
        </ul>

        {confirm && (
          <div className="instance__confirm" role="alertdialog" aria-label="Confirmar ação">
            <p>
              {confirm.kind === 'retry'
                ? 'Tentar publicar de novo nas redes que falharam? As que já publicaram não são repetidas.'
                : confirm.kind === 'delete'
                  ? post.status === 'partial'
                    ? 'Excluir esta publicação da Zernio? O que já saiu nas redes continua lá; só o registro e o que estava pendente são apagados.'
                    : 'Cancelar e excluir esta publicação? Ela não será publicada, e as imagens enviadas para ela são apagadas na Zernio.'
                  : `Remover a publicação do ${platformLabel(confirm.target.platform)}? Isso apaga o post na rede e não pode ser desfeito.`}
            </p>
            <div className="integration__actions">
              <button
                type="button"
                className={`action-button ${confirm.kind === 'retry' ? 'action-button--primary' : 'action-button--danger'}`}
                disabled={busy}
                onClick={() => {
                  if (confirm.kind === 'retry') void run(() => api.retry(post.id), 'Nova tentativa feita. Veja a situação de cada rede.');
                  else if (confirm.kind === 'delete') void remove();
                  else void run(() => api.unpublish(post.id, confirm.target.platform, confirm.target.accountId), 'Publicação removida da rede.');
                }}
              >
                {confirm.kind === 'retry' ? 'Tentar de novo' : confirm.kind === 'delete' ? 'Excluir publicação' : 'Remover da rede'}
              </button>
              <button type="button" className="action-button" onClick={() => setConfirm(null)}>Voltar</button>
            </div>
          </div>
        )}

        {rescheduling && (
          <form
            className="post-detail__reschedule"
            aria-label="Reagendar"
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => api.reschedule(post.id, newTime), 'Publicação reagendada.').then(() => setRescheduling(false));
            }}
          >
            <label className="field__label" htmlFor="reschedule-at">Nova data e hora ({timeZoneLabel(timeZone)})</label>
            <input id="reschedule-at" type="datetime-local" className="field__input" value={newTime} onChange={(event) => setNewTime(event.target.value)} required />
            <div className="integration__actions">
              <button type="submit" className="action-button action-button--primary" disabled={busy}>Salvar novo horário</button>
              <button type="button" className="action-button" onClick={() => setRescheduling(false)}>Cancelar</button>
            </div>
          </form>
        )}

        <footer className="dialog__actions">
          {can(SOCIAL_EDITABLE) && (
            <button type="button" className="action-button" onClick={() => navigate(socialEditRoute(post.id))}>
              <Pencil aria-hidden="true" /> Editar
            </button>
          )}
          {canPublish && post.status === 'scheduled' && !rescheduling && (
            <button type="button" className="action-button" onClick={() => setRescheduling(true)}>
              <CalendarClock aria-hidden="true" /> Reagendar
            </button>
          )}
          {can(SOCIAL_RETRYABLE) && (
            <button type="button" className="action-button action-button--primary" disabled={busy} onClick={() => setConfirm({ kind: 'retry' })}>
              <RotateCcw aria-hidden="true" /> Tentar de novo
            </button>
          )}
          {can(SOCIAL_DELETABLE) && (
            <button type="button" className="action-button action-button--danger" disabled={busy} onClick={() => setConfirm({ kind: 'delete' })}>
              <Trash2 aria-hidden="true" /> {post.status === 'scheduled' ? 'Cancelar agendamento' : 'Excluir'}
            </button>
          )}
        </footer>
      </aside>
    </div>
  );
}
