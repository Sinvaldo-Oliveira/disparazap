// DisparaZap no aplicativo Node.js da Hostinger: arquivo de entrada ("Entry file: server.js").
// Prepara o ambiente e sobe a API, que também entrega o painel (pasta web/) na mesma origem.
// As variáveis (banco, segredos, endereço) vêm do hPanel; veja LEIA-ME.md.
import { isAbsolute, join } from 'node:path';

const env = process.env;
const here = import.meta.dirname;

// Este pacote é sempre de produção: sem NODE_ENV, a API exige banco, segredos e https
env.NODE_ENV ??= 'production';
// A Hostinger informa a porta em PORT
if (env.PORT && !env.API_PORT) env.API_PORT = env.PORT;
// Painel compilado dentro do pacote
env.WEB_DIST_DIR ||= join(here, 'web');
// Certificado do banco com caminho relativo (ex.: certs/supabase-ca.crt) = dentro deste pacote
if (env.DATABASE_CA_FILE && !isAbsolute(env.DATABASE_CA_FILE)) env.DATABASE_CA_FILE = join(here, env.DATABASE_CA_FILE);

await import('./api/index.js');
