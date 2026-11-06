import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { InboxReceptionState } from '@disparazap/contracts';
import { inboxConversations, inboxReceptionGaps, integrationCredentials, whatsappInstances, type AppDatabase } from '@disparazap/db';
import { openWebSocket, type WsCloseReason, type WsConnection, type WsOptions } from '../integrations/ws-client.ts';
import { resolveEvolutionIntegration, type ResolvedIntegration } from '../platform/evolution-settings.ts';
import type { Vault } from '../security/vault.ts';
import type { InboxBus } from './inbox-bus.ts';
import { ingestEvolutionEvent, type AccountRef } from './inbox-ingest.ts';

/**
 * Consumidor dos eventos da Evolution Go para a Inbox (HOMOLOGACAO_I0_EVOLUTION §6.2):
 * - uma conexão em modo difusão por servidor (o modo por instância pode ficar "mudo" depois de reconectar, §5.1);
 * - só aceita eventos de instâncias registradas no DisparaZap, não excluídas e com a Inbox ligada (o resto é descartado
 *   antes de gravar ou avisar, sem registrar nada do conteúdo);
 * - confere o instanceToken do evento com o token do cofre e o descarta;
 * - registra lacunas (períodos sem recebimento), reconecta com espera crescente e NÃO insiste com chave recusada
 *   (a Evolution grava token inválido no log em texto puro): espera a chave mudar em Configurações.
 * A URL (que leva a chave global) e o conteúdo dos eventos nunca vão para o log.
 */

export interface StreamLogger {
  info(data: Record<string, unknown>, message: string): void;
  warn(data: Record<string, unknown>, message: string): void;
}

export interface EvolutionEventStreamOptions {
  db: AppDatabase;
  vault: Vault | null;
  bus: InboxBus;
  logger: StreamLogger;
  /** Espera entre tentativas: começa em min e dobra até max (com variação) */
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
  /** Releitura das instâncias autorizadas e da integração (chave trocada, servidor desligado) */
  refreshMs?: number;
  ws?: WsOptions;
  /** Os testes trocam a resolução da integração */
  resolveIntegration?: () => Promise<ResolvedIntegration>;
}

interface Authorized {
  account: AccountRef;
  credentialId: string | null;
}

const VAULT_TOKEN_CONTEXT = (instanceId: string) => `evolution_go:instance_token:${instanceId}`;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

type Json = Record<string, unknown>;
const asObject = (value: unknown): Json | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null);

export class EvolutionEventStream {
  readonly #options: Required<Omit<EvolutionEventStreamOptions, 'ws' | 'resolveIntegration' | 'vault'>> & Pick<EvolutionEventStreamOptions, 'ws' | 'vault'>;
  readonly #resolve: () => Promise<ResolvedIntegration>;
  #state: InboxReceptionState = 'connecting';
  #since: Date | null = null;
  #connection: WsConnection | null = null;
  #connecting = false;
  #stopped = true;
  #timer: NodeJS.Timeout | null = null;
  #refreshTimer: NodeJS.Timeout | null = null;
  #attempt = 0;
  #serverId: string | null = null;
  /** Hash da chave recusada: não tenta de novo enquanto a chave for a mesma */
  #refusedKeyHash: string | null = null;
  #authorized = new Map<string, Authorized>();
  readonly #tokens = new Map<string, string>();
  #queue: Promise<void> = Promise.resolve();
  /** Contadores para diagnóstico e testes (sem conteúdo) */
  readonly stats = { received: 0, ingested: 0, dropped: 0, rejectedToken: 0, invalid: 0 };

  constructor(options: EvolutionEventStreamOptions) {
    this.#options = { reconnectMinMs: 1000, reconnectMaxMs: 60_000, refreshMs: 30_000, ...options };
    this.#resolve = options.resolveIntegration ?? (() => resolveEvolutionIntegration(options.db, options.vault));
  }

  get state(): InboxReceptionState {
    return this.#state;
  }

  get since(): Date | null {
    return this.#since;
  }

  start() {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#refreshTimer = setInterval(() => void this.#refresh(), this.#options.refreshMs);
    void this.#connect();
  }

  /** Para de receber; as contas autorizadas ficam com a lacuna aberta até a próxima conexão */
  async stop() {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    if (this.#refreshTimer) clearInterval(this.#refreshTimer);
    const wasConnected = this.#state === 'connected';
    this.#connection?.close();
    this.#connection = null;
    await this.#queue;
    if (wasConnected) await this.#openGaps('disconnected').catch(() => undefined);
    this.#setState('disabled');
  }

  /** Espera os eventos já recebidos terminarem de gravar (testes) */
  async idle() {
    await this.#queue;
  }

  /** Relê as instâncias autorizadas agora (ligar ou desligar a Inbox numa instância) */
  async refreshAuthorized() {
    if (!this.#serverId) return;
    const rows = await this.#options.db
      .select({ id: whatsappInstances.id, organizationId: whatsappInstances.organizationId, providerInstanceId: whatsappInstances.providerInstanceId, credentialId: whatsappInstances.credentialId })
      .from(whatsappInstances)
      .where(and(eq(whatsappInstances.providerServerId, this.#serverId), isNull(whatsappInstances.deletedAt), isNotNull(whatsappInstances.inboxEnabledAt), isNotNull(whatsappInstances.providerInstanceId)));
    const next = new Map<string, Authorized>();
    for (const row of rows) next.set(row.providerInstanceId as string, { account: { organizationId: row.organizationId, accountId: row.id }, credentialId: row.credentialId });
    this.#authorized = next;
    for (const key of [...this.#tokens.keys()]) if (!next.has(key)) this.#tokens.delete(key);
  }

  #setState(state: InboxReceptionState) {
    if (this.#state === state) return;
    this.#state = state;
    this.#since = new Date();
    this.#options.bus.publishReception();
  }

  async #refresh() {
    if (this.#stopped) return;
    try {
      await this.refreshAuthorized();
      // Chave recusada: tenta de novo só quando a chave guardada mudar
      if (this.#state === 'auth_failed' || this.#state === 'unavailable') {
        const integration = await this.#resolve();
        if (integration.state === 'ready' && sha256(integration.globalKey) !== this.#refusedKeyHash && !this.#connection) void this.#connect();
      }
    } catch {
      // Banco indisponível por um instante: fica para a próxima rodada
    }
  }

  #schedule() {
    if (this.#stopped) return;
    const base = Math.min(this.#options.reconnectMaxMs, this.#options.reconnectMinMs * 2 ** Math.min(this.#attempt, 10));
    const delay = Math.round(base * (0.75 + Math.random() * 0.5));
    this.#attempt += 1;
    this.#timer = setTimeout(() => void this.#connect(), delay);
  }

  async #connect() {
    // Uma conexão por vez: a releitura periódica e a espera de reconexão podem chamar juntas
    if (this.#stopped || this.#connection || this.#connecting) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#connecting = true;
    try {
      await this.#open();
    } finally {
      this.#connecting = false;
    }
  }

  async #open() {
    let integration: ResolvedIntegration;
    try {
      integration = await this.#resolve();
    } catch {
      this.#setState('unavailable');
      return this.#schedule();
    }
    if (integration.state !== 'ready') {
      this.#setState('unavailable');
      return;
    }
    const keyHash = sha256(integration.globalKey);
    if (keyHash === this.#refusedKeyHash) {
      this.#setState('auth_failed');
      return;
    }
    this.#serverId = integration.serverId;
    await this.refreshAuthorized().catch(() => undefined);

    // Modo difusão: sem instanceId. A chave vai só aqui, nunca em log
    let url: URL;
    try {
      url = new URL(`${integration.baseUrl}/ws`);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('token', integration.globalKey);
    } catch {
      this.#setState('unavailable');
      return;
    }
    if (this.#state !== 'reconnecting') this.#setState('connecting');
    this.#connection = openWebSocket(
      url,
      {
        onOpen: () => {
          this.#attempt = 0;
          this.#refusedKeyHash = null;
          this.#setState('connected');
          this.#options.logger.info({ acao: 'inbox.recebimento.conectado', instancias: this.#authorized.size }, 'Inbox: recebendo eventos da Evolution');
          void this.#closeGaps().catch(() => undefined);
        },
        onMessage: (text) => {
          this.stats.received += 1;
          this.#queue = this.#queue.then(() => this.#handle(text)).catch(() => {
            this.stats.invalid += 1;
          });
        },
        onClose: (reason, httpStatus) => void this.#closed(reason, httpStatus, keyHash),
      },
      this.#options.ws,
    );
  }

  async #closed(reason: WsCloseReason, httpStatus: number | null, keyHash: string) {
    const wasConnected = this.#state === 'connected';
    this.#connection = null;
    if (this.#stopped) return;
    this.#options.logger.warn({ acao: 'inbox.recebimento.queda', motivo: reason, status: httpStatus }, 'Inbox: conexão com a Evolution encerrada');
    if (reason === 'auth_failed') {
      // Nunca repetir com a mesma chave: a Evolution grava o token recusado no log
      this.#refusedKeyHash = keyHash;
      await this.#openGaps('auth_failed').catch(() => undefined);
      this.#setState('auth_failed');
      return;
    }
    if (wasConnected) await this.#openGaps(reason === 'closed' ? 'disconnected' : 'error').catch(() => undefined);
    this.#setState('reconnecting');
    this.#schedule();
  }

  /** Abre uma lacuna para cada conta autorizada que ainda não tem uma aberta */
  async #openGaps(reason: 'disconnected' | 'auth_failed' | 'error') {
    const accounts = [...this.#authorized.values()].map((item) => item.account);
    if (!accounts.length) return;
    const open = await this.#options.db
      .select({ accountId: inboxReceptionGaps.accountId })
      .from(inboxReceptionGaps)
      .where(and(inArray(inboxReceptionGaps.accountId, accounts.map((item) => item.accountId)), isNull(inboxReceptionGaps.endedAt)));
    const already = new Set(open.map((row) => row.accountId));
    const now = new Date();
    const rows = accounts.filter((item) => !already.has(item.accountId)).map((item) => ({ id: randomUUID(), organizationId: item.organizationId, accountId: item.accountId, startedAt: now, reason }));
    if (rows.length) await this.#options.db.insert(inboxReceptionGaps).values(rows);
  }

  async #closeGaps() {
    const ids = [...this.#authorized.values()].map((item) => item.account.accountId);
    if (!ids.length) return;
    await this.#options.db.update(inboxReceptionGaps).set({ endedAt: new Date() }).where(and(inArray(inboxReceptionGaps.accountId, ids), isNull(inboxReceptionGaps.endedAt)));
  }

  async #tokenOf(instanceId: string, entry: Authorized): Promise<string | null> {
    const cached = this.#tokens.get(instanceId);
    if (cached) return cached;
    const vault = this.#options.vault;
    if (!vault || !entry.credentialId) return null;
    const [credential] = await this.#options.db.select().from(integrationCredentials).where(eq(integrationCredentials.id, entry.credentialId)).limit(1);
    if (!credential || credential.revokedAt) return null;
    const token = vault.open(credential, VAULT_TOKEN_CONTEXT(entry.account.accountId));
    this.#tokens.set(instanceId, token);
    return token;
  }

  async #handle(text: string) {
    let outer: Json | null;
    let payload: Json | null;
    try {
      outer = asObject(JSON.parse(text));
      payload = asObject(typeof outer?.payload === 'string' ? JSON.parse(outer.payload) : outer?.payload);
    } catch {
      this.stats.invalid += 1;
      return;
    }
    const instanceId = typeof payload?.instanceId === 'string' ? payload.instanceId : null;
    const entry = instanceId ? this.#authorized.get(instanceId) : undefined;
    // Instância desconhecida (MVP, outro sistema, Inbox desligada): descartada antes de gravar ou avisar
    if (!payload || !instanceId || !entry) {
      this.stats.dropped += 1;
      return;
    }
    const received = typeof payload.instanceToken === 'string' ? payload.instanceToken : null;
    if (received !== null) {
      const expected = await this.#tokenOf(instanceId, entry).catch(() => null);
      const a = Buffer.from(received);
      const b = Buffer.from(expected ?? '');
      if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) {
        this.stats.rejectedToken += 1;
        this.#options.logger.warn({ acao: 'inbox.evento_recusado', motivo: 'token_da_instancia', empresa: entry.account.organizationId }, 'Inbox: evento com token de instância diferente do cofre');
        return;
      }
    }
    const event = typeof payload.event === 'string' ? payload.event : '';
    const changed = await ingestEvolutionEvent(this.#options.db, entry.account, { event, data: payload.data, state: payload.state });
    if (!changed.length) return;
    this.stats.ingested += 1;
    const rows = await this.#options.db
      .select({ id: inboxConversations.id, assignedUserId: inboxConversations.assignedUserId })
      .from(inboxConversations)
      .where(and(eq(inboxConversations.organizationId, entry.account.organizationId), inArray(inboxConversations.id, changed)));
    for (const row of rows) this.#options.bus.publish({ organizationId: entry.account.organizationId, type: 'conversation', conversationId: row.id, assignedUserId: row.assignedUserId });
  }
}
