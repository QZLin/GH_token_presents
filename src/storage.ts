import { normalizeExpiration } from './expiration-values';
import { normalizeRepositoryAccess } from './repository-access';
import type { Permissions, Profile, ProfileStore } from './types';

// Keep the original key: v1 permission maps and v2 profiles must remain readable.
export const STORAGE_KEY = 'gh-fg-token-presets-v1';

type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = Pick<Storage, 'setItem'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizePermissions(value: unknown): Permissions {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([name, level]) => name.trim() && typeof level === 'string' && level.trim())
      .map(([name, level]) => [name.trim(), (level as string).trim()]),
  );
}

export function normalizeProfile(value: unknown): Profile {
  if (!isRecord(value)) return { permissions: {}, expiration: null, repositoryAccess: null };
  const isModern = ['permissions', 'expiration', 'repositoryAccess'].some((key) =>
    Object.hasOwn(value, key),
  );
  return {
    permissions: normalizePermissions(isModern ? value.permissions : value),
    expiration: isModern ? normalizeExpiration(value.expiration) : null,
    repositoryAccess: isModern ? normalizeRepositoryAccess(value.repositoryAccess) : null,
  };
}

function normalizeStore(value: Record<string, unknown>): ProfileStore {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([name, profile]) => name.trim() && isRecord(profile))
      .map(([name, profile]) => [name, normalizeProfile(profile)]),
  );
}

export function loadProfiles(storage: StorageReader = localStorage): ProfileStore {
  try {
    const value: unknown = JSON.parse(storage.getItem(STORAGE_KEY) || '{}');
    return isRecord(value) ? normalizeStore(value) : {};
  } catch (error) {
    console.warn('[profiles] 无法读取已保存的配置:', error);
    return {};
  }
}

export function saveProfiles(
  profiles: Record<string, unknown>,
  storage: StorageWriter = localStorage,
): void {
  // Always write the canonical shape: no repository identities or old expiration labels.
  storage.setItem(STORAGE_KEY, JSON.stringify(normalizeStore(profiles)));
}

export function describeExpiration(value: unknown): string {
  const expiration = normalizeExpiration(value);
  if (!expiration) return '未设置';
  switch (expiration.mode) {
    case 'none':
      return '永不过期';
    case 'custom':
      return `自定义 ${expiration.date || '（无日期）'}`;
    case 'offset':
      return `${expiration.days} days`;
  }
}
