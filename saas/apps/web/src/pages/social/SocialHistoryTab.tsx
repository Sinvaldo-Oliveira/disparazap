import { History, RefreshCw, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { SOCIAL_LIMITS, SOCIAL_POST_STATUSES, SOCIAL_POST_STATUS_LABELS, SOCIAL_PUBLISH_PLATFORMS, type SocialPost, type SocialPostStatus, type SocialPostsResponse } from '@disparazap/contracts';
import { platformLabel } from '../../components/PlatformBadge';
import type { SocialApi } from '../../social/social-api';
import { PostDetail, PostNetworks, PostStatusBadge, excerpt, formatWhen, timeZoneLabel, whenLabel } from '../../social/social-ui';

const isStatus = (value: string | null): value is SocialPostStatus => (SOCIAL_POST_STATUSES as readonly string[]).includes(value ?? '');

/** Histórico das publicações, com filtros na URL (a Visão Geral leva direto às que falharam) */
export function SocialHistoryTab({ api, searchDelayMs }: { api: SocialApi; searchDelayMs: number }) {
  const [params, setParams] = useSearchParams();
  const statusParam = params.get('status');
  const status = isStatus(statusParam) ? statusParam : '';
  const platform = params.get('rede') ?? '';
  const page = Math.max(1, Number(params.get('pagina') ?? '1') || 1);
  const [search, setSearch] = useState(params.get('busca') ?? '');
  const [term, setTerm] = useState(search.trim());
  const [data, setData] = useState<SocialPostsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<SocialPost | null>(null);

  const setFilter = (name: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    if (name !== 'pagina') next.delete('pagina');
    setParams(next, { replace: true });
  };

  // Busca: espera a pessoa parar de digitar
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), searchDelayMs);
    return () => clearTimeout(timer);
  }, [search, searchDelayMs]);

  const load = useCallback(
    async (refresh: boolean, signal?: AbortSignal) => {
      setLoading(true);
      const result = await api.posts(
        { page, ...(status ? { status } : {}), ...(platform ? { platform } : {}), ...(term ? { search: term } : {}), ...(refresh ? { refresh: '1' as const } : {}) },
        signal,
      );
      if (signal?.aborted) return;
      setLoading(false);
      if (!result.ok) return setError(result.message);
      setError(null);
      setData(result.data);
    },
    [api, page, status, platform, term],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(false, controller.signal);
    return () => controller.abort();
  }, [load]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const timeZone = data?.timezone ?? 'America/Sao_Paulo';

  return (
    <section className="card" aria-label="Histórico de publicações">
      <div className="contacts-toolbar">
        <div className="search-field">
          <Search aria-hidden="true" />
          <input type="search" className="field__input" aria-label="Buscar no texto das publicações" placeholder="Buscar no texto" maxLength={SOCIAL_LIMITS.searchMax} value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <select className="field__input field__input--small" aria-label="Filtrar por situação" value={status} onChange={(event) => setFilter('status', event.target.value)}>
          <option value="">Todas as situações</option>
          {SOCIAL_POST_STATUSES.map((item) => (
            <option key={item} value={item}>{SOCIAL_POST_STATUS_LABELS[item]}</option>
          ))}
        </select>
        <select className="field__input field__input--small" aria-label="Filtrar por rede" value={platform} onChange={(event) => setFilter('rede', event.target.value)}>
          <option value="">Todas as redes</option>
          {SOCIAL_PUBLISH_PLATFORMS.map((item) => (
            <option key={item} value={item}>{platformLabel(item)}</option>
          ))}
        </select>
        <button type="button" className="action-button" disabled={loading} onClick={() => void load(true)}>
          <RefreshCw aria-hidden="true" /> Atualizar
        </button>
      </div>

      {error && <p className="auth-alert" role="alert">{error}</p>}
      {data?.syncError && <p className="notice">{data.syncError}</p>}

      {!data ? (
        <p className="integration__loading">Carregando…</p>
      ) : data.posts.length === 0 ? (
        <div className="empty-state">
          <History aria-hidden="true" />
          <strong>{status || platform || term ? 'Nenhuma publicação com esses filtros' : 'Nenhuma publicação ainda'}</strong>
          <span>Publicações feitas pelo painel ou direto na Zernio (no perfil da empresa) aparecem aqui.</span>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table history-table">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Redes</th>
                <th>Conteúdo</th>
                <th>Situação</th>
                <th><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {data.posts.map((post) => {
                const failed = post.targets.filter((target) => target.error);
                return (
                  <tr key={post.id}>
                    <td className="history-table__when">{whenLabel(post, timeZone)}</td>
                    <td>
                      <PostNetworks post={post} />
                    </td>
                    <td>
                      {excerpt(post.content, 90) || <span className="field__hint">Sem texto</span>}
                      {failed.length > 0 && <small className="history-table__error">{failed.map((target) => `${platformLabel(target.platform)}: ${target.error?.message ?? ''}`).join(' ')}</small>}
                    </td>
                    <td>
                      <PostStatusBadge status={post.status} />
                    </td>
                    <td>
                      <button type="button" className="icon-button" onClick={() => setOpen(post)} aria-label={`Detalhes da publicação de ${formatWhen(post.occursAt, timeZone)}`}>
                        Detalhes
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && data.total > data.pageSize && (
        <div className="pager">
          <span>
            Página {page} de {pages} ({data.total.toLocaleString('pt-BR')} publicações)
          </span>
          <div className="pager__buttons">
            <button type="button" className="action-button" disabled={page <= 1} onClick={() => setFilter('pagina', String(page - 1))}>Anterior</button>
            <button type="button" className="action-button" disabled={page >= pages} onClick={() => setFilter('pagina', String(page + 1))}>Próxima</button>
          </div>
        </div>
      )}
      <p className="field__hint">Horários no {timeZoneLabel(timeZone)}. As falhas mostram o motivo informado pela rede, em português.</p>

      {open && data && (
        <PostDetail
          initial={open}
          timeZone={timeZone}
          api={api}
          canPublish={data.canPublish}
          canManage={data.canManage}
          onChanged={(post, id) => setData((current) => (current ? { ...current, posts: post ? current.posts.map((item) => (item.id === id ? post : item)) : current.posts.filter((item) => item.id !== id) } : current))}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}
