require('dotenv').config();

const express = require('express');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const tls = require('tls');
const { validatePhone } = require('./phone');

const EVOLUTION_URL = (process.env.EVOLUTION_URL || '').trim().replace(/\/+$/, '');
const GLOBAL_API_KEY = (process.env.GLOBAL_API_KEY || '').trim();
const PORT = Number(process.env.PORT) || 3000;
// Só esta máquina por padrão — o MVP não tem login. Outro valor expõe o disparador na rede.
const HOST = (process.env.HOST || '127.0.0.1').trim();
const EVOLUTION_CA_FILE = (process.env.EVOLUTION_CA_FILE || '').trim();

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 30000;
const MAX_ERROR_LENGTH = 200;

// Certificado do Evolution sempre verificado. EVOLUTION_CA_FILE só acrescenta uma autoridade às padrão.
function buildHttpsAgent() {
  const options = { rejectUnauthorized: true };
  if (EVOLUTION_CA_FILE) {
    try {
      options.ca = [...tls.rootCertificates, fs.readFileSync(EVOLUTION_CA_FILE, 'utf8')];
    } catch (err) {
      console.error(`✖ Não foi possível ler EVOLUTION_CA_FILE: ${err.message}`);
      process.exit(1);
    }
  }
  return new https.Agent(options);
}
const httpsAgent = buildHttpsAgent();

function dzError(code) {
  return Object.assign(new Error(code), { code });
}

/**
 * Requisição HTTP(S) usando só módulos nativos do Node.
 * Segue redirects (até 5 saltos) apenas para o mesmo host e nunca de HTTPS para HTTP,
 * porque a chave vai no header. Em 302/303 o método vira GET sem body.
 * Resolve com { status, body, json } — json indica se o corpo era JSON.
 */
function proxyFetch(url, { method = 'GET', headers = {}, body } = {}, hops = 0) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      return reject(dzError('DZ_BAD_URL'));
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return reject(dzError('DZ_BAD_URL'));

    const isHttps = target.protocol === 'https:';
    const payload = body === undefined ? undefined : Buffer.from(body);
    const reqHeaders = { Accept: 'application/json', ...headers };
    if (payload) reqHeaders['Content-Length'] = payload.length;

    const req = (isHttps ? https : http).request(
      target,
      { method, headers: reqHeaders, agent: isHttps ? httpsAgent : undefined },
      (res) => {
        const { statusCode, headers: resHeaders } = res;

        if (REDIRECT_CODES.has(statusCode) && resHeaders.location) {
          res.resume();
          if (hops >= MAX_REDIRECTS) return reject(dzError('DZ_REDIRECT_LIMIT'));
          let next;
          try {
            next = new URL(resHeaders.location, target);
          } catch {
            return reject(dzError('DZ_REDIRECT_BLOCKED'));
          }
          const downgrade = isHttps && next.protocol !== 'https:';
          if (next.hostname !== target.hostname || downgrade || !/^https?:$/.test(next.protocol)) {
            return reject(dzError('DZ_REDIRECT_BLOCKED'));
          }
          const toGet = statusCode === 302 || statusCode === 303;
          const nextOpts = toGet
            ? { method: 'GET', headers: withoutContentHeaders(headers) }
            : { method, headers, body };
          return resolve(proxyFetch(next.toString(), nextOpts, hops + 1));
        }

        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            resolve({ status: statusCode, body: text ? JSON.parse(text) : {}, json: true });
          } catch {
            resolve({ status: statusCode, body: null, json: false });
          }
        });
        res.on('error', reject);
      }
    );

    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(dzError('DZ_TIMEOUT')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function withoutContentHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!/^content-(type|length)$/i.test(k)) out[k] = v;
  }
  return out;
}

function isInstanceConnected(inst) {
  if (inst.connected === true) return true;
  const status = String(inst.connectionStatus || inst.status || '').toLowerCase();
  return status === 'open' || status === 'connected';
}

// Lista de campos PERMITIDOS: só o que a interface usa. Token, jid, qrcode, proxy e objetos aninhados nunca saem.
function toPublicInstance(inst) {
  if (!inst || typeof inst !== 'object') return null;
  const name = [inst.name, inst.instanceName].find((v) => typeof v === 'string' && v.trim());
  if (!name) return null;
  return { name: name.trim(), connected: isInstanceConnected(inst) };
}

// Mensagem de erro do Evolution reduzida a um texto curto — o corpo original nunca é repassado
function upstreamError({ status, body, json }) {
  let message = '';
  if (json && body && typeof body === 'object') {
    const inner = body.data && typeof body.data === 'object' ? body.data : {};
    message = [body.error, body.message, inner.error, inner.message]
      .find((v) => typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'success') || '';
  }
  message = message.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_ERROR_LENGTH);
  return message || `O servidor Evolution respondeu com erro HTTP ${status}`;
}

const SAFE_ERRORS = {
  DZ_BAD_URL: 'EVOLUTION_URL inválida no arquivo .env',
  DZ_TIMEOUT: 'Tempo esgotado aguardando o servidor Evolution',
  DZ_REDIRECT_LIMIT: 'Excesso de redirecionamentos no servidor Evolution',
  DZ_REDIRECT_BLOCKED: 'Redirecionamento bloqueado: o servidor Evolution tentou desviar a requisição para outro endereço ou sem HTTPS',
  ECONNREFUSED: 'Conexão recusada pelo servidor Evolution — verifique EVOLUTION_URL',
  ENOTFOUND: 'Servidor Evolution não encontrado — verifique EVOLUTION_URL',
  EAI_AGAIN: 'Falha de DNS ao procurar o servidor Evolution — verifique a internet',
  ECONNRESET: 'O servidor Evolution encerrou a conexão inesperadamente',
  ETIMEDOUT: 'Tempo esgotado ao conectar ao servidor Evolution',
};

// Erros de rede/TLS viram mensagens fixas: endereços e detalhes internos ficam só no console do servidor
function upstreamErrorMessage(err) {
  const code = String(err.code || '');
  if (SAFE_ERRORS[code]) return SAFE_ERRORS[code];
  if (/CERT|SELF_SIGNED|UNABLE_TO_(GET|VERIFY)/.test(code)) {
    return `Certificado HTTPS do servidor Evolution não é confiável (${code}). Corrija o certificado no servidor ou configure EVOLUTION_CA_FILE — conexões inseguras não são permitidas.`;
  }
  if (/^(ERR_SSL|EPROTO)/.test(code)) return 'Falha na negociação HTTPS com o servidor Evolution';
  return 'Falha ao contatar o servidor Evolution';
}

function requireConfig(res, needsGlobalKey) {
  if (!EVOLUTION_URL) {
    res.status(500).json({ error: 'EVOLUTION_URL não configurada no arquivo .env' });
    return false;
  }
  if (needsGlobalKey && !GLOBAL_API_KEY) {
    res.status(500).json({ error: 'GLOBAL_API_KEY não configurada no arquivo .env' });
    return false;
  }
  return true;
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// Serve só arquivos nomeados — express.static(__dirname) exporia server.js, .env e node_modules
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/phone.js', (req, res) => res.sendFile(path.join(__dirname, 'phone.js')));

app.get('/api/instances', async (req, res) => {
  if (!requireConfig(res, true)) return;
  try {
    const upstream = await proxyFetch(`${EVOLUTION_URL}/instance/all`, {
      headers: { apikey: GLOBAL_API_KEY },
    });
    if (upstream.status < 200 || upstream.status >= 300) {
      return res.status(upstream.status).json({ error: upstreamError(upstream) });
    }
    const body = upstream.body;
    const list = Array.isArray(body) ? body : body && Array.isArray(body.data) ? body.data : null;
    if (!list) return res.status(502).json({ error: 'Resposta inesperada do servidor Evolution ao listar instâncias' });
    res.json({ data: list.map(toPublicInstance).filter(Boolean) });
  } catch (err) {
    console.error('[instances]', err.code || '', err.message);
    res.status(502).json({ error: upstreamErrorMessage(err) });
  }
});

app.post('/api/send/text', async (req, res) => {
  if (!requireConfig(res, false)) return;

  const token = String(req.get('X-Instance-Token') || '').trim();
  const text = typeof (req.body && req.body.text) === 'string' ? req.body.text : '';

  if (!token) return res.status(401).json({ error: 'Token da instância não informado' });
  const phone = validatePhone(req.body && req.body.number);
  if (!phone.ok) return res.status(400).json({ error: `Telefone inválido: ${phone.error}` });
  if (!text.trim()) return res.status(400).json({ error: 'Mensagem vazia' });

  try {
    const upstream = await proxyFetch(`${EVOLUTION_URL}/send/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: token },
      body: JSON.stringify({ number: phone.number, text, delay: 0 }),
    });
    if (upstream.status < 200 || upstream.status >= 300) {
      return res.status(upstream.status).json({ error: upstreamError(upstream) });
    }
    const info = upstream.body && upstream.body.data && upstream.body.data.Info;
    res.json({ ok: true, messageId: info && typeof info.ID === 'string' ? info.ID : null });
  } catch (err) {
    console.error('[send/text]', err.code || '', err.message);
    res.status(502).json({ error: upstreamErrorMessage(err) });
  }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada' }));

const server = app.listen(PORT, HOST, () => {
  const local = LOOPBACK_HOSTS.has(HOST);
  console.log(`Disparador rodando em http://${local ? 'localhost' : HOST}:${PORT}`);
  if (!local) {
    console.warn(`⚠  HOST=${HOST}: o disparador fica acessível por outros aparelhos da rede, SEM login. Use só em rede confiável.`);
  }
  if (!EVOLUTION_URL) console.warn('⚠  EVOLUTION_URL não definida — copie .env.example para .env e preencha');
  else console.log(`Evolution Go: ${EVOLUTION_URL}`);
  if (!GLOBAL_API_KEY) console.warn('⚠  GLOBAL_API_KEY não definida — a listagem de instâncias não vai funcionar');
  if (EVOLUTION_CA_FILE) console.log('Certificados do Evolution verificados também contra EVOLUTION_CA_FILE');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`✖ A porta ${PORT} já está em uso — o disparador provavelmente já está aberto em outro terminal.`);
    console.error(`  Acesse http://localhost:${PORT}, feche o outro terminal ou mude PORT no .env.`);
    process.exit(1);
  }
  if (err.code === 'EADDRNOTAVAIL') {
    console.error(`✖ HOST=${HOST} não é um endereço desta máquina. Remova HOST do .env para usar o padrão (127.0.0.1).`);
    process.exit(1);
  }
  throw err;
});
