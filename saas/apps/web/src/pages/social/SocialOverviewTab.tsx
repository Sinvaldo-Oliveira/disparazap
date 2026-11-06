import { ArrowRight, CalendarDays, Plus, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { SOCIAL_METRIC_LABELS, SOCIAL_ROUTES, socialAccountLabel, type SocialOverview, type SocialPost } from '@disparazap/contracts';
import { PlatformBadge, platformLabel } from '../../components/PlatformBadge';
import { StatusBadge } from '../../components/StatusBadge';
import type { SocialApi } from '../../social/social-api';
import { ConnectionNotice, PostDetail, PostNetworks, excerpt, formatWhen, timeZoneLabel } from '../../social/social-ui';

/** Fusos do Brasil primeiro; depois todos os que o navegador conhece */
const BRAZIL_ZONES = ['America/Sao_Paulo', 'America/Manaus', 'America/Cuiaba', 'America/Campo_Grande', 'America/Belem', 'America/Fortaleza', 'America/Recife', 'America/Bahia', 'America/Porto_Velho', 'America/Boa_Vista', 'America/Rio_Branco', 'America/Noronha'];
function timeZoneOptions(current: string): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  const all = intl.supportedValuesOf?.('timeZone') ?? [];
  return [...new Set([current, ...BRAZIL_ZONES, ...all])];
}

function TimezoneSetting({ api, timezone, canManage, onSaved }: { api: SocialApi; timezone: string; canManage: boolean; onSaved: (timezone: string) => void }) {
  const [value, setValue] = useState(timezone);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const options = useMemo(() => timeZoneOptions(timezone), [timezone]);
  useEffect(() => setValue(timezone), [timezone]);

  if (!canManage) return <p className="field__hint">Horários no {timeZoneLabel(timezone)} ({timezone}). Só o dono e os administradores mudam o fuso.</p>;
  return (
    <form
      className="timezone-form"
      aria-label="Configuração do fuso horário"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        void api.saveSettings(value).then((result) => {
          setBusy(false);
          if (!result.ok) return setMessage({ ok: false, text: result.message });
          setMessage({ ok: true, text: 'Fuso horário salvo.' });
          onSaved(result.data.timezone);
        });
      }}
    >
      <label className="field__label" htmlFor="social-timezone">Fuso horário da empresa</label>
      <div className="timezone-form__row">
        <select id="social-timezone" className="field__input" value={value} onChange={(event) => setValue(event.target.value)}>
          {options.map((zone) => (
            <option key={zone} value={zone}>{zone.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <button type="submit" className="action-button" disabled={busy || value === timezone}>Salvar</button>
      </div>
      <p className="field__hint">Agendamentos e calendário usam este fuso.</p>
      {message && <p className={message.ok ? 'integration__success' : 'auth-alert'} role={message.ok ? 'status' : 'alert'}>{message.text}</p>}
    </form>
  );
}

export function SocialOverviewTab({ api }: { api: SocialApi }) {
  const [data, setData] = useState<SocialOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<SocialPost | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const result = await api.overview(signal);
      if (signal?.aborted) return;
      if (!result.ok) return setError(result.message);
      setError(null);
      setData(result.data);
    },
    [api],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (!data) {
    return error ? (
      <section className="card">
        <p className="auth-alert" role="alert">{error}</p>
        <div className="integration__actions">
          <button type="button" className="action-button" onClick={() => void load()}>Tentar de novo</button>
        </div>
      </section>
    ) : (
      <p className="integration__loading">Carregando…</p>
    );
  }

  const performance = data.performance;
  return (
    <>
      <ConnectionNotice connection={data.connection} />

      <section className="card" aria-label="Resumo das publicações">
        <div className="social-head">
          <h2 className="card__title">Publicações</h2>
          {data.canPublish && data.connection === 'ok' && (
            <Link className="action-button action-button--primary" to={SOCIAL_ROUTES.create}>
              <Plus aria-hidden="true" /> Criar publicação
            </Link>
          )}
        </div>
        <dl className="tiles">
          <div className="tile tile--ok">
            <dt>Publicadas</dt>
            <dd>{data.counts.published.toLocaleString('pt-BR')}</dd>
          </div>
          <div className="tile">
            <dt>Agendadas</dt>
            <dd>{data.counts.scheduled.toLocaleString('pt-BR')}</dd>
          </div>
          <div className={`tile${data.counts.failed ? ' tile--err' : ''}`}>
            <dt>Com falha</dt>
            <dd>{data.counts.failed.toLocaleString('pt-BR')}</dd>
          </div>
          <div className="tile">
            <dt>Rascunhos</dt>
            <dd>{data.counts.drafts.toLocaleString('pt-BR')}</dd>
          </div>
        </dl>
        <p className="field__hint">
          Contagem das publicações da empresa sincronizadas com a Zernio{data.syncedAt ? `, atualizada às ${formatWhen(data.syncedAt, data.timezone, 'time')}` : ''}.
        </p>
      </section>

      {data.alerts.length > 0 && (
        <section className="card social-alerts" aria-label="Alertas">
          <h2 className="card__title">Alertas</h2>
          <ul>
            {data.alerts.map((alert) => (
              <li key={`${alert.kind}:${alert.message}`} className="notice">
                <TriangleAlert className="notice__icon" aria-hidden="true" />
                <span>
                  {alert.message}{' '}
                  {(alert.kind === 'reconnect' || alert.kind === 'key_invalid' || alert.kind === 'warning') && (
                    <Link className="text-link" to={{ pathname: '/integracoes', hash: '#zernio' }}>Abrir Integrações</Link>
                  )}
                  {alert.kind === 'failed_posts' && <Link className="text-link" to={`${SOCIAL_ROUTES.history}?status=failed`}>Ver no Histórico</Link>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid grid--two">
        <section className="card" aria-label="Próximas publicações">
          <div className="social-head">
            <h2 className="card__title">Próximas publicações</h2>
            <Link className="text-link" to={SOCIAL_ROUTES.calendar}>
              <CalendarDays aria-hidden="true" className="inline-icon" /> Calendário
            </Link>
          </div>
          {data.upcoming.length === 0 ? (
            <p className="field__hint">Nenhuma publicação agendada.</p>
          ) : (
            <ul className="upcoming">
              {data.upcoming.map((post) => (
                <li key={post.id}>
                  <button type="button" className="upcoming__item" onClick={() => setOpen(post)}>
                    <span className="upcoming__when">{formatWhen(post.scheduledFor, data.timezone)}</span>
                    <PostNetworks post={post} />
                    <span className="upcoming__text">{excerpt(post.content, 70) || 'Sem texto'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="field__hint">Horários no {timeZoneLabel(data.timezone)}.</p>
        </section>

        <section className="card" aria-label="Contas conectadas">
          <div className="social-head">
            <h2 className="card__title">Contas conectadas</h2>
            <Link className="text-link" to={{ pathname: '/integracoes', hash: '#zernio' }}>
              Gerenciar <ArrowRight aria-hidden="true" className="inline-icon" />
            </Link>
          </div>
          {data.accounts.length === 0 ? (
            <p className="field__hint">{data.connection === 'ok' ? 'Nenhuma rede conectada ainda. Conecte em Integrações.' : 'Sem contas: a integração com a Zernio não está pronta.'}</p>
          ) : (
            <ul className="social-accounts">
              {data.accounts.map((account) => (
                <li key={account.id}>
                  <PlatformBadge platform={account.platform} />
                  <span className="social-accounts__name">
                    <strong>{platformLabel(account.platform)}</strong> {socialAccountLabel(account)}
                    {account.reason && <small>{account.reason}</small>}
                  </span>
                  <StatusBadge tone={account.state === 'ok' ? 'success' : account.state === 'needs_reconnect' ? 'danger' : 'development'}>
                    {account.state === 'ok' ? 'Conectada' : account.state === 'needs_reconnect' ? 'Precisa reconectar' : 'Atenção'}
                  </StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card" aria-label="Desempenho dos últimos 30 dias">
        <div className="social-head">
          <h2 className="card__title">Desempenho (últimos 30 dias)</h2>
          <Link className="text-link" to={SOCIAL_ROUTES.results}>Ver resultados</Link>
        </div>
        {!performance ? (
          <p className="field__hint">Os números aparecem quando a integração com a Zernio estiver pronta.</p>
        ) : performance.state === 'unavailable' ? (
          <p className="field__hint">{performance.message}</p>
        ) : (
          <dl className="tiles">
            {(['impressions', 'reach', 'likes', 'comments'] as const).map((metric) => (
              <div className="tile" key={metric}>
                <dt>{SOCIAL_METRIC_LABELS[metric]}</dt>
                <dd>{performance.totals[metric].toLocaleString('pt-BR')}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section className="card" aria-label="Fuso horário">
        <TimezoneSetting api={api} timezone={data.timezone} canManage={data.canManage} onSaved={(timezone) => setData({ ...data, timezone })} />
      </section>

      {open && (
        <PostDetail
          initial={open}
          timeZone={data.timezone}
          api={api}
          canPublish={data.canPublish}
          canManage={data.canManage}
          onChanged={() => undefined}
          onClose={() => {
            setOpen(null);
            void load();
          }}
        />
      )}
    </>
  );
}
