import { FileSpreadsheet, PenLine, Plus, Upload, X } from 'lucide-react';
import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { MESSAGING_LIMITS, validatePhone, type Contact } from '@disparazap/contracts';
import { cellToString, cleanContactName, columnLabel, detectColumns, detectHeader, importContacts, type ReadSpreadsheet, type Spreadsheet } from './spreadsheet';

/** Contatos novos, já validados pelo painel, e o que ficou de fora */
export interface AddReport {
  contacts: Contact[];
  /** Planilha de origem; null = digitado à mão */
  fileName: string | null;
  invalid: number;
  /** Motivo → quantidade (ex.: "sem DDI": 3) */
  reasons: Record<string, number>;
  duplicate: number;
  /** Passariam do limite da lista */
  cut: number;
}

export const plural = (n: number, one: string, many: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;

/** Resumo de uma importação: "3 contatos adicionados, 1 linha ignorada (1 sem DDI), 2 repetidos" */
export function describeAdd({ added, invalid, reasons, duplicate, cut }: { added: number; invalid: number; reasons: Record<string, number>; duplicate: number; cut: number }): string {
  const why = Object.entries(reasons).map(([reason, n]) => `${n} ${reason}`).join(', ');
  return (
    plural(added, 'contato adicionado', 'contatos adicionados') +
    (invalid ? `, ${plural(invalid, 'linha ignorada', 'linhas ignoradas')}${why ? ` (${why})` : ''}` : '') +
    (duplicate ? `, ${plural(duplicate, 'repetido', 'repetidos')}` : '') +
    (cut ? `, ${plural(cut, 'contato acima do limite ficou de fora', 'contatos acima do limite ficaram de fora')}` : '')
  );
}

interface ContactAdderProps {
  readSpreadsheet: ReadSpreadsheet;
  /** Contatos que já estão na lista: o painel recusa repetidos antes de gravar */
  existing: readonly Contact[];
  disabled: boolean;
  /** Recebe os contatos novos. Devolve false se não foram aceitos: os campos ficam como estão para tentar de novo */
  onAdd: (report: AddReport) => boolean | Promise<boolean>;
  onFeedback: (message: string | null, isError?: boolean) => void;
}

/** Adicionar contatos: um a um (Manual) ou por planilha (Excel), com pré-visualização e escolha das colunas */
export function ContactAdder({ readSpreadsheet, existing, disabled, onAdd, onFeedback }: ContactAdderProps) {
  const [tab, setTab] = useState<'manual' | 'excel'>('manual');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [sheet, setSheet] = useState<Spreadsheet | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [columns, setColumns] = useState({ phone: -1, name: -1 });
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const off = disabled || busy;
  const room = MESSAGING_LIMITS.contactsPerList - existing.length;

  async function deliver(report: AddReport): Promise<boolean> {
    setBusy(true);
    try {
      return await onAdd(report);
    } finally {
      setBusy(false);
    }
  }

  // ----- Manual -----
  async function addManual() {
    const check = validatePhone(phone);
    if (!check.ok) return onFeedback(`Telefone inválido: ${check.error}`, true);
    if (existing.some((contact) => contact.phone === check.number)) return onFeedback('Este número já está na lista.', true);
    if (room <= 0) return onFeedback(`A lista já tem o máximo de ${MESSAGING_LIMITS.contactsPerList.toLocaleString('pt-BR')} contatos.`, true);
    const accepted = await deliver({ contacts: [{ name: cleanContactName(name), phone: check.number }], fileName: null, invalid: 0, reasons: {}, duplicate: 0, cut: 0 });
    if (!accepted) return;
    setName('');
    setPhone('');
    nameInput.current?.focus();
  }

  const onPhoneKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!off) void addManual();
    }
  };

  // ----- Excel -----
  async function openFile(file: File | undefined) {
    if (!file) return;
    onFeedback(null);
    try {
      const read = await readSpreadsheet(file);
      if (!read.rows.length) return onFeedback('A planilha está vazia.', true);
      const header = detectHeader(read.rows);
      setSheet(read);
      setHasHeader(header);
      setColumns(detectColumns(read, header));
    } catch (err) {
      onFeedback(`Não foi possível ler a planilha: ${err instanceof Error ? err.message : 'arquivo inválido'}`, true);
    }
  }

  function changeHeader(next: boolean) {
    if (!sheet) return;
    setHasHeader(next);
    setColumns(detectColumns(sheet, next));
  }

  function resetSheet() {
    setSheet(null);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function importSheet() {
    if (!sheet || columns.phone < 0) return;
    const result = importContacts(sheet, { hasHeader, ...columns }, new Set(existing.map((contact) => contact.phone)));
    const added = result.contacts.slice(0, Math.max(0, room));
    const accepted = await deliver({ contacts: added, fileName: sheet.fileName, invalid: result.invalid, reasons: result.reasons, duplicate: result.duplicate, cut: result.contacts.length - added.length });
    if (accepted) resetSheet();
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void openFile(event.dataTransfer.files[0]);
  };

  const start = hasHeader ? 1 : 0;
  const cls = (c: number) => (c === columns.phone ? 'col-phone' : c === columns.name ? 'col-name' : undefined);
  const validRows = sheet && columns.phone >= 0 ? sheet.rows.slice(start).filter((row) => validatePhone(cellToString(row[columns.phone])).ok).length : 0;

  return (
    <>
      <div className="connect__tabs" role="tablist" aria-label="Como adicionar contatos">
        <button type="button" role="tab" aria-selected={tab === 'manual'} className={`connect__tab${tab === 'manual' ? ' connect__tab--active' : ''}`} onClick={() => setTab('manual')}>
          <PenLine aria-hidden="true" /> Manual
        </button>
        <button type="button" role="tab" aria-selected={tab === 'excel'} className={`connect__tab${tab === 'excel' ? ' connect__tab--active' : ''}`} onClick={() => setTab('excel')}>
          <FileSpreadsheet aria-hidden="true" /> Excel
        </button>
      </div>

      {tab === 'manual' && (
        <div className="manual">
          <div className="manual__grid">
            <input ref={nameInput} className="field__input" aria-label="Nome do contato" placeholder="Nome" maxLength={MESSAGING_LIMITS.contactNameMax} value={name} disabled={disabled} onChange={(event) => setName(event.target.value)} />
            <input className="field__input" aria-label="Telefone com DDI" placeholder="Telefone com DDI, ex.: 5511988887777" inputMode="tel" value={phone} disabled={disabled} onChange={(event) => setPhone(event.target.value)} onKeyDown={onPhoneKey} />
            <button type="button" className="action-button action-button--primary" disabled={off} onClick={() => void addManual()}>
              <Plus aria-hidden="true" /> Adicionar
            </button>
          </div>
          <p className="field__hint">Formato internacional: 55 + DDD + número (ex.: 5511988887777). Outros países: comece com + e o DDI. Enter no telefone também adiciona.</p>
        </div>
      )}

      {tab === 'excel' && !sheet && (
        <div
          className={`dropzone${dragging ? ' dropzone--over' : ''}`}
          role="button"
          tabIndex={0}
          aria-label="Escolher planilha Excel"
          onClick={() => fileInput.current?.click()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              fileInput.current?.click();
            }
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <Upload aria-hidden="true" />
          <strong>Arraste a planilha aqui</strong>
          <span>ou clique para escolher um arquivo .xlsx ou .xls</span>
          <small>Os telefones precisam ter DDI: 55 para o Brasil (ex.: 5511988887777)</small>
        </div>
      )}
      <input ref={fileInput} type="file" accept=".xlsx,.xls" hidden data-testid="spreadsheet-input" onChange={(event) => void openFile(event.target.files?.[0])} />

      {tab === 'excel' && sheet && (
        <section className="sheet" aria-label="Importar planilha">
          <div className="sheet__head">
            <span>
              <strong>{sheet.fileName}</strong> · {plural(sheet.rows.length - start, 'linha de dados', 'linhas de dados')}
            </span>
            <button type="button" className="action-button" onClick={resetSheet}>
              <X aria-hidden="true" /> Trocar arquivo
            </button>
          </div>
          <div className="sheet__columns">
            <div className="field">
              <label className="field__label" htmlFor="col-phone">Coluna do telefone</label>
              <select id="col-phone" className="field__input" value={columns.phone} onChange={(event) => setColumns({ ...columns, phone: Number(event.target.value) })}>
                <option value={-1}>— selecione —</option>
                {Array.from({ length: sheet.ncols }, (_, c) => (
                  <option key={c} value={c}>{columnLabel(sheet, hasHeader, c)}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="col-name">Coluna do nome</label>
              <select id="col-name" className="field__input" value={columns.name} onChange={(event) => setColumns({ ...columns, name: Number(event.target.value) })}>
                <option value={-1}>— sem nome —</option>
                {Array.from({ length: sheet.ncols }, (_, c) => (
                  <option key={c} value={c}>{columnLabel(sheet, hasHeader, c)}</option>
                ))}
              </select>
            </div>
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={hasHeader} onChange={(event) => changeHeader(event.target.checked)} /> Primeira linha é cabeçalho
          </label>
          <p className="field__label">Pré-visualização (primeiras 6 linhas)</p>
          <div className="table-wrap">
            <table className="table sheet__preview">
              <thead>
                <tr>
                  {Array.from({ length: sheet.ncols }, (_, c) => (
                    <th key={c} className={cls(c)}>{columnLabel(sheet, hasHeader, c)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheet.rows.slice(start, start + 6).map((row, r) => (
                  <tr key={r}>
                    {Array.from({ length: sheet.ncols }, (_, c) => (
                      <td key={c} className={cls(c)}>{cellToString(row[c])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sheet__foot">
            <span className="field__hint">{columns.phone < 0 ? 'Selecione a coluna do telefone.' : `${validRows.toLocaleString('pt-BR')} de ${(sheet.rows.length - start).toLocaleString('pt-BR')} linhas com telefone válido`}</span>
            <button type="button" className="action-button action-button--primary" disabled={columns.phone < 0 || off} onClick={() => void importSheet()}>
              Importar contatos
            </button>
          </div>
        </section>
      )}
    </>
  );
}
