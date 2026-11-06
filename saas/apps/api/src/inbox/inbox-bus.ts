/**
 * Barramento interno da Inbox (plano §E.6/E.7): avisa o que mudou, por empresa, para o canal em tempo real (SSE) e, no
 * futuro, para IA e automações. Em memória: serve a um processo (Hostinger). Nunca carrega conteúdo de mensagem.
 */
export interface InboxBusEvent {
  organizationId: string;
  type: 'conversation' | 'reception';
  conversationId: string | null;
  /** Responsável da conversa: o atendente só recebe as dele e as sem responsável */
  assignedUserId: string | null;
}

type Listener = (event: InboxBusEvent) => void;

export class InboxBus {
  readonly #listeners = new Map<string, Set<Listener>>();

  subscribe(organizationId: string, listener: Listener): () => void {
    const set = this.#listeners.get(organizationId) ?? new Set<Listener>();
    set.add(listener);
    this.#listeners.set(organizationId, set);
    return () => {
      set.delete(listener);
      if (!set.size) this.#listeners.delete(organizationId);
    };
  }

  publish(event: InboxBusEvent) {
    for (const listener of this.#listeners.get(event.organizationId) ?? []) {
      try {
        listener(event);
      } catch {
        // Um painel com problema não derruba os outros
      }
    }
  }

  /** Mudança no recebimento (conectado, reconectando…): todas as empresas que estão com a Inbox aberta */
  publishReception() {
    for (const organizationId of this.#listeners.keys()) this.publish({ organizationId, type: 'reception', conversationId: null, assignedUserId: null });
  }

  listenerCount(organizationId?: string): number {
    if (organizationId) return this.#listeners.get(organizationId)?.size ?? 0;
    return [...this.#listeners.values()].reduce((sum, set) => sum + set.size, 0);
  }
}
