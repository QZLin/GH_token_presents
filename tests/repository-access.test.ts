import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyRepositoryAccess,
  describeRepositoryAccess,
  normalizeRepositoryAccess,
  readRepositoryAccess,
} from '../src/repository-access';
import { renderRepositoryAccess } from './fixtures';

async function settle<T>(promise: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return promise;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('Repository access mode', () => {
  it.each([
    ['public', 'public'],
    ['none', 'public'],
    [' ALL ', 'all'],
    ['selected', 'selected'],
    [{ mode: 'selected', repositories: ['private'] }, 'selected'],
    [null, null],
    [[], null],
    [42, null],
    ['unknown', null],
  ])('normalizes mode %j without retaining repositories', (value, expected) => {
    expect(normalizeRepositoryAccess(value)).toBe(expected);
  });
  it('rejects inherited mode properties', () => {
    expect(normalizeRepositoryAccess(Object.create({ mode: 'all' }))).toBeNull();
  });
  it.each([
    ['public', '公开仓库（只读）'],
    ['all', '全部仓库'],
    ['selected', '仅所选仓库（不记录列表）'],
    [null, '未记录'],
  ] as const)('describes mode %s', (mode, description) => {
    expect(describeRepositoryAccess(mode)).toBe(description);
  });
  it('handles absent controls and never mistakes unrelated all/none radios for a mode', async () => {
    document.body.innerHTML =
      '<label><input type="radio" name="unrelated" value="all" checked>All things</label>';
    expect(readRepositoryAccess()).toBeNull();
    expect(await applyRepositoryAccess(null)).toBe(true);
    expect(await applyRepositoryAccess('selected')).toBe(false);
  });
  it.each(['public', 'all', 'selected'] as const)('captures a native radio mode: %s', (mode) => {
    renderRepositoryAccess(mode);
    expect(readRepositoryAccess()).toBe(mode);
  });
  it('uses repository selection identifiers if radio labels are missing', () => {
    document.body.innerHTML =
      '<input type="radio" id="repository-selection" name="repository_selection" value="all" checked>';
    expect(readRepositoryAccess()).toBe('all');
  });
  it('switches only the mode and leaves specific repo selections untouched', async () => {
    const field = renderRepositoryAccess('all');
    field.insertAdjacentHTML(
      'beforeend',
      '<input type="checkbox" name="repository_ids" value="PRIVATE_REPO_ID" checked><select name="repository_ids"><option value="PRIVATE_ID">org/private-repo</option></select><select multiple name="repository_ids"><option selected value="ANOTHER_PRIVATE_ID">another/repo</option></select>',
    );
    const checkbox = field.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(await settle(applyRepositoryAccess('selected'))).toBe(true);
    expect(readRepositoryAccess()).toBe('selected');
    expect(checkbox.checked).toBe(true);
    expect(field.querySelector('select')?.value).toBe('PRIVATE_ID');
    const click = vi.spyOn(checkbox, 'click');
    expect(await applyRepositoryAccess('selected')).toBe(true);
    expect(click).not.toHaveBeenCalled();
  });
  it('reports disabled radio modes without changing selection', async () => {
    const field = renderRepositoryAccess();
    const all = field.querySelector<HTMLInputElement>('[value="all"]')!;
    all.disabled = true;
    expect(await applyRepositoryAccess('all')).toBe(false);
    expect(readRepositoryAccess()).toBe('public');
  });
  it('does not count a controlled radio reset as success', async () => {
    const field = renderRepositoryAccess();
    const all = field.querySelector<HTMLInputElement>('[value="all"]')!;
    all.addEventListener('change', () => {
      all.checked = false;
      field.querySelector<HTMLInputElement>('[value="none"]')!.checked = true;
    });
    expect(await settle(applyRepositoryAccess('all'))).toBe(false);
  });
  it('supports ARIA radio controls', async () => {
    document.body.innerHTML =
      '<div role="radiogroup" aria-label="Repository access"><button type="button" role="radio" data-value="none" aria-checked="true">Public repositories</button><button type="button" role="radio" data-value="all" aria-checked="false" aria-label="All repositories"></button><button type="button" role="radio" data-value="selected" aria-checked="false">Only selected repositories</button></div>';
    const items = [...document.querySelectorAll<HTMLElement>('[role="radio"]')];
    for (const item of items)
      item.addEventListener('click', () => {
        for (const candidate of items)
          candidate.setAttribute('aria-checked', String(candidate === item));
      });
    expect(readRepositoryAccess()).toBe('public');
    expect(await settle(applyRepositoryAccess('all'))).toBe(true);
    items[2]!.setAttribute('aria-disabled', 'true');
    expect(await applyRepositoryAccess('selected')).toBe(false);
  });
  it('supports a mode select identified by its label, including nonstandard values', async () => {
    document.body.innerHTML =
      '<label for="mode">Repository access</label><select id="mode"><option value="public-choice">Public repositories</option><option value="all-choice">All repositories</option><option value="selected-choice">Only select repositories</option></select>';
    const select = document.querySelector('select')!;
    expect(readRepositoryAccess()).toBe('public');
    expect(await settle(applyRepositoryAccess('all'))).toBe(true);
    expect(select.value).toBe('all-choice');
    select.disabled = true;
    expect(await applyRepositoryAccess('selected')).toBe(false);
    select.disabled = false;
    select.options[2]!.disabled = true;
    expect(await applyRepositoryAccess('selected')).toBe(false);
    select.options[2]!.remove();
    expect(await applyRepositoryAccess('selected')).toBe(false);
  });
  it('reports empty mode selects and controlled select resets', async () => {
    document.body.innerHTML =
      '<select name="repository_selection"><option value="none">Public repositories</option><option value="all">All repositories</option></select>';
    const select = document.querySelector('select')!;
    select.selectedIndex = -1;
    expect(readRepositoryAccess()).toBeNull();
    select.value = 'none';
    select.addEventListener('change', () => {
      select.value = 'none';
    });
    expect(await settle(applyRepositoryAccess('all'))).toBe(false);
  });
  it('aborts an in-progress mode switch', async () => {
    renderRepositoryAccess();
    const controller = new AbortController();
    const pending = applyRepositoryAccess('all', controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await assertion;
  });
});
