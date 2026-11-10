import { elementText, normText, setInputValue, sleep, waitFor } from './dom';
import type { RepositoryAccess } from './types';

export function normalizeRepositoryAccess(value: unknown): RepositoryAccess | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    value = Object.hasOwn(value, 'mode') ? (value as Record<string, unknown>).mode : null;
  }
  if (typeof value !== 'string') return null;
  const mode = value.trim().toLowerCase();
  if (mode === 'public' || mode === 'none') return 'public';
  return mode === 'all' || mode === 'selected' ? mode : null;
}

export function describeRepositoryAccess(mode: RepositoryAccess | null): string {
  if (mode === 'all') return '全部仓库';
  if (mode === 'selected') return '仅所选仓库（不记录列表）';
  if (mode === 'public') return '公开仓库（只读）';
  return '未记录';
}

function modeFromText(text: string): RepositoryAccess | null {
  if (/^(only (select|selected)|selected) repositories\b/i.test(text)) return 'selected';
  if (/^all repositories\b/i.test(text)) return 'all';
  return /^public repositories\b/i.test(text) ? 'public' : null;
}

function labelText(element: HTMLElement): string {
  const labels =
    element instanceof HTMLInputElement || element instanceof HTMLSelectElement
      ? [...(element.labels || [])].map((label) => normText(label.textContent)).join(' ')
      : '';
  return normText(element.getAttribute('aria-label') || labels || elementText(element));
}

function hasRepositoryContext(element: HTMLElement): boolean {
  const identifiers = `${element.getAttribute('name') || ''} ${element.id} ${element.getAttribute('data-testid') || ''}`;
  if (/repository[_-]?(selection|access)/i.test(identifiers)) return true;
  const group = element.closest('fieldset, [role="radiogroup"]');
  const heading = group?.querySelector('legend, h2, h3, h4');
  return /^repository access\s*:?$/i.test(
    normText(group?.getAttribute('aria-label') || heading?.textContent),
  );
}

function findSelect(): HTMLSelectElement | null {
  return (
    [...document.querySelectorAll<HTMLSelectElement>('select')].find(
      (select) =>
        !select.multiple &&
        (hasRepositoryContext(select) || /^repository access\s*:?$/i.test(labelText(select))) &&
        [...select.options].some(
          (option) =>
            normalizeRepositoryAccess(option.value) || modeFromText(normText(option.textContent)),
        ),
    ) || null
  );
}

function choices(): { element: HTMLElement; mode: RepositoryAccess; selected: boolean }[] {
  return [...document.querySelectorAll<HTMLElement>('input[type="radio"], [role="radio"]')].flatMap(
    (element) => {
      const textMode = modeFromText(labelText(element));
      const value =
        element instanceof HTMLInputElement ? element.value : element.getAttribute('data-value');
      const mode =
        textMode || (hasRepositoryContext(element) ? normalizeRepositoryAccess(value) : null);
      if (!mode) return [];
      const selected =
        element instanceof HTMLInputElement
          ? element.checked
          : element.getAttribute('aria-checked') === 'true';
      return [{ element, mode, selected }];
    },
  );
}

export function readRepositoryAccess(): RepositoryAccess | null {
  const select = findSelect();
  if (select) {
    const option = select.selectedOptions[0];
    return option
      ? normalizeRepositoryAccess(option.value) || modeFromText(normText(option.textContent))
      : null;
  }
  return choices().find((choice) => choice.selected)?.mode || null;
}

export async function applyRepositoryAccess(
  mode: RepositoryAccess | null,
  signal?: AbortSignal,
): Promise<boolean> {
  signal?.throwIfAborted();
  if (!mode || readRepositoryAccess() === mode) return true;
  const select = findSelect();
  if (select) {
    const option = [...select.options].find(
      (candidate) =>
        (normalizeRepositoryAccess(candidate.value) ||
          modeFromText(normText(candidate.textContent))) === mode,
    );
    if (!option || select.disabled || option.disabled) {
      console.warn('[profiles] Repository access 模式不可用:', mode);
      return false;
    }
    setInputValue(select, option.value);
  } else {
    const choice = choices().find((candidate) => candidate.mode === mode);
    if (!choice || choice.element.matches(':disabled, [aria-disabled="true"]')) {
      console.warn('[profiles] 未找到可用的 Repository access 控件:', mode);
      return false;
    }
    choice.element.click();
  }
  await sleep(120, signal);
  return Boolean(await waitFor(() => readRepositoryAccess() === mode, 1500, signal));
}
