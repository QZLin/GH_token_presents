import { findExpirationField, resetExpirationTracking } from './expiration';
import { readRepositoryAccess } from './repository-access';
import { getAllAccessButtons } from './permissions';
import { mountPanel } from './ui';
import type { PanelController } from './ui';

export function isTargetPage(): boolean {
  return (
    location.hostname === 'github.com' &&
    location.pathname === '/settings/personal-access-tokens/new'
  );
}

export function startApp(): () => void {
  let panel: PanelController | null = null;
  let observer: MutationObserver | null = null;
  let timeout: number | undefined;
  const pageEvents = ['turbo:load', 'turbo:render', 'pjax:end'];

  function stopWaiting(): void {
    observer?.disconnect();
    observer = null;
    if (timeout !== undefined) window.clearTimeout(timeout);
    timeout = undefined;
  }

  function tryMount(): boolean {
    if (!getAllAccessButtons().length && !findExpirationField() && !readRepositoryAccess())
      return false;
    panel = mountPanel();
    return true;
  }

  function syncPage(): void {
    stopWaiting();
    if (!isTargetPage()) {
      resetExpirationTracking();
      panel?.dispose();
      panel = null;
      return;
    }
    if (panel?.element.isConnected) return;
    panel?.dispose();
    panel = null;
    if (!document.body || tryMount()) return;

    observer = new MutationObserver(() => {
      if (!isTargetPage()) syncPage();
      else if (tryMount()) stopWaiting();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    timeout = window.setTimeout(() => {
      stopWaiting();
      console.warn('[profiles] 等待 Token 表单超时');
    }, 60_000);
  }

  for (const event of pageEvents) document.addEventListener(event, syncPage);
  window.addEventListener('popstate', syncPage);
  window.addEventListener('pageshow', syncPage);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncPage, { once: true });
  } else {
    syncPage();
  }

  return () => {
    resetExpirationTracking();
    stopWaiting();
    panel?.dispose();
    for (const event of pageEvents) document.removeEventListener(event, syncPage);
    document.removeEventListener('DOMContentLoaded', syncPage);
    window.removeEventListener('popstate', syncPage);
    window.removeEventListener('pageshow', syncPage);
  };
}
