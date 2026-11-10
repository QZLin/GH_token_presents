interface PermissionOptions {
  levels?: string[];
  update?: boolean;
  onSelect?: () => void;
  removable?: boolean;
  removeUpdate?: boolean;
  onRemove?: () => void;
}

export function renderPermission(
  name: string,
  level = 'Read-only',
  options: PermissionOptions = {},
): HTMLElement {
  const row = document.createElement('section');
  const label = document.createElement('span');
  label.textContent = name;
  row.append(label);

  function makeButton(current: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.component = 'ActionMenu.Button';
    button.textContent = `Access: ${current}`;
    button.addEventListener('click', () => {
      const menu = document.createElement('div');
      menu.setAttribute('role', 'menu');
      for (const target of options.levels ?? ['Read-only', 'Read and write', 'No access']) {
        const item = document.createElement('button');
        item.type = 'button';
        item.setAttribute('role', 'menuitemradio');
        item.textContent = target;
        item.addEventListener('click', () => {
          if (options.update !== false) button.replaceWith(makeButton(target));
          options.onSelect?.();
          menu.remove();
        });
        menu.append(item);
      }
      document.body.append(menu);
    });
    return button;
  }

  row.append(makeButton(level));
  if (options.removable) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${name} permission`);
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      if (options.removeUpdate !== false) row.remove();
      options.onRemove?.();
    });
    row.append(remove);
  }
  document.body.append(row);
  return row;
}

export function renderExpirationSelect(): HTMLSelectElement {
  const group = document.createElement('section');
  group.innerHTML = `
    <label for="expiration">Expiration</label>
    <select id="expiration" name="expiration">
      <option value="30">30 days</option>
      <option value="90">90 days</option>
      <option value="none">No expiration</option>
      <option value="custom">Custom…</option>
    </select>
  `;
  const select = group.querySelector<HTMLSelectElement>('select');
  if (!select) throw new Error('Missing test select');
  select.addEventListener('change', () => {
    const existing = group.querySelector('input');
    if (select.value === 'custom' && !existing) {
      const date = document.createElement('input');
      date.type = 'date';
      group.append(date);
    } else if (select.value !== 'custom') {
      existing?.remove();
    }
  });
  document.body.append(group);
  return select;
}

export function renderExpirationButton(initial = '30 days'): HTMLButtonElement {
  const group = document.createElement('section');
  const label = document.createElement('label');
  label.textContent = 'Expiration';
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.component = 'ActionMenu.Button';
  button.setAttribute('aria-haspopup', 'true');
  button.textContent = `Expiration: ${initial}`;
  button.addEventListener('click', () => {
    const menu = document.createElement('div');
    for (const text of ['30 days', '90 days', 'No expiration', 'Custom']) {
      const item = document.createElement('button');
      item.setAttribute('role', 'menuitem');
      item.textContent = text;
      item.addEventListener('click', () => {
        button.textContent = `Expiration: ${text}`;
        group.querySelector('input')?.remove();
        if (text === 'Custom') {
          const date = document.createElement('input');
          date.type = 'date';
          group.append(date);
        }
        menu.remove();
      });
      menu.append(item);
    }
    document.body.append(menu);
  });
  group.append(label, button);
  document.body.append(group);
  return button;
}

export function renderDateField(value = ''): HTMLInputElement {
  const group = document.createElement('section');
  group.innerHTML = '<label>Expires on</label><input type="date">';
  const input = group.querySelector<HTMLInputElement>('input');
  if (!input) throw new Error('Missing test date input');
  input.value = value;
  document.body.append(group);
  return input;
}

export function renderRepositoryAccess(
  initial: 'public' | 'all' | 'selected' = 'public',
): HTMLFieldSetElement {
  const field = document.createElement('fieldset');
  field.innerHTML = `
    <legend>Repository access</legend>
    <label><input type="radio" name="repository_selection" value="none">Public repositories</label>
    <label><input type="radio" name="repository_selection" value="all">All repositories</label>
    <label><input type="radio" name="repository_selection" value="selected">Only select repositories</label>
  `;
  const input = field.querySelector<HTMLInputElement>(
    `input[value="${initial === 'public' ? 'none' : initial}"]`,
  );
  if (!input) throw new Error('Missing repository access fixture');
  input.checked = true;
  document.body.append(field);
  return field;
}
