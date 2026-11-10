import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyProfile } from '../src/apply';
import {
  capturePermissionSurface,
  waitForPermissionSurfaceAfterRepositoryChange,
} from '../src/permission-picker';
import { buildButtonMap, getCurrentLevel } from '../src/permissions';
import { renderExpirationSelect, renderPermission, renderRepositoryAccess } from './fixtures';

function rowIn(root: HTMLElement, name: string, level = 'Read-only'): HTMLElement {
  const row = renderPermission(name, level, { removable: true });
  root.append(row);
  return row;
}

function surface(name = 'Contents'): HTMLElement {
  const root = document.createElement('react-partial');
  root.setAttribute('partial-name', 'integration-permission-selector');
  root.classList.add('loaded');
  root.innerHTML = `<input type="hidden" name="integration[default_permissions][contents]" value="read"><button type="button" aria-label="Add permissions" aria-expanded="false">Add permissions</button>`;
  document.body.append(root);
  rowIn(root, name);
  return root;
}

function addFlow(root: HTMLElement, name: string, opened: () => void): void {
  const add = root.querySelector<HTMLButtonElement>('[aria-label="Add permissions"]')!;
  add.addEventListener('click', () => {
    opened();
    add.setAttribute('aria-expanded', 'true');
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Add permissions');
    dialog.innerHTML = `<label><input type="checkbox">${name}</label><button type="button" data-add>Add permissions</button><button type="button" aria-label="Close dialog">Close</button>`;
    const close = () => {
      dialog.remove();
      add.setAttribute('aria-expanded', 'false');
    };
    dialog.querySelector('[aria-label]')!.addEventListener('click', close);
    dialog.querySelector('[data-add]')!.addEventListener('click', () => {
      if (dialog.querySelector('input')!.checked) rowIn(root, name);
      close();
    });
    document.body.append(dialog);
  });
}

async function settle<T>(promise: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return promise;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('Repository access permission-surface sequencing', () => {
  it('waits for a changed permission surface to become quiet and ready', async () => {
    const old = surface();
    const before = capturePermissionSurface();
    let resolved = false;
    const pending = waitForPermissionSurfaceAfterRepositoryChange(before).then((value) => {
      resolved = true;
      return value;
    });
    setTimeout(() => {
      old.setAttribute('aria-busy', 'true');
    }, 100);
    setTimeout(() => {
      old.remove();
      const replacement = surface('Issues');
      replacement.setAttribute('aria-busy', 'true');
      setTimeout(() => replacement.removeAttribute('aria-busy'), 200);
    }, 400);
    await vi.advanceTimersByTimeAsync(700);
    expect(resolved).toBe(false);
    await vi.runAllTimersAsync();
    expect(await pending).toBe(true);
  });

  it('uses a conservative grace period when the catalogue intentionally stays the same', async () => {
    surface();
    const before = capturePermissionSurface();
    let resolved = false;
    const pending = waitForPermissionSurfaceAfterRepositoryChange(before).then((value) => {
      resolved = true;
      return value;
    });
    await vi.advanceTimersByTimeAsync(1750);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toBe(true);
  });

  it('returns false when the permission surface disappears and never becomes ready', async () => {
    const root = surface();
    const before = capturePermissionSurface();
    root.remove();
    const pending = waitForPermissionSurfaceAfterRepositoryChange(before, undefined, 500);
    await vi.runAllTimersAsync();
    expect(await pending).toBe(false);
  });

  it('supports cancellation while waiting for the new permission catalogue', async () => {
    surface();
    const controller = new AbortController();
    const pending = waitForPermissionSurfaceAfterRepositoryChange(
      capturePermissionSurface(),
      controller.signal,
    );
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sets access on the fresh React row, never the stale pre-scope row', async () => {
    const scope = renderRepositoryAccess('public');
    const oldRoot = surface();
    const stale = buildButtonMap().get('Contents')!;
    let fresh: HTMLButtonElement | undefined;
    scope.querySelector<HTMLInputElement>('[value="all"]')!.addEventListener('click', () => {
      setTimeout(() => {
        oldRoot.remove();
        surface();
        fresh = buildButtonMap().get('Contents');
      }, 400);
    });
    const report = vi.fn();
    const result = await settle(
      applyProfile(
        {
          repositoryAccess: 'all',
          permissions: { Contents: 'Read and write' },
        },
        report,
      ),
    );
    expect(stale.isConnected).toBe(false);
    const current = buildButtonMap().get('Contents')!;
    expect(fresh).not.toBe(stale);
    expect(current.isConnected).toBe(true);
    expect(getCurrentLevel(current)).toBe('Read and write');
    expect(result.permissionsApplied).toBe(1);
    expect(result.permissionSurfaceReady).toBe(true);
    const messages = report.mock.calls.map(([message]) => message);
    expect(messages.indexOf('等待 Repository access 更新权限列表…')).toBeLessThan(
      messages.indexOf('应用中 0/1…'),
    );
  });

  it('uses only permissions offered by the new Repository access catalogue', async () => {
    const scope = renderRepositoryAccess('public');
    const oldRoot = surface('Metadata');
    const oldOpened = vi.fn();
    addFlow(oldRoot, 'Actions', oldOpened);
    const newOpened = vi.fn();
    scope.querySelector<HTMLInputElement>('[value="selected"]')!.addEventListener('click', () => {
      setTimeout(() => {
        oldRoot.remove();
        const next = surface('Metadata');
        addFlow(next, 'Contents', newOpened);
      }, 400);
    });
    const result = await settle(
      applyProfile({
        repositoryAccess: 'selected',
        permissions: { Contents: 'Read and write' },
      }),
    );
    expect(oldOpened).not.toHaveBeenCalled();
    expect(newOpened).toHaveBeenCalledOnce();
    expect(getCurrentLevel(buildButtonMap().get('Contents')!)).toBe('Read and write');
    expect(result.permissionsApplied).toBe(1);
  });

  it('stops permissions and expiration when the new permission surface never stabilizes', async () => {
    const scope = renderRepositoryAccess('public');
    const root = surface();
    const expiration = renderExpirationSelect();
    scope.querySelector<HTMLInputElement>('[value="all"]')!.addEventListener('click', () => {
      setTimeout(() => root.remove(), 200);
    });
    const report = vi.fn();
    const result = await settle(
      applyProfile(
        {
          repositoryAccess: 'all',
          permissions: { Contents: 'Read and write' },
          expiration: { mode: 'offset', days: 90 },
        },
        report,
      ),
    );
    expect(result.repositoryAccessApplied).toBe(true);
    expect(result.permissionSurfaceReady).toBe(false);
    expect(result.permissionsApplied).toBe(0);
    expect(result.expirationApplied).toBe(false);
    expect(expiration.value).toBe('30');
    expect(report).toHaveBeenLastCalledWith(
      'Repository access 已应用，但权限列表未稳定，已停止后续修改',
    );
  });
});
