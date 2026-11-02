import { Save, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { MESSAGING_LIMITS, type Contact, type ContactListSummary } from '@disparazap/contracts';
import { formatPhone } from '../pages/WhatsAppPage';
import { ContactAdder, describeAdd, plural, type AddReport } from './ContactAdder';
import type { MessagingApi } from './messaging-api';
import type { ReadSpreadsheet } from './spreadsheet';

/** Lista salva em uso: id null = lista nova, ainda não salva */
export interface SavedListState {
  id: string | null;
  name: string;
  dirty: boolean;
}

export const NEW_LIST: SavedListState = { id: null, name: '', dirty: false };

/** Quantos contatos a tabela mostra (a lista inteira continua valendo para o envio) */
const TABLE_ROWS = 200;

export type LogType = 'ok' | 'err' | 'sys';

interface ContactsStepProps {
  api: MessagingApi;
  readSpreadsheet: ReadSpreadsheet;
  contacts: Contact[];
  onContactsChange: (contacts: Contact[]) => void;
  saved: SavedListState;
  onSavedChange: (saved: SavedListState) => void;
  lists: ContactListSummary[];
  onListsChanged: () => void;
  canSave: boolean;
  locked: boolean;
  log: (type: LogType, message: string) => void;
}

export function ContactsStep({ api, readSpreadsheet, contacts, onContactsChange, saved, onSavedChange, lists, onListsChanged, canSave, locked, log }: ContactsStepProps) {
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'clear' | 'delete' | { switchTo: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const feedback = (message: string | null, isError = false) => {
    setError(isError ? message : null);
    setNote(isError ? null : message);
  };

  const change = (next: Contact[]) => {
    onContactsChange(next);
    onSavedChange({ ...saved, dirty: true });
  };

  // Manual ou planilha: os contatos entram nesta tela; a lista salva só muda ao salvar
  function addContacts(report: AddReport): boolean {
    change([...contacts, ...report.contacts]);
    if (report.fileName === null) {
      feedback(null);
      return true;
    }
    const summary = describeAdd({ ...report, added: report.contacts.length });
    log('sys', `Importação de "${report.fileName}": ${summary}`);
    feedback(`Importação concluída: ${summary}.`);
    return true;
  }

  // ----- Listas salvas -----
  async function loadList(id: string) {
    setConfirm(null);
    feedback(null);
    if (!id) {
      onContactsChange([]);
      onSavedChange(NEW_LIST);
      return;
    }
    setBusy(true);
    const result = await api.getList(id);
    setBusy(false);
    if (!result.ok) return feedback(result.message, true);
    onContactsChange(result.data.contacts);
    onSavedChange({ id: result.data.id, name: result.data.name, dirty: false });
    feedback(`Lista "${result.data.name}" carregada: ${plural(result.data.contacts.length, 'contato', 'contatos')}.`);
  }

  function chooseList(id: string) {
    if (saved.dirty && contacts.length) return setConfirm({ switchTo: id });
    void loadList(id);
  }

  async function saveList() {
    feedback(null);
    const listName = saved.name.trim();
    if (listName.length < 2) return feedback('Dê um nome à lista antes de salvar (ex.: "Clientes de maio").', true);
    setBusy(true);
    const result = saved.id ? await api.updateList(saved.id, listName, contacts) : await api.createList(listName, contacts);
    if (!result.ok) {
      setBusy(false);
      return feedback(result.message, true);
    }
    const { list, ignored } = result.data;
    // O servidor valida de novo: se descartou alguma linha, a tela passa a mostrar o que foi gravado
    if (ignored.invalid || ignored.duplicate) {
      const fresh = await api.getList(list.id);
      if (fresh.ok) onContactsChange(fresh.data.contacts);
    }
    setBusy(false);
    onSavedChange({ id: list.id, name: list.name, dirty: false });
    onListsChanged();
    feedback(`Lista "${list.name}" salva com ${plural(list.contactCount, 'contato', 'contatos')}.`);
  }

  async function deleteList() {
    if (!saved.id) return;
    setConfirm(null);
    setBusy(true);
    const result = await api.deleteList(saved.id);
    setBusy(false);
    if (!result.ok) return feedback(result.message, true);
    onSavedChange({ id: null, name: saved.name, dirty: contacts.length > 0 });
    onListsChanged();
    feedback(`Lista "${saved.name}" excluída. Os contatos continuam nesta tela até você trocar de lista.`);
  }

  const pendingSwitch = confirm && typeof confirm === 'object' ? confirm.switchTo : null;

  return (
    <div className="wizard__step-body">
      <section className="list-bar" aria-label="Lista de contatos salva">
        <div className="list-bar__row">
          <div className="field list-bar__select">
            <label className="field__label" htmlFor="saved-list">Lista salva</label>
            <select id="saved-list" className="field__input" value={saved.id ?? ''} disabled={locked || busy} onChange={(event) => chooseList(event.target.value)}>
              <option value="">— Nova lista (não salva) —</option>
              {lists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name} ({list.contactCount.toLocaleString('pt-BR')})
                </option>
              ))}
            </select>
          </div>
          {canSave && (
            <div className="field list-bar__name">
              <label className="field__label" htmlFor="list-name">Nome da lista</label>
              <input id="list-name" className="field__input" maxLength={MESSAGING_LIMITS.listNameMax} placeholder="Ex.: Clientes de maio" value={saved.name} disabled={locked || busy} onChange={(event) => onSavedChange({ ...saved, name: event.target.value, dirty: true })} />
            </div>
          )}
        </div>
        <div className="integration__actions">
          {canSave && (
            <button type="button" className="action-button action-button--primary" disabled={locked || busy} onClick={() => void saveList()}>
              <Save aria-hidden="true" /> {saved.id ? 'Salvar alterações' : 'Salvar lista'}
            </button>
          )}
          {canSave && saved.id && (
            <button type="button" className="action-button action-button--danger" disabled={locked || busy} onClick={() => setConfirm('delete')}>
              <Trash2 aria-hidden="true" /> Excluir lista
            </button>
          )}
          <span className="field__hint" role="status">
            {saved.id ? (saved.dirty ? 'Alterações não salvas' : 'Lista salva') : contacts.length ? 'Lista ainda não salva' : ''}
          </span>
        </div>
        {!canSave && <p className="field__hint">Você pode usar as listas salvas da empresa. Só o dono, os administradores e os operadores salvam e enviam.</p>}
        <p className="field__hint">
          Para buscar, editar ou organizar as listas salvas, use a página <Link className="text-link" to="/contatos">Contatos</Link>.
        </p>
        {confirm === 'delete' && (
          <div className="instance__confirm" role="alertdialog" aria-label="Confirmar exclusão da lista">
            <p>Excluir a lista "{saved.name}" de vez? Os contatos dela serão apagados do sistema.</p>
            <div className="integration__actions">
              <button type="button" className="action-button action-button--danger" onClick={() => void deleteList()}>Excluir definitivamente</button>
              <button type="button" className="action-button" onClick={() => setConfirm(null)}>Cancelar</button>
            </div>
          </div>
        )}
        {pendingSwitch !== null && (
          <div className="instance__confirm" role="alertdialog" aria-label="Confirmar troca de lista">
            <p>Os contatos desta tela têm alterações não salvas. Trocar de lista descarta essas alterações.</p>
            <div className="integration__actions">
              <button type="button" className="action-button action-button--danger" onClick={() => void loadList(pendingSwitch)}>Trocar mesmo assim</button>
              <button type="button" className="action-button" onClick={() => setConfirm(null)}>Cancelar</button>
            </div>
          </div>
        )}
      </section>

      <ContactAdder readSpreadsheet={readSpreadsheet} existing={contacts} disabled={locked} onAdd={addContacts} onFeedback={feedback} />

      {error && <p className="auth-alert" role="alert">{error}</p>}
      {note && <p className="integration__success" role="status">{note}</p>}

      <div className="contacts__head">
        <strong>
          Contatos <span className="badge badge--neutral" aria-label={`${contacts.length} contatos`}>{contacts.length.toLocaleString('pt-BR')}</span>
        </strong>
        <button type="button" className="action-button action-button--danger" disabled={!contacts.length || locked} onClick={() => setConfirm('clear')}>
          <Trash2 aria-hidden="true" /> Limpar
        </button>
      </div>
      {confirm === 'clear' && (
        <div className="instance__confirm" role="alertdialog" aria-label="Confirmar limpeza dos contatos">
          <p>Remover todos os {contacts.length.toLocaleString('pt-BR')} contatos desta tela? {saved.id ? 'A lista salva só muda se você salvar depois.' : ''}</p>
          <div className="integration__actions">
            <button
              type="button"
              className="action-button action-button--danger"
              onClick={() => {
                setConfirm(null);
                change([]);
              }}
            >
              Remover todos
            </button>
            <button type="button" className="action-button" onClick={() => setConfirm(null)}>Cancelar</button>
          </div>
        </div>
      )}
      {contacts.length === 0 ? (
        <p className="field__hint">Nenhum contato ainda.</p>
      ) : (
        <div className="table-wrap contacts__table">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Nome</th>
                <th>Telefone</th>
                <th><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {contacts.slice(0, TABLE_ROWS).map((contact, index) => (
                <tr key={contact.phone}>
                  <td className="contacts__num">{index + 1}</td>
                  <td>{contact.name || '—'}</td>
                  <td className="contacts__phone">{formatPhone(contact.phone)}</td>
                  <td>
                    <button type="button" className="icon-button" aria-label={`Remover ${contact.name || formatPhone(contact.phone)}`} disabled={locked} onClick={() => change(contacts.filter((_, i) => i !== index))}>
                      <X aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {contacts.length > TABLE_ROWS && <p className="field__hint">Mostrando os primeiros {TABLE_ROWS} de {contacts.length.toLocaleString('pt-BR')} contatos. O envio usa a lista inteira.</p>}
        </div>
      )}
    </div>
  );
}
