// Gera o pacote do aplicativo Node.js da Hostinger: saas/deploy/hostinger/ (pasta) e saas/deploy/disparazap-hostinger.zip.
// Use pelo npm (compila antes):  npm run pacote:hostinger
// O pacote leva o código já compilado (API + painel), sem node_modules: a Hostinger instala as dependências.
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, extname, join, relative, sep } from 'node:path';

const here = import.meta.dirname;
const saas = join(here, '..', '..');
const deployDir = join(saas, 'deploy');
const out = join(deployDir, 'hostinger');
const zipFile = join(deployDir, 'disparazap-hostinger.zip');
const INTERNAL = ['contracts', 'db', 'shared'];

function fail(message) {
  process.stderr.write(`✖ ${message}\n`);
  process.exit(1);
}
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const toPosix = (path) => path.split(sep).join('/');

function walk(dir, visit) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, visit);
    else if (entry.isFile()) visit(full);
  }
}

// Código compilado sem declarações de tipo, mapas de código-fonte nem cache do TypeScript
const keepCompiled = (source) => !/\.(d\.ts|d\.ts\.map|js\.map|tsbuildinfo)$/.test(source);

// ----- 1. Conferir o que foi compilado -----
const required = [
  'apps/api/dist/index.js',
  'apps/web/dist/index.html',
  ...INTERNAL.map((name) => `packages/${name}/dist/index.js`),
];
for (const path of required) if (!existsSync(join(saas, path))) fail(`Falta ${path}. Rode "npm run pacote:hostinger" (ele compila antes).`);

rmSync(out, { recursive: true, force: true });
rmSync(zipFile, { force: true });
mkdirSync(out, { recursive: true });

// ----- 2. Copiar API, pacotes internos e painel -----
cpSync(join(saas, 'apps/api/dist'), join(out, 'api'), { recursive: true, filter: keepCompiled });
for (const name of INTERNAL) {
  cpSync(join(saas, `packages/${name}/dist`), join(out, 'lib', name, 'dist'), { recursive: true, filter: keepCompiled });
}
// As migrations ficam junto do pacote do banco (o caminho é relativo ao código)
cpSync(join(saas, 'packages/db/migrations'), join(out, 'lib/db/migrations'), { recursive: true });
// Painel: sem mapas de código-fonte (a API também não os serviria)
cpSync(join(saas, 'apps/web/dist'), join(out, 'web'), { recursive: true, filter: (source) => !source.endsWith('.map') });

// ----- 3. Imports dos pacotes internos viram caminhos relativos (sem workspaces no servidor) -----
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"]+)\2/g;
const bare = new Set();
let rewritten = 0;
for (const root of ['api', 'lib']) {
  walk(join(out, root), (file) => {
    if (extname(file) !== '.js') return;
    const code = readFileSync(file, 'utf8');
    const next = code.replace(SPECIFIER, (match, prefix, quote, specifier) => {
      const internal = /^@disparazap\/([a-z-]+)$/.exec(specifier);
      if (internal) {
        if (!INTERNAL.includes(internal[1])) fail(`Pacote interno desconhecido: ${specifier} em ${toPosix(relative(out, file))}`);
        let target = toPosix(relative(dirname(file), join(out, 'lib', internal[1], 'dist', 'index.js')));
        if (!target.startsWith('.')) target = `./${target}`;
        rewritten++;
        return `${prefix}${quote}${target}${quote}`;
      }
      if (!specifier.startsWith('.') && !specifier.startsWith('node:') && !builtinModules.includes(specifier)) {
        bare.add(specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]);
      }
      return match;
    });
    if (next !== code) writeFileSync(file, next);
  });
}
walk(out, (file) => {
  if (extname(file) === '.js' && /['"]@disparazap\//.test(readFileSync(file, 'utf8'))) fail(`Sobrou import interno em ${toPosix(relative(out, file))}`);
});

// ----- 4. Dependências: só as usadas pelo código, nas versões instaladas aqui (exatas) -----
// Versão que o Node usa hoje para cada pacote que a declara: primeiro o node_modules do próprio pacote, depois o da raiz
const owners = new Map();
for (const dir of ['apps/api', ...INTERNAL.map((name) => `packages/${name}`)]) {
  for (const name of Object.keys(readJson(join(saas, dir, 'package.json')).dependencies ?? {})) {
    if (!owners.has(name)) owners.set(name, []);
    owners.get(name).push(dir);
  }
}
function installedVersion(name, dir) {
  for (const base of [join(saas, dir, 'node_modules'), join(saas, 'node_modules')]) {
    const manifest = join(base, name, 'package.json');
    if (existsSync(manifest)) return readJson(manifest).version;
  }
  fail(`"${name}" não está instalado. Rode npm install dentro de saas/.`);
}
const dependencies = {};
for (const name of [...bare].sort()) {
  const dirs = owners.get(name);
  if (!dirs) fail(`O código usa "${name}", que não está nas dependências da API nem dos pacotes.`);
  const versions = new Set(dirs.map((dir) => installedVersion(name, dir)));
  // No servidor tudo fica num node_modules só: as partes precisam concordar na versão
  if (versions.size > 1) fail(`"${name}" tem versões diferentes entre as partes (${[...versions].join(', ')}).`);
  dependencies[name] = [...versions][0];
}
const saasPackage = readJson(join(saas, 'package.json'));
writeFileSync(
  join(out, 'package.json'),
  `${JSON.stringify(
    {
      name: 'disparazap-painel',
      version: saasPackage.version,
      private: true,
      type: 'module',
      description: 'DisparaZap (API + painel) para o aplicativo Node.js da Hostinger',
      main: 'server.js',
      scripts: { start: 'node server.js' },
      engines: { node: '>=24' },
      dependencies,
    },
    null,
    2,
  )}\n`,
);

// ----- 5. Entrada, modelo de variáveis, instruções e certificado do banco -----
copyFileSync(join(here, 'server.js'), join(out, 'server.js'));
copyFileSync(join(here, 'env.hostinger.example'), join(out, 'env.hostinger.example'));
copyFileSync(join(here, 'README.md'), join(out, 'LEIA-ME.md'));
const certsDir = join(saas, 'certs');
const certs = [];
if (existsSync(certsDir)) {
  for (const name of readdirSync(certsDir)) {
    if (!/\.(crt|pem)$/i.test(name)) continue;
    const text = readFileSync(join(certsDir, name), 'utf8');
    // Só certificados públicos de autoridade; nunca chave privada
    if (!text.includes('BEGIN CERTIFICATE') || /PRIVATE KEY/.test(text)) {
      process.stdout.write(`! Ignorado ${name}: não é um certificado público (ou contém chave privada).\n`);
      continue;
    }
    mkdirSync(join(out, 'certs'), { recursive: true });
    copyFileSync(join(certsDir, name), join(out, 'certs', name));
    certs.push(name);
  }
}

// ----- 6. Lockfile: a Hostinger instala exatamente estas versões -----
// Comando inteiro numa string: no Windows o npm é um .cmd e precisa do shell (sem argumentos vindos de fora)
const npm = spawnSync('npm install --package-lock-only --ignore-scripts --no-audit --no-fund', { cwd: out, stdio: 'pipe', shell: true, encoding: 'utf8' });
const hasLock = npm.status === 0 && existsSync(join(out, 'package-lock.json'));
if (!hasLock) process.stdout.write('! Não foi possível gerar o package-lock.json (sem internet?). A Hostinger resolve as versões na instalação.\n');

// ----- 7. Nada sensível no pacote -----
walk(out, (file) => {
  const name = file.slice(dirname(file).length + 1);
  if (/^\.env/.test(name) || /\.(key|p12|pfx)$/i.test(name)) fail(`Arquivo sensível no pacote: ${toPosix(relative(out, file))}`);
  if (/\.map$/.test(name)) fail(`Mapa de código-fonte no pacote: ${toPosix(relative(out, file))}`);
});

// ----- 8. Arquivo compactado (arquivos na raiz do .zip, como a Hostinger espera) -----
const entries = readdirSync(out);
// No Windows, o tar do sistema (bsdtar) gera .zip; o GNU tar (Git Bash, Linux) gera .tar.gz
const systemTar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
const tar = process.platform === 'win32' && existsSync(systemTar) ? systemTar : 'tar';
const isBsdTar = /bsdtar/i.test(spawnSync(tar, ['--version'], { encoding: 'utf8' }).stdout ?? '');
let archive = zipFile;
let packed;
if (isBsdTar) {
  packed = spawnSync(tar, ['-a', '-c', '-f', zipFile, '-C', out, ...entries], { stdio: 'inherit' });
} else {
  archive = join(deployDir, 'disparazap-hostinger.tar.gz');
  rmSync(archive, { force: true });
  packed = spawnSync(tar, ['-czf', archive, '-C', out, ...entries], { stdio: 'inherit' });
}
if (packed.status !== 0) fail('Não foi possível compactar o pacote. A pasta saas/deploy/hostinger está pronta; compacte-a manualmente.');

let files = 0;
walk(out, () => files++);
const mb = (statSync(archive).size / 1024 / 1024).toFixed(1);
process.stdout.write(`
✔ Pacote pronto
  Pasta:   ${toPosix(relative(saas, out))}/ (${files} arquivos; ${rewritten} imports internos ajustados)
  Arquivo: ${toPosix(relative(saas, archive))} (${mb} MB)
  Dependências: ${Object.keys(dependencies).length}${hasLock ? ', com package-lock.json' : ''}
  Certificado do banco: ${certs.length ? certs.join(', ') : 'NENHUM — coloque o certificado do Supabase em saas/certs/ e rode de novo'}

Na Hostinger (Websites → Add Website → Node.js web app → Upload): envie o arquivo acima e use
  Node.js 24 · Build command: (vazio) · Output directory: (vazio) · Entry file: server.js
Variáveis: importe o seu saas/.env.producao. Passo a passo: saas/infra/hostinger/README.md
`);
