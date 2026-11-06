import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  SOCIAL_POST_STATUSES,
  SOCIAL_POST_STATUS_LABELS,
  SOCIAL_PUBLISH_PLATFORMS,
  zonedDateKey,
  zonedLocalToDate,
  type SocialPost,
  type SocialPostStatus,
  type SocialPostsResponse,
} from '@disparazap/contracts';
import { PlatformBadge, platformLabel } from '../../components/PlatformBadge';
import type { SocialApi } from '../../social/social-api';
import { PostDetail, PostNetworks, PostStatusBadge, excerpt, formatWhen, timeZoneLabel } from '../../social/social-ui';

type View = 'month' | 'week' | 'day';
const VIEW_LABELS: Readonly<Record<View, string>> = { month: 'Mês', week: 'Semana', day: 'Dia' };
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const DAY_MS = 24 * 60 * 60 * 1000;

// Datas do calendário como "AAAA-MM-DD" (dias do calendário, sem fuso); o fuso só entra ao converter para instantes
const keyToUtc = (key: string) => {
  const [year, month, day] = key.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day));
};
const utcToKey = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (key: string, days: number) => utcToKey(new Date(keyToUtc(key).getTime() + days * DAY_MS));
const weekday = (key: string) => keyToUtc(key).getUTCDay();
const addMonths = (key: string, months: number) => {
  const date = keyToUtc(key);
  return utcToKey(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1)));
};

/** Dias mostrados na visão (o mês completa as semanas, de domingo a sábado) */
function visibleDays(view: View, anchor: string): string[] {
  let start: string;
  let count: number;
  if (view === 'day') return [anchor];
  if (view === 'week') {
    start = addDays(anchor, -weekday(anchor));
    count = 7;
  } else {
    const first = `${anchor.slice(0, 7)}-01`;
    const date = keyToUtc(first);
    const last = utcToKey(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)));
    start = addDays(first, -weekday(first));
    const end = addDays(last, 6 - weekday(last));
    count = Math.round((keyToUtc(end).getTime() - keyToUtc(start).getTime()) / DAY_MS) + 1;
  }
  return Array.from({ length: count }, (_, index) => addDays(start, index));
}

function title(view: View, anchor: string, days: readonly string[]): string {
  const format = (key: string, options: Intl.DateTimeFormatOptions) => keyToUtc(key).toLocaleDateString('pt-BR', { timeZone: 'UTC', ...options });
  if (view === 'month') return format(anchor, { month: 'long', year: 'numeric' });
  if (view === 'day') return format(anchor, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return `${format(days[0] ?? anchor, { day: 'numeric', month: 'short' })} a ${format(days.at(-1) ?? anchor, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function Chip({ post, timeZone, onOpen }: { post: SocialPost; timeZone: string; onOpen: (post: SocialPost) => void }) {
  const first = post.targets[0];
  return (
    <button type="button" className={`cal-chip cal-chip--${post.status}`} onClick={() => onOpen(post)} title={`${SOCIAL_POST_STATUS_LABELS[post.status]}: ${excerpt(post.content, 80)}`}>
      <span className="cal-chip__time">{post.status === 'draft' ? 'Rascunho' : formatWhen(post.occursAt, timeZone, 'time')}</span>
      {first && <PlatformBadge platform={first.platform} small />}
      {post.targets.length > 1 && <span className="cal-chip__more">+{post.targets.length - 1}</span>}
      <span className="cal-chip__text">{excerpt(post.content, 28) || SOCIAL_POST_STATUS_LABELS[post.status]}</span>
    </button>
  );
}

export function SocialCalendarTab({ api }: { api: SocialApi }) {
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const [view, setView] = useState<View>('month');
  const [anchor, setAnchor] = useState<string | null>(null);
  const [platform, setPlatform] = useState('');
  const [status, setStatus] = useState<SocialPostStatus | ''>('');
  const [data, setData] = useState<SocialPostsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<SocialPost | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void api.settings(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      const zone = result.ok ? result.data.timezone : 'America/Sao_Paulo';
      setTimeZone(zone);
      setAnchor(zonedDateKey(new Date(), zone));
    });
    return () => controller.abort();
  }, [api]);

  const days = useMemo(() => (anchor ? visibleDays(view, anchor) : []), [view, anchor]);

  const load = useCallback(
    async (refresh: boolean, signal?: AbortSignal) => {
      if (!timeZone || !days.length) return;
      const from = zonedLocalToDate(`${days[0]}T00:00`, timeZone);
      const to = zonedLocalToDate(`${addDays(days.at(-1) as string, 1)}T00:00`, timeZone);
      if (!from || !to) return;
      setLoading(true);
      const result = await api.posts({ from: from.toISOString(), to: to.toISOString(), ...(platform ? { platform } : {}), ...(status ? { status } : {}), ...(refresh ? { refresh: '1' as const } : {}) }, signal);
      if (signal?.aborted) return;
      setLoading(false);
      if (!result.ok) return setError(result.message);
      setError(null);
      setData(result.data);
    },
    [api, timeZone, days, platform, status],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(false, controller.signal);
    return () => controller.abort();
  }, [load]);

  const byDay = useMemo(() => {
    const map = new Map<string, SocialPost[]>();
    if (!data || !timeZone) return map;
    for (const post of data.posts) {
      const key = zonedDateKey(new Date(post.occursAt), timeZone);
      map.set(key, [...(map.get(key) ?? []), post]);
    }
    return map;
  }, [data, timeZone]);

  if (!timeZone || !anchor) return <p className="integration__loading">Carregando…</p>;
  const today = zonedDateKey(new Date(), timeZone);
  const move = (direction: 1 | -1) => setAnchor(view === 'month' ? addMonths(anchor, direction) : addDays(anchor, direction * (view === 'week' ? 7 : 1)));
  const openDay = (key: string) => {
    setAnchor(key);
    setView('day');
  };

  return (
    <section className="card calendar-card" aria-label="Calendário editorial">
      <div className="calendar-toolbar">
        <div className="segmented" role="radiogroup" aria-label="Visão do calendário">
          {(['month', 'week', 'day'] as const).map((option) => (
            <label key={option} className={`segmented__option${view === option ? ' segmented__option--on' : ''}`}>
              <input type="radio" name="calendar-view" checked={view === option} onChange={() => setView(option)} />
              {VIEW_LABELS[option]}
            </label>
          ))}
        </div>
        <div className="calendar-toolbar__nav">
          <button type="button" className="icon-button" aria-label="Anterior" onClick={() => move(-1)}>
            <ChevronLeft aria-hidden="true" />
          </button>
          <button type="button" className="action-button" onClick={() => setAnchor(today)}>Hoje</button>
          <button type="button" className="icon-button" aria-label="Próximo" onClick={() => move(1)}>
            <ChevronRight aria-hidden="true" />
          </button>
          <h2 className="calendar-toolbar__title">{title(view, anchor, days)}</h2>
        </div>
        <div className="calendar-toolbar__filters">
          <select className="field__input field__input--small" aria-label="Filtrar por rede" value={platform} onChange={(event) => setPlatform(event.target.value)}>
            <option value="">Todas as redes</option>
            {SOCIAL_PUBLISH_PLATFORMS.map((item) => (
              <option key={item} value={item}>{platformLabel(item)}</option>
            ))}
          </select>
          <select className="field__input field__input--small" aria-label="Filtrar por situação" value={status} onChange={(event) => setStatus(event.target.value as SocialPostStatus | '')}>
            <option value="">Todas as situações</option>
            {SOCIAL_POST_STATUSES.map((item) => (
              <option key={item} value={item}>{SOCIAL_POST_STATUS_LABELS[item]}</option>
            ))}
          </select>
          <button type="button" className="icon-button" aria-label="Atualizar com a Zernio" disabled={loading} onClick={() => void load(true)}>
            <RefreshCw aria-hidden="true" />
          </button>
        </div>
      </div>

      {error && <p className="auth-alert" role="alert">{error}</p>}
      {data?.syncError && <p className="notice">{data.syncError}</p>}

      {view === 'day' ? (
        <ul className="calendar-day" aria-label={`Publicações de ${title('day', anchor, days)}`}>
          {(byDay.get(anchor) ?? []).length === 0 ? (
            <li className="field__hint">Nenhuma publicação neste dia.</li>
          ) : (
            (byDay.get(anchor) ?? []).map((post) => (
              <li key={post.id}>
                <button type="button" className="calendar-day__item" onClick={() => setOpen(post)}>
                  <span className="calendar-day__time">{post.status === 'draft' ? '—' : formatWhen(post.occursAt, timeZone, 'time')}</span>
                  <PostNetworks post={post} />
                  <span className="calendar-day__text">{excerpt(post.content, 120) || 'Sem texto'}</span>
                  <PostStatusBadge status={post.status} />
                </button>
              </li>
            ))
          )}
        </ul>
      ) : (
        <div className={`calendar calendar--${view}`} role="grid" aria-label="Dias">
          <div className="calendar__row calendar__row--head" role="row">
            {WEEKDAYS.map((name) => (
              <span key={name} role="columnheader" className="calendar__weekday">{name}</span>
            ))}
          </div>
          {Array.from({ length: days.length / 7 }, (_, row) => (
            <div key={row} className="calendar__row" role="row">
              {days.slice(row * 7, row * 7 + 7).map((key) => {
                const posts = byDay.get(key) ?? [];
                const limit = view === 'month' ? 3 : 50;
                const outside = view === 'month' && key.slice(0, 7) !== anchor.slice(0, 7);
                return (
                  <div key={key} role="gridcell" className={`calendar__cell${outside ? ' calendar__cell--outside' : ''}${key === today ? ' calendar__cell--today' : ''}`} aria-label={`${Number(key.slice(8))} de ${keyToUtc(key).toLocaleDateString('pt-BR', { timeZone: 'UTC', month: 'long' })}: ${posts.length} publicações`}>
                    <button type="button" className="calendar__day" onClick={() => openDay(key)}>{Number(key.slice(8))}</button>
                    {posts.slice(0, limit).map((post) => (
                      <Chip key={post.id} post={post} timeZone={timeZone} onOpen={setOpen} />
                    ))}
                    {posts.length > limit && (
                      <button type="button" className="text-link calendar__more" onClick={() => openDay(key)}>
                        +{posts.length - limit} mais
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <p className="field__hint">
        Horários no {timeZoneLabel(timeZone)}. Rascunhos aparecem no dia da última alteração. {loading ? 'Atualizando…' : ''}
      </p>

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
