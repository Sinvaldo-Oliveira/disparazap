require('dotenv').config();

const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');

const EVOLUTION_URL = (process.env.EVOLUTION_URL || '').trim().replace(/\/+$/, '');
const GLOBAL_API_KEY = (process.env.GLOBAL_API_KEY || '').trim();
const PORT = Number(process.env.PORT) || 3000;

const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 30000;

// Aceita certificado autoassinado do servidor Evolution Go
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

/**
 * Requisição HTTP(S) usando só módulos nativos do Node.
 * Segue redirects (até 5 saltos); em 302/303 o método vira GET sem body.
 * Resolve com { status, body } — body já parseado como JSON quando possível.
 */
function proxyFetch(url, { method = 'GET', headers = {}, body } = {}, hops = 0) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      return reject(new Error(`URL inválida: ${url}`));
    }

    const isHttps = target.protocol === 'https:';
    const payload = body === undefined ? undefined : Buffer.from(body);
    const reqHeaders = { Accept: 'application/json', ...headers };
    if (payload) reqHeaders['Content-Length'] = payload.length;

    const req = (isHttps ? https : http).request(
      target,
      { method, headers: reqHeaders, agent: isHttps ? httpsAgent : undefined },
      (res) => {
        const { statusCode, headers: resHeaders } = res;

        if ([301, 302, 303, 307, 308].includes(statusCode) && resHeaders.location) {
          res.resume();
          if (hops >= MAX_REDIRECTS) {
            return reject(new Error('Excesso de redirecionamentos no servidor Evolution'));
          }
          const nextUrl = new URL(resHeaders.location, target).toString();
          const toGet = statusCode === 302 || statusCode === 303;
          const nextOpts = toGet
            ? { method: 'GET', headers: withoutContentHeaders(headers) }
            : { method, headers, body };
          return resolve(proxyFetch(nextUrl, nextOpts, hops + 1));
        }

        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed;
          try {
            parsed = text ? JSON.parse(text) : {};
          } catch {
            parsed = { message: text };
          }
          resolve({ status: statusCode, body: parsed });
        });
        res.on('error', reject);
      }
    );

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('Tempo esgotado aguardando o servidor Evolution'));
    });
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

// Remove tokens/chaves de cada instância antes de mandar a lista para o browser
const SENSITIVE_KEY = /token|apikey|api_key|secret|password/i;
function sanitizeInstance(inst) {
  if (!inst || typeof inst !== 'object') return inst;
  const out = {};
  for (const [k, v] of Object.entries(inst)) {
    if (!SENSITIVE_KEY.test(k)) out[k] = v;
  }
  return out;
}

function upstreamErrorMessage(err) {
  if (err.code === 'ECONNREFUSED') return 'Conexão recusada pelo servidor Evolution — verifique EVOLUTION_URL';
  if (err.code === 'ENOTFOUND') return 'Servidor Evolution não encontrado — verifique EVOLUTION_URL';
  return err.message || 'Falha ao contatar o servidor Evolution';
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

// Serve apenas o index.html — express.static(__dirname) exporia server.js, .env e node_modules
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/instances', async (req, res) => {
  if (!requireConfig(res, true)) return;
  try {
    const upstream = await proxyFetch(`${EVOLUTION_URL}/instance/all`, {
      headers: { apikey: GLOBAL_API_KEY },
    });
    const body = upstream.body;
    if (Array.isArray(body)) {
      return res.status(upstream.status).json(body.map(sanitizeInstance));
    }
    if (body && Array.isArray(body.data)) {
      return res.status(upstream.status).json({ ...body, data: body.data.map(sanitizeInstance) });
    }
    res.status(upstream.status).json(body);
  } catch (err) {
    console.error('[instances]', err.message);
    res.status(502).json({ error: upstreamErrorMessage(err) });
  }
});

app.post('/api/send/text', async (req, res) => {
  if (!requireConfig(res, false)) return;

  const token = String(req.get('X-Instance-Token') || '').trim();
  const number = String((req.body && req.body.number) || '').replace(/\D/g, '');
  const text = typeof (req.body && req.body.text) === 'string' ? req.body.text : '';

  if (!token) return res.status(401).json({ error: 'Token da instância não informado' });
  if (number.length < 10 || number.length > 15) {
    return res.status(400).json({ error: 'Número inválido — use DDI + DDD + número (10 a 15 dígitos)' });
  }
  if (!text.trim()) return res.status(400).json({ error: 'Mensagem vazia' });

  try {
    const upstream = await proxyFetch(`${EVOLUTION_URL}/send/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: token },
      body: JSON.stringify({ number, text, delay: 0 }),
    });
    res.status(upstream.status).json(upstream.body);
  } catch (err) {
    console.error('[send/text]', err.message);
    res.status(502).json({ error: upstreamErrorMessage(err) });
  }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada' }));

const server = app.listen(PORT, () => {
  console.log(`Disparador rodando em http://localhost:${PORT}`);
  if (!EVOLUTION_URL) console.warn('⚠  EVOLUTION_URL não definida — copie .env.example para .env e preencha');
  else console.log(`Evolution Go: ${EVOLUTION_URL}`);
  if (!GLOBAL_API_KEY) console.warn('⚠  GLOBAL_API_KEY não definida — a listagem de instâncias não vai funcionar');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`✖ A porta ${PORT} já está em uso — o disparador provavelmente já está aberto em outro terminal.`);
    console.error(`  Acesse http://localhost:${PORT}, feche o outro terminal ou mude PORT no .env.`);
    process.exit(1);
  }
  throw err;
});
