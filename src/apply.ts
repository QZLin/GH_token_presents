import { findMenuItemByText, closeMenu, sleep, waitFor } from './dom';
import { applyExpiration, readExpiration } from './expiration';
import {
  capturePermissionSurface,
  ensurePermissionButton,
  waitForPermissionSurfaceAfterRepositoryChange,
} from './permission-picker';
import {
  buildButtonMap,
  getAllAccessButtons,
  getCurrentLevel,
  getPermissionName,
  isNoAccess,
  readPermissions,
  removePermission,
  waitForLevel,
} from './permissions';
import {
  applyRepositoryAccess,
  describeRepositoryAccess,
  readRepositoryAccess,
} from './repository-access';
import { describeExpiration, normalizeProfile } from './storage';
import type { ApplyOptions, ApplyResult, Profile, StatusReporter } from './types';

export function readCurrentState(): Profile {
  return {
    permissions: readPermissions(),
    expiration: readExpiration(),
    repositoryAccess: readRepositoryAccess(),
  };
}

export async function applyProfile(
  profile: unknown,
  report: StatusReporter = () => {},
  signal?: AbortSignal,
  options: ApplyOptions = {},
): Promise<ApplyResult> {
  signal?.throwIfAborted();
  const { permissions, expiration, repositoryAccess } = normalizeProfile(profile);
  const names = Object.keys(permissions).filter((name) => name !== 'Metadata');
  const removeExtras = options.removeUnrecordedPermissions === true;
  const result: ApplyResult = {
    permissionsApplied: 0,
    permissionsTotal: names.length,
    permissionsRemoved: 0,
    permissionsToRemove: 0,
    unrecognizedPermissions: 0,
    expirationApplied: expiration === null,
    repositoryAccessApplied: true,
    permissionSurfaceReady: true,
  };

  if (repositoryAccess) {
    const previousRepositoryAccess = readRepositoryAccess();
    const permissionSurfaceBefore = capturePermissionSurface();
    report(`设置 Repository access：${describeRepositoryAccess(repositoryAccess)}…`);
    result.repositoryAccessApplied = await applyRepositoryAccess(repositoryAccess, signal);
    if (!result.repositoryAccessApplied) {
      // Never apply privileges in a broader/wrong repository scope after failure.
      report('Repository access 未应用，已停止权限及过期时间修改');
      return result;
    }
    if (previousRepositoryAccess !== repositoryAccess) {
      report('等待 Repository access 更新权限列表…');
      result.permissionSurfaceReady = await waitForPermissionSurfaceAfterRepositoryChange(
        permissionSurfaceBefore,
        signal,
      );
      if (!result.permissionSurfaceReady) {
        report('Repository access 已应用，但权限列表未稳定，已停止后续修改');
        return result;
      }
    }
  }
  if (removeExtras) {
    const extra = [...buildButtonMap().keys()].filter(
      (name) => name !== 'Metadata' && !Object.hasOwn(permissions, name),
    );
    result.permissionsToRemove = extra.length;
    for (const [index, name] of extra.entries()) {
      signal?.throwIfAborted();
      report(`清理未记录权限 ${index + 1}/${extra.length}：${name}…`);
      if (await removePermission(name, signal)) result.permissionsRemoved++;
      else console.warn('[profiles] 未能移除未记录权限:', name);
    }
    result.unrecognizedPermissions = getAllAccessButtons().filter(
      (button) => !getPermissionName(button),
    ).length;
  }

  let processed = 0;
  report(`应用中 0/${names.length}…`);
  for (const name of names) {
    signal?.throwIfAborted();
    const target = permissions[name];
    processed++;
    if (isNoAccess(target || null)) {
      if (await removePermission(name, signal)) result.permissionsApplied++;
      report(`应用中 ${processed}/${names.length}`);
      continue;
    }
    const button =
      buildButtonMap().get(name) || (await ensurePermissionButton(name, signal, report));
    if (!button || !target) {
      console.warn('[profiles] 找不到权限按钮:', name);
      report(`应用中 ${processed}/${names.length}（跳过 ${name}）`);
      continue;
    }
    if (getCurrentLevel(button) === target) {
      result.permissionsApplied++;
      report(`应用中 ${processed}/${names.length}`);
      continue;
    }
    button.click();
    const item = await waitFor(() => findMenuItemByText(target), 1500, signal);
    if (!item) {
      console.warn('[profiles] 找不到菜单项:', target, '（', name, '）');
      closeMenu();
      report(`应用中 ${processed}/${names.length}（失败 ${name}）`);
      continue;
    }
    signal?.throwIfAborted();
    item.click();
    if (await waitForLevel(name, target, 1500, signal)) result.permissionsApplied++;
    else console.warn('[profiles] 状态未更新:', name, target);
    report(`应用中 ${processed}/${names.length}`);
    await sleep(80, signal);
  }

  if (expiration) {
    report(`设置过期时间：${describeExpiration(expiration)}…`);
    result.expirationApplied = await applyExpiration(expiration, signal);
  }

  const removed = removeExtras
    ? `；移除 ${result.permissionsRemoved}/${result.permissionsToRemove}`
    : '';
  const unidentified = result.unrecognizedPermissions
    ? `；${result.unrecognizedPermissions} 项权限无法识别，未移除`
    : '';
  report(
    `完成：权限 ${result.permissionsApplied}/${names.length}${removed}${unidentified}${result.expirationApplied ? '' : '；过期时间未完全应用'}`,
  );
  return result;
}
