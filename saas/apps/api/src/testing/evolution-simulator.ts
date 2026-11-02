import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Evolution Go simulada (só para testes; fora do build de produção).
 * Rotas confirmadas no Swagger da versão instalada; formatos das respostas conferidos no código-fonte da Evolution Go
 * (pkg/instance e pkg/sendMessage): /instance/status sem o número, QR em data.qrcode/data.code, PairingCode,
 * envio com data.Info.ID e falhas de envio como HTTP 500 com {"error": "..."}.
 */
export interface SimInstance {
  id: string;
  name: string;
  token: string;
  state: 'idle' | 'qr' | 'connected';
  phone: string | null;
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
  omitIdOnCreate = false;
  server!: Server;
  url = '';

  private readonly globalKey: string;

  constructor(globalKey: string) {
    this.globalKey = globalKey;
  }

  async start() {
    this.server = createServer((req, res) => void this.handle(req).then(([status, body]) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))));
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop() {
    return new Promise((resolve) => this.server.close(resolve));
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
      return this.instances.delete(decodeURIComponent(deleteMatch[1] ?? '')) ? [200, { message: 'success' }] : [404, { error: 'not found' }];
    }

    const instance = this.byToken(req);
    if (!instance) return [401, { error: 'not authorized' }];
    if (req.method === 'POST' && path === '/instance/connect') {
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
