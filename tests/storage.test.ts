import { describe, expect, it, vi } from 'vitest';
import {
  describeExpiration,
  loadProfiles,
  normalizeProfile,
  saveProfiles,
  STORAGE_KEY,
} from '../src/storage';

describe('profile normalization', () => {
  it('keeps v1 permission maps compatible', () => {
    expect(normalizeProfile({ Contents: 'Read and write', Issues: 'Read-only' })).toEqual({
      permissions: { Contents: 'Read and write', Issues: 'Read-only' },
      expiration: null,
      repositoryAccess: null,
    });
  });

  it.each([null, undefined, [], 42, 'invalid'])('rejects invalid profiles: %j', (value) => {
    expect(normalizeProfile(value)).toEqual({
      permissions: {},
      expiration: null,
      repositoryAccess: null,
    });
  });

  it('validates permissions and keeps only non-empty strings', () => {
    expect(
      normalizeProfile({
        permissions: {
          ' Contents ': ' Read-only ',
          Issues: 5,
          Workflows: null,
          ' ': 'Read-only',
          Actions: '',
        },
        expiration: { mode: 'standard', value: ' 90 days ' },
      }),
    ).toEqual({
      permissions: { Contents: 'Read-only' },
      expiration: { mode: 'offset', days: 90 },
      repositoryAccess: null,
    });
  });

  it.each([
    [{ mode: 'none' }, { mode: 'none' }],
    [
      { mode: 'custom', date: ' 2099-01-01 ' },
      { mode: 'custom', date: '2099-01-01' },
    ],
    [{ mode: 'custom' }, { mode: 'custom', date: null }],
    [{ mode: 'standard', value: '' }, null],
    [{ mode: 'standard', value: 30 }, null],
    [{ mode: 'unknown' }, null],
    [[], null],
  ])('normalizes expiration %j', (input, expected) => {
    expect(normalizeProfile({ permissions: [], expiration: input }).expiration).toEqual(expected);
  });

  it('does not treat inherited properties as a v2 profile', () => {
    const value = Object.assign(Object.create({ permissions: { Issues: 'Read and write' } }), {
      Contents: 'Read-only',
    });
    expect(normalizeProfile(value).permissions).toEqual({ Contents: 'Read-only' });
  });
});

describe('profile storage', () => {
  it('loads legacy and modern profiles from the unchanged storage key', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        legacy: { Contents: 'Read-only' },
        current: { permissions: { Issues: 'Read and write' }, expiration: { mode: 'none' } },
      }),
    );
    const profiles = loadProfiles();
    expect(profiles.legacy?.permissions).toEqual({ Contents: 'Read-only' });
    expect(profiles.current?.expiration).toEqual({ mode: 'none' });
  });

  it.each(['null', '[]', '42', '"invalid"'])('handles invalid top-level JSON: %s', (value) => {
    localStorage.setItem(STORAGE_KEY, value);
    expect(loadProfiles()).toEqual({});
  });

  it('does not erase malformed storage while reading', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(STORAGE_KEY, '{broken');
    expect(loadProfiles()).toEqual({});
    expect(localStorage.getItem(STORAGE_KEY)).toBe('{broken');
  });

  it('handles unavailable localStorage', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      loadProfiles({
        getItem: () => {
          throw new Error('Denied');
        },
      }),
    ).toEqual({});
  });

  it('ignores invalid profile entries but keeps valid entries', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ good: { Contents: 'Read-only' }, bad: [], ' ': {} }),
    );
    expect(Object.keys(loadProfiles())).toEqual(['good']);
  });

  it('round-trips safe special names without prototype pollution', () => {
    const profiles = JSON.parse(
      '{"__proto__":{"permissions":{"Contents":"Read-only"},"expiration":null}}',
    );
    saveProfiles(profiles);
    const loaded = loadProfiles();
    expect(Object.hasOwn(loaded, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(loaded)).toBe(Object.prototype);
    expect(loaded['__proto__']?.permissions).toEqual({ Contents: 'Read-only' });
  });

  it('writes only profile metadata to the original key', () => {
    saveProfiles({ dev: { permissions: { Contents: 'Read-only' }, expiration: null } });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')).toEqual({
      dev: { permissions: { Contents: 'Read-only' }, expiration: null, repositoryAccess: null },
    });
  });

  it('lets callers surface write failures', () => {
    expect(() =>
      saveProfiles(
        {},
        {
          setItem: () => {
            throw new Error('Quota exceeded');
          },
        },
      ),
    ).toThrow('Quota exceeded');
  });
});

describe('expiration descriptions', () => {
  it.each([
    [null, '未设置'],
    [{ mode: 'none' } as const, '永不过期'],
    [{ mode: 'custom', date: null } as const, '自定义 （无日期）'],
    [{ mode: 'custom', date: '2099-01-01' } as const, '自定义 2099-01-01'],
    [{ mode: 'standard', value: '30 days' } as const, '30 days'],
  ])('describes %j', (value, expected) => {
    expect(describeExpiration(value)).toBe(expected);
  });
});
