import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { applyProfile } from '../src/apply';
import { ensurePermissionButton } from '../src/permission-picker';
import { buildButtonMap, getCurrentLevel, readPermissions } from '../src/permissions';
import { renderPermission } from './fixtures';

const initial = readFileSync(
  new NodeURL('./fixtures/github-permissions-initial.html', import.meta.url),
  'utf8',
);
const required = {
  Actions: 'Read and write',
  'Commit statuses': 'Read-only',
  Contents: 'Read and write',
  Issues: 'Read and write',
  'Pull requests': 'Read and write',
  Variables: 'Read and write',
};

type Options = {
  staged?: boolean;
  roleOption?: boolean;
  virtual?: boolean;
  disabled?: string;
  reject?: boolean;
  noDialog?: boolean;
  rowDelay?: number;
  replaceDialog?: boolean;
  replaceOnClose?: boolean;
  previewOnly?: boolean;
  unsafeConfirm?: boolean;
  unsafeChoice?: boolean;
  startAccount?: boolean;
  tabRow?: string;
  noClose?: boolean;
  unlabelled?: boolean;
  noTitle?: boolean;
  nativeDialog?: boolean;
};

function setup(options: Options = {}) {
  const form = document.createElement('form');
  form.innerHTML = initial;
  document.body.append(form);
  const root = form.querySelector('react-partial')!;
  const rows = root.querySelector<HTMLElement>('[data-target="react-partial.reactRoot"]')!;
  const add = root.querySelector<HTMLButtonElement>('[aria-label="Add permissions"]')!;
  const selectedNames = new Set<string>();
  let active: HTMLElement | null = null;
  const opened = vi.fn();
  const submitted = vi.fn((event: Event) => event.preventDefault());
  form.addEventListener('submit', submitted);
  const data = JSON.parse(root.querySelector('script')!.textContent!);
  const keys = new Map<string, string>(
    data.props.resources.repository.map((item: { name: string; metadata: { title: string } }) => [
      item.metadata.title,
      item.name,
    ]),
  );
  function createRow(name: string) {
    if (buildButtonMap().has(name)) return;
    const row = renderPermission(name, 'Read-only', {
      removable: true,
      onSelect: () => {
        const input = root.querySelector<HTMLInputElement>(
          `[data-testid="hidden-input-${keys.get(name)}"]`,
        );
        if (input)
          input.value =
            getCurrentLevel(buildButtonMap().get(name)!) === 'Read and write' ? 'write' : 'read';
      },
    });
    rows.append(row);
    const input = root.querySelector<HTMLInputElement>(
      `[data-testid="hidden-input-${keys.get(name)}"]`,
    );
    if (input) input.value = 'read';
  }
  function finish() {
    active?.remove();
    active = null;
    add.setAttribute('aria-expanded', 'false');
    if (options.replaceOnClose) {
      for (const [name, button] of buildButtonMap()) {
        if (name !== 'Metadata') {
          const level = getCurrentLevel(button)!;
          button.closest('section')?.remove();
          rows.append(renderPermission(name, level));
        }
      }
    }
  }
  function buildPicker() {
    const dialog = document.createElement(options.nativeDialog ? 'dialog' : 'div');
    dialog.id = 'permission-add-dialog';
    if (dialog instanceof HTMLDialogElement) dialog.open = true;
    else dialog.setAttribute('role', 'dialog');
    if (!options.noTitle) dialog.setAttribute('aria-label', 'Add permissions');
    dialog.innerHTML = options.noTitle ? '' : '<h2>Add permissions</h2>';
    if (options.virtual) {
      const search = document.createElement('input');
      search.type = 'search';
      search.setAttribute('aria-label', 'Search permissions');
      dialog.append(search);
      search.addEventListener('input', () => populate(search.value));
    }
    const list = document.createElement('div');
    list.setAttribute('role', 'listbox');
    dialog.append(list);
    function populate(filter = '') {
      list.replaceChildren();
      const names = [...Object.keys(required), 'Metadata'].filter((name) =>
        filter
          ? name.toLowerCase().includes(filter.toLowerCase())
          : !options.virtual || name === 'Actions',
      );
      for (const name of names) {
        const row = document.createElement('div');
        const input = options.roleOption
          ? document.createElement('button')
          : document.createElement('input');
        if (input instanceof HTMLInputElement) {
          input.type = 'checkbox';
          input.checked = selectedNames.has(name);
        } else {
          input.type = options.unsafeChoice ? 'submit' : 'button';
          input.setAttribute('role', 'option');
          input.setAttribute('aria-selected', String(selectedNames.has(name)));
        }
        if (!options.unlabelled) input.setAttribute('aria-label', name);
        if (name === 'Metadata' || name === options.disabled) input.setAttribute('disabled', '');
        const title = document.createElement('span');
        title.textContent = name;
        if (options.unlabelled && input instanceof HTMLInputElement) {
          const label = document.createElement('label');
          label.append(input, title);
          row.append(label);
        } else row.append(input, title);
        list.append(row);
        const onSelect = () => {
          const check =
            input instanceof HTMLInputElement ? input.checked : !selectedNames.has(name);
          if (!options.reject && check) selectedNames.add(name);
          else selectedNames.delete(name);
          if (input instanceof HTMLInputElement) input.checked = selectedNames.has(name);
          else input.setAttribute('aria-selected', String(selectedNames.has(name)));
          if (!options.staged && !options.previewOnly && selectedNames.has(name))
            setTimeout(() => createRow(name), options.rowDelay || 0);
          if (options.replaceDialog) {
            const replacement = buildPicker();
            dialog.replaceWith(replacement);
            active = replacement;
          }
        };
        input.addEventListener(input instanceof HTMLInputElement ? 'change' : 'click', onSelect);
      }
    }
    populate();
    if (options.staged) {
      const confirm = document.createElement('button');
      confirm.type = options.unsafeConfirm ? 'submit' : 'button';
      confirm.textContent = 'Add permissions';
      confirm.addEventListener('click', () => {
        if (!options.previewOnly)
          for (const name of selectedNames)
            setTimeout(() => createRow(name), options.rowDelay || 0);
        finish();
      });
      dialog.append(confirm);
    }
    if (!options.noClose) {
      const close = document.createElement('button');
      close.type = 'button';
      close.setAttribute('aria-label', 'Close dialog');
      close.addEventListener('click', finish);
      dialog.append(close);
    }
    dialog.addEventListener('keydown', (event) => {
      if (event instanceof KeyboardEvent && event.key === 'Escape') finish();
    });
    return dialog;
  }
  add.addEventListener('click', () => {
    opened();
    if (options.noDialog) return;
    selectedNames.clear();
    add.setAttribute('aria-expanded', 'true');
    active = buildPicker();
    form.append(active);
  });
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('button')].filter((button) =>
    /^Repositories|^Account/.test((button.textContent || '').trim()),
  );
  const repository = tabs[0]!;
  if (options.startAccount) {
    repository.removeAttribute('aria-current');
    tabs[1]!.setAttribute('aria-current', 'true');
  }
  repository.addEventListener('click', () => {
    repository.setAttribute('aria-current', 'true');
    tabs[1]?.removeAttribute('aria-current');
    if (options.tabRow) createRow(options.tabRow);
  });
  return { root, form, add, opened, submitted, createRow, selectedNames };
}

async function settle<T>(promise: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return promise;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('Add permissions from the supplied page structure', () => {
  it('reproduces the page with only Metadata and six absent permissions', () => {
    setup();
    expect([...buildButtonMap().keys()]).toEqual(['Metadata']);
    expect(readPermissions()).toEqual({});
    for (const name of Object.keys(required)) expect(buildButtonMap().has(name)).toBe(false);
  });
  it('adds all six requested permissions before setting their levels', async () => {
    const fixture = setup({ staged: true, rowDelay: 100 });
    const report = vi.fn();
    const result = await settle(applyProfile({ permissions: required }, report));
    expect(result.permissionsApplied).toBe(6);
    expect(result.permissionsTotal).toBe(6);
    expect(readPermissions()).toEqual(required);
    expect(buildButtonMap().has('Metadata')).toBe(true);
    expect(fixture.opened).toHaveBeenCalledTimes(6);
    expect(fixture.submitted).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(report).toHaveBeenCalledWith('添加缺失权限：Actions…');
  });
  it('supports labelled checkboxes and text-only ARIA options in an unnamed picker', async () => {
    setup({ staged: true, unlabelled: true, noTitle: true });
    expect(await settle(ensurePermissionButton('Actions'))).not.toBeNull();
    document.body.replaceChildren();
    setup({ roleOption: true, unlabelled: true, noTitle: true });
    expect(await settle(ensurePermissionButton('Contents'))).not.toBeNull();
  });
  it('closes the picker and reports a known permission absent from the offered list', async () => {
    setup({ staged: true });
    expect(await settle(ensurePermissionButton('Administration'))).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it('supports a native dialog without an explicit role attribute', async () => {
    setup({ staged: true, nativeDialog: true });
    expect(await settle(ensurePermissionButton('Pull requests'))).not.toBeNull();
    expect(document.querySelector('dialog[open]')).toBeNull();
  });

  it('supports immediate ARIA option addition and Escape-only dismissal', async () => {
    const fixture = setup({ roleOption: true, noClose: true });
    expect(await settle(ensurePermissionButton('Contents'))).toBe(buildButtonMap().get('Contents'));
    expect(fixture.submitted).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it('searches a virtualized picker instead of assuming every option is mounted', async () => {
    setup({ staged: true, virtual: true });
    expect(await settle(ensurePermissionButton('Variables'))).not.toBeNull();
    expect(buildButtonMap().has('Variables')).toBe(true);
  });
  it('restores repository tab before mistaking a temporarily hidden row for a missing permission', async () => {
    const fixture = setup({ startAccount: true, tabRow: 'Actions' });
    expect(await settle(ensurePermissionButton('Actions'))).not.toBeNull();
    expect(fixture.opened).not.toHaveBeenCalled();
  });
  it('does not open the picker for existing, unknown or mandatory Metadata permissions', async () => {
    const fixture = setup();
    fixture.createRow('Contents');
    expect(await ensurePermissionButton('Contents')).toBe(buildButtonMap().get('Contents'));
    expect(await ensurePermissionButton('Metadata')).toBe(buildButtonMap().get('Metadata'));
    expect(await ensurePermissionButton('Unknown')).toBeNull();
    expect(fixture.opened).not.toHaveBeenCalled();
  });
  it('waits for rows that appear during React rendering without adding duplicates', async () => {
    const fixture = setup();
    setTimeout(() => fixture.createRow('Actions'), 100);
    expect(await settle(ensurePermissionButton('Actions'))).not.toBeNull();
    expect(fixture.opened).not.toHaveBeenCalled();
  });
  it('reports missing or disabled Add controls', async () => {
    const fixture = setup();
    fixture.add.disabled = true;
    expect(await settle(ensurePermissionButton('Actions'))).toBeNull();
    fixture.add.remove();
    expect(await settle(ensurePermissionButton('Actions'))).toBeNull();
    expect(fixture.opened).not.toHaveBeenCalled();
  });
  it('reports a picker that never opens', async () => {
    setup({ noDialog: true });
    expect(await settle(ensurePermissionButton('Actions'))).toBeNull();
  });
  it('does not commit a disabled or rejected permission choice', async () => {
    setup({ staged: true, disabled: 'Actions' });
    expect(await settle(ensurePermissionButton('Actions'))).toBeNull();
    document.body.replaceChildren();
    setup({ staged: true, reject: true });
    expect(await settle(ensurePermissionButton('Actions'))).toBeNull();
    expect(buildButtonMap().has('Actions')).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it('does not confirm a pre-existing user picker or commit unrelated draft choices', async () => {
    const fixture = setup({ staged: true });
    fixture.add.click();
    fixture.opened.mockClear();
    expect(await settle(ensurePermissionButton('Actions'))).toBeNull();
    expect(fixture.opened).not.toHaveBeenCalled();
    expect(buildButtonMap().has('Actions')).toBe(false);
  });
  it('re-finds the picker and access button after complete React replacements', async () => {
    setup({ staged: true, replaceDialog: true, replaceOnClose: true });
    const button = await settle(ensurePermissionButton('Issues'));
    expect(button?.isConnected).toBe(true);
    expect(button).toBe(buildButtonMap().get('Issues'));
  });
  it('does not treat a picker-only preview as a permission in the form', async () => {
    const fixture = setup({ staged: true, previewOnly: true });
    fixture.add.addEventListener('click', () => {
      const picker = document.querySelector('[role="dialog"]')!;
      const preview = renderPermission('Actions');
      picker.append(preview);
    });
    expect(await settle(ensurePermissionButton('Actions'))).toBeNull();
    expect(buildButtonMap().has('Actions')).toBe(false);
  });
  it('never clicks a submit confirmation in the token form', async () => {
    const fixture = setup({ staged: true, unsafeConfirm: true });
    expect(await settle(ensurePermissionButton('Actions'))).toBeNull();
    expect(fixture.submitted).not.toHaveBeenCalled();
    expect(buildButtonMap().has('Actions')).toBe(false);
  });
  it('never clicks a submit option in the token form', async () => {
    const fixture = setup({ roleOption: true, unsafeChoice: true });
    expect(await settle(ensurePermissionButton('Actions'))).toBeNull();
    expect(fixture.submitted).not.toHaveBeenCalled();
  });
  it('cancels before opening or confirming a picker and leaves hidden values unchanged', async () => {
    const fixture = setup({ staged: true });
    const controller = new AbortController();
    const pending = ensurePermissionButton('Actions', controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(201);
    controller.abort();
    await assertion;
    expect(buildButtonMap().has('Actions')).toBe(false);
    expect(
      fixture.root.querySelector<HTMLInputElement>('[data-testid="hidden-input-actions"]')!.value,
    ).toBe('none');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it('honors cleanup with newly added permissions while keeping Metadata', async () => {
    const fixture = setup({ staged: true });
    fixture.createRow('Issues');
    const result = await settle(
      applyProfile({ Actions: 'Read-only' }, undefined, undefined, {
        removeUnrecordedPermissions: true,
      }),
    );
    expect(result.permissionsRemoved).toBe(1);
    expect(result.permissionsApplied).toBe(1);
    expect(buildButtonMap().has('Metadata')).toBe(true);
    expect(buildButtonMap().has('Issues')).toBe(false);
  });
});
