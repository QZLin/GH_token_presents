import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildButtonMap,
  getCurrentLevel,
  getPermissionName,
  readPermissions,
  removePermission,
} from '../src/permissions';
import { renderPermission, renderRepositoryAccess } from './fixtures';

async function settle<T>(promise: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return promise;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('safe permission removal', () => {
  it('uses the GitHub remove control even if the access menu has no No access option', async () => {
    const row = renderPermission('Contents', 'Read and write', {
      removable: true,
      levels: ['Read-only', 'Read and write'],
    });
    expect(await settle(removePermission('Contents'))).toBe(true);
    expect(row.isConnected).toBe(false);
    expect(buildButtonMap().has('Contents')).toBe(false);
  });
  it('can identify a trash icon within its permission row', async () => {
    const row = renderPermission('Issues');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.innerHTML = '<svg class="octicon octicon-trash"></svg>';
    remove.addEventListener('click', () => row.remove());
    row.append(remove);
    expect(await settle(removePermission('Issues'))).toBe(true);
  });
  it('supports repository-named permissions without mistaking them for repository selectors', async () => {
    renderPermission('Repository creation', 'Read-only', { removable: true });
    expect(await settle(removePermission('Repository creation'))).toBe(true);
  });
  it('ignores hidden permission controls', () => {
    const row = renderPermission('Actions');
    row.hidden = true;
    expect(buildButtonMap().size).toBe(0);
    expect(readPermissions()).toEqual({});
  });

  it('falls back to No access and does not capture the revoked permission', async () => {
    renderPermission('Contents', 'Read and write');
    expect(await settle(removePermission('Contents'))).toBe(true);
    expect(getCurrentLevel(buildButtonMap().get('Contents')!)).toBe('No access');
    expect(readPermissions()).toEqual({});
    expect(await removePermission('Contents')).toBe(true);
    expect(await removePermission('Missing')).toBe(true);
  });
  it('never removes Metadata', async () => {
    const row = renderPermission('Metadata', 'Read-only', { removable: true });
    const click = vi.fn();
    row.addEventListener('click', click);
    expect(await removePermission('Metadata')).toBe(false);
    expect(click).not.toHaveBeenCalled();
    expect(row.isConnected).toBe(true);
  });
  it('reports missing removal controls instead of directly deleting DOM nodes', async () => {
    const row = renderPermission('Contents', 'Read-only', {
      levels: ['Read-only', 'Read and write'],
    });
    const escape = vi.fn();
    document.addEventListener('keydown', escape, { once: true });
    expect(await settle(removePermission('Contents'))).toBe(false);
    expect(row.isConnected).toBe(true);
    expect(getCurrentLevel(buildButtonMap().get('Contents')!)).toBe('Read-only');
    expect(escape.mock.calls[0]?.[0].key).toBe('Escape');
  });
  it('does not report a remove click as success if the underlying state stays unchanged', async () => {
    const row = renderPermission('Contents', 'Read-only', { removable: true, removeUpdate: false });
    expect(await settle(removePermission('Contents'))).toBe(false);
    expect(row.isConnected).toBe(true);
  });
  it('reports a No access click that the controlled form rejected', async () => {
    renderPermission('Contents', 'Read and write', { update: false });
    expect(await settle(removePermission('Contents'))).toBe(false);
  });
  it('does not click disabled controls', async () => {
    const row = renderPermission('Contents', 'Read-only', { removable: true });
    row.querySelector<HTMLButtonElement>('[aria-label]')!.disabled = true;
    expect(await removePermission('Contents')).toBe(false);
    row.querySelector('[aria-label]')!.remove();
    row.querySelector('button')!.disabled = true;
    expect(await removePermission('Contents')).toBe(false);
  });
  it('ignores hidden removal controls and disabled menu items', async () => {
    const row = renderPermission('Contents', 'Read and write', { removable: true });
    row.querySelector<HTMLButtonElement>('[aria-label]')!.hidden = true;
    row.querySelector('button')!.addEventListener('click', () => {
      for (const item of document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
        item.disabled = true;
    });
    expect(await settle(removePermission('Contents'))).toBe(false);
    expect(row.isConnected).toBe(true);
  });
  it('never borrows a known name from another row or a specific repository name', () => {
    const container = document.createElement('div');
    const unknown = renderPermission('Unknown permission');
    const known = renderPermission('Contents');
    container.append(unknown, known);
    document.body.append(container);
    expect(getPermissionName(unknown.querySelector('button')!)).toBeNull();
    known.remove();
    const repository = renderRepositoryAccess('selected');
    repository.insertAdjacentHTML(
      'beforeend',
      '<select name="repository_ids"><option value="PRIVATE_ID">Contents</option></select>',
    );
    container.append(repository);
    expect(getPermissionName(unknown.querySelector('button')!)).toBeNull();
    expect(readPermissions()).toEqual({});
  });
  it('never clicks a repository remove button outside the permission row', async () => {
    const container = document.createElement('div');
    const row = renderPermission('Contents', 'Read-only', { levels: [] });
    const repository = renderRepositoryAccess('selected');
    const remove = document.createElement('button');
    remove.textContent = 'Remove repository';
    repository.append(remove);
    const click = vi.fn();
    remove.addEventListener('click', click);
    container.append(row, repository);
    document.body.append(container);
    expect(await settle(removePermission('Contents'))).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });
  it('cancels a pending revocation before clicking a menu option', async () => {
    renderPermission('Contents');
    const controller = new AbortController();
    const pending = removePermission('Contents', controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await assertion;
    expect(getCurrentLevel(buildButtonMap().get('Contents')!)).toBe('Read-only');
  });
});
