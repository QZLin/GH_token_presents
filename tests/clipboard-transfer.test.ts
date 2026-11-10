import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as application from '../src/apply';
import { loadProfiles, saveProfiles, STORAGE_KEY } from '../src/storage';
import { mountPanel } from '../src/ui';
import type { PanelController } from '../src/ui';
import { renderPermission } from './fixtures';

let controller: PanelController | null = null;
function mount(): HTMLElement {
  controller = mountPanel();
  if (!controller) throw new Error('Missing panel');
  return controller.element;
}
function action(panel: HTMLElement, name: string): HTMLButtonElement {
  return panel.querySelector<HTMLButtonElement>(`[data-act="${name}"]`)!;
}
function status(panel: HTMLElement): string {
  return panel.querySelector('.status')!.textContent || '';
}
function paste(panel: HTMLElement, text: string): HTMLTextAreaElement {
  action(panel, 'import').click();
  const editor = panel.querySelector('textarea')!;
  editor.value = text;
  return editor;
}
function clipboard(value?: object) {
  vi.stubGlobal('navigator', { clipboard: value });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  controller?.dispose();
  controller = null;
});

describe('copy/paste import and export UI', () => {
  it('copies exported JSON with the clipboard API and never downloads a file', async () => {
    saveProfiles({ dev: { permissions: { Contents: 'Read-only' } } });
    const writeText = vi.fn().mockResolvedValue(undefined);
    clipboard({ writeText });
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const panel = mount();
    action(panel, 'export').click();
    const editor = panel.querySelector('textarea')!;
    expect(editor.readOnly).toBe(true);
    expect(action(panel, 'confirm-import').hidden).toBe(true);
    action(panel, 'copy').click();
    await vi.runAllTimersAsync();
    expect(writeText).toHaveBeenCalledWith(editor.value);
    expect(JSON.parse(editor.value)).toEqual(loadProfiles());
    expect(status(panel)).toBe('已复制所有 profile JSON');
    expect(download).not.toHaveBeenCalled();
  });
  it('offers selected text for manual copy when clipboard access is unavailable', async () => {
    saveProfiles({ dev: { permissions: {} } });
    clipboard();
    const panel = mount();
    action(panel, 'export').click();
    action(panel, 'copy').click();
    await vi.runAllTimersAsync();
    const editor = panel.querySelector('textarea')!;
    expect(editor.disabled).toBe(false);
    expect(editor.selectionStart).toBe(0);
    expect(editor.selectionEnd).toBe(editor.value.length);
    expect(status(panel)).toContain('Ctrl+C / Cmd+C');
  });
  it('falls back to manual selection if the browser refuses automatic clipboard writes', async () => {
    saveProfiles({ dev: { permissions: {} } });
    clipboard({ writeText: vi.fn().mockRejectedValue(new Error('NotAllowedError')) });
    const panel = mount();
    action(panel, 'export').click();
    action(panel, 'copy').click();
    await vi.runAllTimersAsync();
    const editor = panel.querySelector('textarea')!;
    expect(status(panel)).toContain('无法自动复制');
    expect(editor.selectionEnd).toBe(editor.value.length);
    expect(action(panel, 'import').disabled).toBe(false);
  });
  it('opens an editable paste field without reading the system clipboard or applying a profile', () => {
    const readText = vi.fn().mockResolvedValue('unrelated clipboard data');
    clipboard({ readText });
    const apply = vi.spyOn(application, 'applyProfile');
    const panel = mount();
    action(panel, 'import').click();
    const editor = panel.querySelector('textarea')!;
    expect(editor.readOnly).toBe(false);
    expect(editor.value).toBe('');
    expect(action(panel, 'copy').hidden).toBe(true);
    action(panel, 'copy').click();
    expect(readText).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });
  it('imports new profiles only after validation and preserves existing selection', () => {
    saveProfiles({ existing: { permissions: { Contents: 'Read-only' } } });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const apply = vi.spyOn(application, 'applyProfile');
    const panel = mount();
    paste(
      panel,
      '{"new":{"permissions":{"Issues":"Read and write"},"repositoryAccess":"selected","expiration":{"mode":"offset","days":7}}}',
    );
    action(panel, 'confirm-import').click();
    expect(loadProfiles().new?.permissions).toEqual({ Issues: 'Read and write' });
    expect(loadProfiles().existing?.permissions).toEqual({ Contents: 'Read-only' });
    expect(panel.querySelector('select')?.value).toBe('existing');
    expect(status(panel)).toBe('已导入 1 个 profile');
    expect(confirm).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(panel.querySelector<HTMLFieldSetElement>('.transfer')!.hidden).toBe(true);
  });
  it('does not import anything on a name-conflict cancellation, then safely overwrites on confirmation', () => {
    saveProfiles({ dev: { permissions: { Contents: 'Read-only' } }, keep: { permissions: {} } });
    const before = localStorage.getItem(STORAGE_KEY);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const panel = mount();
    const editor = paste(
      panel,
      '{"dev":{"permissions":{"Contents":"Read and write"}},"new":{"permissions":{}}}',
    );
    action(panel, 'confirm-import').click();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
    expect(loadProfiles().new).toBeUndefined();
    expect(editor.value).not.toBe('');
    expect(status(panel)).toBe('已取消导入，原配置未更改');
    confirm.mockReturnValue(true);
    action(panel, 'confirm-import').click();
    expect(loadProfiles().dev?.permissions.Contents).toBe('Read and write');
    expect(loadProfiles().keep).toBeDefined();
    expect(loadProfiles().new).toBeDefined();
    expect(status(panel)).toBe('已导入 2 个 profile（覆盖 1 个同名）');
  });
  it.each(['{broken', '{"valid":{"permissions":{}},"bad":{"permissions":[]}}'])(
    'rejects invalid pasted data without any storage writes: %s',
    (text) => {
      saveProfiles({ dev: { permissions: {} } });
      const before = localStorage.getItem(STORAGE_KEY);
      const panel = mount();
      paste(panel, text);
      const write = vi.spyOn(Storage.prototype, 'setItem');
      action(panel, 'confirm-import').click();
      expect(write).not.toHaveBeenCalled();
      expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
      expect(status(panel)).toContain('操作失败：');
      expect(panel.querySelector<HTMLFieldSetElement>('.transfer')!.hidden).toBe(false);
    },
  );
  it('keeps pasted JSON for retry when saving fails', () => {
    const panel = mount();
    const text = '{"new":{"permissions":{}}}';
    const editor = paste(panel, text);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded');
    });
    action(panel, 'confirm-import').click();
    expect(status(panel)).toBe('操作失败：Quota exceeded');
    expect(editor.value).toBe(text);
    expect(loadProfiles()).toEqual({});
  });
  it('supports special and HTML-looking names without prototype or DOM injection', () => {
    const panel = mount();
    paste(
      panel,
      '{"__proto__":{"permissions":{"Contents":"Read-only"}},"<img src=x onerror=alert(1)>":{"permissions":{}}}',
    );
    action(panel, 'confirm-import').click();
    const profiles = loadProfiles();
    expect(Object.hasOwn(profiles, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(profiles)).toBe(Object.prototype);
    expect(panel.querySelector('img')).toBeNull();
  });
  it('closes the transfer area and discards only the unsaved pasted text', () => {
    const panel = mount();
    const editor = paste(panel, '{"notImported":{"permissions":{}}}');
    action(panel, 'close-transfer').click();
    expect(editor.value).toBe('');
    expect(loadProfiles()).toEqual({});
    expect(panel.querySelector<HTMLFieldSetElement>('.transfer')!.hidden).toBe(true);
  });
  it('ignores an import confirmation in export mode', () => {
    saveProfiles({ dev: { permissions: {} } });
    const panel = mount();
    action(panel, 'export').click();
    const write = vi.spyOn(Storage.prototype, 'setItem');
    action(panel, 'confirm-import').click();
    expect(write).not.toHaveBeenCalled();
  });
  it('locks pasted data and import actions during permission application', async () => {
    saveProfiles({ dev: { permissions: { Contents: 'Read and write' } } });
    renderPermission('Contents');
    const panel = mount();
    const editor = paste(panel, '{"notImported":{"permissions":{}}}');
    action(panel, 'apply').click();
    expect(editor.disabled).toBe(true);
    expect(action(panel, 'confirm-import').disabled).toBe(true);
    action(panel, 'confirm-import').dispatchEvent(new MouseEvent('click'));
    await vi.runAllTimersAsync();
    expect(loadProfiles().notImported).toBeUndefined();
    expect(editor.disabled).toBe(false);
  });
  it('does not update a disposed panel after a pending copy completes', async () => {
    saveProfiles({ dev: { permissions: {} } });
    let finish!: () => void;
    clipboard({
      writeText: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    });
    const panel = mount();
    action(panel, 'export').click();
    action(panel, 'copy').click();
    const before = status(panel);
    controller?.dispose();
    finish();
    await vi.runAllTimersAsync();
    expect(status(panel)).toBe(before);
    expect(panel.isConnected).toBe(false);
  });
});
