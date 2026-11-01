/**
 * Registro das filas que o worker consome. Vazio na Fase 4: o worker não processa campanhas,
 * não envia mensagens e não conecta ao Redis. Filas (BullMQ) entram com o motor de campanhas
 * (etapa 9 do plano), sempre com o PostgreSQL como fonte da verdade — ver docs/ARQUITETURA_SAAS.md §6.
 */
export interface QueueDefinition {
  readonly name: string;
}

export const queues: readonly QueueDefinition[] = [];
