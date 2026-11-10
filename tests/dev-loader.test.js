import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDevelopmentUserscript,
  DEVELOPMENT_LOADER_KEY,
  RUNTIME_KEY,
} from '../scripts/dev-userscript.mjs';

const origin = 'http://127.0.0.1:5174';
let requests;

function install() {
  window.eval(createDevelopmentUserscript(origin, '2.2.0'));
}

function respond(bundle, status = 200, index = requests.length - 1) {
  requests[index].options.onload({ status, responseText: JSON.stringify(bundle) });
}

beforeEach(() => {
  vi.useFakeTimers();
  requests = [];
  window.GM_xmlhttpRequest = vi.fn((options) => {
    const request = { options, abort: vi.fn() };
    requests.push(request);
    return request;
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  window[Symbol.for(DEVELOPMENT_LOADER_KEY)]?.();
  delete window[Symbol.for(RUNTIME_KEY)];
  delete window.GM_xmlhttpRequest;
  delete window.__developmentCount;
});

describe('CSP-safe development loader', () => {
  it('grants only localhost requests and runs in an isolated userscript world', () => {
    const script = createDevelopmentUserscript(origin, '2.2.0');
    expect(script).toContain('@grant        GM_xmlhttpRequest');
    expect(script).toContain('@connect      127.0.0.1');
    expect(script).toContain('@sandbox      DOM');
    expect(script).toContain('@inject-into  content');
    expect(script).not.toContain('createElement("script")');
    expect(script).not.toContain('__vite-plugin-monkey.entry.js');
    expect(script).not.toContain('script.type = "module"');
  });

  it.each([
    'https://github.com',
    'https://127.0.0.1:5173',
    'http://localhost:5173',
    `${origin}/other`,
  ])('rejects a non-loopback development origin: %s', (url) => {
    expect(() => createDevelopmentUserscript(url, '2.2.0')).toThrow();
  });

  it.each([undefined, '2.2.0\n// @connect *'])('rejects invalid metadata versions', (version) => {
    expect(() => createDevelopmentUserscript(origin, version)).toThrow();
  });

  it('loads a classic bundle via GM without injecting any script element', async () => {
    install();
    expect(requests[0].options.url).toBe(`${origin}/__github-token-profiles.bundle.json?hash=`);
    respond({ hash: 'one', code: 'globalThis.__developmentCount = 1;' });
    expect(window.__developmentCount).toBe(1);
    expect(document.querySelector('script')).toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    expect(requests[1].options.url).toContain('?hash=one');
    respond({}, 204);
    expect(window.__developmentCount).toBe(1);
  });

  it('reexecutes changed bundles but not identical hashes', async () => {
    install();
    respond({ hash: 'one', code: 'globalThis.__developmentCount = 1;' });
    await vi.advanceTimersByTimeAsync(1000);
    respond({ hash: 'one', code: 'globalThis.__developmentCount = 20;' });
    expect(window.__developmentCount).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    respond({ hash: 'two', code: 'globalThis.__developmentCount = 2;' });
    expect(window.__developmentCount).toBe(2);
  });

  it.each([
    [{ hash: 1, code: 'invalid' }, 200],
    [{ hash: 'one', code: 'invalid {' }, 200],
    [{ hash: 'one', code: 'globalThis.__developmentCount = 1;' }, 503],
  ])('does not commit a failed bundle and retries safely', async (body, status) => {
    install();
    respond(body, status);
    expect(window.__developmentCount).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1000);
    expect(requests[1].options.url).toContain('?hash=');
    respond({ hash: 'recovered', code: 'globalThis.__developmentCount = 3;' });
    expect(window.__developmentCount).toBe(3);
  });

  it('rate-limits connection warnings and recovers after timeout', async () => {
    install();
    requests[0].options.onerror(new Error('Offline'));
    await vi.advanceTimersByTimeAsync(1000);
    requests[1].options.ontimeout();
    expect(console.warn).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    respond({}, 204);
    await vi.advanceTimersByTimeAsync(1000);
    requests[3].options.onerror(new Error('Offline again'));
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it('cancels requests on pagehide, ignores stale results and resumes on pageshow', async () => {
    const dispose = vi.fn();
    window[Symbol.for(RUNTIME_KEY)] = dispose;
    install();
    window.dispatchEvent(new PageTransitionEvent('pageshow'));
    expect(requests).toHaveLength(1);
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    expect(requests[0].abort).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    respond({ hash: 'stale', code: 'globalThis.__developmentCount = 100;' });
    requests[0].options.onerror(new Error('Stale'));
    requests[0].options.ontimeout();
    await vi.advanceTimersByTimeAsync(2000);
    expect(requests).toHaveLength(1);
    expect(window.__developmentCount).toBeUndefined();
    window.dispatchEvent(new PageTransitionEvent('pageshow'));
    respond({ hash: 'fresh', code: 'globalThis.__developmentCount = 1;' });
    expect(window.__developmentCount).toBe(1);
  });

  it('cleans up the previous loader and avoids duplicate polling after reinstall', async () => {
    install();
    const original = requests[0];
    install();
    expect(original.abort).toHaveBeenCalledOnce();
    respond({ hash: 'old', code: 'globalThis.__developmentCount = 30;' }, 200, 0);
    respond({ hash: 'new', code: 'globalThis.__developmentCount = 1;' }, 200, 1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(requests).toHaveLength(3);
    expect(window.__developmentCount).toBe(1);
  });
});
