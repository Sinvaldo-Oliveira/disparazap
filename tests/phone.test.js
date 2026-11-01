const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePhone } = require('../phone');

function accepts(input, expected) {
  const result = validatePhone(input);
  assert.equal(result.ok, true, `${JSON.stringify(input)} deveria ser aceito — ${result.error}`);
  assert.equal(result.number, expected);
}

function rejects(input, code) {
  const result = validatePhone(input);
  assert.equal(result.ok, false, `${JSON.stringify(input)} deveria ser recusado`);
  assert.equal(result.code, code, `${JSON.stringify(input)} recusado como "${result.code}": ${result.error}`);
  assert.ok(result.error && result.reason, 'recusa precisa explicar o motivo');
}

test('número brasileiro válido', () => {
  accepts('5511988887777', '5511988887777');
  accepts('+55 (11) 98888-7777', '5511988887777');
  accepts('55 11 98888.7777', '5511988887777');
  accepts(5511988887777, '5511988887777'); // célula numérica do Excel
  accepts('55 21 3333-4444', '552133334444'); // fixo
  accepts('551188887777', '551188887777'); // celular no formato antigo, sem o 9
  accepts('5555988887777', '5555988887777'); // DDD 55 (RS)
});

test('número sem DDI', () => {
  rejects('11988887777', 'missing_country_code');
  rejects('(11) 98888-7777', 'missing_country_code');
  rejects('1133334444', 'missing_country_code');
  rejects('1234567890', 'missing_country_code');
  rejects('55988887777', 'missing_country_code'); // DDD 55 sem o DDI 55
  rejects('+11988887777', 'missing_country_code'); // "+" não torna inequívoco um número brasileiro sem 55
  rejects('12025550123', 'missing_country_code'); // outro país sem "+"
  rejects('442079460958', 'missing_country_code');
});

test('zero de tronco ou prefixo de discagem', () => {
  rejects('011988887777', 'leading_zero');
  rejects('0 11 98888-7777', 'leading_zero');
  rejects('005511988887777', 'leading_zero');
  rejects('+0055 11 98888-7777', 'leading_zero');
});

test('caracteres inválidos', () => {
  rejects('5511abc887777', 'invalid_chars');
  rejects('55 11 98888-7777 ramal 2', 'invalid_chars');
  rejects('5511988887777#', 'invalid_chars');
  rejects('55+11988887777', 'invalid_chars');
  rejects('++5511988887777', 'invalid_chars');
  rejects('５５１１９８８８８７７７７', 'invalid_chars'); // dígitos de largura total
  rejects('+', 'invalid_chars');
});

test('números concatenados', () => {
  rejects('5511988887777 5511977776666', 'multiple_numbers');
  rejects('(11) 98888-7777 (11) 97777-6666', 'multiple_numbers');
  rejects('5511988887777\n5511977776666', 'multiple_numbers');
  rejects('5511988887777/5511977776666', 'invalid_chars');
  rejects('5511988887777, 5511977776666', 'invalid_chars');
  rejects('9999-9999 / 8888', 'invalid_chars');
  rejects('55119888877775511977776666', 'invalid_length');
});

test('entradas vazias', () => {
  rejects('', 'empty');
  rejects('   ', 'empty');
  rejects(null, 'empty');
  rejects(undefined, 'empty');
  rejects('-- ()', 'invalid_length');
});

test('comprimentos inválidos', () => {
  rejects('123456789', 'invalid_length');
  rejects('+1234567890123456', 'invalid_length');
  rejects('5511988887', 'invalid_brazil');
  rejects('55119888877776', 'invalid_brazil');
  rejects('551198888777712', 'invalid_brazil');
});

test('regras do Brasil: DDD e primeiro dígito', () => {
  rejects('5520988887777', 'invalid_brazil'); // DDD 20 não existe
  rejects('5511888877776', 'invalid_brazil'); // 9 dígitos sem começar com 9
  rejects('551118887777', 'invalid_brazil'); // 8 dígitos começando com 1
});

test('outros países exigem "+"', () => {
  accepts('+1 202 555 0123', '12025550123');
  accepts('+44 20 7946 0958', '442079460958');
  rejects('+1 123 555 0123', 'invalid_international'); // código de área dos EUA não começa com 1
});

test('nunca acrescenta nem remove dígitos — só separadores', () => {
  for (const input of ['+55 (11) 98888-7777', '55 21 3333-4444', '+1 202 555 0123']) {
    const result = validatePhone(input);
    assert.equal(result.ok, true);
    assert.equal(result.number, input.replace(/\D/g, ''));
  }
});
