import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { cellToString, columnLetter, detectColumns, detectHeader, importContacts, parseSpreadsheet, readSpreadsheetFile } from './spreadsheet';

// Planilha fictícia gerada no próprio teste (SheetJS 0.20.3, o mesmo do disparador atual)
function workbook(rows: unknown[][]): Uint8Array {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Contatos');
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

describe('importação de planilhas (regras do disparador atual)', () => {
  it('lê o .xlsx, acha cabeçalho e colunas e importa só telefones válidos, sem repetidos', async () => {
    const sheet = await parseSpreadsheet(
      workbook([
        ['Cidade', 'Nome do cliente', 'Celular'],
        ['SP', 'Ana', 5511988887777],
        ['RJ', 'Bruno', '11988887777'],
        ['BH', 'Carla', ''],
        ['SP', 'Ana de novo', '55 11 98888-7777'],
        ['RJ', 'Duda', '+55 21 99876-5432'],
      ]),
      'clientes.xlsx',
    );
    expect(sheet).toMatchObject({ fileName: 'clientes.xlsx', ncols: 3 });
    expect(sheet.rows).toHaveLength(6);
    expect(detectHeader(sheet.rows)).toBe(true);
    const columns = detectColumns(sheet, true);
    expect(columns).toEqual({ phone: 2, name: 1 });

    const result = importContacts(sheet, { hasHeader: true, ...columns }, new Set());
    expect(result.contacts).toEqual([
      { name: 'Ana', phone: '5511988887777' },
      { name: 'Duda', phone: '5521998765432' },
    ]);
    expect(result).toMatchObject({ invalid: 2, duplicate: 1, reasons: { 'sem DDI': 1, vazio: 1 } });
  });

  it('sem cabeçalho: a coluna do telefone é a que mais parece telefone; quem já está na lista conta como repetido', () => {
    const sheet = { fileName: 'x.xlsx', ncols: 2, rows: [['Ana', '5511988887777'], ['Bruno', '5521998765432']] };
    expect(detectHeader(sheet.rows)).toBe(false);
    const columns = detectColumns(sheet, false);
    expect(columns).toEqual({ phone: 1, name: 0 });
    const result = importContacts(sheet, { hasHeader: false, ...columns }, new Set(['5511988887777']));
    expect(result).toMatchObject({ contacts: [{ name: 'Bruno', phone: '5521998765432' }], duplicate: 1, invalid: 0 });
  });

  it('números grandes não viram notação científica; letras das colunas como no Excel', () => {
    expect(cellToString(5511988887777)).toBe('5511988887777');
    expect(cellToString(null)).toBe('');
    expect([0, 25, 26, 27].map(columnLetter)).toEqual(['A', 'Z', 'AA', 'AB']);
  });

  it('recusa outros formatos antes de ler', async () => {
    await expect(readSpreadsheetFile(new File(['a;b'], 'contatos.csv'))).rejects.toThrow('.xlsx');
  });
});
