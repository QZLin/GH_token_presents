import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyProfile } from '../src/apply';
import { buildButtonMap, getCurrentLevel } from '../src/permissions';
import { readRepositoryAccess } from '../src/repository-access';
import { loadProfiles, normalizeProfile, saveProfiles, STORAGE_KEY } from '../src/storage';
import { mountPanel } from '../src/ui';
import type { PanelController } from '../src/ui';
import { renderExpirationSelect, renderPermission, renderRepositoryAccess } from './fixtures';

let controller: PanelController | null = null;
async function settle<T>(promise: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return promise;
}
function mount(): HTMLElement {
  controller = mountPanel();
  if (!controller) throw new Error('Missing panel');
  return controller.element;
}
function button(panel: HTMLElement, action: string): HTMLButtonElement {
  return panel.querySelector<HTMLButtonElement>(`[data-act="${action}"]`)!;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-10T12:00:00'));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  controller?.dispose();
  controller = null;
});

describe('profile metadata privacy and migration', () => {
  it('stores only repository mode and offset, not repo identities or old expiration labels', () => {
    saveProfiles({
      dev: {
        permissions: { Contents: 'Read-only' },
        repositoryAccess: {
          mode: 'selected',
          repositories: ['PRIVATE_REPOSITORY_NAME'],
          repositoryIds: ['PRIVATE_ID'],
        },
        repositories: ['DO_NOT_STORE'],
        repositoryIds: ['DO_NOT_STORE_ID'],
        expiration: { mode: 'offset', days: 30, value: '30 days', date: '2099-01-01' },
      },
    });
    expect(loadProfiles().dev).toEqual({
      permissions: { Contents: 'Read-only' },
      repositoryAccess: 'selected',
      expiration: { mode: 'offset', days: 30 },
    });
    const serialized = localStorage.getItem(STORAGE_KEY)!;
    for (const secret of ['PRIVATE_', 'DO_NOT_STORE', '2099-01-01', '30 days'])
      expect(serialized).not.toContain(secret);
  });
  it('migrates standard expiration labels and leaves old repository scope unspecified', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        old: {
          permissions: { Issues: 'Read-only' },
          expiration: { mode: 'standard', value: '90 days' },
        },
      }),
    );
    expect(loadProfiles().old).toEqual({
      permissions: { Issues: 'Read-only' },
      expiration: { mode: 'offset', days: 90 },
      repositoryAccess: null,
    });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).old.expiration.mode).toBe('standard');
    saveProfiles(loadProfiles());
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).old.expiration).toEqual({
      mode: 'offset',
      days: 90,
    });
  });
  it('supports a repository-only profile and drops unsupported metadata', () => {
    expect(
      normalizeProfile({
        repositoryAccess: 'all',
        repositoryIds: ['private'],
        removeUnrecordedPermissions: true,
      }),
    ).toEqual({ permissions: {}, expiration: null, repositoryAccess: 'all' });
  });
});

describe('application scope and optional cleanup', () => {
  it('preserves extra permissions by default', async () => {
    renderPermission('Contents');
    const extra = renderPermission('Issues', 'Read and write', { removable: true });
    const result = await applyProfile({ Contents: 'Read-only' });
    expect(extra.isConnected).toBe(true);
    expect(result.permissionsRemoved).toBe(0);
    expect(result.permissionsToRemove).toBe(0);
  });
  it('removes unrecorded permissions while always preserving Metadata', async () => {
    renderPermission('Contents');
    const extra = renderPermission('Issues', 'Read and write', {
      removable: true,
      levels: ['Read-only', 'Read and write'],
    });
    const metadata = renderPermission('Metadata', 'Read-only', { removable: true });
    const report = vi.fn();
    const result = await settle(
      applyProfile({ Contents: 'Read-only' }, report, undefined, {
        removeUnrecordedPermissions: true,
      }),
    );
    expect(extra.isConnected).toBe(false);
    expect(metadata.isConnected).toBe(true);
    expect(result.permissionsRemoved).toBe(1);
    expect(result.permissionsToRemove).toBe(1);
    expect(result.permissionsApplied).toBe(1);
    expect(report).toHaveBeenLastCalledWith('完成：权限 1/1；移除 1/1');
  });
  it('re-resolves recorded permissions after cleanup triggers React replacement', async () => {
    let contents = renderPermission('Contents');
    renderPermission('Issues', 'Read-only', {
      removable: true,
      onRemove: () => {
        contents.remove();
        contents = renderPermission('Contents');
      },
    });
    const result = await settle(
      applyProfile({ Contents: 'Read and write' }, undefined, undefined, {
        removeUnrecordedPermissions: true,
      }),
    );
    expect(result.permissionsRemoved).toBe(1);
    expect(result.permissionsApplied).toBe(1);
    expect(getCurrentLevel(buildButtonMap().get('Contents')!)).toBe('Read and write');
  });
  it('reports cleanup failures and leaves unidentified controls untouched', async () => {
    renderPermission('Contents');
    const extra = renderPermission('Actions', 'Read and write', { levels: [] });
    const unknown = renderPermission('Unknown permission');
    const report = vi.fn();
    const result = await settle(
      applyProfile({ Contents: 'Read-only' }, report, undefined, {
        removeUnrecordedPermissions: true,
      }),
    );
    expect(result.permissionsRemoved).toBe(0);
    expect(result.permissionsToRemove).toBe(1);
    expect(result.unrecognizedPermissions).toBe(1);
    expect(extra.isConnected).toBe(true);
    expect(unknown.isConnected).toBe(true);
    expect(report.mock.lastCall?.[0]).toContain('移除 0/1；1 项权限无法识别，未移除');
  });
  it('can clear all optional permissions for an empty profile when explicitly enabled', async () => {
    renderPermission('Contents', 'Read-only', { removable: true });
    renderPermission('Metadata', 'Read-only', { removable: true });
    const result = await settle(
      applyProfile({}, undefined, undefined, { removeUnrecordedPermissions: true }),
    );
    expect(result.permissionsTotal).toBe(0);
    expect(result.permissionsRemoved).toBe(1);
    expect(buildButtonMap().has('Metadata')).toBe(true);
  });
  it('honors explicit legacy No access instructions even when cleanup is off', async () => {
    renderPermission('Contents', 'Read-only', { removable: true });
    const result = await settle(applyProfile({ Contents: 'No access' }));
    expect(result.permissionsApplied).toBe(1);
    expect(buildButtonMap().has('Contents')).toBe(false);
  });
  it('applies repository mode first, but old profiles leave it unchanged', async () => {
    renderRepositoryAccess('all');
    renderPermission('Contents');
    expect(await applyProfile({ Contents: 'Read-only' })).toMatchObject({
      repositoryAccessApplied: true,
    });
    expect(readRepositoryAccess()).toBe('all');
    const result = await settle(
      applyProfile({ permissions: { Contents: 'Read-only' }, repositoryAccess: 'selected' }),
    );
    expect(result.repositoryAccessApplied).toBe(true);
    expect(readRepositoryAccess()).toBe('selected');
  });
  it('does not change permissions, cleanup or expiration after a scope failure', async () => {
    const scope = renderRepositoryAccess('public');
    scope.querySelector<HTMLInputElement>('[value="all"]')!.disabled = true;
    renderPermission('Contents');
    const extra = renderPermission('Issues', 'Read-only', { removable: true });
    const select = renderExpirationSelect();
    const report = vi.fn();
    const result = await applyProfile(
      {
        repositoryAccess: 'all',
        permissions: { Contents: 'Read and write' },
        expiration: { mode: 'offset', days: 90 },
      },
      report,
      undefined,
      { removeUnrecordedPermissions: true },
    );
    expect(result.repositoryAccessApplied).toBe(false);
    expect(result.permissionsApplied).toBe(0);
    expect(result.expirationApplied).toBe(false);
    expect(extra.isConnected).toBe(true);
    expect(select.value).toBe('30');
    expect(getCurrentLevel(buildButtonMap().get('Contents')!)).toBe('Read-only');
    expect(report).toHaveBeenLastCalledWith('Repository access 未应用，已停止权限及过期时间修改');
  });
});

describe('profile update and cleanup switch UI', () => {
  it('updates the selected profile in place after confirmation, without prompting for a new name', () => {
    saveProfiles({
      alpha: { permissions: { Contents: 'Read-only' }, expiration: { mode: 'offset', days: 30 } },
      beta: { permissions: {}, expiration: { mode: 'none' } },
    });
    const untouched = loadProfiles().beta;
    renderRepositoryAccess('selected');
    renderPermission('Issues', 'Read and write');
    const select = renderExpirationSelect();
    select.value = '90';
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue(null);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const panel = mount();
    button(panel, 'update').click();
    expect(loadProfiles().alpha?.permissions).toEqual({ Contents: 'Read-only' });
    confirm.mockReturnValue(true);
    button(panel, 'update').click();
    expect(loadProfiles().alpha).toEqual({
      permissions: { Issues: 'Read and write' },
      expiration: { mode: 'offset', days: 90 },
      repositoryAccess: 'selected',
    });
    expect(loadProfiles().beta).toEqual(untouched);
    expect(panel.querySelector('select')?.value).toBe('alpha');
    expect(panel.querySelector('.status')?.textContent).toContain('已更新：alpha');
    expect(prompt).not.toHaveBeenCalled();
  });
  it('preserves unread scope/expiration settings when updating known permissions', () => {
    saveProfiles({
      dev: {
        permissions: { Contents: 'Read-only' },
        repositoryAccess: 'selected',
        expiration: { mode: 'offset', days: 90 },
      },
    });
    renderPermission('Issues');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const panel = mount();
    button(panel, 'update').click();
    expect(loadProfiles().dev).toEqual({
      permissions: { Issues: 'Read-only' },
      repositoryAccess: 'selected',
      expiration: { mode: 'offset', days: 90 },
    });
  });
  it('does not update an absent profile or an unreadable page', () => {
    const panel = mount();
    button(panel, 'update').click();
    expect(panel.querySelector('.status')?.textContent).toBe('没有可更新的 profile');
  });
  it('rejects a profile deleted before update and avoids overwriting an unreadable page', () => {
    saveProfiles({ dev: { permissions: { Contents: 'Read-only' }, expiration: null } });
    const panel = mount();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    button(panel, 'update').click();
    expect(confirm).not.toHaveBeenCalled();
    expect(loadProfiles().dev?.permissions).toEqual({ Contents: 'Read-only' });
    localStorage.removeItem(STORAGE_KEY);
    button(panel, 'update').click();
    expect(panel.querySelector('.status')?.textContent).toBe('profile 不存在');
  });
  it('saves repository-only profiles without reading specific repo selections', () => {
    const field = renderRepositoryAccess('selected');
    field.insertAdjacentHTML(
      'beforeend',
      '<input type="checkbox" name="repository_ids" value="PRIVATE_REPO_ID" checked>',
    );
    vi.spyOn(window, 'prompt').mockReturnValue('repo-only');
    const panel = mount();
    button(panel, 'save').click();
    expect(loadProfiles()['repo-only']).toEqual({
      permissions: {},
      expiration: null,
      repositoryAccess: 'selected',
    });
    expect(localStorage.getItem(STORAGE_KEY)).not.toContain('PRIVATE_REPO_ID');
  });
  it('keeps computed dates relative on update, but records a user-specified date as fixed', async () => {
    saveProfiles({
      dev: { permissions: { Contents: 'Read-only' }, expiration: { mode: 'offset', days: 37 } },
    });
    renderPermission('Contents');
    renderExpirationSelect();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const panel = mount();
    button(panel, 'apply').click();
    await vi.runAllTimersAsync();
    button(panel, 'update').click();
    expect(loadProfiles().dev?.expiration).toEqual({ mode: 'offset', days: 37 });
    expect(localStorage.getItem(STORAGE_KEY)).not.toContain('2026-02-16');
    const input = document.querySelector<HTMLInputElement>('input[type="date"]')!;
    input.value = '2099-01-01';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    button(panel, 'update').click();
    expect(loadProfiles().dev?.expiration).toEqual({ mode: 'custom', date: '2099-01-01' });
  });
  it('defaults cleanup off, locks the switch during apply, and does not save it to profiles', async () => {
    saveProfiles({ dev: { permissions: { Contents: 'Read-only' }, expiration: null } });
    renderPermission('Contents');
    const extra = renderPermission('Issues', 'Read and write', { removable: true });
    const panel = mount();
    const cleanup = panel.querySelector<HTMLInputElement>('[role="switch"]')!;
    expect(cleanup.checked).toBe(false);
    button(panel, 'apply').click();
    expect(cleanup.disabled).toBe(true);
    expect(button(panel, 'update').disabled).toBe(true);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    button(panel, 'update').dispatchEvent(new MouseEvent('click'));
    expect(confirm).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(extra.isConnected).toBe(true);
    cleanup.checked = true;
    button(panel, 'apply').click();
    await vi.runAllTimersAsync();
    expect(extra.isConnected).toBe(false);
    expect(cleanup.disabled).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).not.toContain('removeUnrecorded');
    expect(panel.querySelector('.status')?.textContent).toContain('移除 1/1');
  });
});
