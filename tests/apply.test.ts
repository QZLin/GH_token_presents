import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyProfile, readCurrentState } from '../src/apply';
import { buildButtonMap, getCurrentLevel } from '../src/permissions';
import { renderExpirationSelect, renderPermission } from './fixtures';

const emptyResult = {
  permissionsApplied: 0,
  permissionsTotal: 0,
  permissionsRemoved: 0,
  permissionsToRemove: 0,
  unrecognizedPermissions: 0,
  expirationApplied: true,
  repositoryAccessApplied: true,
  permissionSurfaceReady: true,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

async function settle<T>(promise: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return promise;
}

describe('current state and profile application', () => {
  it('reads permissions and expiration together without Metadata', () => {
    renderPermission('Contents');
    renderPermission('Metadata');
    renderExpirationSelect();
    expect(readCurrentState()).toEqual({
      permissions: { Contents: 'Read-only' },
      expiration: { mode: 'offset', days: 30 },
      repositoryAccess: null,
    });
  });

  it('applies a legacy permission profile and verifies a replaced React button', async () => {
    renderPermission('Contents');
    const report = vi.fn();
    const result = await settle(applyProfile({ Contents: 'Read and write' }, report));
    expect(result).toEqual({ ...emptyResult, permissionsApplied: 1, permissionsTotal: 1 });
    expect(getCurrentLevel(buildButtonMap().get('Contents')!)).toBe('Read and write');
    expect(report).toHaveBeenLastCalledWith('完成：权限 1/1');
  });

  it('skips already-set permissions and never attempts to modify Metadata', async () => {
    const contents = renderPermission('Contents');
    const metadata = renderPermission('Metadata');
    const click = vi.fn();
    contents.addEventListener('click', click);
    metadata.addEventListener('click', click);
    const result = await applyProfile({ Contents: 'Read-only', Metadata: 'Read and write' });
    expect(result.permissionsTotal).toBe(1);
    expect(result.permissionsApplied).toBe(1);
    expect(click).not.toHaveBeenCalled();
  });

  it('resolves later buttons again if React replaces another permission row', async () => {
    let issues = renderPermission('Issues');
    renderPermission('Contents', 'Read-only', {
      onSelect: () => {
        issues.remove();
        issues = renderPermission('Issues');
      },
    });
    const result = await settle(
      applyProfile({ Contents: 'Read and write', Issues: 'Read and write' }),
    );
    expect(result.permissionsApplied).toBe(2);
    expect(getCurrentLevel(buildButtonMap().get('Issues')!)).toBe('Read and write');
  });

  it('reports and skips missing permissions', async () => {
    const report = vi.fn();
    const result = await applyProfile({ Unknown: 'Read-only' }, report);
    expect(result.permissionsApplied).toBe(0);
    expect(report).toHaveBeenCalledWith('应用中 1/1（跳过 Unknown）');
  });

  it('reports missing menu items and closes the menu', async () => {
    renderPermission('Contents', 'Read-only', { levels: [] });
    const report = vi.fn();
    const escape = vi.fn();
    document.addEventListener('keydown', escape, { once: true });
    const result = await settle(applyProfile({ Contents: 'Read and write' }, report));
    expect(result.permissionsApplied).toBe(0);
    expect(report).toHaveBeenCalledWith('应用中 1/1（失败 Contents）');
    expect(escape.mock.calls[0]?.[0].key).toBe('Escape');
  });

  it('does not count a click as success if the permission remains unchanged', async () => {
    renderPermission('Contents', 'Read-only', { update: false });
    const result = await settle(applyProfile({ Contents: 'Read and write' }));
    expect(result.permissionsApplied).toBe(0);
  });

  it('applies modern profiles including expiration', async () => {
    const select = renderExpirationSelect();
    renderPermission('Contents');
    const report = vi.fn();
    const result = await settle(
      applyProfile(
        {
          permissions: { Contents: 'Read and write' },
          expiration: { mode: 'standard', value: '90 days' },
        },
        report,
      ),
    );
    expect(result).toEqual({ ...emptyResult, permissionsApplied: 1, permissionsTotal: 1 });
    expect(select.value).toBe('90');
    expect(report).toHaveBeenCalledWith('设置过期时间：90 days…');
  });

  it('surfaces expiration failure while still applying permissions', async () => {
    renderPermission('Contents');
    const report = vi.fn();
    const result = await applyProfile(
      { permissions: { Contents: 'Read-only' }, expiration: { mode: 'none' } },
      report,
    );
    expect(result.expirationApplied).toBe(false);
    expect(result.permissionsApplied).toBe(1);
    expect(report).toHaveBeenLastCalledWith('完成：权限 1/1；过期时间未完全应用');
  });

  it('does not click a pending menu item after its panel is cancelled', async () => {
    renderPermission('Contents');
    const controller = new AbortController();
    const result = applyProfile({ Contents: 'Read and write' }, undefined, controller.signal);
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await assertion;
    expect(getCurrentLevel(buildButtonMap().get('Contents')!)).toBe('Read-only');
  });

  it('handles an empty or invalid profile as a no-op', async () => {
    expect(await applyProfile(null)).toEqual(emptyResult);
  });
});
