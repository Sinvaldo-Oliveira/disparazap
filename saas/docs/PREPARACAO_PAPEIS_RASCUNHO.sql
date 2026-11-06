-- =====================================================================================================
-- RASCUNHO da preparação inicial de papéis e esquemas (SUPABASE_CONFIGURACAO §6.2) — NÃO EXECUTADO.
-- Executar UMA vez, no SQL editor do painel, com o usuário postgres, e só depois de revisão do dono do produto.
--
-- ANTES DE RODAR:
--   1. Troque SENHA_DZ_APP e SENHA_DZ_MIGRATOR pelas senhas geradas por você (gerenciador de senhas).
--      Nunca grave as senhas em arquivo do projeto nem as cole no chat.
--   2. Confirme que o postgres consegue criar papéis com esses atributos (item "Viabilidade", §6.2).
--      Se não conseguir, pare: não contorne com superusuário na aplicação.
--
-- Não cria tabelas nem políticas. Isso é das migrações (Drizzle e 0008), executadas por dz_migrator.
-- =====================================================================================================

-- Papel de aplicação: lê e escreve dados de empresa sempre sob RLS; sem DDL, sem BYPASSRLS
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dz_app') THEN
    CREATE ROLE "dz_app" LOGIN PASSWORD 'SENHA_DZ_APP' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;

-- Papel de migrações: dono dos esquemas; sem superusuário, sem BYPASSRLS, sem CREATEROLE e sem CREATEDB
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dz_migrator') THEN
    CREATE ROLE "dz_migrator" LOGIN PASSWORD 'SENHA_DZ_MIGRATOR' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;

-- O postgres (no Supabase não é superusuário) precisa ser membro do dz_migrator para criar esquemas e
-- padrões de privilégio com esse dono. Erro 42501 "must be able to SET ROLE" sem este passo.
GRANT "dz_migrator" TO "postgres";

-- Esquemas do projeto (o dono é o dz_migrator)
CREATE SCHEMA IF NOT EXISTS "identity" AUTHORIZATION "dz_migrator";
CREATE SCHEMA IF NOT EXISTS "app" AUTHORIZATION "dz_migrator";
CREATE SCHEMA IF NOT EXISTS "audit" AUTHORIZATION "dz_migrator";
CREATE SCHEMA IF NOT EXISTS "drizzle" AUTHORIZATION "dz_migrator";
CREATE SCHEMA IF NOT EXISTS "platform" AUTHORIZATION "dz_migrator";

-- Nada de esquemas de projeto para PUBLIC, anon, authenticated ou service_role
REVOKE ALL ON SCHEMA "identity", "app", "audit", "drizzle", "platform" FROM PUBLIC, "anon", "authenticated", "service_role";

-- A aplicação só usa os esquemas que precisa (sem drizzle, sem audit de leitura)
GRANT USAGE ON SCHEMA "identity", "app", "platform" TO "dz_app";
GRANT USAGE ON SCHEMA "audit" TO "dz_app";

-- Funções criadas pelo dono não ficam executáveis por PUBLIC
ALTER DEFAULT PRIVILEGES FOR ROLE "dz_migrator" IN SCHEMA "app", "identity", "platform", "audit" REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- =====================================================================================================
-- Conferência (só leitura): atributos dos papéis devem ser estes
--   select rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin
--   from pg_roles where rolname in ('dz_app', 'dz_migrator');
--   -- esperado: rolsuper false, rolbypassrls false, rolcreaterole false, rolcreatedb false, rolcanlogin true
-- =====================================================================================================
