/**
 * Validação de telefone do SaaS: cópia fiel da regra do MVP (`phone.js` na raiz, detalhes em docs/SEGURANCA_MVP.md).
 * O SaaS não importa código do MVP (regra do projeto): ao mudar uma das duas, mude a outra.
 *
 * - Internacional: DDI + número nacional, de 10 a 15 dígitos, sem zero inicial.
 * - Sem "+": só números brasileiros (55 + DDD + 8 ou 9 dígitos). Com "+": outros países; +1 segue o plano norte-americano.
 * - Nunca acrescenta DDI nem remove dígitos: entradas ambíguas são recusadas com o motivo.
 * O resultado válido é só dígitos (ex.: "5511988887777"), formato esperado pela Evolution Go.
 */

const BR_DDD = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/** Motivos curtos (iguais aos do MVP), usados para resumir as linhas ignoradas de uma planilha */
export const PHONE_REJECTION_REASONS = {
  empty: 'vazio',
  invalid_chars: 'caracteres inválidos',
  multiple_numbers: 'mais de um número',
  leading_zero: 'zero inicial',
  invalid_length: 'tamanho inválido',
  missing_country_code: 'sem DDI',
  invalid_brazil: 'número brasileiro inválido',
  invalid_international: 'número internacional inválido',
} as const;

export type PhoneRejection = keyof typeof PHONE_REJECTION_REASONS;

export type PhoneResult = { ok: true; number: string } | { ok: false; code: PhoneRejection; reason: string; error: string };

const fail = (code: PhoneRejection, error: string): PhoneResult => ({ ok: false, code, reason: PHONE_REJECTION_REASONS[code], error });

function looksLikeBrazilianNational(digits: string): boolean {
  if (!BR_DDD.has(Number(digits.slice(0, 2)))) return false;
  const local = digits.slice(2);
  return (local.length === 8 && /^[2-9]/.test(local)) || (local.length === 9 && local[0] === '9');
}

function validateBrazil(digits: string): PhoneResult {
  const national = digits.slice(2);
  if (national.length !== 10 && national.length !== 11) {
    return fail('invalid_brazil', `Número brasileiro deve ter 55 + DDD + 8 ou 9 dígitos (12 ou 13 dígitos); este tem ${digits.length}.`);
  }
  const ddd = national.slice(0, 2);
  if (!BR_DDD.has(Number(ddd))) return fail('invalid_brazil', `DDD ${ddd} não existe.`);
  const local = national.slice(2);
  if (local.length === 9 && local[0] !== '9') return fail('invalid_brazil', 'Celular com 9 dígitos após o DDD deve começar com 9.');
  if (local.length === 8 && !/^[2-9]/.test(local)) return fail('invalid_brazil', 'Número com 8 dígitos após o DDD não pode começar com 0 ou 1.');
  return { ok: true, number: digits };
}

export function validatePhone(input: string | null | undefined): PhoneResult {
  const raw = input === null || input === undefined ? '' : String(input).trim();
  if (!raw) return fail('empty', 'Telefone vazio.');
  if (!/^\+?[\d\s.()-]+$/.test(raw)) return fail('invalid_chars', 'Use apenas dígitos, espaços, hífen, ponto, parênteses e "+" no início.');

  const longBlocks = raw.split(/\s+/).filter((block) => block.replace(/\D/g, '').length >= 8);
  if (longBlocks.length > 1) return fail('multiple_numbers', 'Parece haver mais de um número no mesmo campo.');

  const hasPlus = raw.startsWith('+');
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0')) {
    return fail('leading_zero', 'Não use zero inicial (zero de tronco ou prefixo de discagem). Informe DDI + DDD + número, ex.: 5511988887777.');
  }
  if (digits.length < 10 || digits.length > 15) return fail('invalid_length', `Tamanho inválido: ${digits.length} dígitos (o formato internacional tem de 10 a 15).`);
  if ((digits.length === 10 || digits.length === 11) && looksLikeBrazilianNational(digits)) {
    return fail('missing_country_code', `Parece um número brasileiro sem o DDI 55. Informe 55 + DDD + número (ex.: 55${digits}).`);
  }
  if (digits.startsWith('55')) return validateBrazil(digits);
  if (!hasPlus) {
    return fail('missing_country_code', 'Sem "+", só são aceitos números brasileiros com DDI 55 (ex.: 5511988887777). Para outros países, comece com "+" e o DDI.');
  }
  if (digits.startsWith('1') && !/^1[2-9]\d{2}[2-9]\d{6}$/.test(digits)) {
    return fail('invalid_international', 'Número dos EUA/Canadá (+1) inválido: use +1, código de área de 3 dígitos e 7 dígitos.');
  }
  return { ok: true, number: digits };
}
