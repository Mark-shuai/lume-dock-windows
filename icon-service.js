// Shared by Dock, settings and launcher: bounded native work and cache storage.
function createIconService({ load, concurrency = 4, maxEntries = 256, maxBytes = 4 * 1024 * 1024, ttl = 60_000, now = Date.now }) {
  const cache = new Map();
  const pending = new Map();
  const queue = [];
  let bytes = 0;
  let active = 0;
  function remove(key) {
    const entry = cache.get(key);
    if (!entry) return;
    bytes -= (entry.value?.length || 0) * 2;
    cache.delete(key);
  }
  function store(key, value) {
    const icon = typeof value === 'string' && value.length <= 128 * 1024 && /^data:image\/png;base64,[a-z\d+/=]+$/i.test(value) ? value : null;
    remove(key);
    cache.set(key, { value: icon, time: now() });
    bytes += (icon?.length || 0) * 2;
    while (cache.size > maxEntries || bytes > maxBytes) remove(cache.keys().next().value);
    return icon;
  }
  function pump() {
    while (active < concurrency && queue.length) {
      const { key, target, resolve } = queue.shift();
      active++;
      Promise.resolve().then(() => load(target)).catch(() => null).then(value => {
        const icon = store(key, value);
        pending.delete(key);
        active--;
        resolve(icon);
        pump();
      });
    }
  }
  return {
    get(target) {
      if (typeof target !== 'string' || !target.trim() || target.length > 4096 || /[\x00-\x1f]/.test(target)) return Promise.resolve(null);
      const key = /^(?:[a-z]:[\\/]|\\\\)/i.test(target) ? target.replaceAll('/', '\\').toLowerCase() : target;
      const cached = cache.get(key);
      if (cached && now() - cached.time < ttl) {
        cache.delete(key);
        cache.set(key, cached);
        return Promise.resolve(cached.value);
      }
      remove(key);
      if (pending.has(key)) return pending.get(key);
      if (queue.length >= 1024) return Promise.resolve(null);
      const request = new Promise(resolve => queue.push({ key, target, resolve }));
      pending.set(key, request);
      pump();
      return request;
    },
  };
}

module.exports = { createIconService };
