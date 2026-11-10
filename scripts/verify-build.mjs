import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Script } from 'node:vm';
import { JSDOM } from 'jsdom';
import { licenseNotice, projectMetadata } from './project-metadata.mjs';

const artifact = new URL('../dist/github-token-profiles.user.js', import.meta.url);
const source = await readFile(artifact, 'utf8');
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const metadata = source.match(/^\/\/ ==UserScript==[\s\S]*?^\/\/ ==\/UserScript==/m)?.[0];
assert.ok(metadata, 'Missing userscript metadata');
assert.ok(source.startsWith('// ==UserScript=='), 'Metadata must start the installable script');
for (const [key, value] of Object.entries(projectMetadata)) {
  assert.equal(metadata.match(new RegExp(`^// @${key}\\s+(.+)$`, 'm'))?.[1], value);
}
assert.ok(source.includes(licenseNotice), 'Complete license notice is missing');
assert.match(metadata, /@name\s+GitHub Fine-grained Token Profiles/);
assert.match(metadata, /@namespace\s+https:\/\/github\.com\//);
assert.match(metadata, new RegExp(`@version\\s+${pkg.version.replaceAll('.', '\\.')}\\s`));
assert.match(metadata, /@match\s+https:\/\/github\.com\/settings\/personal-access-tokens\/new\*/);
assert.match(metadata, /@grant\s+none/);
assert.match(metadata, /@run-at\s+document-idle/);
assert.doesNotMatch(metadata, /@(require|resource|connect)\s/);
new Script(source, { filename: artifact.pathname });

const dom = new JSDOM(
  `<!doctype html><html><body><form>
  <input name="token" value="DO_NOT_READ_OR_STORE_TOKEN">
  <fieldset><legend>Repository access</legend>
    <label><input type="radio" name="repository_selection" value="none">Public repositories</label>
    <label><input type="radio" name="repository_selection" value="all" checked>All repositories</label>
    <label><input type="radio" name="repository_selection" value="selected">Only select repositories</label>
    <input type="checkbox" name="repository_ids" value="DO_NOT_STORE_REPOSITORY_ID" checked>
  </fieldset>
  <react-partial partial-name="integration-permission-selector" class="loaded"><div data-target="react-partial.reactRoot">
    <input type="hidden" name="integration[default_permissions][contents]" value="read">
    <section id="contents-row"><span>Contents</span><button type="button" data-component="ActionMenu.Button">Access: Read-only</button></section>
    <button type="button" id="add-permissions-proof" aria-label="Add permissions" aria-haspopup="dialog" aria-expanded="false">Add permissions</button>
    <section id="mandatory"><span>Metadata</span><button type="button" data-component="ActionMenu.Button">Access: Read-only</button></section>
  </div></react-partial>
  <label for="expiration">Expiration</label>
  <select id="expiration"><option value="30">30 days</option><option value="90">90 days</option></select>
</form></body></html>`,
  {
    url: 'https://github.com/settings/personal-access-tokens/new',
    runScripts: 'outside-only',
  },
);

try {
  const { window } = dom;
  const key = 'gh-fg-token-presets-v1';
  window.localStorage.setItem(
    key,
    JSON.stringify({
      legacy: { Contents: 'Read-only' },
      release: {
        permissions: { Contents: 'Read-only' },
        expiration: { mode: 'standard', value: '90 days' },
        repositoryAccess: 'selected',
      },
    }),
  );
  window.prompt = () => 'Smoke';
  window.confirm = () => true;
  let submissions = 0;
  window.document.querySelector('form').addEventListener('submit', (event) => {
    submissions++;
    event.preventDefault();
  });
  window.eval(source);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  const panel = window.document.getElementById('gh-token-profiles-panel');
  assert.ok(panel, 'Production bundle did not mount');
  assert.equal(panel.querySelectorAll('select option').length, 2);
  assert.ok([...panel.querySelectorAll('button')].every((button) => button.type === 'button'));
  panel.querySelector('[data-act="save"]').click();
  let stored = window.localStorage.getItem(key);
  assert.ok(!stored.includes('DO_NOT_READ_OR_STORE_TOKEN'));
  assert.ok(!stored.includes('DO_NOT_STORE_REPOSITORY_ID'));
  assert.deepEqual(JSON.parse(stored).Smoke, {
    permissions: { Contents: 'Read-only' },
    expiration: { mode: 'offset', days: 30 },
    repositoryAccess: 'all',
  });

  window.document.getElementById('contents-row').remove();
  const add = window.document.getElementById('add-permissions-proof');
  let additions = 0;
  add.addEventListener('click', () => {
    add.setAttribute('aria-expanded', 'true');
    const dialog = window.document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Add permissions');
    dialog.innerHTML =
      '<h2>Add permissions</h2><label><input type="checkbox">Contents</label><button type="button" data-confirm>Add permissions</button><button type="button" aria-label="Close dialog">Close</button>';
    const close = () => {
      dialog.remove();
      add.setAttribute('aria-expanded', 'false');
    };
    dialog.querySelector('[aria-label]').addEventListener('click', close);
    dialog.querySelector('[data-confirm]').addEventListener('click', () => {
      if (dialog.querySelector('input').checked) {
        const row = window.document.createElement('section');
        row.innerHTML =
          '<span>Contents</span><button type="button" data-component="ActionMenu.Button">Access: Read-only</button>';
        window.document
          .querySelector(
            'react-partial[partial-name="integration-permission-selector"] [data-target="react-partial.reactRoot"]',
          )
          .append(row);
        additions++;
      }
      close();
    });
    window.document.querySelector('form').append(dialog);
  });

  const extra = window.document.createElement('section');
  extra.innerHTML =
    '<span>Issues</span><button type="button" data-component="ActionMenu.Button">Access: Read and write</button><button type="button" aria-label="Remove Issues permission">Remove</button>';
  extra.querySelector('[aria-label]').addEventListener('click', () => extra.remove());
  window.document.querySelector('form').append(extra);
  const select = panel.querySelector('select');
  select.value = 'release';
  select.dispatchEvent(new window.Event('change'));
  const apply = panel.querySelector('[data-act="apply"]');
  async function applyAndWait() {
    apply.click();
    const deadline = Date.now() + 3000;
    while (apply.disabled && Date.now() < deadline) await delay(10);
    assert.ok(!apply.disabled, 'Production application did not finish');
  }
  await applyAndWait();
  assert.equal(additions, 1, 'Missing Contents permission was not added once');
  assert.equal(window.document.getElementById('expiration').value, '90');
  assert.equal(
    window.document.querySelector('[name="repository_selection"]:checked').value,
    'selected',
  );
  assert.equal(extra.isConnected, true, 'Cleanup must default off');
  panel.querySelector('[role="switch"]').checked = true;
  await applyAndWait();
  assert.equal(extra.isConnected, false);
  assert.ok(window.document.getElementById('mandatory'), 'Metadata was removed');
  assert.match(panel.querySelector('.status').textContent, /移除 1\/1/);
  assert.equal(submissions, 0, 'Never submit the token creation form');

  select.value = 'Smoke';
  select.dispatchEvent(new window.Event('change'));
  panel.querySelector('[data-act="update"]').click();
  stored = window.localStorage.getItem(key);
  assert.deepEqual(JSON.parse(stored).Smoke, {
    permissions: { Contents: 'Read-only' },
    expiration: { mode: 'offset', days: 90 },
    repositoryAccess: 'selected',
  });
  assert.ok(!stored.includes('DO_NOT_STORE_REPOSITORY_ID'));
  assert.ok(!stored.includes('DO_NOT_READ_OR_STORE_TOKEN'));

  panel.querySelector('[data-act="export"]').click();
  const editor = panel.querySelector('textarea');
  assert.equal(editor.readOnly, true);
  assert.deepEqual(JSON.parse(editor.value), JSON.parse(stored));
  assert.equal(window.document.querySelectorAll('a[download]').length, 0);
  let copied = '';
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text) => {
        copied = text;
      },
    },
  });
  panel.querySelector('[data-act="copy"]').click();
  await delay(0);
  assert.equal(copied, editor.value);
  panel.querySelector('[data-act="import"]').click();
  assert.equal(editor.readOnly, false);
  editor.value = JSON.stringify({
    Pasted: {
      permissions: { Contents: 'Read-only' },
      expiration: { mode: 'offset', days: 7 },
      repositoryAccess: 'selected',
    },
  });
  panel.querySelector('[data-act="confirm-import"]').click();
  assert.deepEqual(JSON.parse(window.localStorage.getItem(key)).Pasted, {
    permissions: { Contents: 'Read-only' },
    expiration: { mode: 'offset', days: 7 },
    repositoryAccess: 'selected',
  });
  assert.equal(
    window.document.getElementById('expiration').value,
    '90',
    'Import must not automatically apply a profile',
  );
  assert.equal(submissions, 0);

  window.eval(source);
  assert.equal(panel.isConnected, false, 'Repeated evaluation did not dispose the old runtime');
  window.document.dispatchEvent(new window.Event('turbo:load'));
  assert.equal(window.document.querySelectorAll('#gh-token-profiles-panel').length, 1);
  window.history.replaceState({}, '', '/settings/profile');
  window.document.dispatchEvent(new window.Event('turbo:load'));
  assert.equal(window.document.querySelectorAll('#gh-token-profiles-panel').length, 0);
  window.history.replaceState({}, '', '/settings/personal-access-tokens/new');
  window.document.dispatchEvent(new window.Event('turbo:load'));
  assert.equal(window.document.querySelectorAll('#gh-token-profiles-panel').length, 1);
  console.log(
    `Verified ${pkg.version}: standalone userscript, author/copyright/license, legacy migration, repository mode/privacy and permission-surface sequencing, offset, update, optional cleanup, form safety and runtime replacement (${Buffer.byteLength(source)} bytes).`,
  );
} finally {
  dom.window.close();
}
