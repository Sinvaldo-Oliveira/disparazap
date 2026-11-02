/**
 * Limite de pedidos em memória (janela deslizante). Suficiente para uma única instância da API;
 * com várias instâncias, precisará de armazenamento compartilhado (Redis, na fase das filas).
 */
export class RateLimiter {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #hits = new Map<string, number[]>();

  constructor(limit: number, windowMs: number) {
    this.#limit = limit;
    this.#windowMs = windowMs;
  }

  /** true se o pedido pode seguir; false se a chave já atingiu o limite na janela */
  allow(key: string, now = Date.now()): boolean {
    const since = now - this.#windowMs;
    const recent = (this.#hits.get(key) ?? []).filter((time) => time > since);
    if (recent.length >= this.#limit) {
      this.#hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.#hits.set(key, recent);
    // Limpeza simples para não crescer sem fim
    if (this.#hits.size > 10_000) {
      for (const [k, times] of this.#hits) if (!times.some((time) => time > since)) this.#hits.delete(k);
    }
    return true;
  }
}
