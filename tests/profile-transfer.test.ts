import { describe, expect, it } from 'vitest';
import { importConflicts, mergeProfileImport, parseProfileImport } from '../src/profile-transfer';

const profile = {
  permissions: { Contents: 'Read-only' },
  expiration: { mode: 'offset' as const, days: 30 },
  repositoryAccess: 'selected' as const,
};

describe('copy/paste profile import validation', () => {
  it('round-trips canonical exported profiles', () => {
    expect(parseProfileImport(JSON.stringify({ dev: profile }))).toEqual({ dev: profile });
  });
  it('migrates legacy maps and expiration labels, including level aliases', () => {
    expect(
      parseProfileImport(
        JSON.stringify({
          old: { Contents: 'read', Issues: 'write', Actions: 'none' },
          modern: {
            permissions: { Contents: ' read-only ' },
            expiration: { mode: 'standard', value: '90 days' },
          },
        }),
      ),
    ).toEqual({
      old: {
        permissions: { Contents: 'Read-only', Issues: 'Read and write', Actions: 'No access' },
        expiration: null,
        repositoryAccess: null,
      },
      modern: {
        permissions: { Contents: 'Read-only' },
        expiration: { mode: 'offset', days: 90 },
        repositoryAccess: null,
      },
    });
  });
  it('keeps supported metadata only and never stores repo identities', () => {
    const imported = parseProfileImport(
      JSON.stringify({
        dev: {
          ...profile,
          repositoryAccess: { mode: 'selected', repositoryIds: ['PRIVATE_ID'] },
          repositories: ['PRIVATE_NAME'],
          expiration: { mode: 'offset', days: 30, date: '2099-01-01', value: '30 days' },
        },
      }),
    );
    expect(imported).toEqual({ dev: profile });
    expect(JSON.stringify(imported)).not.toContain('PRIVATE_');
    expect(JSON.stringify(imported)).not.toContain('2099-01-01');
  });
  it.each(['', '   ', '{broken', '{}', '[]', 'null', '42', '"text"'])(
    'rejects invalid/empty pasted JSON: %s',
    (text) => {
      expect(() => parseProfileImport(text)).toThrow();
    },
  );
  it.each([
    { dev: null },
    { dev: [] },
    { dev: 'invalid' },
    { ' ': {} },
    { dev: { permissions: [] } },
    { dev: { permissions: null } },
    { dev: { permissions: { Contents: 7 } } },
    { dev: { permissions: { Contents: '' } } },
    { dev: { permissions: { Contents: 'SENSITIVE_NOT_A_PERMISSION' } } },
    { dev: { SomeUnrelatedSecret: 'DO_NOT_STORE' } },
    { dev: { permissions: { ' ': 'Read-only' } } },
    { dev: { expiration: { mode: 'offset', days: 0 } } },
    { dev: { expiration: { mode: 'custom', date: '2099-02-30' } } },
    { dev: { expiration: { mode: 'custom', date: 7 } } },
    { dev: { repositoryAccess: 'invalid' } },
  ])('rejects invalid profiles atomically: %j', (value) => {
    expect(() => parseProfileImport(JSON.stringify({ valid: profile, ...value }))).toThrow();
  });
  it('retains valid past fixed dates and legacy empty date intent rather than silently changing it', () => {
    expect(
      parseProfileImport(
        JSON.stringify({
          old: { expiration: { mode: 'custom', date: '2020-01-01' } },
          unset: { expiration: { mode: 'custom', date: null } },
          missing: { expiration: { mode: 'custom' } },
        }),
      ).old?.expiration,
    ).toEqual({ mode: 'custom', date: '2020-01-01' });
  });
  it('allows repository-only and intentionally empty profiles', () => {
    expect(parseProfileImport('{"empty":{},"repo":{"repositoryAccess":"all"}}')).toEqual({
      empty: { permissions: {}, expiration: null, repositoryAccess: null },
      repo: { permissions: {}, expiration: null, repositoryAccess: 'all' },
    });
  });
  it('merges names safely without mutating inputs or polluting prototypes', () => {
    const existing = { dev: profile };
    const incoming = parseProfileImport(
      '{"__proto__":{"permissions":{"Issues":"Read-only"}},"dev":{"permissions":{}}}',
    );
    expect(importConflicts(existing, incoming)).toEqual(['dev']);
    const merged = mergeProfileImport(existing, incoming);
    expect(Object.hasOwn(merged, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(merged.dev?.permissions).toEqual({});
    expect(existing.dev).toBe(profile);
  });
});
