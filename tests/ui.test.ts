import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as application from '../src/apply';
import { loadProfiles, saveProfiles, STORAGE_KEY } from '../src/storage';
import { mountPanel, PANEL_ID } from '../src/ui';
import type { PanelController } from '../src/ui';
import { renderExpirationSelect, renderPermission } from './fixtures';

let controller: PanelController | null = null;

function mount(): HTMLElement {
  controller = mountPanel();
  if (!controller) throw new Error('Test panel did not mount');
  return controller.element;
}

function action(panel: HTMLElement, name: string): HTMLButtonElement {
  const button = panel.querySelector<HTMLButtonElement>(`[data-act="${name}"]`);
  if (!button) throw new Error(`Missing ${name} test action`);
  return button;
}

function status(panel: HTMLElement): string | null | undefined {
  return panel.querySelector('.status')?.textContent;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  controller?.dispose();
  controller = null;
});

describe('profile panel', () => {
  it('shows informative empty states without performing actions', () => {
    const panel = mount();
    expect(panel.querySelector('option')?.textContent).toBe('（暂无 profile）');
    action(panel, 'apply').click();
    expect(status(panel)).toBe('没有可用的 profile');
    action(panel, 'delete').click();
    expect(status(panel)).toBe('没有可删除的 profile');
    action(panel, 'export').click();
    expect(status(panel)).toBe('没有 profile 可导出');
    action(panel, 'save').click();
    expect(status(panel)).toContain('没有读到权限或过期时间');
  });

  it('mounts only once and cleans up its storage listener', () => {
    mount();
    expect(mountPanel()).toBeNull();
    expect(document.querySelectorAll(`#${PANEL_ID}`)).toHaveLength(1);
    controller?.dispose();
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
    expect(getItem).not.toHaveBeenCalled();
    expect(document.getElementById(PANEL_ID)).toBeNull();
  });

  it('folds the panel with a keyboard-accessible toggle and accurate ARIA state', () => {
    const panel = mount();
    const toggle = action(panel, 'toggle');
    expect(toggle.type).toBe('button');
    toggle.click();
    expect(panel.classList.contains('collapsed')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toBe('展开');
    toggle.click();
    expect(panel.classList.contains('collapsed')).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('saves trimmed names, permission metadata and expiration, never token inputs', () => {
    renderPermission('Contents');
    renderPermission('Metadata');
    renderExpirationSelect();
    const token = document.createElement('input');
    token.name = 'token';
    token.value = 'PRIVATE_TOKEN_SENTINEL';
    document.body.append(token);
    vi.spyOn(window, 'prompt').mockReturnValue(' Dev ');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const panel = mount();
    action(panel, 'save').click();
    expect(loadProfiles().Dev).toEqual({
      permissions: { Contents: 'Read-only' },
      expiration: { mode: 'offset', days: 30 },
      repositoryAccess: null,
    });
    expect(localStorage.getItem(STORAGE_KEY)).not.toContain('PRIVATE_TOKEN_SENTINEL');
    expect(panel.querySelector('select')?.value).toBe('Dev');
    expect(panel.querySelector('.info')?.textContent).toBe(
      '仓库：未记录 · 权限 1 项 · 过期：30 days',
    );
    expect(status(panel)).toContain('已保存：Dev');
    expect(confirm).not.toHaveBeenCalled();
  });

  it.each([null, '', '   '])('does not save a cancelled or empty name: %j', (name) => {
    renderExpirationSelect();
    vi.spyOn(window, 'prompt').mockReturnValue(name);
    const panel = mount();
    action(panel, 'save').click();
    expect(loadProfiles()).toEqual({});
  });

  it('asks before overwriting an existing profile', () => {
    saveProfiles({ dev: { permissions: { Contents: 'Read and write' }, expiration: null } });
    renderPermission('Contents');
    vi.spyOn(window, 'prompt').mockReturnValue('dev');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const panel = mount();
    action(panel, 'save').click();
    expect(loadProfiles().dev?.permissions.Contents).toBe('Read and write');
    confirm.mockReturnValue(true);
    action(panel, 'save').click();
    expect(loadProfiles().dev?.permissions.Contents).toBe('Read-only');
  });

  it('supports special profile names without prototype mutation or HTML injection', () => {
    renderExpirationSelect();
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('__proto__');
    const panel = mount();
    action(panel, 'save').click();
    expect(Object.hasOwn(loadProfiles(), '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(loadProfiles())).toBe(Object.prototype);
    prompt.mockReturnValue('<img src=x onerror=alert(1)>');
    action(panel, 'save').click();
    expect(panel.querySelector('img')).toBeNull();
    expect(panel.querySelector('select')?.value).toBe('<img src=x onerror=alert(1)>');
  });

  it('confirms deletion and preserves other profiles', () => {
    saveProfiles({
      a: { permissions: {}, expiration: null },
      b: { permissions: {}, expiration: null },
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const panel = mount();
    action(panel, 'delete').click();
    expect(Object.keys(loadProfiles())).toEqual(['a', 'b']);
    confirm.mockReturnValue(true);
    action(panel, 'delete').click();
    expect(Object.keys(loadProfiles())).toEqual(['b']);
    expect(status(panel)).toBe('已删除：a');
  });

  it('exports selectable JSON without creating a download', () => {
    saveProfiles({ dev: { permissions: { Contents: 'Read-only' }, expiration: null } });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const panel = mount();
    action(panel, 'export').click();
    const editor = panel.querySelector('textarea')!;
    expect(editor.readOnly).toBe(true);
    expect(JSON.parse(editor.value)).toEqual(loadProfiles());
    expect(editor.selectionStart).toBe(0);
    expect(editor.selectionEnd).toBe(editor.value.length);
    expect(click).not.toHaveBeenCalled();
    expect(document.querySelector('a')).toBeNull();
    expect(status(panel)).toBe('已生成导出 JSON，可复制保存');
  });

  it('applies selected profiles and prevents concurrent or conflicting actions', async () => {
    saveProfiles({ dev: { permissions: { Contents: 'Read and write' }, expiration: null } });
    renderPermission('Contents');
    const apply = vi.spyOn(application, 'applyProfile');
    const panel = mount();
    action(panel, 'apply').click();
    expect(panel.getAttribute('aria-busy')).toBe('true');
    for (const name of ['apply', 'save', 'delete', 'export'])
      expect(action(panel, name).disabled).toBe(true);
    expect(panel.querySelector('select')?.disabled).toBe(true);
    action(panel, 'apply').dispatchEvent(new MouseEvent('click'));
    expect(apply).toHaveBeenCalledOnce();
    await vi.runAllTimersAsync();
    expect(status(panel)).toBe('完成：权限 1/1');
    expect(action(panel, 'apply').disabled).toBe(false);
    expect(panel.getAttribute('aria-busy')).toBe('false');
  });

  it('aborts pending form actions when the panel is disposed', async () => {
    saveProfiles({ dev: { permissions: { Contents: 'Read and write' }, expiration: null } });
    const row = renderPermission('Contents');
    const panel = mount();
    action(panel, 'apply').click();
    controller?.dispose();
    await vi.runAllTimersAsync();
    expect(row.querySelector('button')?.textContent).toBe('Access: Read-only');
  });

  it('reports when a selected profile disappears before applying', () => {
    saveProfiles({ dev: { permissions: {}, expiration: null } });
    const panel = mount();
    localStorage.removeItem(STORAGE_KEY);
    action(panel, 'apply').click();
    expect(status(panel)).toBe('profile 不存在');
  });

  it('restores controls and surfaces an unexpected application error', async () => {
    saveProfiles({ dev: { permissions: {}, expiration: null } });
    vi.spyOn(application, 'applyProfile').mockRejectedValue(new Error('DOM changed'));
    const panel = mount();
    action(panel, 'apply').click();
    await vi.runAllTimersAsync();
    expect(status(panel)).toBe('操作失败：DOM changed');
    expect(action(panel, 'apply').disabled).toBe(false);
  });

  it('surfaces localStorage write failures instead of reporting success', () => {
    renderExpirationSelect();
    vi.spyOn(window, 'prompt').mockReturnValue('dev');
    const panel = mount();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded');
    });
    action(panel, 'save').click();
    expect(status(panel)).toBe('操作失败：Quota exceeded');
  });

  it('refreshes for cross-tab updates and storage clearing, but ignores unrelated keys', () => {
    saveProfiles({ dev: { permissions: {}, expiration: null } });
    const panel = mount();
    saveProfiles({
      dev: { permissions: {}, expiration: null },
      release: { permissions: {}, expiration: { mode: 'none' } },
    });
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }));
    expect(panel.querySelectorAll('option')).toHaveLength(1);
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
    expect(panel.querySelectorAll('option')).toHaveLength(2);
    expect(panel.querySelector('select')?.value).toBe('dev');
    const select = panel.querySelector('select')!;
    select.value = 'release';
    select.dispatchEvent(new Event('change'));
    expect(panel.querySelector('.info')?.textContent).toContain('永不过期');
    localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(panel.querySelector('option')?.textContent).toBe('（暂无 profile）');
  });
});
