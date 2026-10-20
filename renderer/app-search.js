(function (root) {
  const normalize = value => String(value || '').normalize('NFKC').toLowerCase().trim();

  // Build once with the application index; typing never tokenizes every name.
  function indexNames(names) {
    return [...new Set(names.filter(Boolean))].map(name => {
      const text = normalize(name);
      const words = normalize(name.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/([a-z\d])([A-Z])/g, '$1 $2')).match(/[\p{L}\p{N}]+/gu) || [];
      return { text, words, initials: words.map(word => [...word][0]).join('') };
    });
  }

  function prepareQuery(value) {
    const text = normalize(value);
    return { text, tokens: text.split(/\s+/).filter(Boolean) };
  }

  function matchName(name, token) {
    if (name.text === token) return 1000;
    if (name.text.startsWith(token)) return 800;
    if (name.words.some(word => word.startsWith(token))) return 650;
    if (name.text.includes(token)) return 500;
    if (/^[a-z\d]{2,64}$/.test(token) && name.initials.startsWith(token)) return 450;
    // Conservative fuzzy matching: only ASCII queries with at least 3 letters.
    // A typo in Chinese or a one-letter query must not flood the grid.
    if (!/^[a-z\d]{3,64}$/.test(token)) return -1;
    let cursor = 0, first = -1, last = -1;
    for (const letter of token) {
      const position = name.text.indexOf(letter, cursor);
      if (position < 0) return -1;
      if (first < 0) first = position;
      last = position; cursor = position + 1;
    }
    const gaps = last - first + 1 - token.length;
    // Spread-out coincidences are poor launch targets. Prefer compact matches.
    return gaps <= Math.max(8, token.length * 3) ? 180 - gaps - Math.min(first, 40) : -1;
  }

  function score(names, query) {
    if (!query.text) return 0;
    let phrase = -1;
    for (const name of names) phrase = Math.max(phrase, matchName(name, query.text));
    if (query.tokens.length === 1 || phrase >= 500) return phrase;
    let total = 0;
    for (const token of query.tokens) {
      let best = -1;
      for (const name of names) best = Math.max(best, matchName(name, token));
      if (best < 0) return -1;
      total += best;
    }
    return Math.max(phrase, 250 + total / query.tokens.length / 5);
  }

  const api = { indexNames, prepareQuery, score };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.launcherSearch = api;
})(typeof window !== 'undefined' ? window : globalThis);
