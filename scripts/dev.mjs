import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { BUNDLE_PATH, createDevelopmentUserscript, INSTALL_PATH } from './dev-userscript.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const portValue = portIndex === -1 ? '5173' : args[portIndex + 1];
if (!portValue || !/^\d+$/.test(portValue) || Number(portValue) < 1 || Number(portValue) > 65535) {
  throw new Error('Use --port with a port number between 1 and 65535');
}
const port = Number(portValue);
const origin = `http://127.0.0.1:${port}`;
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const cacheDirectory = resolve(root, 'node_modules/.cache/github-token-profiles-dev');
const bundleFile = resolve(cacheDirectory, 'github-token-profiles.user.js');
const loader = createDevelopmentUserscript(origin, pkg.version);

const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') {
    response.writeHead(405);
    response.end('GET only');
    return;
  }
  const url = new URL(request.url || '/', origin);
  if (url.pathname === '/') {
    response.writeHead(302, { Location: INSTALL_PATH });
    response.end();
  } else if (url.pathname === INSTALL_PATH) {
    response.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    response.end(loader);
  } else if (url.pathname === BUNDLE_PATH) {
    try {
      const code = await readFile(bundleFile, 'utf8');
      const hash = createHash('sha256').update(code).digest('hex');
      if (url.searchParams.get('hash') === hash) {
        response.writeHead(204);
        response.end();
      } else {
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ hash, code }));
      }
    } catch {
      response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('The development build is not ready yet');
    }
  } else {
    response.writeHead(404);
    response.end('Not found');
  }
});

await new Promise((resolveListen, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', resolveListen);
});
console.log(`[profiles:dev] Install ${origin}${INSTALL_PATH}`);
console.log(
  '[profiles:dev] CSP-safe isolated userscript; rebuilds refresh the panel, not the page.',
);

let watcher;
try {
  watcher = await build({
    root,
    mode: 'development',
    build: {
      outDir: cacheDirectory,
      emptyOutDir: false,
      watch: { exclude: ['**/node_modules/**', '**/coverage/**', '**/legacy/**'] },
    },
  });
} catch (error) {
  server.close();
  throw error;
}

async function close() {
  await watcher.close();
  server.close();
}
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
