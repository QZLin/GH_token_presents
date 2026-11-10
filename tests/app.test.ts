import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isTargetPage, startApp } from '../src/app';
import { PANEL_ID } from '../src/ui';
import { renderExpirationSelect, renderPermission, renderRepositoryAccess } from './fixtures';

let dispose: (() => void) | undefined;

function boot(): void {
  dispose = startApp();
  document.dispatchEvent(new Event('DOMContentLoaded'));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
});

describe('userscript lifecycle', () => {
  it('matches only the token creation path, including query parameters', () => {
    expect(isTargetPage()).toBe(true);
    window.history.replaceState({}, '', '/settings/personal-access-tokens/new?description=test');
    expect(isTargetPage()).toBe(true);
    window.history.replaceState({}, '', '/settings/personal-access-tokens');
    expect(isTargetPage()).toBe(false);
  });

  it('mounts once when the form is ready and cleans up', () => {
    renderExpirationSelect();
    boot();
    expect(document.getElementById(PANEL_ID)).not.toBeNull();
    for (const name of ['turbo:load', 'turbo:render', 'pjax:end'])
      document.dispatchEvent(new Event(name));
    expect(document.querySelectorAll(`#${PANEL_ID}`)).toHaveLength(1);
    dispose?.();
    expect(document.getElementById(PANEL_ID)).toBeNull();
  });

  it('mounts when only Repository access controls are ready', () => {
    renderRepositoryAccess('selected');
    boot();
    expect(document.getElementById(PANEL_ID)).not.toBeNull();
  });

  it('waits for GitHub to render form controls', async () => {
    boot();
    expect(document.getElementById(PANEL_ID)).toBeNull();
    renderPermission('Contents');
    await Promise.resolve();
    expect(document.getElementById(PANEL_ID)).not.toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops waiting after a bounded timeout and can retry after Turbo renders', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    boot();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(warn).toHaveBeenCalledWith('[profiles] 等待 Token 表单超时');
    renderPermission('Contents');
    await Promise.resolve();
    expect(document.getElementById(PANEL_ID)).toBeNull();
    document.dispatchEvent(new Event('turbo:render'));
    expect(document.getElementById(PANEL_ID)).not.toBeNull();
  });

  it('removes the panel when leaving and remounts after returning', () => {
    renderExpirationSelect();
    boot();
    window.history.replaceState({}, '', '/settings/profile');
    document.dispatchEvent(new Event('turbo:load'));
    expect(document.getElementById(PANEL_ID)).toBeNull();
    document.body.replaceChildren();
    window.history.replaceState({}, '', '/settings/personal-access-tokens/new');
    renderExpirationSelect();
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(document.getElementById(PANEL_ID)).not.toBeNull();
  });

  it('does not mount after navigating away while waiting for the form', async () => {
    boot();
    window.history.replaceState({}, '', '/settings/profile');
    renderPermission('Contents');
    await Promise.resolve();
    expect(document.getElementById(PANEL_ID)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('remounts after Turbo replaces the entire body', () => {
    renderExpirationSelect();
    boot();
    const previous = document.getElementById(PANEL_ID);
    document.body.replaceChildren();
    renderExpirationSelect();
    document.dispatchEvent(new Event('turbo:render'));
    expect(document.getElementById(PANEL_ID)).not.toBe(previous);
    expect(document.querySelectorAll(`#${PANEL_ID}`)).toHaveLength(1);
  });

  it('does nothing on other GitHub pages', async () => {
    window.history.replaceState({}, '', '/settings/profile');
    boot();
    renderExpirationSelect();
    await Promise.resolve();
    expect(document.getElementById(PANEL_ID)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels observers and event listeners when disposed', async () => {
    boot();
    dispose?.();
    renderExpirationSelect();
    document.dispatchEvent(new Event('turbo:load'));
    window.dispatchEvent(new PageTransitionEvent('pageshow'));
    await Promise.resolve();
    expect(document.getElementById(PANEL_ID)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for DOMContentLoaded when injected before DOM readiness', () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    renderExpirationSelect();
    dispose = startApp();
    expect(document.getElementById(PANEL_ID)).toBeNull();
    document.dispatchEvent(new Event('DOMContentLoaded'));
    expect(document.getElementById(PANEL_ID)).not.toBeNull();
  });
});
