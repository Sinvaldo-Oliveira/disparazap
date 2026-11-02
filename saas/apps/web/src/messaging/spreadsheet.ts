import { MESSAGING_LIMITS, validatePhone, type Contact } from '@disparazap/contracts';

/**
 * Importação de planilhas, portada do disparador atual (index.html do MVP): detecção de cabeçalho e de colunas,
 * números sem notação científica e a mesma regra de telefone. A leitura do arquivo acontece no navegador.
 */
export interface Spreadsheet {
  fileName: string;
  rows: unknown[][];
  ncols: number;
}

export type ReadSpreadsheet = (file: File) => Promise<Spreadsheet>;

/** Planilhas maiores travariam o navegador; 10 mil contatos cabem com folga */
export const MAX_SPREADSHEET_BYTES = 10 * 1024 * 1024;

export const PHONE_HEADER_RE = /(telefone|celular|fone|phone|whats|zap|n[uú]mero|mobile|^tel\b|^cel\b)/i;
export const NAME_HEADER_RE = /(nome|name|cliente|contato|raz[aã]o)/i;

/** Lê os bytes de .xlsx/.xls com o SheetJS (carregado só quando alguém importa uma planilha) */
export async function parseSpreadsheet(bytes: Uint8Array, fileName: string): Promise<Spreadsheet> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(bytes, { type: 'array' });
  const first = workbook.SheetNames[0];
  const sheet = first ? workbook.Sheets[first] : undefined;
  if (!sheet) return { fileName, rows: [], ncols: 0 };
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '', blankrows: false });
  return { fileName, rows, ncols: rows.reduce((max, row) => Math.max(max, row.length), 0) };
}

export const readSpreadsheetFile: ReadSpreadsheet = async (file) => {
  if (!/\.(xlsx|xls)$/i.test(file.name)) throw new Error('Formato inválido: use um arquivo .xlsx ou .xls.');
  if (file.size > MAX_SPREADSHEET_BYTES) throw new Error('Planilha grande demais (máximo de 10 MB).');
  return parseSpreadsheet(new Uint8Array(await file.arrayBuffer()), file.name);
};

/** Números grandes do Excel viram texto sem notação científica */
export function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isInteger(value) ? value.toFixed(0) : String(value);
  return String(value).trim();
}

/** Só para achar a coluna e o cabeçalho: 8+ dígitos e nenhuma letra. A validação de verdade é a regra de telefone */
export function looksLikePhone(value: unknown): boolean {
  const text = cellToString(value);
  return !/[a-zà-ú]/i.test(text) && text.replace(/\D/g, '').length >= 8;
}

/** Se a 1ª linha já tem um telefone, ela é dado; senão é cabeçalho */
export function detectHeader(rows: readonly unknown[][]): boolean {
  return !(rows[0] ?? []).some(looksLikePhone);
}

export function detectColumns(sheet: Spreadsheet, hasHeader: boolean): { phone: number; name: number } {
  const start = hasHeader ? 1 : 0;
  const header = hasHeader ? Array.from({ length: sheet.ncols }, (_, c) => cellToString(sheet.rows[0]?.[c])) : [];
  const sample = sheet.rows.slice(start, start + 50);

  let phone = header.findIndex((title) => PHONE_HEADER_RE.test(title));
  let name = header.findIndex((title, index) => index !== phone && NAME_HEADER_RE.test(title));

  if (phone < 0) {
    let best = 0;
    for (let c = 0; c < sheet.ncols; c++) {
      const score = sample.filter((row) => looksLikePhone(row[c])).length;
      if (score > best) {
        best = score;
        phone = c;
      }
    }
  }
  if (name < 0) {
    for (let c = 0; c < sheet.ncols; c++) {
      if (c === phone) continue;
      if (sample.some((row) => /[a-zà-ú]/i.test(cellToString(row[c])))) {
        name = c;
        break;
      }
    }
  }
  return { phone, name };
}

/** 0 → A, 25 → Z, 26 → AA */
export function columnLetter(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rest = (n - 1) % 26;
    letters = String.fromCharCode(65 + rest) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export function columnLabel(sheet: Spreadsheet, hasHeader: boolean, index: number): string {
  const title = hasHeader ? cellToString(sheet.rows[0]?.[index]) : '';
  return title ? `${columnLetter(index)} · ${title}` : `Coluna ${columnLetter(index)}`;
}

/** Nome do contato: sem quebras de linha, até o limite da API */
export function cleanContactName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MESSAGING_LIMITS.contactNameMax);
}

export interface ImportResult {
  contacts: Contact[];
  invalid: number;
  duplicate: number;
  /** Motivos das linhas ignoradas (ex.: { "sem DDI": 3, "vazio": 1 }) */
  reasons: Record<string, number>;
}

export function importContacts(sheet: Spreadsheet, options: { hasHeader: boolean; phone: number; name: number }, existing: ReadonlySet<string>): ImportResult {
  const seen = new Set(existing);
  const contacts: Contact[] = [];
  const reasons: Record<string, number> = {};
  let invalid = 0;
  let duplicate = 0;
  for (const row of sheet.rows.slice(options.hasHeader ? 1 : 0)) {
    const check = validatePhone(cellToString(row[options.phone]));
    if (!check.ok) {
      invalid++;
      reasons[check.reason] = (reasons[check.reason] ?? 0) + 1;
      continue;
    }
    if (seen.has(check.number)) {
      duplicate++;
      continue;
    }
    seen.add(check.number);
    contacts.push({ name: options.name >= 0 ? cleanContactName(cellToString(row[options.name])) : '', phone: check.number });
  }
  return { contacts, invalid, duplicate, reasons };
}
