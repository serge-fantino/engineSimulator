/**
 * Generate HTTPS cert for local preview. Uses mkcert if available (browser-trusted),
 * otherwise falls back to self-signed (browser will show a warning).
 * Usage: node scripts/serve-pages-https.cjs
 * Expects: .preview/ already exists (run after build:pages + copy).
 */
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const PREVIEW_DIR = path.join(process.cwd(), '.preview');
const CERT_PATH = path.join(PREVIEW_DIR, 'cert.pem');
const KEY_PATH = path.join(PREVIEW_DIR, 'key.pem');
const PORT = 4173;

function ensureCert() {
  if (fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH)) {
    return;
  }
  if (!fs.existsSync(PREVIEW_DIR)) {
    fs.mkdirSync(PREVIEW_DIR, { recursive: true });
  }

  // Prefer mkcert: generates a cert trusted by the browser (no warning) if you ran mkcert -install once
  const mkcert = spawnSync('mkcert', [
    '-cert-file', CERT_PATH,
    '-key-file', KEY_PATH,
    'localhost', '127.0.0.1', '::1',
  ], { encoding: 'utf8' });

  if (mkcert.status === 0) {
    console.log('Generated .preview/cert.pem and .preview/key.pem (mkcert — trusted by the browser)');
    return;
  }

  // Fallback: self-signed cert (browser will show "Your connection is not private")
  console.log('mkcert not found or failed; using self-signed cert (browser will show a warning).');
  console.log('For a trusted cert: install mkcert (e.g. brew install mkcert) and run: mkcert -install');
  const selfsigned = require('selfsigned');
  const attrs = [{ name: 'commonName', value: 'localhost' }];
  const opts = { days: 365, keySize: 2048, algorithm: 'sha256' };
  const pems = selfsigned.generate(attrs, opts);
  fs.writeFileSync(CERT_PATH, pems.cert, 'utf8');
  fs.writeFileSync(KEY_PATH, pems.private, 'utf8');
  console.log('Generated .preview/cert.pem and .preview/key.pem (self-signed)');
}

function main() {
  if (!fs.existsSync(PREVIEW_DIR)) {
    console.error('Missing .preview/ — run: npm run build:pages');
    process.exit(1);
  }
  ensureCert();

  const child = spawn(
    'npx',
    [
      'http-server',
      PREVIEW_DIR,
      '-p', String(PORT),
      '-S',
      '-C', CERT_PATH,
      '-K', KEY_PATH,
      '-c-1',
      '--cors',
    ],
    { stdio: 'inherit', cwd: process.cwd(), shell: true }
  );
  child.on('error', (err) => {
    console.error(err);
    process.exit(1);
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}

main();
