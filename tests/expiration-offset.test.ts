import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyExpiration, readExpiration } from '../src/expiration';
import { dateAtOffset } from '../src/expiration-values';
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

describe('offset expiration application', () => {
  it('records only an offset even when a standard option stores an absolute date', async () => {
    const select = renderExpirationSelect();
    select.options[0]!.value = '2026-02-09';
    expect(readExpiration()).toEqual({ mode: 'offset', days: 30 });
    expect(await applyExpiration({ mode: 'offset', days: 30 })).toBe(true);
    expect(select.value).toBe('2026-02-09');
  });
  it('does not reuse dated standard options after the day changes', async () => {
    const select = renderExpirationSelect();
    select.options[0]!.value = '2026-02-09';
    vi.setSystemTime(new Date('2026-01-11T12:00:00'));
    expect(await settle(applyExpiration({ mode: 'offset', days: 30 }))).toBe(true);
    expect(select.value).toBe('custom');
    expect(document.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe(
      '2026-02-10',
    );
    expect(readExpiration()).toEqual({ mode: 'offset', days: 30 });
  });
  it('converts otherwise-unlabelled date-valued/numeric choices into offsets', () => {
    const select = renderExpirationSelect();
    select.options[0]!.textContent = 'Expires on a relative date';
    select.options[0]!.value = '2026-01-25';
    expect(readExpiration()).toEqual({ mode: 'offset', days: 15 });
    select.options[0]!.value = '14';
    expect(readExpiration()).toEqual({ mode: 'offset', days: 14 });
    select.options[0]!.value = '1705000000';
    expect(readExpiration()).toBeNull();
  });
  it('uses Custom only as a control fallback, without recording the generated date', async () => {
    renderExpirationSelect();
    expect(await settle(applyExpiration({ mode: 'offset', days: 37 }))).toBe(true);
    const input = document.querySelector<HTMLInputElement>('input[type="date"]')!;
    expect(input.value).toBe('2026-02-16');
    expect(readExpiration()).toEqual({ mode: 'offset', days: 37 });
    const unrelated = document.createElement('input');
    document.body.append(unrelated);
    unrelated.dispatchEvent(new Event('input', { bubbles: true }));
    expect(readExpiration()).toEqual({ mode: 'offset', days: 37 });
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(readExpiration()).toEqual({ mode: 'custom', date: '2026-02-16' });
  });
  it('keeps offset intent when React replaces expiration controls', async () => {
    const select = renderExpirationSelect();
    expect(await settle(applyExpiration({ mode: 'offset', days: 37 }))).toBe(true);
    const replacement = select.cloneNode(true) as HTMLSelectElement;
    replacement.value = 'custom';
    select.replaceWith(replacement);
    const date = document.querySelector('input')!;
    date.replaceWith(date.cloneNode(true));
    expect(readExpiration()).toEqual({ mode: 'offset', days: 37 });
  });
  it('treats an explicitly applied fixed date as fixed, even when equal to a generated date', async () => {
    renderExpirationSelect();
    expect(await settle(applyExpiration({ mode: 'offset', days: 37 }))).toBe(true);
    expect(await applyExpiration({ mode: 'custom', date: '2026-02-16' })).toBe(true);
    expect(readExpiration()).toEqual({ mode: 'custom', date: '2026-02-16' });
  });
  it('recomputes direct-date controls from the application day', async () => {
    const input = renderDateField();
    expect(await settle(applyExpiration({ mode: 'offset', days: 7 }))).toBe(true);
    expect(input.value).toBe('2026-01-17');
    vi.setSystemTime(new Date('2026-02-01T12:00:00'));
    expect(await settle(applyExpiration({ mode: 'offset', days: 7 }))).toBe(true);
    expect(input.value).toBe('2026-02-08');
    expect(readExpiration()).toEqual({ mode: 'offset', days: 7 });
  });
  it('supports button-based offset choices and custom fallback', async () => {
    renderExpirationButton();
    expect(await settle(applyExpiration({ mode: 'offset', days: 90 }))).toBe(true);
    expect(readExpiration()).toEqual({ mode: 'offset', days: 90 });
    expect(await settle(applyExpiration({ mode: 'offset', days: 14 }))).toBe(true);
    expect(readExpiration()).toEqual({ mode: 'offset', days: 14 });
    expect(document.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe(
      '2026-01-24',
    );
  });
  it('does not alter controls for invalid offset configurations', async () => {
    const input = renderDateField('2099-01-01');
    for (const days of [0, -1, 2.5, Number.MAX_SAFE_INTEGER]) {
      expect(await applyExpiration({ mode: 'offset', days })).toBe(false);
    }
    expect(input.value).toBe('2099-01-01');
  });
  it('honors date min/max and read-only restrictions before writing', async () => {
    const input = renderDateField('2099-01-01');
    input.max = '2026-01-20';
    expect(await applyExpiration({ mode: 'offset', days: 30 })).toBe(false);
    expect(input.value).toBe('2099-01-01');
    input.max = '';
    input.min = '2026-03-01';
    expect(await applyExpiration({ mode: 'offset', days: 30 })).toBe(false);
    input.min = '';
    input.readOnly = true;
    expect(await applyExpiration({ mode: 'offset', days: 30 })).toBe(false);
    input.readOnly = false;
    input.disabled = true;
    expect(await applyExpiration({ mode: 'offset', days: 30 })).toBe(false);
  });
  it('does not click disabled standard options or silently keep a reset value', async () => {
    const select = renderExpirationSelect();
    select.options[1]!.disabled = true;
    select.options[3]!.disabled = true;
    expect(await applyExpiration({ mode: 'offset', days: 90 })).toBe(false);
    select.options[1]!.disabled = false;
    select.disabled = true;
    expect(await applyExpiration({ mode: 'offset', days: 90 })).toBe(false);
    select.disabled = false;
    select.addEventListener('change', () => {
      select.value = '30';
    });
    expect(await settle(applyExpiration({ mode: 'offset', days: 90 }))).toBe(false);
  });
  it('retains a relative offset after no-op reads, but clears it for changed modes', async () => {
    const select = renderExpirationSelect();
    expect(await settle(applyExpiration({ mode: 'offset', days: 37 }))).toBe(true);
    select.value = 'none';
    expect(readExpiration()).toEqual({ mode: 'none' });
    expect(dateAtOffset(37)).toBe('2026-02-16');
  });
});
