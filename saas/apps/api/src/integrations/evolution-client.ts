import http from 'node:http';
import https from 'node:https';
import type { ConnectionCheckStatus } from '@disparazap/contracts';

// Certificado sempre verificado, mesmo com NODE_TLS_REJECT_UNAUTHORIZED=0 no ambiente (regra do projeto)
const httpsAgent = new https.Agent({ rejectUnauthorized: true, keepAlive: false });

const MAX_BODY_BYTES = 1024 * 1024;

export interface HttpResponse {
  status: number;
  body: string;
}

/** GET simples, sem seguir redirecionamentos (a chave vai no cabeçalho) e com tempo-limite */
export function httpGet(url: URL, headers: Record<string, string>, timeoutMs: number): Promise<HttpResponse> {
  return httpRequest('GET', url, headers, undefined, timeoutMs);
}

/** Pedido HTTP com corpo JSON opcional, sem seguir redirecionamentos e com tempo-limite */
export function httpRequest(method: 'GET' | 'POST' | 'DELETE', url: URL, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<HttpResponse> {
  const transport = url.protocol === 'https:' ? https : http;
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method,
        headers: {
          accept: 'application/json',
          ...(payload !== undefined ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) } : {}),
          ...headers,
        },
        timeout: timeoutMs,
        ...(url.protocol === 'https:' ? { agent: httpsAgent } : {}),
      },
      (res) => {
        let size = 0;
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            req.destroy(Object.assign(new Error('resposta grande demais'), { code: 'DZ_BODY_TOO_LARGE' }));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('tempo esgotado'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end(payload);
  });
}

export interface ConnectionCheck {
  status: ConnectionCheckStatus;
  /** Mensagem fixa para a tela: nunca o corpo da Evolution, a URL ou a chave */
  detail: string;
  instances: number | null;
}

const TLS_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

export function networkFailure(err: unknown): ConnectionCheck {
  const code = (err as { code?: string }).code ?? '';
  if (TLS_CODES.has(code)) {
    return { status: 'unreachable', detail: 'O certificado HTTPS do servidor não é válido. A conexão foi recusada por segurança.', instances: null };
  }
  if (code === 'ETIMEDOUT') return { status: 'unreachable', detail: 'O servidor não respondeu a tempo.', instances: null };
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { status: 'unreachable', detail: 'O endereço do servidor não foi encontrado.', instances: null };
  if (code === 'ECONNREFUSED') return { status: 'unreachable', detail: 'O servidor recusou a conexão (está ligado nesse endereço?).', instances: null };
  if (code === 'DZ_BODY_TOO_LARGE') return { status: 'invalid_response', detail: 'A resposta do servidor foi grande demais.', instances: null };
  return { status: 'unreachable', detail: 'Não foi possível conectar ao servidor.', instances: null };
}

/**
 * Testa a integração global: GET {baseUrl}/instance/all com a chave global (mesma chamada que o MVP usa).
 * Só leitura: não cria nem altera nada na Evolution Go.
 */
export async function checkEvolutionConnection(baseUrl: string, apiKey: string, timeoutMs = 10_000): Promise<ConnectionCheck> {
  let response: HttpResponse;
  try {
    response = await httpGet(new URL(`${baseUrl}/instance/all`), { apikey: apiKey }, timeoutMs);
  } catch (err) {
    return networkFailure(err);
  }

  if (response.status === 401 || response.status === 403) {
    return { status: 'unauthorized', detail: 'A Evolution Go recusou a chave global. Confira a chave informada.', instances: null };
  }
  if (response.status >= 300 && response.status < 400) {
    return { status: 'error', detail: 'O servidor respondeu com um redirecionamento. Informe o endereço final da API.', instances: null };
  }
  if (response.status !== 200) {
    return { status: 'error', detail: `O servidor respondeu com o código HTTP ${response.status}.`, instances: null };
  }

  try {
    const parsed: unknown = JSON.parse(response.body);
    const data = (parsed as { data?: unknown }).data;
    if (Array.isArray(data)) {
      return { status: 'ok', detail: 'Conexão confirmada: a Evolution Go aceitou a chave global.', instances: data.length };
    }
  } catch {
    // corpo não-JSON: cai na mensagem abaixo
  }
  return { status: 'invalid_response', detail: 'O servidor respondeu, mas não no formato da Evolution Go. Confira o endereço.', instances: null };
}
