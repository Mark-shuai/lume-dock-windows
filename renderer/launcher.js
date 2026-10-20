window.createLauncher = function createLauncher({ getPinned, getLibrary = () => [], getRecent = () => [], recordRecent = () => {}, keyForTarget, addPinned, removePinned, escape,
  notify, beforeOpen, openAdd, restoreDock, editIcon, refreshLibrary = () => {} }) {
  const panel = document.querySelector('#launcherPanel');
  const search = document.querySelector('#appSearch');
  const grid = document.querySelector('#appGrid');
  const empty = document.querySelector('#launcherEmpty');
  const status = document.querySelector('#launcherStatus');
  const refresh = document.querySelector('#refreshApps');
  let catalog = [];
  let identities = new Map();
  let filter = 'all';
  let kind = 'apps';
  let loading = null;
  let loaded = false;
  let issue = '';
  let filtered = [];
  let launchPending = false;
  let composing = false;
  let scrollFrame = null;
  let visibleRange = '';
  let entryIndex = null;
  let iconGeneration = 0;
  const nameOrder = new Intl.Collator('zh-CN', { numeric: true });
  const iconCache = new Map();
  const iconPending = new Map();
  const iconQueue = [];
  const queuedIconKeys = new Set();
  const ICON_CACHE_LIMIT = 256;
  const ICON_MAX_DATA_URL_LENGTH = 128 * 1024;
  const ICON_CACHE_BYTES = 4 * 1024 * 1024;
  let iconCacheBytes = 0;
  let activeIcons = 0;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting || panel.hidden || !entry.target.isConnected) continue;
      observer.unobserve(entry.target);
      const index = Number(entry.target.dataset.index);
      const item = filtered[index];
      const fileTarget = item && (item.target.startsWith('apps-folder:') || /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(item.target) || !/^[a-z][a-z\d+.-]*:/i.test(item.target));
      const key = item && keyForTarget(item.target);
      if (key && iconPending.has(key)) {
        iconPending.get(key).then(icon => {
          if (icon && entry.target.isConnected && !window.customIconStore?.get(item)) setIcon(entry.target, icon);
        });
        continue;
      }
      if (fileTarget && key && !window.dockIcons.preferred(item) && !iconCache.has(key) && !iconPending.has(key) && !queuedIconKeys.has(key)) {
        queuedIconKeys.add(key);
        iconQueue.push({ item, node: entry.target });
      }
    }
    pumpIcons();
  }, { root: grid, rootMargin: '80px' });

  function pumpIcons() {
    while (activeIcons < 4 && iconQueue.length) {
      const { item, node } = iconQueue.shift();
      const key = keyForTarget(item.target);
      queuedIconKeys.delete(key);
      if (panel.hidden || !node.isConnected || !window.dockAPI?.getIcon) continue;
      activeIcons++;
      getIcon(key, item.target)
        .then((icon) => {
          if (icon && node.isConnected && !window.customIconStore?.get(item)) setIcon(node, icon);
        }).catch(() => {}).finally(() => { activeIcons--; pumpIcons(); });
    }
  }

  function cacheIcon(key, icon) {
    const value = typeof icon === 'string' && icon.length <= ICON_MAX_DATA_URL_LENGTH && icon.startsWith('data:image/png;base64,') ? icon : null;
    iconCacheBytes -= (iconCache.get(key)?.length || 0) * 2;
    iconCache.delete(key);
    iconCache.set(key, value);
    iconCacheBytes += (value?.length || 0) * 2;
    while (iconCache.size > ICON_CACHE_LIMIT || iconCacheBytes > ICON_CACHE_BYTES) {
      const oldest = iconCache.keys().next().value;
      iconCacheBytes -= (iconCache.get(oldest)?.length || 0) * 2;
      iconCache.delete(oldest);
    }
    return value;
  }

  function getIcon(key, target) {
    if (iconCache.has(key)) {
      const icon = iconCache.get(key);
      // Refresh recency so frequently used icons stay in the bounded cache.
      iconCache.delete(key);
      iconCache.set(key, icon);
      return Promise.resolve(icon);
    }
    if (iconPending.has(key)) return iconPending.get(key);
    const generation = iconGeneration;
    const request = Promise.resolve().then(() => window.dockAPI.getIcon(target))
      .then((icon) => generation === iconGeneration ? cacheIcon(key, icon) : null)
      .catch(() => generation === iconGeneration ? cacheIcon(key, null) : null)
      .finally(() => { if (iconPending.get(key) === request) iconPending.delete(key); });
    iconPending.set(key, request);
    return request;
  }

  function setIcon(node, icon) {
    const art = node.querySelector('.app-art');
    if (!art) return;
    const image = document.createElement('img');
    image.src = icon;
    image.alt = '';
    art.replaceChildren(image);
    art.classList.add('has-icon');
  }

  function getEntryIndex() {
    const pinned = getPinned().filter(item => item.type !== 'separator');
    const library = getLibrary(), recent = getRecent();
    const unchanged = (before, current) => before.length === current.length && before.every((item, index) => item === current[index]);
    // Entry records are replaced on edits. Compare membership as well, so an
    // in-place append/reorder cannot leave stale pins or search results.
    if (entryIndex && entryIndex.catalog === catalog && entryIndex.identities === identities &&
      unchanged(entryIndex.pinned, pinned) && unchanged(entryIndex.library, library) && unchanged(entryIndex.recent, recent)) return entryIndex;
    const entries = [...catalog];
    for (const list of [library, recent]) for (const item of list) {
      if (item.target) entries.push({ ...item, source: '已收录入口' });
    }
    const catalogIds = window.dockAPI?.listApps ? null : new Set(catalog.map(item => item.id));
    for (const item of pinned) {
      if (item.target && !catalogIds?.has(item.id)) entries.push({ ...item, source: '固定入口' });
    }
    const collectedSources = new Set();
    for (const list of [pinned, library]) for (const item of list) {
      if (item.collectedFrom) collectedSources.add(keyForTarget(item.collectedFrom));
    }
    const merged = window.appIdentity.mergeEntries(entries.filter(item => item.collectedFrom || !collectedSources.has(keyForTarget(item.target))), identities);
    merged.sort((a, b) => nameOrder.compare(a.name, b.name));
    const counts = { apps: 0, shortcuts: 0 };
    for (const item of merged) {
      counts[item.kind]++;
      item.searchText = item.searchNames.join(' ').normalize('NFKC').toLocaleLowerCase();
      item.nameKey = item.name.normalize('NFKC').toLocaleLowerCase();
    }
    const recentKeys = recent.map(item => keyForTarget(item.target));
    return entryIndex = { catalog, identities, pinned, library: [...library], recent: [...recent], entries: merged, counts,
      pinnedTargets: new Set(pinned.map(item => keyForTarget(item.target))),
      recentTargets: new Set(recentKeys), recentOrder: new Map(recentKeys.map((target, index) => [target, index])) };
  }

  const matches = (item, targets) => item.aliases.some(target => targets.has(target));

  function gridLayout() {
    const style = getComputedStyle(grid);
    const columns = Math.max(1, style.gridTemplateColumns.split(' ').length);
    const pitch = (parseFloat(style.gridAutoRows) || 126) + (parseFloat(style.rowGap) || 0);
    return { columns, pitch };
  }

  function renderGrid(force = false) {
    const { columns, pitch } = gridLayout();
    const rows = Math.ceil(filtered.length / columns);
    const virtual = filtered.length > 120;
    const firstRow = virtual ? Math.min(Math.max(0, rows - 1), Math.max(0, Math.floor(grid.scrollTop / pitch) - 2)) : 0;
    const lastRow = virtual ? Math.min(rows, firstRow + Math.ceil(grid.clientHeight / pitch) + 5) : rows;
    const start = firstRow * columns;
    const end = Math.min(filtered.length, lastRow * columns);
    const range = `${start}:${end}:${columns}`;
    if (!force && visibleRange === range) return;
    visibleRange = range;
    const focused = document.activeElement?.closest('.app-cell')?.dataset.index;
    const focusedAction = document.activeElement?.classList.contains('app-pin') ? 'app-pin' : document.activeElement?.classList.contains('app-edit-icon') ? 'app-edit-icon' : 'app-open';
    observer.disconnect();
    iconQueue.length = 0;
    queuedIconKeys.clear();
    const pinned = getEntryIndex().pinnedTargets;
    const spacer = count => count > 0 ? `<div aria-hidden="true" style="grid-column:1/-1;grid-row:span ${count};pointer-events:none"></div>` : '';
    grid.innerHTML = spacer(firstRow) + filtered.slice(start, end).map((item, offset) => {
      const index = start + offset;
      const isPinned = matches(item, pinned);
      return `<div class="app-cell" role="listitem" data-index="${index}" aria-setsize="${filtered.length}" aria-posinset="${index + 1}">
        <button class="app-open" type="button" title="${escape(item.name)} · ${escape(item.source || '应用')}" aria-label="打开 ${escape(item.name)}">
          <span class="app-art"><img src="${escape(window.dockIcons.preferred(item) || iconCache.get(keyForTarget(item.target)) || window.dockIcons.fallback(item))}" alt="" draggable="false" /></span>
          <span class="app-name">${escape(item.name)}</span>
        </button>
        <button class="app-pin" type="button" title="${isPinned ? '取消固定' : '固定到程序坞'}" aria-label="${isPinned ? '取消固定' : '固定'} ${escape(item.name)}${isPinned ? '' : ' 到程序坞'}" aria-pressed="${isPinned}">${isPinned ? '★' : '☆'}</button>
        <button class="app-edit-icon" type="button" title="更换图标" aria-label="更换 ${escape(item.name)} 的图标">⋯</button>
      </div>`;
    }).join('') + spacer(rows - lastRow);
    grid.querySelectorAll('.app-cell').forEach(node => {
      const item = filtered[Number(node.dataset.index)];
      if (!window.dockIcons.preferred(item) && !iconCache.has(keyForTarget(item.target))) observer.observe(node);
    });
    if (focused !== undefined) grid.querySelector(`[data-index="${focused}"] .${focusedAction}`)?.focus({ preventScroll: true });
  }

  function render({ preserveScroll = false } = {}) {
    observer.disconnect();
    iconQueue.length = 0;
    queuedIconKeys.clear();
    if (panel.hidden) return;
    if (!preserveScroll) grid.scrollTop = 0;
    const query = search.value.normalize('NFKC').toLocaleLowerCase().trim();
    const tokens = query.split(/\s+/).filter(Boolean);
    const { entries, counts, pinnedTargets: pinned, recentTargets, recentOrder } = getEntryIndex();
    const label = kind === 'apps' ? '应用' : '快捷方式';
    panel.querySelectorAll('[data-kind]').forEach(button => {
      const count = counts[button.dataset.kind] || 0;
      button.setAttribute('aria-pressed', String(button.dataset.kind === kind));
      button.querySelector('[data-kind-count]').textContent = count;
      button.title = `${button.dataset.kind === 'apps' ? '应用' : '快捷方式'}，共 ${count} 个`;
    });
    search.placeholder = `搜索${label}名称…`;
    search.setAttribute('aria-label', `搜索${label}名称`);
    grid.setAttribute('aria-label', `${label}列表`);
    panel.querySelector('.launcher-filters').setAttribute('aria-label', `筛选${label}`);
    const inFilter = item => (filter !== 'pinned' || matches(item, pinned)) && (filter !== 'recent' || matches(item, recentTargets));
    const inSearch = item => tokens.every(token => item.searchText.includes(token));
    filtered = entries.filter((item) => {
      return item.kind === kind && inFilter(item) && inSearch(item);
    });
    if (query) filtered.sort((a, b) => Number(b.nameKey.startsWith(query)) - Number(a.nameKey.startsWith(query)));
    else if (filter === 'recent') {
      const order = item => Math.min(...item.aliases.map(target => recentOrder.get(target) ?? Infinity));
      filtered.sort((a, b) => order(a) - order(b));
    }
    grid.setAttribute('aria-busy', String(Boolean(loading)));
    empty.hidden = true;
    grid.hidden = false;
    if (loading && !loaded && !filtered.length) {
      grid.innerHTML = Array.from({ length: 18 }, () => '<div class="app-skeleton" aria-hidden="true"></div>').join('');
    } else {
      renderGrid(true);
      if (!filtered.length && !loading) {
        grid.hidden = true;
        empty.hidden = false;
        document.querySelector('#launcherEmptyTitle').textContent = query ? `没有找到匹配的${label}` : filter === 'pinned' ? `还没有固定的${label}` : filter === 'recent' ? `还没有最近使用的${label}` : `暂时没有可显示的${label}`;
        const otherCount = entries.filter(item => item.kind !== kind && inFilter(item) && inSearch(item)).length;
        const otherLabel = kind === 'apps' ? '快捷方式' : '应用';
        document.querySelector('#launcherEmptyCopy').textContent = query && otherCount ? `“${otherLabel}”中有 ${otherCount} 个匹配结果，点击上方分类查看。` : query ? '换一个名称试试，或点击“手动添加”选择入口。' : filter !== 'all' ? `切换“全部”查看此分类，点击 ☆ 可固定到程序坞。` : kind === 'apps' ? '刷新列表重新识别程序，或手动添加 EXE。' : '网址、文件、文件夹和未识别的快捷方式收纳在这里。';
      }
    }
    status.textContent = loading ? '正在读取应用与快捷方式…' : issue || (query ? `${label}中找到 ${filtered.length} 个结果` : `${filtered.length} 个${label}`);
    refresh.disabled = Boolean(loading);
    refresh.textContent = loading ? '正在读取…' : '刷新列表';
  }

  async function load(force = false) {
    if (loading) return loading;
    if (!window.dockAPI?.listApps) {
      catalog = window.dockIcons.previewApps;
      loaded = true;
      issue = '外观预览 · Windows 安装版会显示本机应用';
      render(); return;
    }
    loading = (async () => {
      try {
        if (force) await refreshLibrary();
        const result = await window.dockAPI.listApps({ refresh: force, targets: [...getLibrary(), ...getPinned(), ...getRecent()].map(item => item.target) });
        if (panel.hidden) return;
        if (result.error) issue = result.error;
        else {
          catalog = Array.isArray(result.items) ? result.items : [];
          identities = new Map((result.identities || []).map(record => [keyForTarget(record.source), record.identity]));
          loaded = true;
          issue = result.warnings?.length ? `${result.warnings.join('；')}，可刷新重试` : '';
        }
      } catch {
        issue = '应用列表读取失败，请刷新重试；也可使用手动添加';
      } finally {
        loading = null;
        render();
      }
    })();
    render();
    return loading;
  }

  async function open() {
    beforeOpen();
    panel.hidden = false;
    document.querySelector('#dock').inert = true;
    document.querySelector('#settingsPanel').inert = true;
    try { await window.dockAPI?.setHeight?.(740); }
    catch { notify('启动台窗口调整失败，请重试'); }
    if (panel.hidden) return;
    search.value = '';
    filter = 'all';
    kind = 'apps';
    syncFilters();
    render();
    search.focus();
    // Read through the main-process cache on every open; refresh bypasses it.
    await load();
  }

  function close(restore = true) {
    panel.hidden = true;
    if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
    scrollFrame = null;
    visibleRange = '';
    observer.disconnect();
    iconQueue.length = 0;
    queuedIconKeys.clear();
    grid.replaceChildren();
    filtered = [];
    entryIndex = null;
    catalog = [];
    identities.clear();
    loaded = false;
    iconGeneration++;
    iconPending.clear();
    iconCache.clear();
    iconCacheBytes = 0;
    document.querySelector('#dock').inert = false;
    if (restore) {
      restoreDock();
      document.querySelector('#appsButton')?.focus();
    }
  }

  function syncFilters() {
    panel.querySelectorAll('[data-filter]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.filter === filter)));
  }

  async function launch(item, button) {
    if (launchPending || !item) return;
    if (!window.dockAPI?.openTarget) { notify('请在程序坞中打开应用'); return; }
    launchPending = true;
    if (button) button.disabled = true;
    try {
      const result = await window.dockAPI.openTarget(item.target);
      if (result.ok) { recordRecent(item); close(); }
      else notify(result.message || '应用无法启动，请刷新列表后重试');
    } catch { notify('应用无法启动，请重试'); }
    finally { launchPending = false; if (button) button.disabled = false; }
  }

  search.addEventListener('compositionstart', () => { composing = true; });
  search.addEventListener('compositionend', () => { composing = false; render(); });
  search.addEventListener('input', () => { if (!composing) render(); });
  search.addEventListener('keydown', (event) => {
    if (event.isComposing || composing || event.keyCode === 229) return;
    if (event.key === 'Enter') { event.preventDefault(); void launch(filtered[0]); }
    if (event.key === 'ArrowDown') { event.preventDefault(); grid.querySelector('.app-open')?.focus(); }
  });
  grid.addEventListener('click', (event) => {
    const cell = event.target.closest('.app-cell');
    if (!cell) return;
    const item = filtered[Number(cell.dataset.index)];
    if (!item) return;
    if (item.target.startsWith('preview:')) { notify('这是外观预览，请在 Windows 安装版中操作本机应用'); return; }
    if (event.target.closest('.app-edit-icon')) { editIcon?.(item); return; }
    if (event.target.closest('.app-pin')) {
      const isPinned = matches(item, getEntryIndex().pinnedTargets);
      if (isPinned ? removePinned?.(item) : addPinned({ ...item, icon: item.icon || iconCache.get(keyForTarget(item.target)), iconVersion: 2 })) render({ preserveScroll: true });
    } else if (event.target.closest('.app-open')) void launch(item, cell.querySelector('.app-open'));
  });
  grid.addEventListener('contextmenu', event => {
    const cell = event.target.closest('.app-cell');
    if (!cell) return;
    event.preventDefault(); editIcon?.(filtered[Number(cell.dataset.index)]);
  });
  grid.addEventListener('keydown', (event) => {
    if (!event.target.matches('.app-open') || !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const index = Number(event.target.closest('.app-cell').dataset.index);
    const { columns, pitch } = gridLayout();
    const offset = { ArrowDown: columns, ArrowUp: -columns, ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (event.key === 'ArrowUp' && index < columns) search.focus();
    else {
      const next = Math.min(Math.max(0, index + offset), filtered.length - 1);
      if (!grid.querySelector(`[data-index="${next}"]`)) {
        grid.scrollTop = Math.floor(next / columns) * pitch;
        renderGrid();
      }
      grid.querySelector(`[data-index="${next}"] .app-open`)?.focus();
    }
  });
  grid.addEventListener('scroll', () => {
    if (panel.hidden || filtered.length <= 120 || scrollFrame !== null) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = null;
      if (!panel.hidden) renderGrid();
    });
  }, { passive: true });
  window.addEventListener('resize', () => { if (!panel.hidden) renderGrid(true); });
  document.addEventListener('keydown', (event) => {
    if (panel.hidden || document.querySelector('#addDialog').open || document.querySelector('#iconDialog').open || event.isComposing || composing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (search.value) { search.value = ''; render(); search.focus(); }
      else close();
    }
  });
  panel.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
    filter = button.dataset.filter; syncFilters(); render();
  }));
  panel.querySelectorAll('[data-kind]').forEach(button => button.addEventListener('click', () => {
    kind = button.dataset.kind; render();
  }));
  refresh.addEventListener('click', () => void load(true));
  document.querySelector('#closeLauncher').addEventListener('click', () => close());
  document.querySelector('#launcherAdd').addEventListener('click', openAdd);
  return { open, close, render, refresh: () => load(true), isOpen: () => !panel.hidden };
};
