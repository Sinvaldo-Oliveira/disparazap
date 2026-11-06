import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import type { Duplex } from 'node:stream';

/**
 * Cliente WebSocket mínimo (RFC 6455), só de leitura, para os eventos da Evolution Go (HOMOLOGACAO_I0_EVOLUTION §6.2).
 * Próprio em vez do WebSocket nativo do Node porque precisamos: do código HTTP da recusa (401 → não insistir com a chave,
 * que a Evolution grava no log), do mesmo TLS sempre verificado do resto da API, de limite de tamanho por mensagem e de
 * sinal de vida (a Evolution não manda ping). A URL (que leva a chave global) nunca é registrada nem vai em erro.
 */

// Certificado sempre verificado, mesmo com NODE_TLS_REJECT_UNAUTHORIZED=0 no ambiente (regra do projeto)
const httpsAgent = new https.Agent({ rejectUnauthorized: true, keepAlive: false });
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export type WsCloseReason = 'closed' | 'auth_failed' | 'refused' | 'error' | 'timeout' | 'too_large';

export interface WsHandlers {
  onOpen(): void;
  onMessage(text: string): void;
  /** Chamado uma vez só, em qualquer fim (inclusive se a conexão nem abriu) */
  onClose(reason: WsCloseReason, httpStatus: number | null): void;
}

export interface WsOptions {
  connectTimeoutMs?: number;
  /** Sinal de vida (ping) e prazo da resposta (pong) */
  pingIntervalMs?: number;
  pongTimeoutMs?: number;
  /** Maior mensagem aceita (mídia em base64 vem dentro do evento) */
  maxMessageBytes?: number;
}

export interface WsConnection {
  close(): void;
}

/** Quadro do cliente para o servidor: sempre mascarado (RFC 6455 §5.3) */
export function clientFrame(opcode: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const mask = randomBytes(4);
  const length = payload.length;
  const header = length < 126 ? Buffer.from([0x80 | opcode, 0x80 | length]) : Buffer.from([0x80 | opcode, 0x80 | 126, length >> 8, length & 0xff]);
  const masked = Buffer.alloc(length);
  for (let i = 0; i < length; i += 1) masked[i] = (payload[i] as number) ^ (mask[i % 4] as number);
  return Buffer.concat([header, mask, masked]);
}

export function openWebSocket(url: URL, handlers: WsHandlers, options: WsOptions = {}): WsConnection {
  const { connectTimeoutMs = 15_000, pingIntervalMs = 30_000, pongTimeoutMs = 10_000, maxMessageBytes = 32 * 1024 * 1024 } = options;
  const secure = url.protocol === 'wss:';
  const key = randomBytes(16).toString('base64');
  let socket: Duplex | null = null;
  let finished = false;
  let buffer = Buffer.alloc(0);
  let fragments: Buffer[] = [];
  let fragmentsSize = 0;
  let pingTimer: NodeJS.Timeout | null = null;
  let pongTimer: NodeJS.Timeout | null = null;

  const finish = (reason: WsCloseReason, status: number | null = null, graceful = false) => {
    if (finished) return;
    finished = true;
    clearTimeout(connectTimer);
    if (pingTimer) clearInterval(pingTimer);
    if (pongTimer) clearTimeout(pongTimer);
    // Fechamento combinado: deixa o quadro de fechamento sair antes de encerrar
    if (graceful) socket?.end();
    else socket?.destroy();
    request.destroy();
    handlers.onClose(reason, status);
  };

  const request = (secure ? https : http).request({
    protocol: secure ? 'https:' : 'http:',
    hostname: url.hostname,
    port: url.port || (secure ? 443 : 80),
    path: `${url.pathname}${url.search}`,
    method: 'GET',
    headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key },
    ...(secure ? { agent: httpsAgent } : {}),
  });
  const connectTimer = setTimeout(() => finish('timeout'), connectTimeoutMs);

  // Resposta sem upgrade: 401 = chave recusada (não insistir); o resto = recusa do servidor
  request.on('response', (response) => {
    response.resume();
    finish(response.statusCode === 401 || response.statusCode === 403 ? 'auth_failed' : 'refused', response.statusCode ?? null);
  });
  // Erro de rede ou de TLS: sem a mensagem (pode trazer endereço)
  request.on('error', () => finish('error'));

  const send = (opcode: number, payload?: Buffer) => {
    if (!finished && socket?.writable) socket.write(clientFrame(opcode, payload));
  };

  function parse() {
    while (buffer.length >= 2) {
      const first = buffer[0] as number;
      const second = buffer[1] as number;
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        const big = buffer.readBigUInt64BE(2);
        if (big > BigInt(maxMessageBytes)) return finish('too_large');
        length = Number(big);
        offset = 10;
      }
      if (length > maxMessageBytes) return finish('too_large');
      const maskBytes = masked ? 4 : 0;
      if (buffer.length < offset + maskBytes + length) return;
      let payload = buffer.subarray(offset + maskBytes, offset + maskBytes + length);
      if (masked) {
        const mask = buffer.subarray(offset, offset + 4);
        payload = Buffer.from(payload.map((byte, i) => byte ^ (mask[i % 4] as number)));
      }
      buffer = buffer.subarray(offset + maskBytes + length);

      if (opcode === 0x8) {
        send(0x8);
        return finish('closed', null, true);
      }
      if (opcode === 0x9) {
        send(0xa, payload);
        continue;
      }
      if (opcode === 0xa) {
        if (pongTimer) clearTimeout(pongTimer);
        pongTimer = null;
        continue;
      }
      // Texto (1), binário (2, ignorado) e continuação (0)
      if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
        fragmentsSize += payload.length;
        if (fragmentsSize > maxMessageBytes) return finish('too_large');
        fragments.push(Buffer.from(payload));
        if (fin) {
          const whole = Buffer.concat(fragments);
          const isText = opcode === 0x1 || opcode === 0x0;
          fragments = [];
          fragmentsSize = 0;
          if (isText) handlers.onMessage(whole.toString('utf8'));
        }
      }
    }
  }

  request.on('upgrade', (response, upgraded, head) => {
    const expected = createHash('sha1').update(`${key}${GUID}`).digest('base64');
    socket = upgraded;
    if (response.headers['sec-websocket-accept'] !== expected) return finish('refused', response.statusCode ?? null);
    clearTimeout(connectTimer);
    upgraded.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      parse();
    });
    upgraded.on('close', () => finish('closed'));
    upgraded.on('error', () => finish('error'));
    pingTimer = setInterval(() => {
      if (pongTimer) return;
      send(0x9);
      pongTimer = setTimeout(() => finish('timeout'), pongTimeoutMs);
    }, pingIntervalMs);
    handlers.onOpen();
    if (head.length) {
      buffer = Buffer.concat([buffer, head]);
      parse();
    }
  });

  request.end();

  return {
    close() {
      if (finished) return;
      send(0x8);
      finish('closed', null, true);
    },
  };
}
