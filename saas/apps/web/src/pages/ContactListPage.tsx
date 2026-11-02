import { ArrowLeft, Check, ChevronLeft, ChevronRight, Pencil, Search, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { CONTACT_SEARCH_LIMITS, MESSAGING_LIMITS, validatePhone, type Contact, type ContactListDetail } from '@disparazap/contracts';
import type { NavigationItem } from '../app/navigation';
import { useSession } from '../auth/AuthProvider';
import { Card } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { ContactAdder, describeAdd, plural, type AddReport } from '../messaging/ContactAdder';
import type { MessagingApi } from '../messaging/messaging-api';
import { readSpreadsheetFile, type ReadSpreadsheet } from '../messaging/spreadsheet';
import { CONTACTS_DESCRIPTION, NoCompanyCard, canEditContacts, formatDateTime, normalizeText, type ContactsNavState } from './ContactsPage';
import { formatPhone } from './WhatsAppPage';

/** Contatos por página da tabela */
export const PAGE_SIZE = 50;

const contactLabel = (contact: Contact) => (contact.name ? `${contact.name} (${formatPhone(contact.phone)})` : formatPhone(contact.phone));

/** Onde mostrar o aviso: perto de onde a pessoa agiu */
type Area = 'head' | 'add' | 'table';
interface Feedback {
  area: Area;
  message: string;
  isError: boolean;
}

type Confirm = { kind: 'list' } | { kind: 'contacts'; phones: string[]; label: string };

export interface ContactListPageProps {
  item: NavigationItem;
  api: MessagingApi;
  readSpreadsheet?: ReadSpreadsheet;
}

export function ContactListPage({ item, api, readSpreadsheet = readSpreadsheetFile }: ContactListPageProps) {
  const session = useSession();
  const { listId = '' } = useParams();
  if (!session.organization) return <NoCompanyCard item={item} />;
  // key: trocar de lista recomeça a página do zero
  return <ListManager key={listId} item={item} api={api} readSpreadsheet={readSpreadsheet} listId={listId} canEdit={canEditContacts(session)} />;
}

function ListManager({ item, api, readSpreadsheet, listId, canEdit }: Required<ContactListPageProps> & { listId: string; canEdit: boolean }) {
  const navigate = useNavigate();
  const navState = (useLocation().state as ContactsNavState | null) ?? {};
  const [list, setList] = useState<ContactListDetail | null>(null);
  const [loadError, setLoadError] = useState<{ message: string; status: number } | null>(null);
  const [search, setSearch] = useState(navState.search ?? '');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<{ phone: string; name: string; newPhone: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(navState.created ? { area: 'add', message: 'Lista criada. Agora adicione os contatos, à mão ou por planilha.', isError: false } : null);
  const [busy, setBusy] = useState(false);

  const say = (area: Area, message: string | null, isError = false) => setFeedback(message ? { area, message, isError } : null);

  const load = useCallback(async () => {
    const result = await api.getList(listId);
    if (!result.ok) return setLoadError({ message: result.message, status: result.status });
    setLoadError(null);
    setList(result.data);
  }, [api, listId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Busca nesta lista: nome (sem acentos nem maiúsculas) ou, com 3 dígitos ou mais, parte do telefone
  const filtered = useMemo(() => {
    const rows = (list?.contacts ?? []).map((contact, index) => ({ contact, index }));
    const wanted = normalizeText(search.trim());
    if (!wanted) return rows;
    const digits = search.replace(/\D/g, '');
    const byPhone = digits.length >= CONTACT_SEARCH_LIMITS.phoneDigitsMin;
    return rows.filter(({ contact }) => normalizeText(contact.name).includes(wanted) || (byPhone && contact.phone.includes(digits)));
  }, [list, search]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const pageRows = filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const allOnPage = pageRows.length > 0 && pageRows.every(({ contact }) => selected.has(contact.phone));

  function toggle(phone: string) {
    setSelected((now) => {
      const next = new Set(now);
      if (next.has(phone)) next.delete(phone);
      else next.add(phone);
      return next;
    });
  }

  function toggleAllOnPage() {
    setSelected((now) => {
      const next = new Set(now);
      for (const { contact } of pageRows) {
        if (allOnPage) next.delete(contact.phone);
        else next.add(contact.phone);
      }
      return next;
    });
  }

  // ----- Adicionar (cada inclusão é gravada na hora) -----
  async function addContacts(report: AddReport): Promise<boolean> {
    if (!list) return false;
    if (!report.contacts.length) {
      say('add', `Nenhum contato novo em "${report.fileName ?? ''}": ${describeAdd({ ...report, added: 0 })}.`, true);
      return true;
    }
    const result = await api.addContacts(list.id, report.contacts);
    if (!result.ok) {
      say('add', result.message, true);
      return false;
    }
    const { added, ignored } = result.data;
    const fresh = await api.getList(list.id);
    if (fresh.ok) setList(fresh.data);
    else setList({ ...list, ...result.data.list });
    if (report.fileName === null) {
      say('add', added ? 'Contato adicionado e salvo na lista.' : 'Este número já está na lista.', !added);
    } else {
      const summary = describeAdd({ added, invalid: report.invalid + ignored.invalid, reasons: report.reasons, duplicate: report.duplicate + ignored.duplicate, cut: report.cut + ignored.overLimit });
      say('add', `Importação de "${report.fileName}" concluída: ${summary}.`);
    }
    return true;
  }

  // ----- Alterar um contato -----
  async function saveEdit() {
    if (!list || !editing) return;
    const check = validatePhone(editing.newPhone);
    if (!check.ok) return say('table', `Telefone inválido: ${check.error}`, true);
    if (check.number !== editing.phone && list.contacts.some((contact) => contact.phone === check.number)) return say('table', 'Este número já está na lista.', true);
    setBusy(true);
    const result = await api.updateContact(list.id, editing.phone, editing.name, editing.newPhone);
    setBusy(false);
    if (!result.ok) return say('table', result.message, true);
    const before = editing.phone;
    setList({ ...list, ...result.data.list, contacts: list.contacts.map((contact) => (contact.phone === before ? result.data.contact : contact)) });
    setSelected((now) => new Set([...now].filter((phone) => phone !== before)));
    setEditing(null);
    say('table', 'Contato atualizado.');
  }

  const onEditKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void saveEdit();
    } else if (event.key === 'Escape') {
      setEditing(null);
    }
  };

  // ----- Remover contatos (de vez) -----
  async function removeContacts(phones: string[]) {
    if (!list) return;
    setConfirm(null);
    setBusy(true);
    const result = await api.removeContacts(list.id, phones);
    setBusy(false);
    if (!result.ok) return say('table', result.message, true);
    const gone = new Set(phones);
    setList({ ...list, ...result.data.list, contacts: list.contacts.filter((contact) => !gone.has(contact.phone)) });
    setSelected(new Set());
    if (editing && gone.has(editing.phone)) setEditing(null);
    say('table', `${plural(result.data.removed, 'contato removido', 'contatos removidos')} da lista.`);
  }

  // ----- Lista: renomear e excluir -----
  async function saveName(event: FormEvent) {
    event.preventDefault();
    if (!list || renaming === null) return;
    const name = renaming.trim();
    if (name.length < 2) return say('head', 'Dê um nome à lista (ex.: "Clientes de maio").', true);
    setBusy(true);
    const result = await api.renameList(list.id, name);
    setBusy(false);
    if (!result.ok) return say('head', result.message, true);
    setList({ ...list, ...result.data });
    setRenaming(null);
    say('head', 'Nome da lista atualizado.');
  }

  async function deleteList() {
    if (!list) return;
    setConfirm(null);
    setBusy(true);
    const result = await api.deleteList(list.id);
    setBusy(false);
    if (!result.ok) return say('head', result.message, true);
    navigate('/contatos', { state: { deleted: list.name } satisfies ContactsNavState });
  }

  const show = (area: Area) =>
    feedback?.area === area ? (
      feedback.isError ? (
        <p className="auth-alert" role="alert">{feedback.message}</p>
      ) : (
        <p className="integration__success" role="status">{feedback.message}</p>
      )
    ) : null;

  const back = (
    <Link className="text-link back-link" to="/contatos">
      <ArrowLeft aria-hidden="true" /> Todas as listas
    </Link>
  );

  if (!list) {
    return (
      <>
        <PageHeader title={item.label} icon={item.icon} description={CONTACTS_DESCRIPTION} />
        {back}
        {loadError ? (
          <Card title={loadError.status === 404 ? 'Lista não encontrada' : 'Não foi possível abrir a lista'}>
            <p className="card__text">{loadError.status === 404 ? 'Esta lista não existe mais ou não pertence à sua empresa.' : loadError.message}</p>
            {loadError.status !== 404 && (
              <div className="integration__actions">
                <button type="button" className="action-button" onClick={() => void load()}>Tentar de novo</button>
              </div>
            )}
          </Card>
        ) : (
          <p className="integration__loading">Carregando lista…</p>
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader title={item.label} icon={item.icon} description={CONTACTS_DESCRIPTION} />
      {back}

      <section className="card" aria-label="Lista de contatos">
        <div className="list-detail__head">
          {renaming === null ? (
            <div className="list-detail__title">
              <h2>{list.name}</h2>
              {canEdit && (
                <button type="button" className="icon-button" disabled={busy} onClick={() => setRenaming(list.name)}>
                  <Pencil aria-hidden="true" /> Renomear
                </button>
              )}
            </div>
          ) : (
            <form className="list-detail__rename" aria-label="Renomear lista" onSubmit={(event) => void saveName(event)}>
              <input className="field__input" aria-label="Nome da lista" autoFocus maxLength={MESSAGING_LIMITS.listNameMax} value={renaming} onChange={(event) => setRenaming(event.target.value)} />
              <button type="submit" className="action-button action-button--primary" disabled={busy}>
                <Check aria-hidden="true" /> Salvar nome
              </button>
              <button type="button" className="action-button" onClick={() => setRenaming(null)}>Cancelar</button>
            </form>
          )}
          {canEdit && renaming === null && (
            <button type="button" className="action-button action-button--danger" disabled={busy} onClick={() => setConfirm({ kind: 'list' })}>
              <Trash2 aria-hidden="true" /> Excluir lista
            </button>
          )}
        </div>
        <dl className="tiles tiles--three">
          <div className="tile">
            <dt>Contatos</dt>
            <dd>
              {list.contacts.length.toLocaleString('pt-BR')} de {MESSAGING_LIMITS.contactsPerList.toLocaleString('pt-BR')}
            </dd>
          </div>
          <div className="tile">
            <dt>Criada em</dt>
            <dd>{formatDateTime(list.createdAt)}</dd>
          </div>
          <div className="tile">
            <dt>Atualizada em</dt>
            <dd>{formatDateTime(list.updatedAt)}</dd>
          </div>
        </dl>
        {confirm?.kind === 'list' && (
          <div className="instance__confirm" role="alertdialog" aria-label="Confirmar exclusão da lista">
            <p>Excluir a lista "{list.name}" de vez? {plural(list.contacts.length, 'contato será apagado', 'contatos serão apagados')} do sistema e a lista deixa de aparecer no Envio de Mensagens.</p>
            <div className="integration__actions">
              <button type="button" className="action-button action-button--danger" disabled={busy} onClick={() => void deleteList()}>Excluir definitivamente</button>
              <button type="button" className="action-button" onClick={() => setConfirm(null)}>Cancelar</button>
            </div>
          </div>
        )}
        {show('head')}
        {!canEdit && <p className="field__hint">Você pode ver e buscar os contatos. Só o dono, os administradores e os operadores alteram as listas.</p>}
      </section>

      {canEdit && (
        <section className="card" aria-label="Adicionar contatos">
          <h2 className="card__title">Adicionar contatos</h2>
          <ContactAdder readSpreadsheet={readSpreadsheet} existing={list.contacts} disabled={busy} onAdd={addContacts} onFeedback={(message, isError) => say('add', message, isError)} />
          {show('add')}
          <p className="field__hint">Cada contato adicionado é salvo na hora. Números repetidos não entram de novo.</p>
        </section>
      )}

      <section className="card" aria-label="Contatos da lista">
        <div className="contacts-toolbar">
          <h2 className="card__title">Contatos da lista</h2>
          <div className="search-field">
            <Search aria-hidden="true" />
            <input
              type="search"
              className="field__input"
              aria-label="Buscar nesta lista"
              placeholder="Buscar por nome ou telefone"
              maxLength={CONTACT_SEARCH_LIMITS.queryMax}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
            />
          </div>
        </div>

        {selected.size > 0 && (
          <div className="selection-bar" role="region" aria-label="Contatos selecionados">
            <span>{plural(selected.size, 'contato selecionado', 'contatos selecionados')}</span>
            <button type="button" className="action-button action-button--danger" disabled={busy} onClick={() => setConfirm({ kind: 'contacts', phones: [...selected], label: plural(selected.size, 'contato selecionado', 'contatos selecionados') })}>
              <Trash2 aria-hidden="true" /> Remover selecionados
            </button>
            <button type="button" className="action-button" onClick={() => setSelected(new Set())}>Limpar seleção</button>
          </div>
        )}
        {confirm?.kind === 'contacts' && (
          <div className="instance__confirm" role="alertdialog" aria-label="Confirmar remoção de contatos">
            <p>Remover {confirm.label} da lista? Os dados são apagados do sistema.</p>
            <div className="integration__actions">
              <button type="button" className="action-button action-button--danger" disabled={busy} onClick={() => void removeContacts(confirm.phones)}>Remover definitivamente</button>
              <button type="button" className="action-button" onClick={() => setConfirm(null)}>Cancelar</button>
            </div>
          </div>
        )}
        {show('table')}

        {list.contacts.length === 0 ? (
          <p className="field__hint">{canEdit ? 'Esta lista ainda não tem contatos. Adicione acima, à mão ou por planilha.' : 'Esta lista ainda não tem contatos.'}</p>
        ) : filtered.length === 0 ? (
          <p className="field__hint">Nenhum contato com "{search.trim()}" nesta lista.</p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table contacts-grid">
                <thead>
                  <tr>
                    {canEdit && (
                      <th className="contacts-grid__check">
                        <input type="checkbox" aria-label="Selecionar todos desta página" checked={allOnPage} onChange={toggleAllOnPage} />
                      </th>
                    )}
                    <th className="contacts__num">#</th>
                    <th>Nome</th>
                    <th>Telefone</th>
                    {canEdit && <th><span className="sr-only">Ações</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map(({ contact, index }) =>
                    editing?.phone === contact.phone ? (
                      <tr key={contact.phone} className="is-editing">
                        <td />
                        <td className="contacts__num">{index + 1}</td>
                        <td>
                          <input className="field__input field__input--small" aria-label="Nome do contato em edição" autoFocus maxLength={MESSAGING_LIMITS.contactNameMax} value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} onKeyDown={onEditKey} />
                        </td>
                        <td>
                          <input className="field__input field__input--small" aria-label="Telefone do contato em edição" inputMode="tel" value={editing.newPhone} onChange={(event) => setEditing({ ...editing, newPhone: event.target.value })} onKeyDown={onEditKey} />
                        </td>
                        <td>
                          <div className="row-actions">
                            <button type="button" className="icon-button" disabled={busy} onClick={() => void saveEdit()}>
                              <Check aria-hidden="true" /> Salvar
                            </button>
                            <button type="button" className="icon-button" aria-label="Cancelar edição" onClick={() => setEditing(null)}>
                              <X aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr key={contact.phone} className={selected.has(contact.phone) ? 'is-selected' : undefined}>
                        {canEdit && (
                          <td className="contacts-grid__check">
                            <input type="checkbox" aria-label={`Selecionar ${contactLabel(contact)}`} checked={selected.has(contact.phone)} onChange={() => toggle(contact.phone)} />
                          </td>
                        )}
                        <td className="contacts__num">{index + 1}</td>
                        <td>{contact.name || '—'}</td>
                        <td className="contacts__phone">{formatPhone(contact.phone)}</td>
                        {canEdit && (
                          <td>
                            <div className="row-actions">
                              <button type="button" className="icon-button" aria-label={`Editar ${contactLabel(contact)}`} disabled={busy} onClick={() => setEditing({ phone: contact.phone, name: contact.name, newPhone: formatPhone(contact.phone) })}>
                                <Pencil aria-hidden="true" />
                              </button>
                              <button type="button" className="icon-button icon-button--danger" aria-label={`Remover ${contactLabel(contact)}`} disabled={busy} onClick={() => setConfirm({ kind: 'contacts', phones: [contact.phone], label: contactLabel(contact) })}>
                                <Trash2 aria-hidden="true" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
            <div className="pager">
              <span>
                {search.trim() ? `${plural(filtered.length, 'contato encontrado', 'contatos encontrados')} de ${list.contacts.length.toLocaleString('pt-BR')}` : plural(list.contacts.length, 'contato', 'contatos')}
                {pages > 1 && ` · página ${current + 1} de ${pages}`}
              </span>
              {pages > 1 && (
                <div className="pager__buttons">
                  <button type="button" className="icon-button" disabled={current === 0} onClick={() => setPage(current - 1)}>
                    <ChevronLeft aria-hidden="true" /> Anterior
                  </button>
                  <button type="button" className="icon-button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
                    Próxima <ChevronRight aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </>
  );
}
