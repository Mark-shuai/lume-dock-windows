(function (root) {
  function targetKey(value) {
    const text = String(value || '').trim();
    return /^(?:[a-z]:[\\/]|\\\\)/i.test(text) ? text.replaceAll('/', '\\').toLowerCase() : text;
  }
  const validIcon = value => typeof value === 'string' && value.length <= 128 * 1024 && /^data:image\/png;base64,[a-z\d+/=]+$/i.test(value);
  function entryKind(item, identities = new Map()) {
    const target = String(item.target || '').trim();
    const value = identities.get(targetKey(target));
    const keys = Array.isArray(value) ? value : value ? [value] : [];
    // Use resolved program evidence, never the display name or translated source.
    const program = keys.some(key => typeof key === 'string' && /^(?:exe|app):.+/.test(key));
    const executable = (!/^[a-z][a-z\d+.-]*:/i.test(target) || /^[a-z]:[\\/]/i.test(target)) && /\.(?:exe|com|appref-ms)$/i.test(target);
    return program || executable || /^(?:apps-folder:|preview:|ms-calendar:|ms-stickynotes:)/i.test(target) ? 'apps' : 'shortcuts';
  }
  function mergeEntries(entries, identities = new Map()) {
    const parents = new Map();
    function find(key) {
      if (!parents.has(key)) parents.set(key, key);
      let root = key;
      while (parents.get(root) !== root) root = parents.get(root);
      while (parents.get(key) !== key) {
        const next = parents.get(key); parents.set(key, root); key = next;
      }
      return root;
    }
    const keysFor = item => {
      const key = targetKey(item.target), value = identities.get(key);
      return [`target:${key}`, ...(Array.isArray(value) ? value : value ? [value] : [])];
    };
    for (const item of entries) {
      if (!item.target) continue;
      const keys = keysFor(item), first = find(keys[0]);
      for (const key of keys.slice(1)) parents.set(find(key), first);
    }
    const groups = new Map();
    for (const item of entries) {
      if (!item.target) continue;
      const key = targetKey(item.target);
      const identity = find(`target:${key}`);
      let group = groups.get(identity);
      if (!group) { group = { item, aliases: new Set(), names: new Set(), score: -1, kind: 'shortcuts' }; groups.set(identity, group); }
      if (entryKind(item, identities) === 'apps') group.kind = 'apps';
      group.aliases.add(key);
      if (item.collectedFrom) group.aliases.add(targetKey(item.collectedFrom));
      if (item.name) group.names.add(item.name);
      // Keep the real app artwork while preserving the original launch target.
      const score = (validIcon(item.icon) ? 10 : 0) + (item.source === '已安装应用' || item.source === 'Windows 应用' ? 2 : 0);
      if (score > group.score) { group.item = item; group.score = score; }
    }
    return [...groups.values()].map(group => ({ ...group.item, kind: group.kind, aliases: [...group.aliases], searchNames: [...group.names] }));
  }
  const api = { targetKey, entryKind, mergeEntries };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.appIdentity = api;
})(typeof window !== 'undefined' ? window : globalThis);
