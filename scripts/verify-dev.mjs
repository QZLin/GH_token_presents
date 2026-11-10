import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Script } from 'node:vm';
import { JSDOM } from 'jsdom';
import { BUNDLE_PATH, DEVELOPMENT_LOADER_KEY, INSTALL_PATH } from './dev-userscript.mjs';
import { licenseNotice, projectMetadata } from './project-metadata.mjs';

const args = process.argv.slice(2).filter((argument) => argument !== '--');
const origin = new URL(args[0] || 'http://127.0.0.1:5173');
assert.equal(origin.protocol, 'http:');
assert.equal(origin.hostname, '127.0.0.1');
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const install = await fetch(new URL(INSTALL_PATH, origin));
assert.equal(install.status, 200);
const loader = await install.text();
const metadata = loader.match(/^\/\/ ==UserScript==[\s\S]*?^\/\/ ==\/UserScript==/m)?.[0];
assert.ok(metadata, 'Development metadata is missing');
for (const [key, value] of Object.entries(projectMetadata)) {
  assert.equal(metadata.match(new RegExp(`^// @${key}\\s+(.+)$`, 'm'))?.[1], value);
}
assert.ok(loader.includes(licenseNotice), 'Development loader license notice is missing');
assert.match(loader, /@grant\s+GM_xmlhttpRequest/);
assert.match(loader, /@sandbox\s+DOM/);
assert.match(loader, /@inject-into\s+content/);
assert.match(loader, new RegExp(`@version\\s+${pkg.version.replaceAll('.', '\\.')}\\s`));
assert.ok(!loader.includes('__vite-plugin-monkey.entry.js'));
new Script(loader);

const response = await fetch(new URL(BUNDLE_PATH, origin));
assert.equal(response.status, 200);
const bundle = await response.json();
assert.equal(typeof bundle.code, 'string');
assert.ok(bundle.code.includes(licenseNotice), 'Development bundle license notice is missing');
assert.equal(typeof bundle.hash, 'string');
new Script(bundle.code);
if (args[1]) assert.notEqual(bundle.hash, args[1], 'Watched source changes did not rebuild');
const unchanged = await fetch(new URL(`${BUNDLE_PATH}?hash=${bundle.hash}`, origin));
assert.equal(unchanged.status, 204);

const dom = new JSDOM(
  `<!doctype html><html><body>
  <section><span>Contents</span><button type="button" data-component="ActionMenu.Button">Access: Read-only</button></section>
  <label for="expiration">Expiration</label><select id="expiration"><option value="30">30 days</option></select>
</body></html>`,
  {
    url: 'https://github.com/settings/personal-access-tokens/new',
    runScripts: 'outside-only',
  },
);
try {
  dom.window.GM_xmlhttpRequest = ({ onload }) => {
    queueMicrotask(() => onload({ status: 200, responseText: JSON.stringify(bundle) }));
    return { abort() {} };
  };
  dom.window.eval(loader);
  await delay(20);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  const panel = dom.window.document.getElementById('gh-token-profiles-panel');
  assert.ok(panel, 'Isolated development loader did not mount the application');
  assert.equal(
    dom.window.document.querySelectorAll('script').length,
    0,
    'Do not inject page scripts',
  );
  dom.window.eval(bundle.code);
  assert.equal(panel.isConnected, false, 'Old runtime was not disposed');
  assert.equal(dom.window.document.querySelectorAll('#gh-token-profiles-panel').length, 1);
  console.log(
    `Verified development install, classic bundle, isolated load, replacement and 204 caching: ${origin.origin}`,
  );
  console.log(`Development hash: ${bundle.hash}`);
} finally {
  dom.window[Symbol.for(DEVELOPMENT_LOADER_KEY)]?.();
  dom.window.close();
}
