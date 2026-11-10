import { closeMenu, elementText, getMenuItems, normText, sleep, waitFor } from './dom';
import { PERMISSION_NAMES } from './permission-names';
import type { Permissions } from './types';

export function getAllAccessButtons(): HTMLButtonElement[] {
  return [
    ...document.querySelectorAll<HTMLButtonElement>('button[data-component="ActionMenu.Button"]'),
  ].filter(
    (button) =>
      !button.closest(
        '[hidden], [aria-hidden="true"], dialog, [role="dialog"], #gh-token-profiles-panel',
      ) && /Access:/.test(elementText(button)),
  );
}

export function findExactPermissionNames(root: Node | null): string[] {
  if (!root) return [];
  const names = new Set<string>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = normText(node.textContent);
    if (PERMISSION_NAMES.has(text)) names.add(text);
  }
  return [...names];
}

function accessButtonsIn(root: HTMLElement): HTMLButtonElement[] {
  return [
    ...root.querySelectorAll<HTMLButtonElement>('button[data-component="ActionMenu.Button"]'),
  ].filter(
    (button) =>
      !button.closest(
        '[hidden], [aria-hidden="true"], dialog, [role="dialog"], #gh-token-profiles-panel',
      ) && /Access:/.test(elementText(button)),
  );
}

function hasRepositoryHeading(root: HTMLElement): boolean {
  return [...root.querySelectorAll('label, legend, h2, h3')].some((label) =>
    /^repository access\s*:?$/i.test(normText(label.textContent)),
  );
}

export function getPermissionName(button: HTMLButtonElement): string | null {
  let element: HTMLElement | null = button;
  for (let depth = 0; depth < 8 && element; depth++, element = element.parentElement) {
    // Never borrow another row's name from a shared container or the entire form.
    if (
      element.matches('body, html, form, [role="form"]') ||
      accessButtonsIn(element).length > 1 ||
      hasRepositoryHeading(element)
    )
      break;
    const names = findExactPermissionNames(element);
    if (names.length === 1) return names[0] ?? null;
    if (names.length > 1) break;
  }
  return null;
}

export function getCurrentLevel(button: HTMLButtonElement): string | null {
  return (
    elementText(button)
      .match(/Access:\s*(.+)$/)?.[1]
      ?.trim() || null
  );
}

export function isNoAccess(level: string | null): boolean {
  return /^no access$/i.test(normText(level));
}

export function buildButtonMap(): Map<string, HTMLButtonElement> {
  const map = new Map<string, HTMLButtonElement>();
  for (const button of getAllAccessButtons()) {
    const name = getPermissionName(button);
    if (name && !map.has(name)) map.set(name, button);
  }
  return map;
}

export function readPermissions(): Permissions {
  return Object.fromEntries(
    [...buildButtonMap()]
      .filter(([name]) => name !== 'Metadata')
      .flatMap(([name, button]) => {
        const level = getCurrentLevel(button);
        return level && !isNoAccess(level) ? [[name, level]] : [];
      }),
  );
}

export async function waitForLevel(
  name: string,
  level: string,
  timeout = 1500,
  signal?: AbortSignal,
): Promise<boolean> {
  return Boolean(
    await waitFor(
      () => {
        const button = buildButtonMap().get(name);
        return button && getCurrentLevel(button) === level;
      },
      timeout,
      signal,
    ),
  );
}

function findRemoveButton(button: HTMLButtonElement, name: string): HTMLButtonElement | null {
  let group = button.parentElement;
  let matchingContainers = 0;
  for (let depth = 0; depth < 8 && group; depth++, group = group.parentElement) {
    if (group.matches('body, html, form') || accessButtonsIn(group).length > 1) break;
    const names = findExactPermissionNames(group);
    if (names.length > 1) break;
    if (names.length !== 1 || names[0] !== name) continue;
    if (hasRepositoryHeading(group)) break;
    const candidate = [...group.querySelectorAll<HTMLButtonElement>('button')].find((item) => {
      if (
        item === button ||
        item.closest('#gh-token-profiles-panel, [hidden], [aria-hidden="true"]')
      )
        return false;
      const text = normText(
        `${item.getAttribute('aria-label') || ''} ${item.title} ${item.getAttribute('data-testid') || ''} ${elementText(item)}`,
      );
      if (/repositories?|\brepo\b/i.test(text) && !text.toLowerCase().includes(name.toLowerCase()))
        return false;
      return (
        /\b(remove|delete)\b/i.test(text) ||
        Boolean(item.querySelector('svg.octicon-trash, svg.octicon-x'))
      );
    });
    if (candidate) return candidate;
    if (++matchingContainers >= 3) break;
  }
  return null;
}

export async function removePermission(name: string, signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted();
  if (name === 'Metadata') return false;
  const button = buildButtonMap().get(name);
  if (!button) return true;
  const remove = findRemoveButton(button, name);
  if (remove) {
    if (remove.matches(':disabled, [aria-disabled="true"]')) return false;
    remove.click();
  } else {
    if (isNoAccess(getCurrentLevel(button))) return true;
    if (button.disabled) return false;
    button.click();
    const item = await waitFor(
      () =>
        getMenuItems().find(
          (candidate) =>
            !candidate.matches(':disabled, [aria-disabled="true"]') &&
            isNoAccess(elementText(candidate)),
        ),
      1500,
      signal,
    );
    if (!item) {
      closeMenu();
      console.warn('[profiles] 未找到权限移除控件或 No access 选项:', name);
      return false;
    }
    signal?.throwIfAborted();
    item.click();
  }
  await sleep(120, signal);
  return Boolean(
    await waitFor(
      () => {
        const current = buildButtonMap().get(name);
        return !current || isNoAccess(getCurrentLevel(current));
      },
      1500,
      signal,
    ),
  );
}
