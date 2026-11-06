-- =====================================================================================================
-- RASCUNHO — isolamento por empresa (RLS) nas tabelas que já existem em produção.
-- NÃO EXECUTADO. Não colocar em packages/db/migrations sem aprovação do dono do produto.
--
-- Pré-requisitos (todos verificados antes de rodar):
--   1. preparação de papéis executada (PREPARACAO_PAPEIS_RASCUNHO.sql): dz_app, dz_migrator e o GRANT ao postgres.
--   2. Consulta de estado conferida: 23 tabelas com dono postgres; RLS ativo e NÃO forçado; 17 com organization_id text.
--   3. Autorização explícita para alterar donos e políticas em PRODUÇÃO.
--
-- O que este script faz (tudo numa transação):
--   A. Transfere o dono dos 3 esquemas e das 23 tabelas para dz_migrator (migrações passam a funcionar).
--   B. Cria app.current_org_id() (mesma definição de MIGRACAO_0008) e políticas por empresa para dz_app
--      nas 17 tabelas com organization_id.
--   C. Concede só o necessário a dz_app e retira tudo de PUBLIC, anon, authenticated e service_role.
--
-- O que este script NÃO faz (de propósito):
--   - NÃO usa FORCE ROW LEVEL SECURITY. Forçar agora derrubaria o acesso de quem ainda usa o dono.
--     Só depois de a API trocar a conexão para dz_app e enviar app.org_id em cada requisição.
--   - NÃO mexe em identity.users, identity.accounts, identity.sessions, identity.verifications,
--     identity.organizations e platform.provider_servers (globais: login, sessões, a própria empresa
--     ou a plataforma). Eles têm outro tratamento (ver seção "Pendências" no fim).
--   - NÃO troca a conexão da aplicação. Isso é uma etapa separada.
--
-- Efeito esperado nesta execução, para quem conecta como postgres: nada muda na leitura, porque o dono
-- ignora RLS enquanto não estiver forçado. Quem conecta como dz_app passa a ver só a própria empresa.
-- =====================================================================================================

BEGIN;

-- ---------------------------------------------------------------------------------------------------
-- A. Donos: esquemas e tabelas passam a ser do dz_migrator
-- ---------------------------------------------------------------------------------------------------
ALTER SCHEMA "identity" OWNER TO "dz_migrator";
ALTER SCHEMA "app" OWNER TO "dz_migrator";
ALTER SCHEMA "platform" OWNER TO "dz_migrator";

ALTER TABLE "app"."contact_lists" OWNER TO "dz_migrator";
ALTER TABLE "app"."contacts" OWNER TO "dz_migrator";
ALTER TABLE "app"."inbox_contact_identities" OWNER TO "dz_migrator";
ALTER TABLE "app"."inbox_contacts" OWNER TO "dz_migrator";
ALTER TABLE "app"."inbox_conversation_events" OWNER TO "dz_migrator";
ALTER TABLE "app"."inbox_conversations" OWNER TO "dz_migrator";
ALTER TABLE "app"."inbox_messages" OWNER TO "dz_migrator";
ALTER TABLE "app"."inbox_pending_receipts" OWNER TO "dz_migrator";
ALTER TABLE "app"."inbox_reception_gaps" OWNER TO "dz_migrator";
ALTER TABLE "app"."media_files" OWNER TO "dz_migrator";
ALTER TABLE "app"."message_templates" OWNER TO "dz_migrator";
ALTER TABLE "app"."social_posts" OWNER TO "dz_migrator";
ALTER TABLE "app"."whatsapp_instances" OWNER TO "dz_migrator";
ALTER TABLE "app"."zernio_connections" OWNER TO "dz_migrator";
ALTER TABLE "identity"."accounts" OWNER TO "dz_migrator";
ALTER TABLE "identity"."invitations" OWNER TO "dz_migrator";
ALTER TABLE "identity"."members" OWNER TO "dz_migrator";
ALTER TABLE "identity"."organizations" OWNER TO "dz_migrator";
ALTER TABLE "identity"."sessions" OWNER TO "dz_migrator";
ALTER TABLE "identity"."users" OWNER TO "dz_migrator";
ALTER TABLE "identity"."verifications" OWNER TO "dz_migrator";
ALTER TABLE "platform"."integration_credentials" OWNER TO "dz_migrator";
ALTER TABLE "platform"."provider_servers" OWNER TO "dz_migrator";

-- ---------------------------------------------------------------------------------------------------
-- B. Função de contexto (a mesma de MIGRACAO_0008; CREATE OR REPLACE é idempotente)
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "app"."current_org_id"() RETURNS text
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, app
  AS $$ SELECT NULLIF(current_setting('app.org_id', true), '') $$;
REVOKE EXECUTE ON FUNCTION "app"."current_org_id"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "app"."current_org_id"() TO "dz_app";

-- Garante RLS ligado (já está em produção; o comando é idempotente). NÃO forçado.
ALTER TABLE "app"."contact_lists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."inbox_contact_identities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."inbox_contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."inbox_conversation_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."inbox_conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."inbox_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."inbox_pending_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."inbox_reception_gaps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."media_files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."message_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."social_posts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."whatsapp_instances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."zernio_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "identity"."invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "identity"."members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."integration_credentials" ENABLE ROW LEVEL SECURITY;

-- Políticas: a linha só é vista/gravada se a empresa for a da transação (app.org_id)
CREATE POLICY "contact_lists_tenant" ON "app"."contact_lists" FOR ALL TO "dz_app" USING ("organization_id" = "app"."current_org_id"()) WITH CHECK ("organization_id" = "app"."current_org_id"());
CREATE POLICY "contacts_tenant" ON "app"."contacts" FOR ALL TO "dz_app" USING ("organization_id" = "app"."current_org_id"()) WITH CHECK ("organization_id" = "app"."current_org_id"());
CREATE POLICY "inbox_contact_identities_tenant" ON "app"."inbox_contact_identities" FOR ALL TO "dz_app" USING ("organization_id" = "app"."current_org_id"()) WITH CHECK ("organization_id" = "app"."current_org_id"());
CREATE POLICY "inbox_contacts_tenant" ON "app"."inbox_contacts" FOR ALL TO "dz_app" USING ("organization_id" = "app"."current_org_id"()) WITH CHECK ("organization_id" = "app"."current_org_id"());
CREATE POLICY "inbox_conversation_events_tenant" ON "app"."inbox_conversation_events" FOR ALL TO "dz_app" USING ("organization_id" = "app"."current_org_id"()) WITH CHECK ("organization_id" = "app"."current_org_id"());
CREATE POLICY "inbox_conversations_tenant" ON "app"."inbox_conversations" FOR ALL TO "dz_app" USING ("organization_id" = "app"."current_org_id"()) WITH CHECK ("organization_id" = "app"."current_org_id"());
CREATE POLICY "inbox_messages_tenant" ON "app"."inbox_messages" FOR ALL TO "dz_app" USING ("organization_id" = "app"."current_org_id"()) WITH CHECK ("organization_id" = "app"."current_org_id"());
CREATE POLICY "inbox_pending_receipts_tenant" ON "app"."inbox_pending_receipts" FOR ALL TO "dz_app" USING ("organization_id" = "app"."current_org_id"()) WITH CHECK ("organization_id" = "app"."current_org_id"());
CREATE POLICY "inbox_reception_gaps_tenant" ON "app"."inbox_reception_gaps" FOR ALL TO "dz_app" USING ("organization_id" = "app"."current_org_id"()) WITH CHECK ("organization_id" = "app"."current_org_id"());
CREATE POLICY "media_files_tenant" ON "app"."media_files" FOR ALL TO "dz_app" USING ("organization_id" = "app"."current_org_id"()) WITH CHECK ("organization_id" = "app"."current_org_id"());
CREATE POLICY "message_templates_tenant" ON "app"."message_templates" FOR ALL TO "dz_app" USING ("organization_id" = "app"."current_org_id"()) WITH CHECK ("organization_id" = "app"."current_org_id"());
CREATE POLICY "social_posts_tenant" ON "app"."social_posts" FOR ALL TO "dz_app" USING ("organization_id" = "app"."current_org_id"()) WITH CHECK ("organization_id" = "app"."current_org_id"());
CREATE POLICY "whatsapp_instances_tenant" ON "app"."whatsapp_instances" FOR ALL TO "dz_app" USING ("organization_id" = "app"."current_org_id"()) WITH CHECK ("organization_id" = "app"."current_org_id"());
CREATE POLICY "zernio_connections_tenant" ON "app"."zernio_connections" FOR ALL TO "dz_app" USING ("organization_id" = "app"."current_org_id"()) WITH CHECK ("organization_id" = "app"."current_org_id"());
CREATE POLICY "invitations_tenant" ON "identity"."invitations" FOR ALL TO "dz_app" USING ("organization_id" = "app"."current_org_id"()) WITH CHECK ("organization_id" = "app"."current_org_id"());
CREATE POLICY "members_tenant" ON "identity"."members" FOR ALL TO "dz_app" USING ("organization_id" = "app"."current_org_id"()) WITH CHECK ("organization_id" = "app"."current_org_id"());
CREATE POLICY "integration_credentials_tenant" ON "platform"."integration_credentials" FOR ALL TO "dz_app" USING ("organization_id" = "app"."current_org_id"()) WITH CHECK ("organization_id" = "app"."current_org_id"());

-- ---------------------------------------------------------------------------------------------------
-- C. Privilégios: só o necessário para dz_app; nada para PUBLIC, anon, authenticated ou service_role
-- ---------------------------------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA "app", "identity", "platform" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "app"."contact_lists", "app"."contacts", "app"."inbox_contact_identities", "app"."inbox_contacts",
  "app"."inbox_conversation_events", "app"."inbox_conversations", "app"."inbox_messages",
  "app"."inbox_pending_receipts", "app"."inbox_reception_gaps", "app"."media_files",
  "app"."message_templates", "app"."social_posts", "app"."whatsapp_instances", "app"."zernio_connections",
  "identity"."invitations", "identity"."members", "platform"."integration_credentials"
TO "dz_app";

COMMIT;

-- =====================================================================================================
-- VERIFICAÇÃO (só leitura, rodar depois do COMMIT)
--   select n.nspname, c.relname, pg_get_userbyid(c.relowner) dono, c.relrowsecurity, c.relforcerowsecurity
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname in ('identity','app','platform') and c.relkind = 'r' order by 1, 2;
--   -- esperado: todos com dono dz_migrator; rls ativo true; forçado false
--
--   select tablename, policyname from pg_policies where schemaname in ('app','identity','platform') order by 1, 2;
--   -- esperado: 17 políticas *_tenant
--
-- ROLLBACK (só se precisar desfazer; reverte dono e políticas, não dados)
--   DROP POLICY ... (uma por tabela, nomes acima), e ALTER TABLE ... OWNER TO postgres para cada tabela e esquema.
-- =====================================================================================================

-- =====================================================================================================
-- PENDÊNCIAS (fora deste rascunho, cada uma com aprovação própria)
--   - identity.users, accounts, sessions, verifications: login e sessões acontecem antes de existir empresa.
--     Tratamento: papel dz_auth (SUPABASE_CONFIGURACAO, alternativa B) ou política específica. Não aplicar aqui.
--   - identity.organizations: a própria empresa. Leitura pela API com política por id, a definir.
--   - platform.provider_servers: da plataforma (dz_platform), não da empresa.
--   - API: enviar app.org_id em cada requisição (tenant.ts, withTenant) antes de trocar a conexão para dz_app.
--   - identity.members e invitations: a API precisa do contexto da empresa ANTES de consultar participação.
--   - FORCE ROW LEVEL SECURITY: só depois da troca de conexão e de testes com dz_app.
-- =====================================================================================================
