import { z } from 'zod';

// Fuso horário da empresa (decisão R3 do PLANO_MODULO_REDES_SOCIAIS): agenda e calendário no horário da empresa.
// Só Intl (navegador e Node), sem biblioteca: os nomes são os da base IANA (ex.: America/Sao_Paulo).

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

export function isValidTimeZone(value: string): boolean {
  if (!value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const timeZoneSchema = z.string().trim().min(1).max(64).refine(isValidTimeZone, 'Fuso horário desconhecido.');

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Data e hora de um instante no fuso indicado */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return { year: parts.year ?? 0, month: parts.month ?? 1, day: parts.day ?? 1, hour: (parts.hour ?? 0) % 24, minute: parts.minute ?? 0, second: parts.second ?? 0 };
}

const pad = (value: number, size = 2) => String(value).padStart(size, '0');

/** "AAAA-MM-DD" do instante no fuso (chave do dia no calendário) */
export function zonedDateKey(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** "AAAA-MM-DDTHH:mm" do instante no fuso (valor de um campo datetime-local) */
export function zonedLocalValue(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${zonedDateKey(date, timeZone)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Diferença do fuso para o UTC naquele instante, em milissegundos */
function offsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

export const LOCAL_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * "AAAA-MM-DDTHH:mm" no fuso da empresa → instante (Date). Na mudança de horário (horário de verão), um horário que não
 * existe avança para o primeiro que existe. Devolve null se o texto não for uma data válida.
 */
export function zonedLocalToDate(local: string, timeZone: string): Date | null {
  const match = LOCAL_DATETIME_RE.exec(local);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(guess);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  // Duas passadas: o deslocamento pode mudar entre o palpite e o resultado (virada do horário de verão)
  let result = guess - offsetMs(new Date(guess), timeZone);
  result = guess - offsetMs(new Date(result), timeZone);
  return new Date(result);
}
