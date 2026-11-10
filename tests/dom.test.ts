import { describe, expect, it, vi } from 'vitest';
import {
  closeMenu,
  elementText,
  findMenuItemByRegex,
  findMenuItemByText,
  normText,
  setInputValue,
  sleep,
  waitFor,
} from '../src/dom';

describe('DOM helpers', () => {
  it('normalizes whitespace and absent text', () => {
    expect(normText('  Read\n and\twrite ')).toBe('Read and write');
    expect(normText(null)).toBe('');
    expect(normText(undefined)).toBe('');
    const element = document.createElement('span');
    element.textContent = ' fallback ';
    expect(elementText(element)).toBe('fallback');
    element.innerText = ' visible ';
    expect(elementText(element)).toBe('visible');
  });

  it.each(['input', 'textarea', 'select'] as const)(
    'uses native setters and bubbling events for %s',
    (tag) => {
      const parent = document.createElement('div');
      const input = document.createElement(tag);
      if (input instanceof HTMLSelectElement) input.innerHTML = '<option value="new">New</option>';
      parent.append(input);
      const events: string[] = [];
      parent.addEventListener('input', () => events.push('input'));
      parent.addEventListener('change', () => events.push('change'));
      setInputValue(input, 'new');
      expect(input.value).toBe('new');
      expect(events).toEqual(['input', 'change']);
    },
  );

  it('bypasses an instance setter used by controlled inputs', () => {
    const input = document.createElement('input');
    const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    const trackedSetter = vi.fn();
    Object.defineProperty(input, 'value', {
      get: () => native?.get?.call(input),
      set: trackedSetter,
      configurable: true,
    });
    setInputValue(input, 'controlled');
    expect(input.value).toBe('controlled');
    expect(trackedSetter).not.toHaveBeenCalled();
  });

  it('finds exact menu items before prefix matches and ignores hidden menus', () => {
    document.body.innerHTML = `
      <div hidden><button role="menuitem">Read-only</button></div>
      <button role="option">Read-only More information</button>
      <button role="menuitemradio" id="exact">Read-only</button>
      <button data-component="ActionMenu.Item">Custom date</button>
      <div aria-hidden="true"><button role="menuitem">No expiration</button></div>
    `;
    expect(findMenuItemByText(' read-only ')?.id).toBe('exact');
    expect(findMenuItemByText('Custom')?.textContent).toBe('Custom date');
    expect(findMenuItemByText('')).toBeUndefined();
    expect(findMenuItemByText('No expiration')).toBeUndefined();
    expect(findMenuItemByRegex(/^custom/gi)?.textContent).toBe('Custom date');
  });

  it('dispatches Escape to close menus', () => {
    const listener = vi.fn();
    document.addEventListener('keydown', listener, { once: true });
    closeMenu();
    expect(listener.mock.calls[0]?.[0].key).toBe('Escape');
  });

  it('cancels pending waits and clears their timers', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const waiting = waitFor(() => false, 1500, controller.signal);
    const assertion = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
    await expect(sleep(10, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(waitFor(() => true, 10, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('returns immediately when a condition is already satisfied', async () => {
    expect(await waitFor(() => 'ready')).toBe('ready');
  });

  it('waits for asynchronous DOM changes and stops at the timeout', async () => {
    vi.useFakeTimers();
    let ready = false;
    setTimeout(() => {
      ready = true;
    }, 100);
    const found = waitFor(() => (ready ? 'ready' : null));
    await vi.runAllTimersAsync();
    expect(await found).toBe('ready');
    const missing = waitFor(() => false, 100);
    await vi.runAllTimersAsync();
    expect(await missing).toBeNull();
  });
});
