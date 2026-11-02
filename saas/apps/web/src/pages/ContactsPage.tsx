import { ArrowRight, Plus, Search, Trash2, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { CONTACT_SEARCH_LIMITS, MESSAGING_LIMITS, type ContactListSummary, type ContactSearchResponse, type SessionInfo } from '@disparazap/contracts';
import type { NavigationItem } from '../app/navigation';
import { useSession } from '../auth/AuthProvider';
import { Card } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { plural } from '../messaging/ContactAdder';
import type { MessagingApi } from '../messaging/messaging-api';
import { formatPhone } from './WhatsAppPage';

export const CONTACTS_DESCRIPTION = 'Listas de contatos da sua empresa. As mesmas listas aparecem no Envio de Mensagens.';

/** Dono, administradores e operadores criam e alteram listas; quem só visualiza vê e busca (a API confere de novo) */
export const canEditContacts = (session: SessionInfo) => session.organization !== null && session.organization.role !== 'viewer';

export const formatDateTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Para comparar sem acentos nem maiúsculas ("joao" acha "João") */
export const normalizeText = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Estado de navegação entre as páginas de Contatos (fica fora da URL: telefones não vão para o histórico) */
export interface ContactsNavState {
  search?: string;
  created?: boolean;
  deleted?: string;
}

export function NoCompanyCard({ item }: { item: NavigationItem }) {
  return (
    <>
      <PageHeader title={item.label} icon={item.icon} description={CONTACTS_DESCRIPTION} />
      <Card title="Sem empresa nesta conta">
        <p className="card__text">As listas de contatos pertencem às empresas. Sua conta não está ligada a uma empresa.</p>
      </Card>
    </>
  );
}

export interface ContactsPageProps {
  item: NavigationItem;
  api: MessagingApi;
  /** Espera depois da última tecla antes de buscar nas listas (os testes usam 0) */
  searchDelayMs?: number;
}

export function ContactsPage({ item, api, searchDelayMs = 300 }: ContactsPageProps) {
  const session = useSession();
  if (!session.organization) return <NoCompanyCard item={item} />;
  return <ListsOverview item={item} api={api} searchDelayMs={searchDelayMs} canEdit={canEditContacts(session)} />;
}

function ListsOverview({ item, api, searchDelayMs, canEdit }: Required<ContactsPageProps> & { canEdit: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const deletedName = (location.state as ContactsNavState | null)?.deleted;
  const [lists, setLists] = useState<ContactListSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<ContactSearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(deletedName ? `Lista "${deletedName}" excluída.` : null);
  const [toDelete, setToDelete] = useState<ContactListSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const result = await api.lists(signal);
      if (signal?.aborted) return;
      if (!result.ok) return setLoadError(result.message);
      setLoadError(null);
      setLists(result.data.lists);
    },
    [api],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Busca de contatos em todas as listas: espera a pessoa parar de digitar e cancela a busca anterior
  const term = query.trim();
  const searchesContacts = term.length >= CONTACT_SEARCH_LIMITS.queryMin;
  useEffect(() => {
    if (!searchesContacts) {
      setFound(null);
      setSearchError(null);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      void api.searchContacts(term, controller.signal).then((result) => {
        if (controller.signal.aborted) return;
        setSearching(false);
        if (!result.ok) {
          setFound(null);
          setSearchError(result.message);
          return;
        }
        setSearchError(null);
        setFound(result.data);
      });
    }, searchDelayMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [api, term, searchesContacts, searchDelayMs]);

  const visible = useMemo(() => {
    if (!lists || !term) return lists ?? [];
    const wanted = normalizeText(term);
    return lists.filter((list) => normalizeText(list.name).includes(wanted));
  }, [lists, term]);

  const totalContacts = lists?.reduce((sum, list) => sum + list.contactCount, 0) ?? 0;
  // A API devolve as listas da mais recente para a mais antiga
  const lastChange = lists?.[0]?.updatedAt;

  async function create(event: FormEvent) {
    event.preventDefault();
    setNote(null);
    const name = newName.trim();
    if (name.length < 2) return setError('Dê um nome à lista (ex.: "Clientes de maio").');
    setBusy(true);
    const result = await api.createList(name, []);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    navigate(`/contatos/${encodeURIComponent(result.data.list.id)}`, { state: { created: true } satisfies ContactsNavState });
  }

  async function remove(list: ContactListSummary) {
    setToDelete(null);
    setBusy(true);
    const result = await api.deleteList(list.id);
    setBusy(false);
    if (!result.ok) {
      setNote(null);
      return setError(result.message);
    }
    setError(null);
    setNote(`Lista "${list.name}" excluída.`);
    void load();
  }

  return (
    <>
      <PageHeader title={item.label} icon={item.icon} description={CONTACTS_DESCRIPTION} />

      {lists === null && loadError ? (
        <Card title="Não foi possível carregar as listas">
          <p className="auth-alert" role="alert">{loadError}</p>
          <div className="integration__actions">
            <button type="button" className="action-button" onClick={() => void load()}>Tentar de novo</button>
          </div>
        </Card>
      ) : (
        <section className="card contacts-panel" aria-label="Listas de contatos">
          <dl className="tiles tiles--three">
            <div className="tile">
              <dt>Listas</dt>
              <dd>{lists ? `${lists.length} de ${MESSAGING_LIMITS.listsPerOrganization}` : '…'}</dd>
            </div>
            <div className="tile">
              <dt>Contatos nas listas</dt>
              <dd>{lists ? totalContacts.toLocaleString('pt-BR') : '…'}</dd>
            </div>
            <div className="tile">
              <dt>Última alteração</dt>
              <dd>{lastChange ? formatDateTime(lastChange) : '—'}</dd>
            </div>
          </dl>

          <div className="contacts-toolbar">
            <div className="search-field">
              <Search aria-hidden="true" />
              <input
                type="search"
                className="field__input"
                aria-label="Buscar listas e contatos"
                placeholder="Buscar lista, nome ou telefone do contato"
                maxLength={CONTACT_SEARCH_LIMITS.queryMax}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            {canEdit && (
              <button
                type="button"
                className="action-button action-button--primary"
                disabled={creating || busy}
                onClick={() => {
                  setCreating(true);
                  setError(null);
                  setNote(null);
                }}
              >
                <Plus aria-hidden="true" /> Nova lista
              </button>
            )}
          </div>

          {creating && (
            <form className="new-list" aria-label="Nova lista" onSubmit={(event) => void create(event)}>
              <div className="field">
                <label className="field__label" htmlFor="new-list-name">Nome da nova lista</label>
                <input id="new-list-name" className="field__input" autoFocus maxLength={MESSAGING_LIMITS.listNameMax} placeholder="Ex.: Clientes de maio" value={newName} onChange={(event) => setNewName(event.target.value)} />
              </div>
              <div className="integration__actions">
                <button type="submit" className="action-button action-button--primary" disabled={busy}>Criar lista</button>
                <button
                  type="button"
                  className="action-button"
                  onClick={() => {
                    setCreating(false);
                    setNewName('');
                    setError(null);
                  }}
                >
                  Cancelar
                </button>
              </div>
              <p className="field__hint">Depois de criar, você adiciona os contatos à mão ou por planilha do Excel.</p>
            </form>
          )}

          {error && <p className="auth-alert" role="alert">{error}</p>}
          {note && <p className="integration__success" role="status">{note}</p>}

          {toDelete && (
            <div className="instance__confirm" role="alertdialog" aria-label="Confirmar exclusão da lista">
              <p>
                Excluir a lista "{toDelete.name}" de vez? {plural(toDelete.contactCount, 'contato será apagado', 'contatos serão apagados')} do sistema e a lista deixa de aparecer no Envio de Mensagens.
              </p>
              <div className="integration__actions">
                <button type="button" className="action-button action-button--danger" disabled={busy} onClick={() => void remove(toDelete)}>Excluir definitivamente</button>
                <button type="button" className="action-button" onClick={() => setToDelete(null)}>Cancelar</button>
              </div>
            </div>
          )}

          {lists === null ? (
            <p className="integration__loading">Carregando listas…</p>
          ) : lists.length === 0 ? (
            <div className="empty-state">
              <Users aria-hidden="true" />
              <strong>Nenhuma lista ainda</strong>
              <span>{canEdit ? 'Clique em "Nova lista" para criar a primeira. Listas salvas no Envio de Mensagens também aparecem aqui.' : 'Quando a empresa salvar listas, elas aparecem aqui.'}</span>
            </div>
          ) : visible.length === 0 ? (
            <p className="field__hint">Nenhuma lista com "{term}" no nome.</p>
          ) : (
            <div className="table-wrap">
              <table className="table lists-table">
                <thead>
                  <tr>
                    <th>Lista</th>
                    <th>Contatos</th>
                    <th>Atualizada em</th>
                    <th><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((list) => (
                    <tr key={list.id}>
                      <td>
                        <Link className="lists-table__name" to={`/contatos/${encodeURIComponent(list.id)}`}>{list.name}</Link>
                      </td>
                      <td>{list.contactCount.toLocaleString('pt-BR')}</td>
                      <td>{formatDateTime(list.updatedAt)}</td>
                      <td>
                        <div className="row-actions">
                          <Link className="icon-button" to={`/contatos/${encodeURIComponent(list.id)}`} aria-label={`Abrir a lista ${list.name}`}>
                            Abrir <ArrowRight aria-hidden="true" />
                          </Link>
                          {canEdit && (
                            <button type="button" className="icon-button icon-button--danger" aria-label={`Excluir a lista ${list.name}`} disabled={busy} onClick={() => setToDelete(list)}>
                              <Trash2 aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {term.length === 1 && <p className="field__hint">Digite pelo menos {CONTACT_SEARCH_LIMITS.queryMin} caracteres para buscar também nos contatos.</p>}
          {!canEdit && <p className="field__hint">Você pode ver e buscar as listas. Só o dono, os administradores e os operadores criam e alteram.</p>}
        </section>
      )}

      {searchesContacts && (
        <section className="card" aria-label="Contatos encontrados">
          <h2 className="card__title">Contatos encontrados</h2>
          {searching ? (
            <p className="integration__loading">Buscando…</p>
          ) : searchError ? (
            <p className="auth-alert" role="alert">{searchError}</p>
          ) : found && found.results.length === 0 ? (
            <p className="field__hint">Nenhum contato com "{term}" nas listas da empresa.</p>
          ) : found ? (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Nome</th>
                      <th>Telefone</th>
                      <th>Lista</th>
                    </tr>
                  </thead>
                  <tbody>
                    {found.results.map((result) => (
                      <tr key={`${result.listId}:${result.phone}`}>
                        <td>{result.name || '—'}</td>
                        <td className="contacts__phone">{formatPhone(result.phone)}</td>
                        <td>
                          <Link className="text-link" to={`/contatos/${encodeURIComponent(result.listId)}`} state={{ search: result.phone } satisfies ContactsNavState}>
                            {result.listName}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {found.truncated && <p className="field__hint">Mostrando os primeiros {CONTACT_SEARCH_LIMITS.results} resultados. Refine a busca para encontrar outros.</p>}
            </>
          ) : null}
        </section>
      )}
    </>
  );
}
