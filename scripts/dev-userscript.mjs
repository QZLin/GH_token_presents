/* global GM_xmlhttpRequest */

import { attachLicenseNotice, projectMetadata } from './project-metadata.mjs';

export const DEVELOPMENT_LOADER_KEY = 'github-token-profiles:development-loader';
export const RUNTIME_KEY = 'github-token-profiles:runtime';
export const INSTALL_PATH = '/github-token-profiles.dev.user.js';
export const BUNDLE_PATH = '/__github-token-profiles.bundle.json';

// Serialized into a userscript: this function executes in the manager's isolated
// world, NOT a script tag/module in github.com's CSP-protected page world.
function runDevelopmentLoader(origin, bundlePath, loaderName, runtimeName) {
  const loaderKey = Symbol.for(loaderName);
  const runtimeKey = Symbol.for(runtimeName);
  const previous = globalThis[loaderKey];
  if (typeof previous === 'function') previous();
  let timer;
  let request;
  let hash = '';
  let generation = 0;
  let suspended = false;
  let warned = false;

  function disposeRuntime() {
    const dispose = globalThis[runtimeKey];
    if (typeof dispose === 'function') dispose();
  }

  function schedule() {
    if (!suspended) timer = setTimeout(load, 1000);
  }

  function failure(error) {
    if (!warned) console.warn('[profiles:dev] 本地开发构建暂不可用，稍后重试。', error);
    warned = true;
  }

  function load() {
    if (suspended) return;
    const currentGeneration = generation;
    function finish() {
      if (suspended || generation !== currentGeneration) return;
      request = undefined;
      schedule();
    }
    request = GM_xmlhttpRequest({
      method: 'GET',
      url: `${origin}${bundlePath}?hash=${encodeURIComponent(hash)}`,
      timeout: 10_000,
      onload(response) {
        if (suspended || generation !== currentGeneration) return;
        try {
          if (response.status === 204) {
            warned = false;
          } else {
            if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
            const bundle = JSON.parse(response.responseText);
            if (typeof bundle.hash !== 'string' || typeof bundle.code !== 'string') {
              throw new Error('Invalid development bundle');
            }
            if (bundle.hash !== hash) {
              // Direct eval deliberately stays in this isolated userscript world.
              // Only the explicitly authorized localhost development server is read.
              eval(bundle.code);
              hash = bundle.hash;
            }
            warned = false;
          }
        } catch (error) {
          failure(error);
        } finally {
          finish();
        }
      },
      onerror(error) {
        if (suspended || generation !== currentGeneration) return;
        failure(error);
        finish();
      },
      ontimeout() {
        if (suspended || generation !== currentGeneration) return;
        failure(new Error('Development request timed out'));
        finish();
      },
    });
  }

  function suspend() {
    suspended = true;
    generation++;
    clearTimeout(timer);
    request?.abort?.();
    request = undefined;
    disposeRuntime();
  }

  function resume() {
    if (!suspended) return;
    suspended = false;
    hash = '';
    load();
  }

  function dispose() {
    suspend();
    window.removeEventListener('pagehide', suspend);
    window.removeEventListener('pageshow', resume);
    if (globalThis[loaderKey] === dispose) delete globalThis[loaderKey];
  }

  globalThis[loaderKey] = dispose;
  window.addEventListener('pagehide', suspend);
  window.addEventListener('pageshow', resume);
  load();
}

export function createDevelopmentUserscript(origin, version) {
  const url = new URL(origin);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/') {
    throw new Error('Development scripts may only load the local loopback server');
  }
  if (typeof version !== 'string' || /[\r\n]/.test(version)) throw new Error('Invalid version');
  const metadata = [
    '// ==UserScript==',
    '// @name         server:GitHub Fine-grained Token Profiles',
    '// @namespace    https://github.com/',
    `// @version      ${version}`,
    ...Object.entries(projectMetadata).map(([key, value]) => `// @${key.padEnd(13)} ${value}`),
    '// @description  在隔离环境中加载本地 GitHub Token Profiles 开发构建',
    '// @match        https://github.com/settings/personal-access-tokens/new*',
    '// @grant        GM_xmlhttpRequest',
    '// @connect      127.0.0.1',
    '// @sandbox      DOM',
    '// @inject-into  content',
    '// @run-at       document-idle',
    '// ==/UserScript==',
  ].join('\n');
  const args = [url.origin, BUNDLE_PATH, DEVELOPMENT_LOADER_KEY, RUNTIME_KEY]
    .map((value) => JSON.stringify(value))
    .join(', ');
  return `${attachLicenseNotice(metadata)}\n\n(${runDevelopmentLoader.toString()})(${args});\n`;
}
