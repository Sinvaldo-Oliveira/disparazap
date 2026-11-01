// Evolution Go simulado para os testes. Nunca contata servidores reais.
const http = require('http');
const https = require('https');

const GLOBAL_KEY = 'chave-global-de-teste';
const INSTANCE_TOKEN = 'token-de-teste';

// Campos sensíveis de propósito: os testes provam que nenhum chega ao navegador
const INSTANCES = [
  {
    id: 'i1',
    name: 'vendas',
    connected: true,
    token: INSTANCE_TOKEN,
    apikey: 'apikey-da-instancia',
    jid: '5511900000001@s.whatsapp.net',
    qrcode: '2@qrcode-secreto',
    proxy: 'http://usuario:senha-do-proxy@proxy.exemplo:8080',
    settings: { webhookToken: 'segredo-aninhado' },
  },
  { id: 'i2', name: 'suporte', connected: false, token: 'outro-token', jid: null },
  { id: 'i3', instanceName: 'legado', connectionStatus: 'open' },
  { id: 'i4', connected: true },
];

const SECRET_VALUES = [
  GLOBAL_KEY, INSTANCE_TOKEN, 'outro-token', 'apikey-da-instancia', '5511900000001',
  '2@qrcode-secreto', 'senha-do-proxy', 'segredo-aninhado',
];

function handler(state) {
  return (req, res) => {
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const { url } = req;
      state.requests.push({ method: req.method, url, host: req.headers.host, apikey: req.headers.apikey });

      if (url.startsWith('/same-host/')) {
        res.writeHead(301, { Location: url.replace('/same-host', '') });
        return res.end();
      }
      if (url.startsWith('/other-host/')) {
        res.writeHead(302, { Location: `${state.protocol}://localhost:${state.port}${url.replace('/other-host', '')}` });
        return res.end();
      }
      if (url.startsWith('/downgrade/')) {
        res.writeHead(301, { Location: `http://127.0.0.1:${state.port}${url.replace('/downgrade', '')}` });
        return res.end();
      }
      if (url.startsWith('/html-error/')) {
        return send(500, '<html><body>Stack trace interno em /var/app/server.go</body></html>', 'text/html');
      }

      if (req.method === 'GET' && url === '/instance/all') {
        if (req.headers.apikey !== GLOBAL_KEY) return send(401, { error: 'not authorized' });
        return send(200, { message: 'success', data: INSTANCES });
      }
      if (req.method === 'POST' && url === '/send/text') {
        if (req.headers.apikey !== INSTANCE_TOKEN) return send(401, { error: 'not authorized' });
        let data = {};
        try { data = JSON.parse(raw); } catch { /* corpo inválido */ }
        state.sent.push(data);
        return send(200, {
          message: 'success',
          data: { Info: { ID: `MSG${state.sent.length}`, Type: 'ExtendedTextMessage' }, Internal: { token: INSTANCE_TOKEN } },
        });
      }
      send(404, { error: 'not found' });
    });
  };
}

async function startMockEvolution({ tls } = {}) {
  const state = { requests: [], sent: [], port: 0, protocol: tls ? 'https' : 'http' };
  const server = tls ? https.createServer(tls, handler(state)) : http.createServer(handler(state));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  state.port = server.address().port;
  return {
    state,
    url: `${state.protocol}://127.0.0.1:${state.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

module.exports = { startMockEvolution, GLOBAL_KEY, INSTANCE_TOKEN, SECRET_VALUES };
