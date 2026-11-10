import type { Expiration } from './types';

export function isOffsetDays(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function parseDate(date: string | null): Date | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const value = new Date(`${date}T12:00:00`);
  const [year, month, day] = date.split('-').map(Number);
  return Number.isFinite(value.getTime()) &&
    value.getFullYear() === year &&
    value.getMonth() + 1 === month &&
    value.getDate() === day
    ? value
    : null;
}

function calendarDay(value: Date): number {
  // UTC is used only for day numbers: DST must not turn an offset into 23/25 hours.
  return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / 86_400_000;
}

export function daysUntilDate(date: string | null, today = new Date()): number | null {
  const value = parseDate(date);
  if (!value) return null;
  const days = calendarDay(value) - calendarDay(today);
  return Number.isSafeInteger(days) ? days : null;
}

export function dateAtOffset(days: number, today = new Date()): string | null {
  if (!isOffsetDays(days)) return null;
  const value = new Date(today);
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() + days);
  const year = value.getFullYear();
  if (!Number.isFinite(value.getTime()) || year < 0 || year > 9999) return null;
  return `${String(year).padStart(4, '0')}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

export function offsetFromText(text: string, today = new Date()): number | null {
  const match = text.match(/(?:^|\s)(\d+)\s*(days?|weeks?|months?|years?)\b/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!isOffsetDays(amount)) return null;
  const unit = match[2]?.toLowerCase();
  if (unit?.startsWith('day')) return amount;
  if (unit?.startsWith('week')) return isOffsetDays(amount * 7) ? amount * 7 : null;

  const target = new Date(today);
  target.setHours(12, 0, 0, 0);
  const day = target.getDate();
  target.setDate(1);
  if (unit?.startsWith('month')) target.setMonth(target.getMonth() + amount);
  else target.setFullYear(target.getFullYear() + amount);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  const days = calendarDay(target) - calendarDay(today);
  return isOffsetDays(days) ? days : null;
}

export function normalizeExpiration(value: unknown): Expiration | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const expiration = value as Record<string, unknown>;
  if (expiration.mode === 'none') return { mode: 'none' };
  if (expiration.mode === 'custom') {
    return {
      mode: 'custom',
      date: typeof expiration.date === 'string' ? expiration.date.trim() : null,
    };
  }
  if (expiration.mode === 'offset' && isOffsetDays(expiration.days)) {
    return { mode: 'offset', days: expiration.days };
  }
  // Migrate old {mode: 'standard', value: '30 days'} without retaining its label.
  if (expiration.mode === 'standard' && typeof expiration.value === 'string') {
    if (/no expiration|never expires?/i.test(expiration.value)) return { mode: 'none' };
    const days = offsetFromText(expiration.value.trim());
    if (days !== null) return { mode: 'offset', days };
  }
  return null;
}
