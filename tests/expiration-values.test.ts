import { describe, expect, it } from 'vitest';
import {
  dateAtOffset,
  daysUntilDate,
  isOffsetDays,
  normalizeExpiration,
  offsetFromText,
  parseDate,
} from '../src/expiration-values';

const today = new Date('2026-01-10T23:30:00');

describe('relative expiration values', () => {
  it.each([0, -1, 1.5, NaN, Infinity, '30', null, Number.MAX_SAFE_INTEGER + 1])(
    'rejects non-positive/inexact offsets: %j',
    (value) => {
      expect(isOffsetDays(value)).toBe(false);
    },
  );
  it('accepts positive integer day offsets', () => {
    expect(isOffsetDays(1)).toBe(true);
    expect(isOffsetDays(365)).toBe(true);
  });
  it.each(['2026-02-30', '2026-13-01', '2026-1-10', '', 'invalid', null])(
    'validates date strings: %s',
    (date) => {
      expect(parseDate(date)).toBeNull();
    },
  );
  it('counts local calendar days, including leap years and date boundaries', () => {
    expect(daysUntilDate('2026-01-11', today)).toBe(1);
    expect(daysUntilDate('2026-01-09', today)).toBe(-1);
    expect(daysUntilDate('2026-01-10', today)).toBe(0);
    expect(dateAtOffset(1, new Date('2026-12-31T23:59:00'))).toBe('2027-01-01');
    expect(dateAtOffset(1, new Date('2028-02-28T12:00:00'))).toBe('2028-02-29');
    expect(dateAtOffset(2, new Date('2028-02-28T12:00:00'))).toBe('2028-03-01');
    expect(daysUntilDate('2026-03-10', new Date('2026-03-07T23:00:00'))).toBe(3);
  });
  it('rejects invalid bases or dates outside the representable calendar', () => {
    expect(daysUntilDate('2026-01-11', new Date(NaN))).toBeNull();
    expect(dateAtOffset(0, today)).toBeNull();
    expect(dateAtOffset(1, new Date(NaN))).toBeNull();
    expect(dateAtOffset(Number.MAX_SAFE_INTEGER, today)).toBeNull();
    expect(dateAtOffset(1, new Date('9999-12-31T12:00:00'))).toBeNull();
  });
  it.each([
    ['30 days', 30],
    ['90 DAYS', 90],
    ['Expires in 2 weeks', 14],
    ['1 day', 1],
    ['0 days', null],
    ['No expiration', null],
    ['tomorrow', null],
  ])('extracts offset from %s', (text, expected) => {
    expect(offsetFromText(text, today)).toBe(expected);
  });
  it('converts month/year choices to their captured calendar-day offset', () => {
    expect(offsetFromText('1 month', new Date('2026-01-31T12:00:00'))).toBe(28);
    expect(offsetFromText('1 month', new Date('2028-01-31T12:00:00'))).toBe(29);
    expect(offsetFromText('1 year', new Date('2028-02-29T12:00:00'))).toBe(365);
    expect(offsetFromText('1 year', new Date('2027-03-01T12:00:00'))).toBe(366);
    expect(offsetFromText(`${Number.MAX_SAFE_INTEGER} weeks`, today)).toBeNull();
    expect(offsetFromText(`${Number.MAX_SAFE_INTEGER} months`, today)).toBeNull();
    expect(offsetFromText(`${Number.MAX_SAFE_INTEGER} years`, today)).toBeNull();
  });
  it('keeps only numeric offsets and migrates old standard labels', () => {
    expect(normalizeExpiration({ mode: 'standard', value: ' 30 days ' })).toEqual({
      mode: 'offset',
      days: 30,
    });
    expect(
      normalizeExpiration({ mode: 'offset', days: 30, value: '30 days', date: '2099-01-01' }),
    ).toEqual({ mode: 'offset', days: 30 });
    expect(normalizeExpiration({ mode: 'standard', value: 'No expiration' })).toEqual({
      mode: 'none',
    });
    expect(normalizeExpiration({ mode: 'custom', date: ' 2099-01-01 ' })).toEqual({
      mode: 'custom',
      date: '2099-01-01',
    });
  });
  it.each([
    { mode: 'offset', days: 0 },
    { mode: 'offset', days: '30' },
    { mode: 'offset', days: 2.5 },
    { mode: 'standard', value: 'unknown' },
    {},
    null,
    [],
  ])('ignores malformed expiration %j', (value) => {
    expect(normalizeExpiration(value)).toBeNull();
  });
});
