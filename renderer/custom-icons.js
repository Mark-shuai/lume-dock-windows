(function (root) {
  const STORAGE_KEY = 'lume-dock-custom-icons-v1';
  const MAX_RECORDS = 100;
  const MAX_BYTES = 1024 * 1024;
  const validIcon = value => typeof value === 'string' && value.length <= 48 * 1024 && /^data:image\/png;base64,[a-z\d+/=]+$/i.test(value);
  function targetKey(value) {
    const text = typeof value === 'string' ? value.trim().slice(0, 4096) : '';
    return /^(?:[a-z]:[\\/]|\\\\)/i.test(text) ? text.replaceAll('/', '\\').toLowerCase() : text;
  }
  function keysFor(item) {
    return [...new Set([item?.target, item?.collectedFrom, ...(Array.isArray(item?.aliases) ? item.aliases : [])].map(targetKey).filter(Boolean)
      .concat((!item?.target || ['apps', 'settings', 'recycle-bin', 'browser', 'files', 'terminal', 'music', 'notes', 'calendar', 'downloads'].includes(item?.id)) && typeof item?.id === 'string' ? [`item:${item.id}`] : []))].slice(0, 64);
  }
  function normalize(records) {
    if (!Array.isArray(records)) return [];
    const used = new Set();
    let bytes = 4;
    const result = [];
    for (const record of records.slice(0, MAX_RECORDS)) {
      if (!record || !validIcon(record.icon) || !Array.isArray(record.keys)) continue;
      const keys = [...new Set(record.keys.slice(0, 64).map(targetKey).filter(key => key && !/[\x00-\x1f\x7f]/.test(key) && !used.has(key)))];
      if (!keys.length) continue;
      const next = { keys, icon: record.icon };
      const length = JSON.stringify(next).length * 2 + (result.length ? 2 : 0);
      if (bytes + length > MAX_BYTES) continue;
      bytes += length;
      keys.forEach(key => used.add(key));
      result.push(next);
    }
    return result;
  }
  function createStore(storage) {
    let records = [];
    let index = new Map();
    const reindex = () => {
      index.clear();
      for (const record of records) for (const key of record.keys) index.set(key, record);
    };
    const sameRecords = (a, b) => a.length === b.length && a.every((record, i) => record.icon === b[i].icon &&
      record.keys.length === b[i].keys.length && record.keys.every((key, j) => key === b[i].keys[j]));
    function sync() {
      let incoming;
      try { incoming = normalize(JSON.parse(storage.getItem(STORAGE_KEY))); } catch { incoming = []; }
      if (sameRecords(records, incoming)) return false;
      records = incoming;
      reindex();
      return true;
    }
    function persist(next) {
      const normalized = normalize(next);
      if (!sameRecords(normalized, next)) throw new Error('自定义图标空间已满，请先恢复一些默认图标');
      try { storage.setItem(STORAGE_KEY, JSON.stringify(next)); }
      catch { throw new Error('图标保存失败，本地空间不足或不可用'); }
      records = next; reindex();
    }
    const matching = item => [...new Set(keysFor(item).map(key => index.get(key)).filter(Boolean))];
    function set(item, icon) {
      sync(); // Merge with the most recent edit from the other window.
      if (icon !== null && !validIcon(icon)) throw new Error('图标数据无效');
      const found = matching(item);
      const keys = [...new Set([...keysFor(item), ...found.flatMap(record => record.keys)])];
      if (!keys.length || keys.length > 64) throw new Error('应用入口过多，无法保存图标');
      const kept = records.filter(record => !found.includes(record));
      persist(icon === null ? kept : [...kept, { keys, icon }]);
    }
    sync();
    return {
      get(item) {
        for (const key of keysFor(item)) {
          const record = index.get(key);
          if (record) return record.icon;
        }
        return null;
      },
      set,
      link(item) { sync(); const found = matching(item)[0]; if (found && keysFor(item).some(key => !found.keys.includes(key))) set(item, found.icon); },
      sync,
      export: () => records.map(record => ({ keys: [...record.keys], icon: record.icon })),
      import(value) {
        if (!Array.isArray(value)) throw new Error('自定义图标配置无效');
        const incoming = normalize(value);
        if (incoming.length !== value.length) throw new Error('自定义图标配置无效或超过容量限制');
        sync();
        const keys = new Set(incoming.flatMap(record => record.keys));
        persist([...records.map(record => ({ ...record, keys: record.keys.filter(key => !keys.has(key)) })).filter(record => record.keys.length), ...incoming]);
      },
    };
  }
  const api = { STORAGE_KEY, MAX_RECORDS, MAX_BYTES, validIcon, keysFor, normalize, createStore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.customIcons = api;
})(typeof window !== 'undefined' ? window : globalThis);
