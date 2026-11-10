import { elementText, normText, setInputValue, sleep, waitFor } from './dom';
import { PERMISSION_NAMES } from './permission-names';
import { buildButtonMap, findExactPermissionNames } from './permissions';
import type { StatusReporter } from './types';

const PICKERS = 'dialog[open], [role="dialog"], [role="menu"], [data-component="AnchoredOverlay"]';
const CHOICES =
  'input[type="checkbox"], [role="checkbox"], [role="menuitemcheckbox"], [role="option"]';
const identity = new WeakMap<Element, number>();
let nextIdentity = 1;

export interface PermissionSurfaceSnapshot {
  ready: boolean;
  signature: string;
}

function permissionRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    'react-partial[partial-name="integration-permission-selector"]',
  );
}

function elementIdentity(element: Element): number {
  let value = identity.get(element);
  if (!value) {
    value = nextIdentity++;
    identity.set(element, value);
  }
  return value;
}

export function capturePermissionSurface(): PermissionSurfaceSnapshot {
  const root = permissionRoot();
  if (!root) return { ready: false, signature: 'missing' };
  const busy = Boolean(
    root.matches('[aria-busy="true"], [data-loading="true"]') ||
    root.querySelector('[aria-busy="true"], [data-loading="true"]'),
  );
  const add = [...root.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
    /^add permissions$/i.test(caption(button)),
  );
  const hidden = [
    ...root.querySelectorAll<HTMLInputElement>(
      'input[type="hidden"][name*="[default_permissions]"]',
    ),
  ]
    .map((input) => `${input.name}=${input.value}:${input.disabled}`)
    .sort();
  const rows = [...buildButtonMap()]
    .map(([name, button]) => `${name}=${elementText(button)}`)
    .sort();
  const signature = JSON.stringify({
    root: elementIdentity(root),
    loaded: root.classList.contains('loaded'),
    busy,
    add: add
      ? `${add.disabled}:${add.getAttribute('aria-disabled')}:${add.getAttribute('data-loading')}:${add.getAttribute('aria-expanded')}`
      : null,
    hidden,
    rows,
  });
  return {
    ready:
      !busy &&
      root.isConnected &&
      (Boolean(add && !add.disabled) || hidden.length > 0 || rows.length > 0),
    signature,
  };
}

export async function waitForPermissionSurfaceAfterRepositoryChange(
  before: PermissionSurfaceSnapshot,
  signal?: AbortSignal,
  timeout = 6000,
): Promise<boolean> {
  const started = Date.now();
  let latest = capturePermissionSurface();
  let latestChange = started;
  let changed = latest.signature !== before.signature;
  while (Date.now() - started < timeout) {
    signal?.throwIfAborted();
    const current = capturePermissionSurface();
    if (current.signature !== latest.signature) {
      latest = current;
      latestChange = Date.now();
    }
    changed ||= current.signature !== before.signature;
    const quiet = Date.now() - latestChange >= 250;
    // Some scope changes intentionally expose the same permission catalogue. In
    // that case use a conservative grace period rather than waiting forever.
    const transitionMinimumElapsed = Date.now() - started >= 750;
    const graceElapsed = Date.now() - started >= 1800;
    if (current.ready && quiet && transitionMinimumElapsed && (changed || graceElapsed))
      return true;
    await sleep(50, signal);
  }
  return false;
}

function visible(element: HTMLElement): boolean {
  if (element instanceof HTMLDialogElement && !element.open) return false;
  return (
    element.isConnected &&
    !element.closest('[hidden], [aria-hidden="true"]') &&
    element.style.display !== 'none'
  );
}

function caption(element: HTMLElement): string {
  const labelled = (element.getAttribute('aria-labelledby') || '')
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent || '')
    .join(' ');
  return normText(element.getAttribute('aria-label') || labelled || elementText(element));
}

function safeButton(button: HTMLButtonElement): boolean {
  // A permission picker must never accidentally submit the token creation form.
  return (
    visible(button) &&
    !button.matches(':disabled, [aria-disabled="true"]') &&
    (button.type !== 'submit' || !button.form)
  );
}

function addButton(): HTMLButtonElement | null {
  return (
    [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) =>
        !button.closest('#gh-token-profiles-panel') &&
        safeButton(button) &&
        /^add permissions$/i.test(caption(button)),
    ) || null
  );
}

function selectionControls(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(CHOICES)].filter(
    (element) => visible(element) && !element.querySelector(CHOICES),
  );
}

function selected(element: HTMLElement): boolean {
  return element instanceof HTMLInputElement
    ? element.checked
    : element.getAttribute('aria-checked') === 'true' ||
        element.getAttribute('aria-selected') === 'true';
}

function namedChoice(picker: HTMLElement, name: string): HTMLElement | null {
  for (const control of selectionControls(picker)) {
    if (caption(control) === name) return control;
    if (control instanceof HTMLInputElement) {
      const label = [...(control.labels || [])].find(
        (candidate) =>
          picker.contains(candidate) && findExactPermissionNames(candidate).includes(name),
      );
      if (label) return control;
    }
    let group: HTMLElement | null = control;
    for (
      let depth = 0;
      depth < 7 && group && group !== picker;
      depth++, group = group.parentElement
    ) {
      if (selectionControls(group).length > 1) break;
      const names = findExactPermissionNames(group);
      if (names.length === 1 && names[0] === name) return control;
      if (names.length > 1) break;
    }
  }
  return null;
}

function findPicker(before: Set<Element>): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>(PICKERS)].find((element) => {
      if (!visible(element) || before.has(element) || element.closest('#gh-token-profiles-panel'))
        return false;
      const title =
        element.getAttribute('aria-label') ||
        caption(element.querySelector<HTMLElement>('h1, h2, h3') || element);
      if (/^(?:(add|select|choose)\s+)?(?:repository\s+)?permissions$/i.test(normText(title)))
        return true;
      return (
        !before.has(element) &&
        selectionControls(element).some((control) => {
          const names = findExactPermissionNames(control.parentElement);
          return names.some((name) => name !== 'Metadata');
        })
      );
    }) || null
  );
}

async function repositoryTab(root: Element, signal?: AbortSignal): Promise<void> {
  const tab = [...root.querySelectorAll<HTMLButtonElement>('button')].find((button) => {
    const text = button.querySelector<HTMLElement>('[data-component="text"]');
    return /^repositories(?:\s|\d|\(|$)/i.test(text ? elementText(text) : caption(button));
  });
  if (
    tab &&
    safeButton(tab) &&
    tab.getAttribute('aria-current') !== 'true' &&
    tab.getAttribute('aria-selected') !== 'true'
  ) {
    signal?.throwIfAborted();
    tab.click();
    await sleep(120, signal);
  }
}

function confirmButton(picker: HTMLElement): HTMLButtonElement | null {
  return (
    [...picker.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) =>
        safeButton(button) &&
        /^(add(?: selected)?(?: \d+)?(?: permissions)?(?: \(\d+\))?|done|apply|save)$/i.test(
          caption(button),
        ),
    ) || null
  );
}

function closePicker(picker: HTMLElement): void {
  if (!visible(picker)) return;
  const close = [...picker.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) =>
      safeButton(button) &&
      (/^close(?:\s|$)/i.test(caption(button)) ||
        Boolean(picker.id && button.getAttribute('data-close-dialog-id') === picker.id)),
  );
  if (close) close.click();
  else {
    picker.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }),
    );
    const native =
      picker instanceof HTMLDialogElement
        ? picker
        : picker.querySelector<HTMLDialogElement>('dialog[open]');
    if (native?.isConnected && native.open && typeof native.close === 'function') native.close();
  }
}

export async function ensurePermissionButton(
  name: string,
  signal?: AbortSignal,
  report: StatusReporter = () => {},
): Promise<HTMLButtonElement | null> {
  signal?.throwIfAborted();
  const existing = buildButtonMap().get(name);
  if (existing) return existing;
  if (name === 'Metadata' || !PERMISSION_NAMES.has(name)) return null;

  const root = document.querySelector(
    'react-partial[partial-name="integration-permission-selector"]',
  );
  if (root) await repositoryTab(root, signal);
  const delayed = await waitFor(() => buildButtonMap().get(name), 200, signal);
  if (delayed) return delayed;
  const add = addButton();
  if (!add) {
    console.warn('[profiles] 找不到可用的 Add permissions 控件:', name);
    return null;
  }
  if (add.getAttribute('aria-expanded') === 'true') {
    console.warn('[profiles] 请先关闭已有的 Add permissions 弹窗，再应用 profile');
    return null;
  }
  report(`添加缺失权限：${name}…`);
  const before = new Set([...document.querySelectorAll<HTMLElement>(PICKERS)].filter(visible));
  signal?.throwIfAborted();
  add.click();
  let picker: HTMLElement | null = null;
  let success: boolean;
  try {
    picker = await waitFor(() => findPicker(before), 2500, signal);
    if (!picker) {
      console.warn('[profiles] 未找到权限添加弹窗:', name);
      return null;
    }
    await repositoryTab(picker, signal);
    let choice = namedChoice(picker, name);
    if (!choice) {
      const search = picker.querySelector<HTMLInputElement>(
        'input[type="search"], input[role="combobox"], input[placeholder*="search" i], input[aria-label*="search" i], input[placeholder*="filter" i], input[aria-label*="filter" i]',
      );
      if (search && !search.disabled && !search.readOnly) setInputValue(search, name);
      choice = await waitFor(() => picker && namedChoice(picker, name), 2500, signal);
    }
    if (
      !choice ||
      choice.matches(':disabled, [aria-disabled="true"]') ||
      (choice instanceof HTMLButtonElement && !safeButton(choice)) ||
      choice instanceof HTMLAnchorElement
    ) {
      console.warn('[profiles] 权限不在可选列表中或被策略禁用:', name);
      return null;
    }
    if (!selected(choice)) {
      signal?.throwIfAborted();
      choice.click();
      await sleep(50, signal);
    }
    picker = visible(picker) ? picker : findPicker(before) || picker;
    const confirm = confirmButton(picker);
    if (confirm) {
      const current = namedChoice(picker, name);
      if (!current || !selected(current)) {
        console.warn('[profiles] 权限选择未成功，不确认添加:', name);
        return null;
      }
      signal?.throwIfAborted();
      confirm.click();
    }
    success = Boolean(await waitFor(() => buildButtonMap().get(name), 3000, signal));
    if (!success) console.warn('[profiles] 添加后权限行未出现:', name);
  } finally {
    const owned = picker && visible(picker) ? picker : findPicker(before);
    if (owned) closePicker(owned);
  }
  if (!success) return null;
  await sleep(120, signal);
  return await waitFor(() => buildButtonMap().get(name), 500, signal);
}
