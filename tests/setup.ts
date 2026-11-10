import { afterEach, beforeEach, vi } from 'vitest';
import { resetExpirationTracking } from '../src/expiration';

beforeEach(() => {
  resetExpirationTracking();
  document.body.replaceChildren();
  localStorage.clear();
  window.history.replaceState({}, '', '/settings/personal-access-tokens/new');
});

afterEach(() => {
  resetExpirationTracking();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
  localStorage.clear();
});
