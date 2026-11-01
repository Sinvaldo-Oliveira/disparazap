// Sobe o server.js real em um processo filho, isolado das credenciais reais
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

async function freePort() {
  const srv = net.createServer();
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const { port } = srv.address();
  await new Promise((resolve) => srv.close(resolve));
  return port;
}

// Garante que nenhum teste aponte para um servidor Evolution que não seja local
function assertLocalOnly(env) {
  const url = env.EVOLUTION_URL || '';
  if (url && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(url)) {
    throw new Error('Teste bloqueado: EVOLUTION_URL precisa apontar para o Evolution simulado local');
  }
}

function spawnServer(env) {
  assertLocalOnly(env);
  // Diretório de trabalho temporário: o dotenv procura o .env no cwd e não encontra o .env real
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-test-'));
  const childEnv = { ...process.env, EVOLUTION_URL: '', GLOBAL_API_KEY: '', HOST: '', EVOLUTION_CA_FILE: '', ...env };
  if (!('NODE_TLS_REJECT_UNAUTHORIZED' in env)) delete childEnv.NODE_TLS_REJECT_UNAUTHORIZED;
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  const cleanup = () => fs.rmSync(cwd, { recursive: true, force: true });
  return { child, exited, cleanup, output: () => output };
}

async function startApp(env = {}) {
  const port = await freePort();
  const proc = spawnServer({ PORT: String(port), ...env });
  const base = `http://127.0.0.1:${port}`;
  const started = Date.now();
  for (;;) {
    if (proc.child.exitCode !== null) throw new Error(`server.js encerrou ao iniciar:\n${proc.output()}`);
    try {
      await fetch(`${base}/`);
      break;
    } catch {
      if (Date.now() - started > 10000) {
        proc.child.kill();
        throw new Error(`server.js não subiu em 10s:\n${proc.output()}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  return {
    base,
    port,
    output: proc.output,
    stop: async () => {
      proc.child.kill();
      await proc.exited;
      proc.cleanup();
    },
  };
}

// Para cenários em que o servidor deve se recusar a iniciar
async function runUntilExit(env = {}, timeoutMs = 10000) {
  const port = await freePort();
  const proc = spawnServer({ PORT: String(port), ...env });
  const timer = setTimeout(() => proc.child.kill(), timeoutMs);
  const code = await proc.exited;
  clearTimeout(timer);
  proc.cleanup();
  return { code, output: proc.output() };
}

module.exports = { startApp, runUntilExit, freePort };
