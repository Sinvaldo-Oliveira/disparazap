const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const { startMockEvolution, GLOBAL_KEY, INSTANCE_TOKEN, SECRET_VALUES } = require('./helpers/mock-evolution');
const { startApp, runUntilExit, freePort } = require('./helpers/app');
const { makeSelfSignedCert } = require('./helpers/tls');

const json = async (res) => ({ status: res.status, body: await res.json() });
const send = (base, body, token = INSTANCE_TOKEN) => fetch(`${base}/api/send/text`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Instance-Token': token } : {}) },
  body: JSON.stringify(body),
});

function assertNoSecrets(text) {
  for (const secret of SECRET_VALUES) assert.ok(!text.includes(secret), `vazou para o navegador: ${secret}`);
}

function lanAddress() {
  return Object.values(os.networkInterfaces()).flat().find((i) => i.family === 'IPv4' && !i.internal)?.address;
}

test('servidor do MVP contra Evolution simulado', async (t) => {
  const mock = await startMockEvolution();
  const app = await startApp({ EVOLUTION_URL: mock.url, GLOBAL_API_KEY: GLOBAL_KEY });
  t.after(async () => { await app.stop(); await mock.close(); });

  await t.test('escuta só nesta máquina (127.0.0.1)', async (t) => {
    assert.equal((await fetch(`http://localhost:${app.port}/`)).status, 200);
    const lan = lanAddress();
    if (!lan) return t.skip('sem interface de rede local para testar');
    await assert.rejects(fetch(`http://${lan}:${app.port}/`), 'não deveria responder pelo IP da rede local');
  });

  await t.test('não serve arquivos internos', async () => {
    for (const p of ['/server.js', '/.env', '/package.json', '/node_modules/express/package.json', '/tests/server.test.js']) {
      assert.equal((await fetch(app.base + p)).status, 404, p);
    }
    const phoneJs = await fetch(`${app.base}/phone.js`);
    assert.equal(phoneJs.status, 200);
    assert.match(phoneJs.headers.get('content-type'), /javascript/);
  });

  await t.test('listagem: só nome e status, com fallback de connectionStatus', async () => {
    const res = await fetch(`${app.base}/api/instances`);
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(text), {
      data: [
        { name: 'vendas', connected: true },
        { name: 'suporte', connected: false },
        { name: 'legado', connected: true },
      ],
    });
    assertNoSecrets(text);
    assert.equal(mock.state.requests.at(-1).apikey, GLOBAL_KEY, 'a chave global vai só do servidor para o Evolution');
  });

  await t.test('envio válido: número normalizado, texto UTF-8 intacto e resposta mínima', async () => {
    const res = await send(app.base, { number: '+55 (11) 98888-7777', text: 'Olá João! ✓ *promo*' });
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(text), { ok: true, messageId: 'MSG1' });
    assertNoSecrets(text);
    assert.deepEqual(mock.state.sent.at(-1), { number: '5511988887777', text: 'Olá João! ✓ *promo*', delay: 0 });
  });

  await t.test('telefone inválido é recusado no servidor e não chega ao Evolution', async () => {
    const before = mock.state.sent.length;
    for (const number of ['11988887777', '5511988887777 5511977776666', '011988887777', 'abc', '']) {
      const { status, body } = await json(await send(app.base, { number, text: 'oi' }));
      assert.equal(status, 400, number);
      assert.match(body.error, /^Telefone inválido/, number);
    }
    assert.equal(mock.state.sent.length, before);
  });

  await t.test('mensagem vazia, token ausente e token recusado', async () => {
    assert.equal((await send(app.base, { number: '5511988887777', text: '   ' })).status, 400);
    const noToken = await json(await send(app.base, { number: '5511988887777', text: 'oi' }, null));
    assert.equal(noToken.status, 401);
    const wrong = await json(await send(app.base, { number: '5511988887777', text: 'oi' }, 'errado'));
    assert.deepEqual(wrong, { status: 401, body: { error: 'not authorized' } });
  });

  await t.test('CSRF por formulário (text/plain) não envia', async () => {
    const res = await fetch(`${app.base}/api/send/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', Origin: 'https://site-malicioso.exemplo' },
      body: JSON.stringify({ number: '5511988887777', text: 'x' }),
    });
    assert.equal(res.status, 401);
  });

  await t.test('rota de API inexistente', async () => {
    assert.equal((await fetch(`${app.base}/api/xyz`)).status, 404);
  });
});

test('erros do Evolution não vazam detalhes internos', async (t) => {
  const mock = await startMockEvolution();
  t.after(() => mock.close());

  await t.test('chave global recusada', async () => {
    const app = await startApp({ EVOLUTION_URL: mock.url, GLOBAL_API_KEY: 'chave-errada' });
    try {
      assert.deepEqual(await json(await fetch(`${app.base}/api/instances`)), { status: 401, body: { error: 'not authorized' } });
    } finally { await app.stop(); }
  });

  await t.test('resposta HTML de erro vira mensagem genérica', async () => {
    const app = await startApp({ EVOLUTION_URL: `${mock.url}/html-error`, GLOBAL_API_KEY: GLOBAL_KEY });
    try {
      const res = await fetch(`${app.base}/api/instances`);
      const text = await res.text();
      assert.equal(res.status, 500);
      assert.ok(!/html|var\/app|Stack/i.test(text), text);
    } finally { await app.stop(); }
  });

  await t.test('redirect para o mesmo host é seguido', async () => {
    const app = await startApp({ EVOLUTION_URL: `${mock.url}/same-host`, GLOBAL_API_KEY: GLOBAL_KEY });
    try {
      const { status, body } = await json(await fetch(`${app.base}/api/instances`));
      assert.equal(status, 200);
      assert.equal(body.data.length, 3);
    } finally { await app.stop(); }
  });

  await t.test('redirect para outro host é bloqueado e a chave não segue', async () => {
    const app = await startApp({ EVOLUTION_URL: `${mock.url}/other-host`, GLOBAL_API_KEY: GLOBAL_KEY });
    try {
      const before = mock.state.requests.length;
      const { status, body } = await json(await fetch(`${app.base}/api/instances`));
      assert.equal(status, 502);
      assert.match(body.error, /Redirecionamento bloqueado/);
      const after = mock.state.requests.slice(before);
      assert.equal(after.length, 1, 'só a requisição original chega ao Evolution');
      assert.ok(!after.some((r) => /^localhost/.test(r.host)));
    } finally { await app.stop(); }
  });

  await t.test('servidor fora do ar: mensagem clara, sem expor o endereço', async () => {
    const closedPort = await freePort();
    const app = await startApp({ EVOLUTION_URL: `http://127.0.0.1:${closedPort}`, GLOBAL_API_KEY: GLOBAL_KEY });
    try {
      const res = await fetch(`${app.base}/api/instances`);
      const text = await res.text();
      assert.equal(res.status, 502);
      assert.match(text, /Conexão recusada/);
      assert.ok(!text.includes(String(closedPort)) && !text.includes('127.0.0.1'), text);
    } finally { await app.stop(); }
  });

  await t.test('sem EVOLUTION_URL configurada', async () => {
    const app = await startApp({});
    try {
      const { status, body } = await json(await fetch(`${app.base}/api/instances`));
      assert.equal(status, 500);
      assert.match(body.error, /EVOLUTION_URL/);
    } finally { await app.stop(); }
  });
});

test('TLS com o Evolution', async (t) => {
  const cert = makeSelfSignedCert();
  if (!cert) return t.skip('openssl indisponível para gerar certificado de teste');
  const mock = await startMockEvolution({ tls: { key: cert.key, cert: cert.cert } });
  t.after(async () => { await mock.close(); cert.cleanup(); });

  await t.test('certificado autoassinado é recusado e a chave global não é enviada', async () => {
    const app = await startApp({ EVOLUTION_URL: mock.url, GLOBAL_API_KEY: GLOBAL_KEY });
    try {
      const { status, body } = await json(await fetch(`${app.base}/api/instances`));
      assert.equal(status, 502);
      assert.match(body.error, /Certificado HTTPS do servidor Evolution não é confiável/);
      assert.equal(mock.state.requests.length, 0, 'nenhuma requisição HTTP chegou ao servidor com certificado inválido');
    } finally { await app.stop(); }
  });

  await t.test('NODE_TLS_REJECT_UNAUTHORIZED=0 não desliga a verificação', async () => {
    const app = await startApp({ EVOLUTION_URL: mock.url, GLOBAL_API_KEY: GLOBAL_KEY, NODE_TLS_REJECT_UNAUTHORIZED: '0' });
    try {
      assert.equal((await fetch(`${app.base}/api/instances`)).status, 502);
      assert.equal(mock.state.requests.length, 0);
    } finally { await app.stop(); }
  });

  await t.test('EVOLUTION_CA_FILE permite confiar no certificado próprio, com verificação ligada', async () => {
    const app = await startApp({ EVOLUTION_URL: mock.url, GLOBAL_API_KEY: GLOBAL_KEY, EVOLUTION_CA_FILE: cert.certPath });
    try {
      const { status, body } = await json(await fetch(`${app.base}/api/instances`));
      assert.equal(status, 200);
      assert.equal(body.data[0].name, 'vendas');
    } finally { await app.stop(); }
  });

  await t.test('redirect de HTTPS para HTTP é bloqueado', async () => {
    const app = await startApp({ EVOLUTION_URL: `${mock.url}/downgrade`, GLOBAL_API_KEY: GLOBAL_KEY, EVOLUTION_CA_FILE: cert.certPath });
    try {
      const { status, body } = await json(await fetch(`${app.base}/api/instances`));
      assert.equal(status, 502);
      assert.match(body.error, /Redirecionamento bloqueado/);
    } finally { await app.stop(); }
  });

  await t.test('EVOLUTION_CA_FILE ilegível impede o servidor de iniciar', async () => {
    const { code, output } = await runUntilExit({ EVOLUTION_URL: mock.url, EVOLUTION_CA_FILE: 'Z:/nao-existe/ca.pem' });
    assert.equal(code, 1);
    assert.match(output, /EVOLUTION_CA_FILE/);
  });
});
