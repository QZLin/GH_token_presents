import { normalizeExpiration, parseDate } from './expiration-values';
import { PERMISSION_NAMES } from './permission-names';
import { normalizeRepositoryAccess } from './repository-access';
import { normalizeProfile } from './storage';
import type { Permissions, Profile, ProfileStore } from './types';

const LEVELS = new Map([
  ['read-only', 'Read-only'],
  ['read and write', 'Read and write'],
  ['write-only', 'Write-only'],
  ['no access', 'No access'],
  ['admin', 'Admin'],
  ['read', 'Read-only'],
  ['write', 'Read and write'],
  ['none', 'No access'],
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function importedProfile(name: string, value: unknown): Profile {
  if (!isRecord(value)) throw new Error(`Profile "${name}" 必须是 JSON 对象`);
  const modern = ['permissions', 'expiration', 'repositoryAccess'].some((key) =>
    Object.hasOwn(value, key),
  );
  const rawPermissions = modern
    ? Object.hasOwn(value, 'permissions')
      ? value.permissions
      : {}
    : value;
  if (!isRecord(rawPermissions)) throw new Error(`Profile "${name}" 的 permissions 必须是对象`);
  const permissions: Permissions = Object.fromEntries(
    Object.entries(rawPermissions).map(([permission, level]) => {
      if (!permission.trim() || (!modern && !PERMISSION_NAMES.has(permission.trim()))) {
        throw new Error(`Profile "${name}" 包含无效的权限名称`);
      }
      if (typeof level !== 'string') throw new Error(`Profile "${name}" 的权限级别必须是字符串`);
      const normalized = LEVELS.get(level.replace(/\s+/g, ' ').trim().toLowerCase());
      if (!normalized) throw new Error(`Profile "${name}" 的权限 "${permission}" 级别不受支持`);
      return [permission.trim(), normalized];
    }),
  );
  if (modern && Object.hasOwn(value, 'expiration') && value.expiration !== null) {
    const expiration = normalizeExpiration(value.expiration);
    if (!expiration) throw new Error(`Profile "${name}" 的 expiration 无效`);
    if (expiration.mode === 'custom' && isRecord(value.expiration)) {
      const date = value.expiration.date;
      if (
        date !== undefined &&
        date !== null &&
        (typeof date !== 'string' || !parseDate(date.trim()))
      ) {
        throw new Error(`Profile "${name}" 的固定日期无效`);
      }
    }
  }
  if (
    modern &&
    Object.hasOwn(value, 'repositoryAccess') &&
    value.repositoryAccess !== null &&
    !normalizeRepositoryAccess(value.repositoryAccess)
  ) {
    throw new Error(`Profile "${name}" 的 Repository access 模式无效`);
  }
  return normalizeProfile(modern ? { ...value, permissions } : permissions);
}

export function parseProfileImport(text: string): ProfileStore {
  if (!text.trim()) throw new Error('请先粘贴 profile JSON');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('JSON 格式错误，请粘贴完整的导出内容');
  }
  if (!isRecord(parsed)) throw new Error('JSON 顶层必须是 {"Profile 名称": profile} 对象');
  const entries = Object.entries(parsed);
  if (!entries.length) throw new Error('JSON 中没有可导入的 profile');
  return Object.fromEntries(
    entries.map(([name, value]) => {
      if (!name.trim()) throw new Error('Profile 名称不能为空');
      return [name, importedProfile(name, value)];
    }),
  );
}

export function importConflicts(existing: ProfileStore, incoming: ProfileStore): string[] {
  return Object.keys(incoming).filter((name) => Object.hasOwn(existing, name));
}

export function mergeProfileImport(existing: ProfileStore, incoming: ProfileStore): ProfileStore {
  // Object.fromEntries safely preserves names such as __proto__ without invoking setters.
  return Object.fromEntries([...Object.entries(existing), ...Object.entries(incoming)]);
}
