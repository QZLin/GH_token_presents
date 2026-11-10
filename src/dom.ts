export function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    function abort(): void {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export const normText = (value: string | null | undefined): string =>
  (value || '').replace(/\s+/g, ' ').trim();

export const elementText = (element: HTMLElement): string =>
  normText(element.innerText || element.textContent);

export function setInputValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): void {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (!setter) throw new Error('无法设置页面输入控件');
  setter.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

export async function waitFor<T>(
  find: () => T | null | undefined | false,
  timeout = 1500,
  signal?: AbortSignal,
): Promise<T | null> {
  const deadline = Date.now() + timeout;
  while (true) {
    signal?.throwIfAborted();
    const result = find();
    if (result) return result;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;
    await sleep(Math.min(50, remaining), signal);
  }
}

export function closeMenu(): void {
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }),
  );
}

export function getMenuItems(): HTMLElement[] {
  return [
    ...document.querySelectorAll<HTMLElement>(
      '[role="menuitemradio"], [role="menuitem"], [role="option"], [data-component="ActionMenu.Item"]',
    ),
  ].filter((item) => !item.closest('[hidden], [aria-hidden="true"]'));
}

export function findMenuItemByText(text: string): HTMLElement | undefined {
  const target = normText(text).toLowerCase();
  if (!target) return undefined;
  const items = getMenuItems();
  return (
    items.find((item) => elementText(item).toLowerCase() === target) ||
    items.find((item) => elementText(item).toLowerCase().startsWith(target))
  );
}

export function findMenuItemByRegex(expression: RegExp): HTMLElement | undefined {
  return getMenuItems().find((item) => {
    expression.lastIndex = 0;
    return expression.test(elementText(item));
  });
}
