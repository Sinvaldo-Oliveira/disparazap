import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';

/**
 * Evolution Go simulada (só para testes; fora do build de produção).
 * Rotas confirmadas no Swagger da versão instalada; formatos das respostas conferidos no código-fonte da Evolution Go
 * (pkg/instance e pkg/sendMessage): /instance/status sem o número, QR em data.qrcode/data.code, PairingCode,
 * envio com data.Info.ID e falhas de envio como HTTP 500 com {"error": "..."}.
 * WebSocket /ws como no código das versões 0.6.1 a 0.7.2 (HOMOLOGACAO_I0_EVOLUTION §5): só a chave global no `token`,
 * 401 sem upgrade quando ela é outra, entrega só das instâncias com `websocketEnable = "enabled"` e evento no `subscribe`,
 * mensagem `{queue, payload}` com o payload em texto JSON levando `instanceToken`.
 */
export interface SimInstance {
  id: string;
  name: string;
  token: string;
  state: 'idle' | 'qr' | 'connected';
  phone: string | null;
  /** Configuração de eventos gravada pelo /instance/connect */
  websocket?: boolean;
  subscribe?: string[];
}

/** Categoria do `subscribe` de cada evento (pkg/events) */
const EVENT_CATEGORY: Readonly<Record<string, string>> = {
  Message: 'MESSAGE',
  SendMessage: 'SEND_MESSAGE',
  Receipt: 'READ_RECEIPT',
  Connected: 'CONNECTION',
  Disconnected: 'CONNECTION',
  LoggedOut: 'CONNECTION',
};

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function serverFrame(opcode: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const length = payload.length;
  let header: Buffer;
  if (length < 126) header = Buffer.from([0x80 | opcode, length]);
  else if (length < 65_536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

interface WsClient {
  socket: Duplex;
  /** Modo por instância (instanceId na URL) ou difusão (null) */
  instanceId: string | null;
  buffer: Buffer;
}

export interface SentMessage {
  instance: string;
  number: string;
  text: string;
}

export class EvolutionSimulator {
  readonly instances = new Map<string, SimInstance>();
  readonly sent: SentMessage[] = [];
  /** Imagens recebidas em /send/media (base64 e legenda) */
  readonly sentMedia: { instance: string; number: string; base64: string; caption: string }[] = [];
  /** Números "sem WhatsApp": o envio responde 500 "is not registered on WhatsApp" */
  readonly unregistered = new Set<string>();
  failNextCreate = false;
  /** A próxima exclusão responde 500 (a instância continua no servidor) */
  failNextDelete = false;
  omitIdOnCreate = false;
  server!: Server;
  url = '';
  /** Corpos recebidos em /instance/connect, por instância (o teste confere que nada foi ligado sozinho) */
  readonly connectCalls: { instance: string; body: Record<string, unknown> }[] = [];
  /** Pedidos de WebSocket: aceitos e recusados (sem guardar a chave) */
  readonly ws = { accepted: 0, rejected: 0, pongs: 0 };
  readonly #wsClients = new Set<WsClient>();

  private globalKey: string;

  constructor(globalKey: string) {
    this.globalKey = globalKey;
  }

  async start() {
    this.server = createServer((req, res) => void this.handle(req).then(([status, body]) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))));
    this.server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => this.#upgrade(req, socket, head));
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop() {
    this.dropWsConnections();
    return new Promise((resolve) => this.server.close(resolve));
  }

  /** Troca a chave global do servidor (a guardada no DisparaZap passa a ser recusada) */
  rotateGlobalKey(key: string) {
    this.globalKey = key;
  }

  get wsClientCount() {
    return this.#wsClients.size;
  }

  /** Queda abrupta de todas as conexões WebSocket (rede, reinício do servidor) */
  dropWsConnections() {
    for (const client of this.#wsClients) client.socket.destroy();
    this.#wsClients.clear();
  }

  /** Fechamento combinado pelo servidor (quadro de fechamento) */
  closeWsConnections() {
    for (const client of this.#wsClients) client.socket.write(serverFrame(0x8, Buffer.from([0x03, 0xe8])));
  }

  /** Manda ping para os clientes (o cliente deve responder pong) */
  pingWsClients() {
    for (const client of this.#wsClients) client.socket.write(serverFrame(0x9, Buffer.from('vivo')));
  }

  /**
   * Evento de uma instância, como a Evolution distribui: só se a instância tiver WebSocket ligado e o evento no subscribe
   * (`force` ignora a configuração, para simular instâncias de fora do DisparaZap). Devolve quantos clientes receberam.
   */
  emit(name: string, event: string, data: unknown, options: { state?: string; force?: boolean; instanceToken?: string | null } = {}): number {
    const instance = this.byName(name);
    if (!instance) return 0;
    const category = EVENT_CATEGORY[event] ?? event.toUpperCase();
    if (!options.force && (!instance.websocket || !(instance.subscribe ?? []).includes(category))) return 0;
    const payload: Record<string, unknown> = { event, data, instanceId: instance.id, instanceName: instance.name };
    if (options.instanceToken !== null) payload.instanceToken = options.instanceToken ?? instance.token;
    if (options.state) payload.state = options.state;
    return this.emitRaw(JSON.stringify({ queue: `${instance.id}.${category}`, payload: JSON.stringify(payload) }), instance.id);
  }

  /** Texto qualquer para os clientes (mensagens inválidas) */
  emitRaw(text: string, instanceId: string | null = null): number {
    let delivered = 0;
    for (const client of this.#wsClients) {
      if (client.instanceId && client.instanceId !== instanceId) continue;
      client.socket.write(serverFrame(0x1, Buffer.from(text, 'utf8')));
      delivered += 1;
    }
    return delivered;
  }

  #upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const url = new URL(req.url ?? '/', 'http://simulador');
    const key = req.headers['sec-websocket-key'];
    if (url.pathname !== '/ws' || typeof key !== 'string') {
      socket.end('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    // Como a Evolution: só a chave global abre o WebSocket; o resto é 401 sem upgrade
    if (url.searchParams.get('token') !== this.globalKey) {
      this.ws.rejected += 1;
      socket.end('HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: 26\r\n\r\n{"error":"not authorized"}');
      return;
    }
    this.ws.accepted += 1;
    const accept = createHash('sha1').update(`${key}${WS_GUID}`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const client: WsClient = { socket, instanceId: url.searchParams.get('instanceId'), buffer: Buffer.alloc(0) };
    this.#wsClients.add(client);
    socket.on('data', (chunk: Buffer) => {
      client.buffer = Buffer.concat([client.buffer, chunk]);
      this.#readClientFrames(client);
    });
    socket.on('close', () => this.#wsClients.delete(client));
    socket.on('error', () => this.#wsClients.delete(client));
    if (head.length) {
      client.buffer = Buffer.concat([client.buffer, head]);
      this.#readClientFrames(client);
    }
  }

  /** Quadros do cliente (sempre mascarados): fechamento é respondido, ping vira pong */
  #readClientFrames(client: WsClient) {
    while (client.buffer.length >= 2) {
      const opcode = (client.buffer[0] as number) & 0x0f;
      const second = client.buffer[1] as number;
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (client.buffer.length < 4) return;
        length = client.buffer.readUInt16BE(2);
        offset = 4;
      }
      const masked = (second & 0x80) !== 0;
      const total = offset + (masked ? 4 : 0) + length;
      if (client.buffer.length < total) return;
      const mask = masked ? client.buffer.subarray(offset, offset + 4) : null;
      const payload = Buffer.from(client.buffer.subarray(total - length, total).map((byte, i) => (mask ? byte ^ (mask[i % 4] as number) : byte)));
      client.buffer = client.buffer.subarray(total);
      if (opcode === 0x8) {
        client.socket.end(serverFrame(0x8));
        this.#wsClients.delete(client);
        return;
      }
      if (opcode === 0x9) client.socket.write(serverFrame(0xa, payload));
      if (opcode === 0xa) this.ws.pongs += 1;
    }
  }

  byName(name: string) {
    return [...this.instances.values()].find((item) => item.name === name);
  }

  /** Simula o celular lendo o QR Code (ou digitando o código) */
  scan(name: string, phone = '5511988887777') {
    const instance = this.byName(name);
    if (instance) Object.assign(instance, { state: 'connected', phone });
  }

  /** Simula a queda da conexão do celular */
  drop(name: string) {
    const instance = this.byName(name);
    if (instance) Object.assign(instance, { state: 'idle' });
  }

  private byToken(req: IncomingMessage) {
    return [...this.instances.values()].find((item) => item.token === req.headers.apikey);
  }

  // Modelo Instance (pkg/instance/model): inclui token e qrcode, que o DisparaZap nunca pode repassar
  private model(instance: SimInstance) {
    return {
      id: instance.id,
      name: instance.name,
      token: instance.token,
      jid: instance.phone ? `${instance.phone}:7@s.whatsapp.net` : '',
      qrcode: instance.state === 'qr' ? '2@simulado|data:image/png;base64,UVJTSU1VTEFETw==' : '',
      connected: instance.state === 'connected',
      disconnect_reason: '',
    };
  }

  private async handle(req: IncomingMessage): Promise<[number, unknown]> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    const path = req.url ?? '';
    const global = req.headers.apikey === this.globalKey;

    if (req.method === 'POST' && path === '/instance/create') {
      if (!global) return [401, { error: 'not authorized' }];
      if (this.failNextCreate) {
        this.failNextCreate = false;
        return [500, { error: 'falha interna simulada', detalheSecreto: 'nao-deve-vazar' }];
      }
      const instance: SimInstance = { id: randomUUID(), name: body.name, token: body.token, state: 'idle', phone: null };
      this.instances.set(instance.id, instance);
      const created = this.model(instance);
      if (this.omitIdOnCreate) delete (created as Partial<typeof created>).id;
      return [200, { message: 'success', data: created }];
    }
    if (req.method === 'GET' && path === '/instance/all') {
      if (!global) return [401, { error: 'not authorized' }];
      return [200, { message: 'success', data: [...this.instances.values()].map((item) => this.model(item)) }];
    }
    const infoMatch = /^\/instance\/info\/(.+)$/.exec(path);
    if (req.method === 'GET' && infoMatch) {
      if (!global) return [401, { error: 'not authorized' }];
      const instance = this.instances.get(decodeURIComponent(infoMatch[1] ?? ''));
      return instance ? [200, { message: 'success', data: this.model(instance) }] : [404, { error: 'instance not found' }];
    }
    const deleteMatch = /^\/instance\/delete\/(.+)$/.exec(path);
    if (req.method === 'DELETE' && deleteMatch) {
      if (!global) return [401, { error: 'not authorized' }];
      if (this.failNextDelete) {
        this.failNextDelete = false;
        return [500, { error: 'falha simulada na exclusão' }];
      }
      return this.instances.delete(decodeURIComponent(deleteMatch[1] ?? '')) ? [200, { message: 'success' }] : [404, { error: 'not found' }];
    }

    const instance = this.byToken(req);
    if (!instance) return [401, { error: 'not authorized' }];
    if (req.method === 'POST' && path === '/instance/connect') {
      this.connectCalls.push({ instance: instance.name, body });
      // UpdateInstanceSettings: grava a configuração de eventos; corpo vazio volta ao padrão (só MESSAGE, sem WebSocket)
      instance.websocket = body.websocketEnable === 'enabled';
      instance.subscribe = Array.isArray(body.subscribe) && body.subscribe.length ? body.subscribe.map(String) : ['MESSAGE'];
      if (instance.state !== 'connected') instance.state = 'qr';
      return [200, { message: 'success', data: { jid: '', webhookUrl: '', eventString: '' } }];
    }
    if (req.method === 'GET' && path === '/instance/qr') {
      if (instance.state !== 'qr') return [400, { error: 'no QR code available. Please wait a moment and try again' }];
      return [200, { message: 'success', data: { qrcode: '2@simulado', code: 'data:image/png;base64,UVJTSU1VTEFETw==' } }];
    }
    if (req.method === 'POST' && path === '/instance/pair') return [200, { message: 'success', data: { PairingCode: 'ABCD1234' } }];
    if (req.method === 'GET' && path === '/instance/status') {
      const connected = instance.state === 'connected';
      return [200, { message: 'success', data: { Connected: connected, LoggedIn: connected, Name: connected ? 'Celular de teste' : '' } }];
    }
    if (req.method === 'DELETE' && path === '/instance/logout') {
      Object.assign(instance, { state: 'idle', phone: null });
      return [200, { message: 'success' }];
    }
    if (req.method === 'POST' && path === '/send/media') {
      if (instance.state !== 'connected') return [500, { error: 'no active session found' }];
      const url = String(body.url ?? '');
      // Como a Evolution: o que não começa com http(s) é lido como base64 puro (um "data:" falharia aqui)
      if (!/^https?:\/\//.test(url) && !/^[A-Za-z0-9+/]+={0,2}$/.test(url)) return [400, { error: 'invalid base64 encoding' }];
      if (body.type !== 'image') return [500, { error: 'invalid media type' }];
      this.sentMedia.push({ instance: instance.name, number: String(body.number ?? ''), base64: url, caption: String(body.caption ?? '') });
      return [200, { message: 'success', data: { Info: { ID: `3EB1${this.sentMedia.length.toString().padStart(6, '0')}` }, Message: {} } }];
    }
    if (req.method === 'POST' && path === '/send/text') {
      if (instance.state !== 'connected') return [500, { error: 'no active session found' }];
      const number = String(body.number ?? '');
      if (this.unregistered.has(number)) return [500, { error: `number ${number} is not registered on WhatsApp` }];
      this.sent.push({ instance: instance.name, number, text: String(body.text ?? '') });
      return [200, { message: 'success', data: { Info: { ID: `3EB0${this.sent.length.toString().padStart(6, '0')}` }, Message: { conversation: body.text } } }];
    }
    return [404, { error: 'not found' }];
  }
}
