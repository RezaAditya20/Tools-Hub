/**
 * Shared settings helper — SQLite-backed via API, localStorage as fallback.
 * Usage: await Settings.init(); Settings.get('key', fallback); Settings.set('key', value);
 */
window.Settings = (() => {
  const API = location.origin + '/api/settings';
  const _cache = {};

  async function init() {
    try {
      const res = await fetch(API);
      if (res.ok) {
        const data = await res.json();
        Object.assign(_cache, data);
        // Backfill localStorage so other scripts that still read it directly work
        for (const [k, v] of Object.entries(data)) {
          try {
            localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
          } catch {}
        }
        // Migrate: if API empty but localStorage has data, push it up
        if (Object.keys(data).length === 0) {
          const toMigrate = [
            'theme', 'tools-fav', 'tools-hidden', 'view',
            'torrserver-url', 'school-notes-db', 'school-notes-catorder'
          ];
          for (const k of toMigrate) {
            const raw = localStorage.getItem(k);
            if (raw != null) {
              _cache[k] = _safeParse(raw);
              _post(k, raw);
            }
          }
        }
      }
    } catch {
      // API offline — rely on localStorage fallback
    }
  }

  function get(key, fallback) {
    if (key in _cache) return _cache[key];
    try {
      const raw = localStorage.getItem(key);
      if (raw != null) {
        const val = _safeParse(raw);
        _cache[key] = val;
        return val;
      }
    } catch {}
    return fallback !== undefined ? fallback : null;
  }

  async function set(key, value) {
    _cache[key] = value;
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    try { localStorage.setItem(key, serialized); } catch {}
    await _post(key, serialized);
  }

  async function _post(key, serialized) {
    try {
      await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: serialized })
      });
    } catch {}
  }

  function _safeParse(raw) {
    try { return JSON.parse(raw); } catch { return raw; }
  }

  return { init, get, set };
})();
