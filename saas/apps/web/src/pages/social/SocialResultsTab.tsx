import { BarChart3, ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SOCIAL_ANALYTICS_PERIODS, SOCIAL_METRICS, SOCIAL_METRIC_LABELS, metricSupported, type SocialAnalytics, type SocialMetric } from '@disparazap/contracts';
import { PlatformBadge, platformLabel } from '../../components/PlatformBadge';
import type { SocialApi } from '../../social/social-api';
import { excerpt } from '../../social/social-ui';

const number = (value: number) => value.toLocaleString('pt-BR');
const TOP_METRICS: readonly SocialMetric[] = ['likes', 'comments', 'shares', 'views'];

/** Resultados: só métricas que a Zernio informa; "—" quando a rede não fornece aquele número */
export function SocialResultsTab({ api }: { api: SocialApi }) {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<SocialAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    void api.analytics(days, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (!result.ok) return setError(result.message);
      setError(null);
      setData(result.data);
    });
    return () => controller.abort();
  }, [api, days]);

  return (
    <>
      <section className="card" aria-label="Período">
        <div className="social-head">
          <h2 className="card__title">Resultados</h2>
          <div className="segmented" role="radiogroup" aria-label="Período">
            {SOCIAL_ANALYTICS_PERIODS.map((option) => (
              <label key={option} className={`segmented__option${days === option ? ' segmented__option--on' : ''}`}>
                <input type="radio" name="results-period" checked={days === option} onChange={() => setDays(option)} />
                {option} dias
              </label>
            ))}
          </div>
        </div>
        {error && <p className="auth-alert" role="alert">{error}</p>}
        {!data && !error && <p className="integration__loading">Carregando…</p>}
        {data?.state === 'unavailable' && (
          <div className="empty-state">
            <BarChart3 aria-hidden="true" />
            <strong>Resultados indisponíveis</strong>
            <span>{data.message}</span>
          </div>
        )}
        {data?.state === 'available' && (
          <>
            <dl className="tiles">
              <div className="tile">
                <dt>Publicações no período</dt>
                <dd>{number(data.postCount)}</dd>
              </div>
              {SOCIAL_METRICS.map((metric) => (
                <div className="tile" key={metric}>
                  <dt>{SOCIAL_METRIC_LABELS[metric]}</dt>
                  <dd>{number(data.totals[metric])}</dd>
                </div>
              ))}
            </dl>
            <p className="field__hint">
              De {new Date(`${data.from}T12:00:00Z`).toLocaleDateString('pt-BR')} a {new Date(`${data.to}T12:00:00Z`).toLocaleDateString('pt-BR')}. Soma das redes que informam cada número: algumas não informam
              tudo (o Instagram não informa cliques; o Google Business não tem números por publicação). Os dados vêm das redes pela Zernio e podem levar algumas horas para atualizar.
            </p>
          </>
        )}
      </section>

      {data?.state === 'available' && (
        <>
          <section className="card" aria-label="Por rede">
            <h2 className="card__title">Por rede</h2>
            {data.byPlatform.length === 0 ? (
              <p className="field__hint">Nenhuma publicação com números no período.</p>
            ) : (
              <div className="table-wrap">
                <table className="table results-table">
                  <thead>
                    <tr>
                      <th>Rede</th>
                      <th>Publicações</th>
                      {SOCIAL_METRICS.map((metric) => (
                        <th key={metric}>{SOCIAL_METRIC_LABELS[metric]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.byPlatform.map((row) => (
                      <tr key={row.platform}>
                        <td>
                          <span className="zernio-accounts__network">
                            <PlatformBadge platform={row.platform} small /> {platformLabel(row.platform)}
                          </span>
                        </td>
                        <td>{number(row.postCount)}</td>
                        {SOCIAL_METRICS.map((metric) => (
                          <td key={metric} title={metricSupported(row.platform, metric) ? undefined : 'Não informado por esta rede'}>
                            {metricSupported(row.platform, metric) ? number(row.metrics[metric]) : '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="field__hint">"—" = a rede não informa este número.</p>
          </section>

          <section className="card" aria-label="Publicações com mais engajamento">
            <h2 className="card__title">Publicações com mais engajamento</h2>
            {data.topPosts.length === 0 ? (
              <p className="field__hint">Nenhuma publicação com números no período.</p>
            ) : (
              <div className="table-wrap">
                <table className="table results-table">
                  <thead>
                    <tr>
                      <th>Rede</th>
                      <th>Publicação</th>
                      {TOP_METRICS.map((metric) => (
                        <th key={metric}>{SOCIAL_METRIC_LABELS[metric]}</th>
                      ))}
                      <th><span className="sr-only">Link</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topPosts.map((post, index) => (
                      <tr key={`${post.platform}:${index}`}>
                        <td>
                          <PlatformBadge platform={post.platform} small /> <span className="sr-only">{platformLabel(post.platform)}</span>
                        </td>
                        <td>
                          {excerpt(post.content, 70) || 'Sem texto'}
                          {post.publishedAt && <small className="field__hint"> · {new Date(post.publishedAt).toLocaleDateString('pt-BR')}</small>}
                        </td>
                        {TOP_METRICS.map((metric) => (
                          <td key={metric}>{metricSupported(post.platform, metric) ? number(post.metrics[metric]) : '—'}</td>
                        ))}
                        <td>
                          {post.url && (
                            <a className="text-link" href={post.url} target="_blank" rel="noopener noreferrer" aria-label="Ver na rede">
                              <ExternalLink aria-hidden="true" className="inline-icon" />
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
