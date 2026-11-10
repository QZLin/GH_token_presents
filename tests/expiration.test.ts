import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyExpiration,
  findExpirationField,
  isFutureDate,
  readCustomDate,
  readExpiration,
  setCustomDate,
} from '../src/expiration';
import { renderDateField, renderExpirationButton, renderExpirationSelect } from './fixtures';

async function settle<T>(promise: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return promise;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-10T12:00:00'));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('expiration discovery and reading', () => {
  it('returns null when no expiration field exists', () => {
    expect(findExpirationField()).toBeNull();
    expect(readExpiration()).toBeNull();
    expect(readCustomDate()).toBeNull();
  });

  it('reads a standard select and locates it by name or label', () => {
    const select = renderExpirationSelect();
    expect(readExpiration()).toEqual({ mode: 'offset', days: 30 });
    select.removeAttribute('id');
    expect(findExpirationField()?.type).toBe('select');
    select.removeAttribute('name');
    expect(findExpirationField()?.type).toBe('select');
  });

  it('reads no-expiration and custom select options', () => {
    const select = renderExpirationSelect();
    select.value = 'none';
    expect(readExpiration()).toEqual({ mode: 'none' });
    select.value = 'custom';
    select.dispatchEvent(new Event('change'));
    document.querySelector<HTMLInputElement>('input')!.value = '2099-01-01';
    expect(readExpiration()).toEqual({ mode: 'custom', date: '2099-01-01' });
  });

  it('handles selects without a selected option', () => {
    renderExpirationSelect().replaceChildren();
    expect(readExpiration()).toBeNull();
  });

  it('reads direct date fields and text date fallbacks', () => {
    const date = renderDateField();
    expect(readExpiration()).toEqual({ mode: 'custom', date: null });
    const text = document.createElement('input');
    text.type = 'text';
    text.name = 'token_expiration';
    text.value = '2099-02-01';
    document.body.append(text);
    expect(readCustomDate()).toBe('2099-02-01');
    date.value = '2099-01-01';
    expect(readExpiration()).toEqual({ mode: 'custom', date: '2099-01-01' });
    expect(readCustomDate()).toBe('2099-01-01');
  });

  it.each([
    ['90 days', { mode: 'offset', days: 90 }],
    ['No expiration', { mode: 'none' }],
    ['Custom', { mode: 'custom', date: null }],
    ['', null],
  ])('reads expiration button text: %s', (text, expected) => {
    renderExpirationButton(text);
    expect(readExpiration()).toEqual(expected);
  });
});

describe('custom date validation', () => {
  it.each([
    null,
    '',
    'invalid',
    '2026-01-10',
    '2026-01-09',
    '2099-02-30',
    '2099-13-01',
    '2099-1-01',
  ])('rejects invalid or non-future dates: %s', (date) => {
    expect(isFutureDate(date)).toBe(false);
  });

  it('accepts future dates and valid leap days', () => {
    expect(isFutureDate('2026-01-11')).toBe(true);
    expect(isFutureDate('2028-02-29')).toBe(true);
    expect(isFutureDate('2099-02-29')).toBe(false);
  });

  it('does not modify inputs when a date has expired', async () => {
    const date = renderDateField('2099-01-01');
    expect(await setCustomDate('2026-01-09')).toBe(false);
    expect(date.value).toBe('2099-01-01');
  });

  it('reports missing date inputs', async () => {
    expect(await setCustomDate('2099-01-01')).toBe(false);
  });

  it('sets date inputs through bubbling native events and verifies the value', async () => {
    const date = renderDateField();
    const change = vi.fn();
    date.addEventListener('change', change);
    expect(await settle(setCustomDate('2099-01-01'))).toBe(true);
    expect(date.value).toBe('2099-01-01');
    expect(change).toHaveBeenCalledOnce();
    expect(await setCustomDate('2099-01-01')).toBe(true);
    expect(change).toHaveBeenCalledOnce();
  });

  it('supports text inputs and reports controlled-input resets', async () => {
    const input = document.createElement('input');
    input.placeholder = 'YYYY-MM-DD';
    document.body.append(input);
    expect(await settle(setCustomDate('2099-01-01'))).toBe(true);
    input.addEventListener('change', () => {
      input.value = '';
    });
    expect(await settle(setCustomDate('2099-02-01'))).toBe(false);
  });
});

describe('expiration application', () => {
  it('treats unset expiration as a no-op and reports missing controls', async () => {
    expect(await applyExpiration(null)).toBe(true);
    expect(await applyExpiration({ mode: 'none' })).toBe(false);
  });

  it('sets standard options and skips an already selected value', async () => {
    const select = renderExpirationSelect();
    const change = vi.fn();
    select.addEventListener('change', change);
    expect(await settle(applyExpiration({ mode: 'standard', value: '90 DAYS' }))).toBe(true);
    expect(select.value).toBe('90');
    expect(change).toHaveBeenCalledOnce();
    expect(await applyExpiration({ mode: 'standard', value: '90 days' })).toBe(true);
    expect(change).toHaveBeenCalledOnce();
  });

  it('sets no expiration and reports unavailable options', async () => {
    const select = renderExpirationSelect();
    expect(await settle(applyExpiration({ mode: 'none' }))).toBe(true);
    expect(select.value).toBe('none');
    select.querySelector('option[value="custom"]')?.remove();
    expect(await applyExpiration({ mode: 'standard', value: '365 days' })).toBe(false);
  });

  it('sets a custom select date without losing native change events', async () => {
    const select = renderExpirationSelect();
    expect(await settle(applyExpiration({ mode: 'custom', date: '2099-01-01' }))).toBe(true);
    expect(select.value).toBe('custom');
    expect(readExpiration()).toEqual({ mode: 'custom', date: '2099-01-01' });
  });

  it('rejects expired custom dates before modifying the selected mode', async () => {
    const select = renderExpirationSelect();
    expect(await applyExpiration({ mode: 'custom', date: '2026-01-01' })).toBe(false);
    expect(select.value).toBe('30');
  });

  it('supports direct date fields but cannot set a standard mode on them', async () => {
    const date = renderDateField();
    expect(await settle(applyExpiration({ mode: 'custom', date: '2099-01-01' }))).toBe(true);
    expect(date.value).toBe('2099-01-01');
    expect(await applyExpiration({ mode: 'none' })).toBe(false);
  });

  it('sets button standard and no-expiration modes', async () => {
    const button = renderExpirationButton();
    expect(await settle(applyExpiration({ mode: 'standard', value: '90 days' }))).toBe(true);
    expect(button.textContent).toBe('Expiration: 90 days');
    expect(await applyExpiration({ mode: 'standard', value: '90 days' })).toBe(true);
    expect(await settle(applyExpiration({ mode: 'none' }))).toBe(true);
    expect(readExpiration()).toEqual({ mode: 'none' });
  });

  it('can switch a custom expiration button back to a standard mode', async () => {
    renderExpirationButton();
    expect(await settle(applyExpiration({ mode: 'custom', date: '2099-01-01' }))).toBe(true);
    expect(readExpiration()).toEqual({ mode: 'custom', date: '2099-01-01' });
    expect(await settle(applyExpiration({ mode: 'standard', value: '90 days' }))).toBe(true);
    expect(readExpiration()).toEqual({ mode: 'offset', days: 90 });
  });

  it('closes the menu and reports a missing button option', async () => {
    const button = renderExpirationButton();
    button.addEventListener('click', () => {
      for (const item of document.querySelectorAll('[role="menuitem"]')) {
        if (item.textContent === 'No expiration') item.remove();
      }
    });
    const escape = vi.fn();
    document.addEventListener('keydown', escape, { once: true });
    expect(await settle(applyExpiration({ mode: 'none' }))).toBe(false);
    expect(escape.mock.calls[0]?.[0].key).toBe('Escape');
  });

  it('does not set a custom date if React rejected the custom mode', async () => {
    const select = renderExpirationSelect();
    select.addEventListener('change', () => {
      select.value = '30';
    });
    expect(await settle(applyExpiration({ mode: 'custom', date: '2099-01-01' }))).toBe(false);
    expect(document.querySelector<HTMLInputElement>('input')?.value).toBe('');
  });

  it('does not click an expiration option after its instance is cancelled', async () => {
    const button = renderExpirationButton();
    const controller = new AbortController();
    const result = applyExpiration({ mode: 'none' }, controller.signal);
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await assertion;
    expect(button.textContent).toBe('Expiration: 30 days');
  });

  it('does not report success when a controlled select resets its value', async () => {
    const select = renderExpirationSelect();
    select.addEventListener('change', () => {
      select.value = '30';
    });
    expect(await settle(applyExpiration({ mode: 'standard', value: '90 days' }))).toBe(false);
  });
});
