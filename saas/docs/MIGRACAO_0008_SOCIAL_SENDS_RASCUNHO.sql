-- =====================================================================================================
-- RASCUNHO da migração 0008_social_sends — NÃO APLICADA.
-- Status: aguardando aprovação específica (Z3.1, seção 3). Não executar em desenvolvimento nem em produção sem ela.
-- Fora de packages/db/migrations de propósito: o servidor de desenvolvimento aplica tudo que estiver no _journal.json.
--
-- Pré-requisitos (verificar antes de aplicar):
--   1. Papel de aplicação "dz_app" existente (Supabase: criado pelo SQL de preparação, fora do Drizzle).
--   2. A aplicação precisa definir app.org_id por transação (set_config('app.org_id', <id>, true)) antes
--      das consultas. O código atual AINDA NÃO faz isso: sem essa etapa, com RLS forçada, a aplicação não
--      enxerga nenhuma linha em produção. Este é o bloqueio principal para aplicar em produção.
--   3. As tabelas de empresa já criadas (0002 a 0006) não têm RLS ainda: pendência separada, fora desta migração.
--
-- O que NÃO está aqui de propósito: texto de mensagem, credenciais, tokens, identificadores pessoais.
-- =====================================================================================================

-- Pré-verificação (roda antes de qualquer alteração): o papel dz_app vem da preparação inicial (SUPABASE_CONFIGURACAO §6.2), não desta migração.
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dz_app') THEN RAISE EXCEPTION 'Papel dz_app inexistente: execute antes a preparação de papéis (SUPABASE_CONFIGURACAO §6.2). Nada foi alterado.'; END IF; END $$;

-- Função de contexto da empresa (padrão de SUPABASE_CONFIGURACAO §RLS). Sem contexto, retorna NULL e nada é liberado.
CREATE OR REPLACE FUNCTION "app"."current_org_id"() RETURNS text
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, app
  AS $$ SELECT NULLIF(current_setting('app.org_id', true), '') $$;
REVOKE EXECUTE ON FUNCTION "app"."current_org_id"() FROM PUBLIC;
-- A política RLS chama esta função: sem EXECUTE para o papel da aplicação, a leitura falha com permissão negada
GRANT EXECUTE ON FUNCTION "app"."current_org_id"() TO "dz_app";

-- Registro local de envios para respostas humanas pelo Instagram.
-- Guarda só metadados: tamanho do texto (nunca o texto), estado, identificador do provedor e motivo fixo do erro.
CREATE TABLE "app"."inbox_social_sends" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "account_ref" text NOT NULL,
  "conversation_ref" text NOT NULL,
  "client_request_id" text NOT NULL,
  "actor_user_id" text,
  "text_length" integer NOT NULL,
  "window_mode" text NOT NULL,
  "status" text NOT NULL,
  "provider_message_id" text,
  "error_category" text,
  "attempts" integer NOT NULL DEFAULT 0,
  "reconciled_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "inbox_social_sends_org_fk" FOREIGN KEY ("organization_id") REFERENCES "identity"."organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "inbox_social_sends_actor_fk" FOREIGN KEY ("actor_user_id") REFERENCES "identity"."users"("id") ON DELETE SET NULL,
  CONSTRAINT "inbox_social_sends_status_check" CHECK ("status" IN ('pending', 'sent', 'failed', 'unknown')),
  CONSTRAINT "inbox_social_sends_window_check" CHECK ("window_mode" IN ('none', 'human_agent')),
  CONSTRAINT "inbox_social_sends_text_check" CHECK ("text_length" >= 0 AND "text_length" <= 1000),
  CONSTRAINT "inbox_social_sends_attempts_check" CHECK ("attempts" >= 0 AND "attempts" <= 5),
  CONSTRAINT "inbox_social_sends_provider_check" CHECK ("status" <> 'sent' OR "provider_message_id" IS NOT NULL)
);

-- Um pedido do painel = um registro por empresa (idempotência local). Mesmo requestId devolve o registro existente.
CREATE UNIQUE INDEX "inbox_social_sends_org_request_unique" ON "app"."inbox_social_sends" ("organization_id", "client_request_id");
CREATE INDEX "inbox_social_sends_org_created_idx" ON "app"."inbox_social_sends" ("organization_id", "created_at");
CREATE INDEX "inbox_social_sends_conversation_idx" ON "app"."inbox_social_sends" ("organization_id", "conversation_ref");
-- Pendências de reconciliação (estado unknown) para a tela de conferência
CREATE INDEX "inbox_social_sends_unknown_idx" ON "app"."inbox_social_sends" ("organization_id") WHERE "status" = 'unknown';

-- RLS habilitada e forçada, com uma política por operação (SUPABASE_CONFIGURACAO: "toda tabela de empresa")
ALTER TABLE "app"."inbox_social_sends" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."inbox_social_sends" FORCE ROW LEVEL SECURITY;
CREATE POLICY "inbox_social_sends_select" ON "app"."inbox_social_sends" FOR SELECT TO "dz_app" USING ("organization_id" = "app"."current_org_id"());
CREATE POLICY "inbox_social_sends_insert" ON "app"."inbox_social_sends" FOR INSERT TO "dz_app" WITH CHECK ("organization_id" = "app"."current_org_id"());
CREATE POLICY "inbox_social_sends_update" ON "app"."inbox_social_sends" FOR UPDATE TO "dz_app"
  USING ("organization_id" = "app"."current_org_id"()) WITH CHECK ("organization_id" = "app"."current_org_id"());
-- Sem DELETE para a aplicação: registros de envio são auditoria. Remoção só pela exclusão da empresa (cascata).

-- Nada concedido a PUBLIC, anon, authenticated ou service_role (checklist de SUPABASE_CONFIGURACAO)
REVOKE ALL ON TABLE "app"."inbox_social_sends" FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT SELECT, INSERT, UPDATE ON TABLE "app"."inbox_social_sends" TO "dz_app";

-- =====================================================================================================
-- ROLLBACK (0008_social_sends) — só se a migração tiver sido aplicada e precisar ser desfeita.
-- Não há dados de outras tabelas que dependam desta. Os envios registrados são perdidos, por isso o rollback
-- deve ser feito só depois de conferir com o administrador a lista de estados "unknown" e "pending".
--
--   DROP TABLE IF EXISTS "app"."inbox_social_sends";
--   -- Só se a função não for usada por nenhuma outra política (conferir antes):
--   -- DROP FUNCTION IF EXISTS "app"."current_org_id"();
-- =====================================================================================================
