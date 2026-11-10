import { applyProfile, readCurrentState } from './apply';
import { resetExpirationTracking } from './expiration';
import { describeRepositoryAccess } from './repository-access';
import { importConflicts, mergeProfileImport, parseProfileImport } from './profile-transfer';
import {
  describeExpiration,
  loadProfiles,
  normalizeProfile,
  saveProfiles,
  STORAGE_KEY,
} from './storage';
import type { Profile } from './types';
import css from './styles.css?inline';

export const PANEL_ID = 'gh-token-profiles-panel';
export interface PanelController {
  element: HTMLElement;
  dispose: () => void;
}

function required<T extends Element>(root: Element, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`缺少界面元素：${selector}`);
  return element;
}

export function mountPanel(): PanelController | null {
  if (document.getElementById(PANEL_ID)) return null;
  const panel = document.createElement('aside');
  panel.id = PANEL_ID;
  panel.setAttribute('aria-labelledby', 'gh-token-profiles-heading');
  panel.innerHTML = `
    <h3 id="gh-token-profiles-heading">
      <span>Token Profiles</span>
      <button type="button" class="toggle" data-act="toggle" aria-expanded="true" aria-controls="gh-token-profiles-body">折叠</button>
    </h3>
    <div id="gh-token-profiles-body" class="body">
      <label class="sr-only" for="gh-token-profile-select">选择 Token Profile</label>
      <select id="gh-token-profile-select"></select>
      <p class="info"></p>
      <label class="cleanup-option" for="gh-token-remove-unrecorded">
        <input type="checkbox" role="switch" id="gh-token-remove-unrecorded" aria-describedby="gh-token-cleanup-hint">
        <span>移除未记录权限</span>
      </label>
      <p class="hint" id="gh-token-cleanup-hint">默认保留现有额外权限；开启后清理，Metadata 始终保留。</p>
      <div class="row">
        <button type="button" data-act="apply">应用 Profile</button>
        <button type="button" data-act="save">保存当前</button>
      </div>
      <div class="row">
        <button type="button" data-act="update">更新所选 Profile</button>
        <button type="button" data-act="delete">删除</button>
      </div>
      <div class="row">
        <button type="button" data-act="export">导出/复制</button>
        <button type="button" data-act="import">粘贴导入</button>
      </div>
      <fieldset class="transfer" hidden>
        <legend class="transfer-title">Profile JSON</legend>
        <label class="sr-only" for="gh-token-profile-json">Profile JSON 文本</label>
        <textarea id="gh-token-profile-json" spellcheck="false" autocomplete="off" aria-describedby="gh-token-transfer-hint"></textarea>
        <p class="hint" id="gh-token-transfer-hint"></p>
        <div class="row">
          <button type="button" data-act="copy">复制 JSON</button>
          <button type="button" data-act="confirm-import">校验并导入</button>
          <button type="button" data-act="close-transfer">关闭</button>
        </div>
      </fieldset>
      <p class="status" role="status" aria-live="polite">就绪</p>
      <p class="hint">仅保存仓库访问模式、权限与过期时间，不保存仓库列表或 Token。</p>
    </div>
  `;
  const style = document.createElement('style');
  style.textContent = css;
  panel.prepend(style);
  document.body.append(panel);

  const select = required<HTMLSelectElement>(panel, 'select');
  const status = required<HTMLElement>(panel, '.status');
  const info = required<HTMLElement>(panel, '.info');
  const cleanup = required<HTMLInputElement>(panel, '[role="switch"]');
  const toggle = required<HTMLButtonElement>(panel, '[data-act="toggle"]');
  const apply = required<HTMLButtonElement>(panel, '[data-act="apply"]');
  const save = required<HTMLButtonElement>(panel, '[data-act="save"]');
  const update = required<HTMLButtonElement>(panel, '[data-act="update"]');
  const remove = required<HTMLButtonElement>(panel, '[data-act="delete"]');
  const exportButton = required<HTMLButtonElement>(panel, '[data-act="export"]');
  const importButton = required<HTMLButtonElement>(panel, '[data-act="import"]');
  const copyButton = required<HTMLButtonElement>(panel, '[data-act="copy"]');
  const confirmImport = required<HTMLButtonElement>(panel, '[data-act="confirm-import"]');
  const closeTransferButton = required<HTMLButtonElement>(panel, '[data-act="close-transfer"]');
  const transfer = required<HTMLFieldSetElement>(panel, '.transfer');
  const transferTitle = required<HTMLElement>(panel, '.transfer-title');
  const editor = required<HTMLTextAreaElement>(panel, 'textarea');
  const transferHint = required<HTMLElement>(panel, '#gh-token-transfer-hint');
  let transferMode: 'export' | 'import' | null = null;
  let busy = false;
  const lifetime = new AbortController();

  function setStatus(message: string): void {
    status.textContent = message;
  }
  function description(profile: Profile): string {
    const count = Object.keys(profile.permissions).filter((name) => name !== 'Metadata').length;
    return `仓库：${describeRepositoryAccess(profile.repositoryAccess)} · 权限 ${count} 项 · 过期：${describeExpiration(profile.expiration)}`;
  }
  function updateInfo(): void {
    info.textContent = select.value
      ? description(normalizeProfile(loadProfiles()[select.value]))
      : '选中 profile 后可应用。';
  }
  function refreshSelect(): void {
    const previous = select.value;
    const profiles = loadProfiles();
    const names = Object.keys(profiles);
    select.replaceChildren();
    for (const name of names.length ? names : ['']) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name || '（暂无 profile）';
      select.append(option);
    }
    if (names.includes(previous)) select.value = previous;
    updateInfo();
  }
  function setBusy(value: boolean): void {
    busy = value;
    panel.setAttribute('aria-busy', String(value));
    select.disabled = value;
    cleanup.disabled = value;
    editor.disabled = value && transferMode !== 'export';
    for (const button of [
      apply,
      save,
      update,
      remove,
      exportButton,
      importButton,
      copyButton,
      confirmImport,
      closeTransferButton,
    ])
      button.disabled = value;
  }
  function showError(error: unknown): void {
    console.warn('[profiles] 操作失败:', error);
    setStatus(`操作失败：${error instanceof Error ? error.message : String(error)}`);
  }
  function perform(action: () => void): void {
    if (busy) return;
    try {
      action();
    } catch (error) {
      showError(error);
    }
  }
  function capture(): Profile | null {
    const state = readCurrentState();
    if (!Object.keys(state.permissions).length && !state.expiration && !state.repositoryAccess) {
      setStatus('没有读到权限或过期时间，也未识别 Repository access，请等页面加载完');
      return null;
    }
    return state;
  }

  function openTransfer(mode: 'export' | 'import', text = ''): void {
    transferMode = mode;
    transfer.hidden = false;
    transferTitle.textContent = mode === 'export' ? '复制导出 JSON' : '粘贴导入 JSON';
    editor.value = text;
    editor.readOnly = mode === 'export';
    editor.placeholder =
      mode === 'import'
        ? '{"Profile 名称": {"permissions": {}, "expiration": null, "repositoryAccess": null}}'
        : '';
    copyButton.hidden = mode !== 'export';
    confirmImport.hidden = mode !== 'import';
    transferHint.textContent =
      mode === 'export'
        ? '点击复制 JSON，或直接按 Ctrl+C / Cmd+C；不会下载文件。'
        : '手动粘贴完整 JSON，校验后合并；同名覆盖需要确认，不会自动读取剪贴板。';
    editor.focus();
    if (mode === 'export') editor.select();
  }
  function closeTransfer(): void {
    transfer.hidden = true;
    transferMode = null;
    editor.value = '';
  }
  async function copyExport(): Promise<void> {
    if (busy || transferMode !== 'export') return;
    editor.focus();
    editor.select();
    setBusy(true);
    try {
      if (typeof navigator.clipboard?.writeText !== 'function') {
        setStatus('JSON 已选中，请按 Ctrl+C / Cmd+C 复制');
        return;
      }
      await navigator.clipboard.writeText(editor.value);
      if (!lifetime.signal.aborted) setStatus('已复制所有 profile JSON');
    } catch {
      if (!lifetime.signal.aborted) {
        editor.focus();
        editor.select();
        setStatus('无法自动复制，JSON 已选中，请按 Ctrl+C / Cmd+C');
      }
    } finally {
      if (!lifetime.signal.aborted) setBusy(false);
    }
  }

  select.addEventListener('change', updateInfo);
  toggle.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('collapsed');
    toggle.textContent = collapsed ? '展开' : '折叠';
    toggle.setAttribute('aria-expanded', String(!collapsed));
  });
  apply.addEventListener('click', () => {
    if (busy) return;
    const name = select.value;
    if (!name) return setStatus('没有可用的 profile');
    const profiles = loadProfiles();
    if (!Object.hasOwn(profiles, name)) return setStatus('profile 不存在');
    const options = { removeUnrecordedPermissions: cleanup.checked };
    setBusy(true);
    void applyProfile(profiles[name], setStatus, lifetime.signal, options)
      .catch(showError)
      .finally(() => setBusy(false));
  });
  save.addEventListener('click', () =>
    perform(() => {
      const state = capture();
      if (!state) return;
      const name = window
        .prompt('Profile 名称：', `Profile ${new Date().toLocaleString()}`)
        ?.trim();
      if (!name) return;
      const profiles = loadProfiles();
      if (Object.hasOwn(profiles, name) && !window.confirm(`"${name}" 已存在，覆盖？`)) return;
      saveProfiles({ ...profiles, [name]: state });
      refreshSelect();
      select.value = name;
      updateInfo();
      setStatus(`已保存：${name}（${description(state)}）`);
    }),
  );
  update.addEventListener('click', () =>
    perform(() => {
      const name = select.value;
      if (!name) return setStatus('没有可更新的 profile');
      const profiles = loadProfiles();
      if (!Object.hasOwn(profiles, name)) return setStatus('profile 不存在');
      const state = capture();
      if (!state) return;
      const old = normalizeProfile(profiles[name]);
      // Unavailable fields are not an instruction to erase an existing setting.
      const updated: Profile = {
        ...state,
        repositoryAccess: state.repositoryAccess ?? old.repositoryAccess,
        expiration: state.expiration ?? old.expiration,
      };
      if (!window.confirm(`使用当前页面设置更新 "${name}"？\n${description(updated)}`)) return;
      saveProfiles({ ...profiles, [name]: updated });
      refreshSelect();
      setStatus(`已更新：${name}（${description(updated)}）`);
    }),
  );
  remove.addEventListener('click', () =>
    perform(() => {
      const name = select.value;
      if (!name) return setStatus('没有可删除的 profile');
      if (!window.confirm(`删除 "${name}"？`)) return;
      const profiles = loadProfiles();
      delete profiles[name];
      saveProfiles(profiles);
      refreshSelect();
      setStatus(`已删除：${name}`);
    }),
  );
  exportButton.addEventListener('click', () =>
    perform(() => {
      const profiles = loadProfiles();
      if (!Object.keys(profiles).length) return setStatus('没有 profile 可导出');
      openTransfer('export', JSON.stringify(profiles, null, 2));
      setStatus('已生成导出 JSON，可复制保存');
    }),
  );
  copyButton.addEventListener('click', () => {
    void copyExport();
  });
  importButton.addEventListener('click', () =>
    perform(() => {
      openTransfer('import');
      setStatus('请粘贴 profile JSON 后点击校验并导入');
    }),
  );
  confirmImport.addEventListener('click', () =>
    perform(() => {
      if (transferMode !== 'import') return;
      const incoming = parseProfileImport(editor.value);
      const existing = loadProfiles();
      const names = Object.keys(incoming);
      const conflicts = importConflicts(existing, incoming);
      const examples = conflicts
        .slice(0, 5)
        .map((name) => JSON.stringify(name))
        .join('、');
      const more = conflicts.length > 5 ? '…' : '';
      if (
        conflicts.length &&
        !window.confirm(
          `将导入 ${names.length} 个 profile，其中 ${conflicts.length} 个同名：${examples}${more}。\n确认会覆盖同名记录；取消则不导入任何内容。`,
        )
      ) {
        setStatus('已取消导入，原配置未更改');
        return;
      }
      saveProfiles(mergeProfileImport(existing, incoming));
      refreshSelect();
      closeTransfer();
      setStatus(
        `已导入 ${names.length} 个 profile${conflicts.length ? `（覆盖 ${conflicts.length} 个同名）` : ''}`,
      );
    }),
  );
  closeTransferButton.addEventListener('click', () => perform(closeTransfer));
  function onStorage(event: StorageEvent): void {
    if (event.key === STORAGE_KEY || event.key === null) refreshSelect();
  }
  window.addEventListener('storage', onStorage);
  refreshSelect();
  return {
    element: panel,
    dispose: () => {
      lifetime.abort();
      closeTransfer();
      resetExpirationTracking();
      window.removeEventListener('storage', onStorage);
      panel.remove();
    },
  };
}
