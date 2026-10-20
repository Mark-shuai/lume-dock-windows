window.createIconEditor = function ({ store, changed, notify, beforeOpen, afterClose }) {
  const dialog = document.querySelector('#iconDialog');
  const image = document.querySelector('#customIconPreview');
  const name = document.querySelector('#customIconName');
  const error = document.querySelector('#customIconError');
  const choose = document.querySelector('#chooseCustomIcon');
  const reset = document.querySelector('#resetCustomIcon');
  const close = document.querySelector('#closeIconDialog');
  let selected;
  let busy = false;
  let opening = false;
  let revision = 0;
  function preview() {
    reset.disabled = !store.get(selected);
    image.src = window.dockIcons.preferred(selected) || window.dockIcons.fallback(selected);
    const current = ++revision;
    if (!window.dockIcons.preferred(selected) && window.dockAPI?.getIcon && selected.target) {
      window.dockAPI.getIcon(selected.target).then(icon => {
        if (icon && dialog.open && revision === current && !store.get(selected)) image.src = icon;
      }).catch(() => {});
    }
  }
  function setBusy(value) {
    busy = value;
    choose.disabled = close.disabled = value;
    reset.disabled = value || !store.get(selected);
    choose.textContent = value ? '正在读取…' : '选择图片…';
  }
  choose.addEventListener('click', async () => {
    if (busy) return;
    if (!window.dockAPI?.pickCustomIcon) { error.textContent = '请在 Lume Dock 应用中选择本地图片'; return; }
    error.textContent = '';
    setBusy(true);
    try {
      const result = await window.dockAPI.pickCustomIcon();
      if (result.ok) {
        store.set(selected, result.icon);
        changed(); preview(); notify('图标已更换');
      } else if (!result.canceled) error.textContent = result.message || '无法读取这张图片';
    } catch (failure) { error.textContent = failure.message || '图标保存失败，请重试'; }
    finally { setBusy(false); }
  });
  reset.addEventListener('click', () => {
    try { store.set(selected, null); changed(); preview(); error.textContent = ''; notify('已恢复默认图标'); }
    catch (failure) { error.textContent = failure.message || '图标保存失败，请重试'; }
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => { revision++; selected = null; afterClose(); });
  return {
    async open(item) {
      if (!item || item.type === 'separator' || dialog.open || opening) return;
      opening = true;
      selected = item;
      name.textContent = item.name;
      error.textContent = '';
      try {
        await beforeOpen();
        dialog.showModal(); preview(); choose.focus();
      } catch { selected = null; afterClose(); notify('窗口调整失败，请重试'); }
      finally { opening = false; }
    },
    refresh() { if (dialog.open && selected && !busy) preview(); },
  };
};
