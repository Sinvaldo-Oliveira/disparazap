// Certificado autoassinado descartável (127.0.0.1/localhost), gerado em pasta temporária a cada execução
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function findOpenssl() {
  const candidates = [
    process.env.OPENSSL_BIN,
    'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe',
    'openssl',
    'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
  ].filter(Boolean);
  return candidates.find((bin) => spawnSync(bin, ['version'], { encoding: 'utf8' }).status === 0) || null;
}

function makeSelfSignedCert() {
  const bin = findOpenssl();
  if (!bin) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-tls-'));
  const keyPath = path.join(dir, 'key.pem');
  const certPath = path.join(dir, 'cert.pem');
  const result = spawnSync(bin, [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-keyout', keyPath, '-out', certPath,
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
  ], { encoding: 'utf8' });
  if (result.status !== 0) {
    fs.rmSync(dir, { recursive: true, force: true });
    return null;
  }
  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
    certPath,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

module.exports = { makeSelfSignedCert };
