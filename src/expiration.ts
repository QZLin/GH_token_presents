import {
  closeMenu,
  elementText,
  getMenuItems,
  normText,
  setInputValue,
  sleep,
  waitFor,
} from './dom';
import {
  dateAtOffset,
  daysUntilDate,
  isOffsetDays,
  normalizeExpiration,
  offsetFromText,
  parseDate,
} from './expiration-values';
import type { Expiration } from './types';

type ExpirationField =
  | { type: 'select'; element: HTMLSelectElement }
  | { type: 'date'; element: HTMLInputElement }
  | { type: 'button'; element: HTMLButtonElement };

let computedOffset: { days: number; date: string } | null = null;
let stopTracking: (() => void) | null = null;

export function resetExpirationTracking(): void {
  computedOffset = null;
  stopTracking?.();
  stopTracking = null;
}

export function findExpirationField(): ExpirationField | null {
  const direct = document.querySelector<HTMLSelectElement>(
    'select#expiration, select[name="expiration"]',
  );
  if (direct) return { type: 'select', element: direct };
  const pattern = /^\s*(expiration|expires?(\s+on)?)\s*:?\s*$/i;
  const labels = [
    ...document.querySelectorAll<HTMLElement>('label, dt, legend, [class*="label"]'),
  ].filter((label) => pattern.test(label.textContent || ''));
  for (const label of labels) {
    let group = label.parentElement;
    for (let depth = 0; depth < 4 && group; depth++, group = group.parentElement) {
      const select = group.querySelector<HTMLSelectElement>('select');
      if (select) return { type: 'select', element: select };
      const button = group.querySelector<HTMLButtonElement>(
        'button[aria-haspopup="true"], button[data-component="ActionMenu.Button"]',
      );
      if (button) return { type: 'button', element: button };
      const date = group.querySelector<HTMLInputElement>('input[type="date"]');
      if (date) return { type: 'date', element: date };
    }
  }
  return null;
}

function dateInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(
    'input[type="date"], input[name*="expir" i][type="text"], input[placeholder*="YYYY" i]',
  );
}

export function readCustomDate(): string | null {
  const date = document.querySelector<HTMLInputElement>('input[type="date"]');
  if (date?.value) return date.value;
  const text = document.querySelector<HTMLInputElement>(
    'input[name*="expir" i][type="text"], input[placeholder*="YYYY" i]',
  );
  return text?.value || null;
}

function fromText(text: string, value?: string | null): Expiration | null {
  if (/custom/i.test(text)) return { mode: 'custom', date: readCustomDate() };
  if (/no expiration|never expires?/i.test(text)) return { mode: 'none' };
  let days = offsetFromText(text);
  if (days === null && value) {
    days = daysUntilDate(value);
    if (days === null && /^\d+$/.test(value) && Number(value) <= 36500) days = Number(value);
  }
  return isOffsetDays(days) ? { mode: 'offset', days } : null;
}

function rawExpiration(field: ExpirationField): Expiration | null {
  if (field.type === 'select') {
    const option = field.element.selectedOptions[0];
    return option ? fromText(normText(option.textContent), option.value) : null;
  }
  if (field.type === 'date') return { mode: 'custom', date: field.element.value || null };
  return fromText(
    elementText(field.element)
      .replace(/^expiration:?\s*/i, '')
      .trim(),
  );
}

export function readExpiration(): Expiration | null {
  const field = findExpirationField();
  if (!field) return null;
  const actual = rawExpiration(field);
  // A custom control may be used to APPLY an offset. It is still relative until
  // the user edits an expiration control; do not save our generated date as fixed.
  if (computedOffset && actual?.mode === 'custom' && actual.date === computedOffset.date) {
    return { mode: 'offset', days: computedOffset.days };
  }
  computedOffset = null;
  return actual;
}

function rememberOffset(days: number, date: string): void {
  computedOffset = { days, date };
  if (stopTracking) return;
  const onEdit = (event: Event): void => {
    if (event.target === dateInput() || event.target === findExpirationField()?.element)
      computedOffset = null;
  };
  document.addEventListener('input', onEdit, true);
  document.addEventListener('change', onEdit, true);
  stopTracking = () => {
    document.removeEventListener('input', onEdit, true);
    document.removeEventListener('change', onEdit, true);
  };
}

export function isFutureDate(date: string | null, today = new Date()): boolean {
  const days = daysUntilDate(date, today);
  return days !== null && days > 0;
}

export async function setCustomDate(date: string | null, signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted();
  if (!isFutureDate(date)) {
    console.warn('[profiles] 自定义日期无效或已过，跳过:', date);
    return false;
  }
  const input = dateInput();
  if (!input || !date || input.disabled || input.readOnly) {
    console.warn('[profiles] 未找到可编辑的日期输入');
    return false;
  }
  if ((parseDate(input.min) && date < input.min) || (parseDate(input.max) && date > input.max)) {
    console.warn('[profiles] 日期超出页面允许范围:', date);
    return false;
  }
  if (input.value !== date) {
    setInputValue(input, date);
    await sleep(120, signal);
  }
  return readCustomDate() === date && (dateInput()?.validity.valid ?? false);
}

function matches(actual: Expiration | null, target: Expiration): boolean {
  if (!actual || actual.mode !== target.mode) return false;
  if (actual.mode === 'offset' && target.mode === 'offset') return actual.days === target.days;
  return true;
}

export async function applyExpiration(value: unknown, signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted();
  if (value === null || value === undefined) return true;
  const expiration = normalizeExpiration(value);
  const targetDate =
    expiration?.mode === 'offset'
      ? dateAtOffset(expiration.days)
      : expiration?.mode === 'custom'
        ? expiration.date
        : null;
  if (!expiration || (expiration.mode !== 'none' && !isFutureDate(targetDate))) {
    console.warn('[profiles] 无效的过期时间配置:', value);
    return false;
  }
  const field = findExpirationField();
  if (!field) {
    console.warn('[profiles] 未找到过期时间控件');
    return false;
  }
  computedOffset = null;
  if (field.type === 'date') {
    if (expiration.mode === 'none') return false;
    const success = await setCustomDate(targetDate, signal);
    if (success && expiration.mode === 'offset' && targetDate)
      rememberOffset(expiration.days, targetDate);
    return success;
  }

  let useCustom = expiration.mode === 'custom';
  const optionMatches = (text: string, value?: string | null): boolean => {
    if (expiration.mode === 'custom') return /^custom\b/i.test(text);
    if (expiration.mode === 'none') return /no expiration|never expires?/i.test(text);
    // Date-valued standard options must not reuse a date from an older day.
    return (
      matches(fromText(text, value), expiration) &&
      (!parseDate(value || null) || value === targetDate)
    );
  };

  if (field.type === 'select') {
    let option = [...field.element.options].find(
      (candidate) =>
        !candidate.disabled && optionMatches(normText(candidate.textContent), candidate.value),
    );
    if (!option && expiration.mode === 'offset') {
      option = [...field.element.options].find(
        (candidate) => !candidate.disabled && /^custom\b/i.test(normText(candidate.textContent)),
      );
      useCustom = Boolean(option);
    }
    if (!option || field.element.disabled) {
      console.warn('[profiles] 未找到可用过期选项:', expiration);
      return false;
    }
    if (field.element.value !== option.value) {
      setInputValue(field.element, option.value);
      await sleep(150, signal);
    }
  } else {
    const current = rawExpiration(field);
    if (matches(current, expiration) && expiration.mode !== 'custom') return true;
    if (current?.mode !== 'custom' || expiration.mode !== 'custom') {
      field.element.click();
      const item = await waitFor(
        () => {
          const items = getMenuItems().filter(
            (candidate) => !candidate.matches(':disabled, [aria-disabled="true"]'),
          );
          const exact = items.find((candidate) =>
            optionMatches(elementText(candidate), candidate.getAttribute('data-value')),
          );
          if (exact) return exact;
          if (expiration.mode === 'offset') {
            const custom = items.find((candidate) => /^custom\b/i.test(elementText(candidate)));
            if (custom) {
              useCustom = true;
              return custom;
            }
          }
          return null;
        },
        1500,
        signal,
      );
      if (!item) {
        closeMenu();
        console.warn('[profiles] 未找到过期菜单项:', expiration);
        return false;
      }
      signal?.throwIfAborted();
      item.click();
      await sleep(150, signal);
    }
  }

  if (useCustom) {
    if (!(await waitFor(readCustomMode, 1500, signal))) return false;
    const success = await setCustomDate(targetDate, signal);
    if (success && expiration.mode === 'offset' && targetDate)
      rememberOffset(expiration.days, targetDate);
    return success;
  }
  return Boolean(
    await waitFor(
      () => {
        const current = findExpirationField();
        return current && matches(rawExpiration(current), expiration);
      },
      1500,
      signal,
    ),
  );
}

function readCustomMode(): boolean {
  const field = findExpirationField();
  return Boolean(field && rawExpiration(field)?.mode === 'custom');
}
