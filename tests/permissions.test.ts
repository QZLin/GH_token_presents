import { describe, expect, it, vi } from 'vitest';
import {
  buildButtonMap,
  findExactPermissionNames,
  getAllAccessButtons,
  getCurrentLevel,
  getPermissionName,
  readPermissions,
  waitForLevel,
} from '../src/permissions';
import { renderPermission } from './fixtures';

describe('permission discovery', () => {
  it('reads exact names and levels, excluding mandatory Metadata', () => {
    renderPermission('Contents', 'Read and write');
    renderPermission('Issues');
    renderPermission('Metadata');
    expect(getAllAccessButtons()).toHaveLength(3);
    expect(readPermissions()).toEqual({ Contents: 'Read and write', Issues: 'Read-only' });
  });

  it('deduplicates exact text nodes and rejects unknown labels', () => {
    const root = document.createElement('div');
    root.innerHTML = '<span>Contents</span><span> Contents </span><span>Contents extra</span>';
    expect(findExactPermissionNames(root)).toEqual(['Contents']);
    expect(findExactPermissionNames(null)).toEqual([]);
    const unknown = renderPermission('Unknown permission');
    expect(getPermissionName(unknown.querySelector('button')!)).toBeNull();
  });

  it('does not guess a name when the row contains multiple permissions', () => {
    const row = document.createElement('section');
    row.innerHTML =
      '<span>Contents</span><span>Issues</span><button data-component="ActionMenu.Button">Access: Read-only</button>';
    document.body.append(row);
    expect(buildButtonMap().size).toBe(0);
  });

  it('keeps the first button if duplicate permission rows exist', () => {
    const first = renderPermission('Contents');
    renderPermission('Contents', 'Read and write');
    expect(buildButtonMap().get('Contents')).toBe(first.querySelector('button'));
  });

  it('ignores non-access menus and empty access levels', () => {
    const row = renderPermission('Contents', '');
    const button = row.querySelector('button')!;
    expect(getCurrentLevel(button)).toBeNull();
    expect(readPermissions()).toEqual({});
    button.textContent = 'Expiration: 30 days';
    expect(getAllAccessButtons()).toHaveLength(0);
  });

  it('recognizes a permission after React replaces its button', async () => {
    vi.useFakeTimers();
    const row = renderPermission('Contents');
    setTimeout(() => {
      row.remove();
      renderPermission('Contents', 'Read and write');
    }, 100);
    const changed = waitForLevel('Contents', 'Read and write', 500);
    await vi.runAllTimersAsync();
    expect(await changed).toBe(true);
  });

  it('reports missing or unchanged permissions after a bounded wait', async () => {
    vi.useFakeTimers();
    renderPermission('Contents');
    const unchanged = waitForLevel('Contents', 'Read and write', 100);
    const missing = waitForLevel('Issues', 'Read-only', 100);
    await vi.runAllTimersAsync();
    expect(await unchanged).toBe(false);
    expect(await missing).toBe(false);
  });
});
