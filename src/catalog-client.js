import { usesSameOrigin } from './api.js';
import { fetchJson } from './weather.js';
import { validateCatalog, searchCatalog, normalizeCampName } from './catalog-data.js';
let entry, pending;
export function catalogMetadata() { return entry ? { updatedAt: entry.catalog.updatedAt, count: entry.catalog.camps.length, stale: entry.stale, notice: entry.notice } : null; }
export function catalogSourceUrl() {
  const path = usesSameOrigin ? 'api/camp-catalog' : 'data/campgrounds.json';
  return new URL(`${import.meta.env?.BASE_URL ?? './'}${path}`, globalThis.location?.href ?? 'http://localhost/').href;
}
async function getCatalog() {
  if (entry && Date.now() - entry.receivedAt < 3600000) return entry.catalog;
  if (!pending) pending = (async () => {
    const url = catalogSourceUrl();
    const value = await fetchJson(url, { timeout: 15000, cache: 'default' });
    const catalog = validateCatalog(value.catalog ?? value);
    entry = { catalog, receivedAt: Date.now(), stale: Boolean(value.stale) || Date.now() - Date.parse(catalog.updatedAt) > 14 * 86400000, notice: typeof value.notice === 'string' ? value.notice : '' };
    return catalog;
  })().finally(() => { pending = null; });
  return pending;
}
export async function searchCampCatalog(query, signal) {
  if (normalizeCampName(query).length === 0) return [];
  const catalog = await getCatalog();
  if (signal?.aborted) throw new DOMException('検索を中止しました。', 'AbortError');
  return searchCatalog(catalog, query).map(camp => ({ name: camp.name, location: { ...camp.location }, catalogIdentity: `${camp.location.osmType}-${camp.location.osmId}` }));
}
