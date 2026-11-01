/*
 * Validação de telefones do DisparaZap — mesma regra no servidor (require) e no navegador (<script src="/phone.js">).
 *
 * Formato aceito (detalhes em docs/SEGURANCA_MVP.md):
 *  - Internacional: DDI + número nacional, de 10 a 15 dígitos, sem zero inicial.
 *  - Separadores permitidos: espaço, hífen, ponto, parênteses e "+" apenas no início.
 *  - Sem "+": somente números brasileiros (DDI 55) — 55 + DDD + 8 ou 9 dígitos.
 *  - Com "+": outros países; +1 (EUA/Canadá) segue o plano de numeração norte-americano.
 *
 * Nunca acrescenta DDI nem remove dígitos: entradas ambíguas são recusadas com o motivo.
 * O resultado válido é só dígitos (ex.: "5511988887777"), formato esperado pelo Evolution Go.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DisparaZapPhone = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BR_DDD = new Set([
    11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28,
    31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49,
    51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69,
    71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89,
    91, 92, 93, 94, 95, 96, 97, 98, 99,
  ]);

  const REASONS = {
    empty: 'vazio',
    invalid_chars: 'caracteres inválidos',
    multiple_numbers: 'mais de um número',
    leading_zero: 'zero inicial',
    invalid_length: 'tamanho inválido',
    missing_country_code: 'sem DDI',
    invalid_brazil: 'número brasileiro inválido',
    invalid_international: 'número internacional inválido',
  };

  function fail(code, error) {
    return { ok: false, code, reason: REASONS[code], error };
  }

  // DDD válido + 8 dígitos (fixo ou celular antigo) ou 9 + 8 dígitos (celular)
  function looksLikeBrazilianNational(digits) {
    if (!BR_DDD.has(Number(digits.slice(0, 2)))) return false;
    const local = digits.slice(2);
    return (local.length === 8 && /^[2-9]/.test(local)) || (local.length === 9 && local[0] === '9');
  }

  function validateBrazil(digits) {
    const national = digits.slice(2);
    if (national.length !== 10 && national.length !== 11) {
      return fail('invalid_brazil', `Número brasileiro deve ter 55 + DDD + 8 ou 9 dígitos (12 ou 13 dígitos); este tem ${digits.length}.`);
    }
    const ddd = national.slice(0, 2);
    if (!BR_DDD.has(Number(ddd))) return fail('invalid_brazil', `DDD ${ddd} não existe.`);
    const local = national.slice(2);
    if (local.length === 9 && local[0] !== '9') {
      return fail('invalid_brazil', 'Celular com 9 dígitos após o DDD deve começar com 9.');
    }
    if (local.length === 8 && !/^[2-9]/.test(local)) {
      return fail('invalid_brazil', 'Número com 8 dígitos após o DDD não pode começar com 0 ou 1.');
    }
    return { ok: true, number: digits };
  }

  function validatePhone(input) {
    const raw = input === null || input === undefined ? '' : String(input).trim();
    if (!raw) return fail('empty', 'Telefone vazio.');

    if (!/^\+?[\d\s.()-]+$/.test(raw)) {
      return fail('invalid_chars', 'Use apenas dígitos, espaços, hífen, ponto, parênteses e "+" no início.');
    }

    // Dois blocos com 8+ dígitos separados por espaço = provavelmente dois números na mesma célula
    const longBlocks = raw.split(/\s+/).filter((block) => block.replace(/\D/g, '').length >= 8);
    if (longBlocks.length > 1) return fail('multiple_numbers', 'Parece haver mais de um número no mesmo campo.');

    const hasPlus = raw.startsWith('+');
    const digits = raw.replace(/\D/g, '');

    if (digits.startsWith('0')) {
      return fail('leading_zero', 'Não use zero inicial (zero de tronco ou prefixo de discagem). Informe DDI + DDD + número, ex.: 5511988887777.');
    }
    if (digits.length < 10 || digits.length > 15) {
      return fail('invalid_length', `Tamanho inválido: ${digits.length} dígitos (o formato internacional tem de 10 a 15).`);
    }

    // 10–11 dígitos no padrão "DDD + número" é um número brasileiro sem o DDI, mesmo começando com 55 (DDD do RS)
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

  return { validatePhone, REASONS };
});
