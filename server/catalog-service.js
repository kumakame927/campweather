import { readFileSync } from 'node:fs';
import { validateCatalog } from '../src/catalog-data.js';
import { requestJson } from './catalog-http.js';
export const CATALOG_URL = 'https://raw.githubusercontent.com/kumakame927/campweather/main/public/data/campgrounds.json';
function bundledCatalog() {
  try { return validateCatalog(JSON.parse(readFileSync(new URL('../public/data/campgrounds.json', import.meta.url), 'utf8'))); }
  catch { return null; }
}
export function createCatalogService({ remote = true, fetchCatalog = () => requestJson(CATALOG_URL, { timeout: 5000 }), fallback = bundledCatalog, now = Date.now } = {}) {
  let cached, until = 0, pending;
  return async () => {
    if (cached && now() < until) return cached;
    if (pending) return pending;
    pending = (async () => {
      let data, stale = false;
      try { data = validateCatalog(remote ? await fetchCatalog() : fallback()); }
      catch {
        data = cached?.catalog ?? fallback(); stale = true;
        if (!data) throw new Error('検索用一覧を取得できません。住所検索・地図指定は利用できます。');
      }
      stale ||= now() - Date.parse(data.updatedAt) > 14 * 86400000;
      cached = { catalog: data, stale, notice: stale ? '最新一覧の更新・取得ができていないため、前回取得した一覧を表示しています。' : '' };
      until = now() + (stale ? 5 : 15) * 60000;
      return cached;
    })();
    try { return await pending; } finally { pending = null; }
  };
}
