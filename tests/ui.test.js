// Fluxo completo da interface (Instância → Contatos → Mensagem → Delay → Disparar) em navegador simulado
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM, requestInterceptor } = require('jsdom');
const XLSX = require('xlsx');
const { startMockEvolution, GLOBAL_KEY, INSTANCE_TOKEN } = require('./helpers/mock-evolution');
const { startApp } = require('./helpers/app');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(fn, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return true;
    await sleep(50);
  }
  return false;
}

// Carrega só recursos do servidor local; a CDN da SheetJS vira resposta vazia (XLSX é injetado no beforeParse)
const localOnly = (base) => requestInterceptor((request) => {
  if (!request.url.startsWith(base)) {
    return new Response('', { headers: { 'Content-Type': 'application/javascript' } });
  }
  return undefined;
});

test('interface do disparador', async (t) => {
  const mock = await startMockEvolution();
  const app = await startApp({ EVOLUTION_URL: mock.url, GLOBAL_API_KEY: GLOBAL_KEY });
  const dom = await JSDOM.fromURL(`${app.base}/`, {
    runScripts: 'dangerously',
    resources: { interceptors: [localOnly(app.base)] },
    pretendToBeVisual: true,
    beforeParse(win) {
      win.fetch = (url, opts) => fetch(new URL(url, app.base), opts);
      win.confirm = () => true;
      win.scrollTo = () => {};
      win.XLSX = XLSX;
    },
  });
  t.after(async () => { dom.window.close(); await app.stop(); await mock.close(); });

  const win = dom.window;
  const doc = win.document;
  const $ = (id) => doc.getElementById(id);
  const type = (id, value) => { $(id).value = value; $(id).dispatchEvent(new win.Event('input', { bubbles: true })); };
  const choose = (id, value) => { $(id).value = value; $(id).dispatchEvent(new win.Event('change', { bubbles: true })); };
  const step = () => doc.querySelector('.step.active').dataset.step;
  const lastToast = () => [...doc.querySelectorAll('.toast')].at(-1)?.textContent || '';
  const count = () => Number($('contactCount').textContent);
  const logText = () => $('logPanel').textContent;
  const addManual = (name, phone) => { type('contactName', name); type('contactPhone', phone); $('btnAddContact').click(); };
  const goTo = (n) => doc.querySelector(`.step-item[data-step="${n}"]`).click();
  const finished = () => !$('postSummary').classList.contains('hidden') && !$('btnStart').disabled;

  await waitFor(() => doc.readyState === 'complete' && win.DisparaZapPhone);

  await t.test('etapa 1 — instâncias e token', async () => {
    await waitFor(() => $('instanceSelect').options.length > 1);
    assert.deepEqual([...$('instanceSelect').options].map((o) => o.textContent),
      ['— selecione —', '🟢 vendas', '🔴 suporte', '🟢 legado']);
    $('btnNext').click();
    assert.equal(step(), '1', 'não avança sem instância');
    choose('instanceSelect', 'vendas');
    assert.equal($('instanceStatusText').textContent, 'Conectado');
    type('tokenInput', INSTANCE_TOKEN);
    $('btnSaveToken').click();
    assert.equal(win.localStorage.getItem('token:vendas'), INSTANCE_TOKEN);
    choose('instanceSelect', 'suporte');
    assert.equal($('instanceStatusText').textContent, 'Desconectado');
    assert.equal($('tokenInput').value, '');
    choose('instanceSelect', 'vendas');
    assert.equal($('tokenInput').value, INSTANCE_TOKEN, 'token recarregado do localStorage');
    $('btnNext').click();
    assert.equal(step(), '2');
  });

  await t.test('etapa 2 — contatos manuais com a nova regra de telefone', async () => {
    addManual('João', '+55 (11) 98888-7777');
    assert.equal(count(), 1);
    assert.ok($('contactsBody').textContent.includes('5511988887777'));
    addManual('Repetido', '5511988887777');
    assert.equal(count(), 1, 'duplicado recusado');
    addManual('Sem DDI', '11988887777');
    assert.equal(count(), 1);
    assert.match(lastToast(), /sem o DDI 55/);
    addManual('Zero', '011988887777');
    assert.match(lastToast(), /zero inicial/);
    type('contactName', 'Maria');
    type('contactPhone', '5511977776666');
    $('contactPhone').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal(count(), 2, 'Enter no telefone adiciona');
  });

  await t.test('etapa 2 — importação de Excel com motivos de rejeição', async () => {
    doc.querySelector('.tab[data-tab="excel"]').click();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Nome do Cliente', 'Celular', 'Cidade'],
      ['Ana', 5511966665555, 'SP'],
      ['Bruno', '55 (21) 95555-4444', 'RJ'],
      ['Sem DDI', '11 94444-3333', 'SP'],
      ['Sem telefone', '', 'BH'],
      ['Maria repetida', 5511977776666, 'SP'],
      ['Dois números', '5511911112222 5511933334444', 'SP'],
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Contatos');
    const file = new win.File([XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })], 'contatos.xlsx');
    const drop = new win.Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [file] } });
    $('dropzone').dispatchEvent(drop);
    await waitFor(() => !$('excelConfig').classList.contains('hidden'));

    assert.ok($('hasHeader').checked, 'cabeçalho detectado');
    assert.equal($('colPhone').value, '1', 'coluna Celular');
    assert.equal($('colName').value, '0', 'coluna Nome do Cliente');
    assert.ok($('excelPreview').textContent.includes('5511966665555'), 'sem notação científica');
    assert.match($('excelValidHint').textContent, /^3 de 6/);
    $('btnImport').click();
    assert.equal(count(), 4, 'Ana e Bruno adicionados');
    assert.ok(logText().includes('2 contato(s) adicionado(s), 3 linha(s) ignorada(s) (1 sem DDI, 1 vazio, 1 mais de um número), 1 duplicado(s)'), logText());
    $('contactsBody').querySelector('button[data-index="3"]').click();
    assert.equal(count(), 3);
    assert.ok(!$('contactsBody').textContent.includes('Bruno'));
    $('btnNext').click();
    assert.equal(step(), '3');
  });

  await t.test('etapa 3 — mensagem, pré-visualização e variações', async () => {
    $('btnNext').click();
    assert.equal(step(), '3', 'não avança sem mensagem');
    type('messageInput', 'Olá {nome}! *Promo* de hoje');
    assert.equal($('charCount').textContent, '27 caracteres');
    $('btnPreview').click();
    assert.equal($('previewBox').style.display, 'block');
    assert.ok($('previewBubbles').innerHTML.includes('Olá João! <strong>Promo</strong>'));
    $('abToggle').click();
    type(doc.querySelector('#variationsList textarea').id, 'Oi {nome}, tudo bem?');
    assert.equal(doc.querySelectorAll('#previewBubbles .bubble').length, 2);
    $('btnNext').click();
    assert.equal(step(), '4');
  });

  await t.test('etapa 4 — validação do intervalo', async () => {
    type('delayMin', '3');
    type('delayMax', '2');
    $('btnNext').click();
    assert.equal(step(), '4', 'máximo menor que mínimo bloqueia');
    type('delayMin', '1');
    type('delayMax', '1');
    assert.ok(!$('delayWarn').classList.contains('hidden'), 'aviso abaixo de 5s');
    $('btnNext').click();
    assert.equal(step(), '5');
  });

  await t.test('etapa 5 — disparo completo contra o Evolution simulado', async () => {
    assert.equal($('preContacts').textContent, '3');
    assert.equal($('preMessages').textContent, '2 variações');
    const before = mock.state.sent.length;
    $('btnStart').click();
    await sleep(100);
    assert.ok(!$('btnStop').disabled && doc.querySelector('.step-item').disabled, 'parar ativo e navegação travada');
    assert.ok(await waitFor(finished));
    assert.equal($('progressText').textContent, '3 / 3');
    assert.equal($('sumSent').textContent, '3');
    assert.equal($('sumErrors').textContent, '0');
    const sent = mock.state.sent.slice(before);
    assert.deepEqual(sent.map((m) => m.number).sort(), ['5511966665555', '5511977776666', '5511988887777']);
    assert.ok(sent.every((m) => /^(Olá|Oi) (João|Maria|Ana)/.test(m.text)), JSON.stringify(sent));
  });

  await t.test('etapa 5 — parar durante o intervalo', async () => {
    $('btnNewCampaign').click();
    assert.equal(step(), '2');
    assert.equal(count(), 0);
    for (const phone of ['5511911110001', '5511911110002', '5511911110003']) addManual('', phone);
    goTo(4);
    type('delayMin', '8');
    type('delayMax', '8');
    goTo(5);
    $('btnStart').click();
    assert.ok(await waitFor(() => /Próximo envio em \ds/.test($('runStatus').textContent)));
    const stopAt = Date.now();
    $('btnStop').click();
    assert.ok(await waitFor(finished, 5000));
    assert.ok(Date.now() - stopAt < 1500, 'parada rápida');
    assert.equal($('sumSent').textContent, '1');
    assert.match($('stoppedWarn').textContent, /2 de 3/);
  });

  await t.test('etapa 5 — token recusado interrompe no primeiro erro', async () => {
    goTo(1);
    type('tokenInput', 'token-errado');
    goTo(5);
    $('btnStart').click();
    assert.ok(await waitFor(finished, 5000));
    assert.equal($('sumErrors').textContent, '1');
    assert.equal($('sumSent').textContent, '0');
    assert.match($('stoppedWarn').className, /error/);
    assert.ok([...doc.querySelectorAll('.log-line.err')].some((l) => l.textContent.includes('not authorized')));
  });

  await t.test('HTML em nomes é exibido como texto', async () => {
    goTo(2);
    addManual('<img src=x onerror=alert(1)>', '5511900000000');
    assert.equal($('contactsBody').querySelector('img'), null);
    assert.ok($('contactsBody').textContent.includes('<img'));
  });
});
