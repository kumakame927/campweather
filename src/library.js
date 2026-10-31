import { STORAGE_KEY, restoreCamps, locationId } from './locations.js';
import { normalizeCampName } from './catalog-data.js';
import { writeStorageEntries } from './storage-transaction.js';
export const COMPARISON_KEY = 'camp-weather-comparison-v1';
export const FAVORITES_KEY = 'camp-weather-favorites-v1';
export function selectionIds(value, camps) {
  if (value === null || value === undefined) return camps.map(camp => camp.id); // Legacy: all existing camps were compared.
  if (value.version !== 1 || !Array.isArray(value.ids)) return [];
  const known = new Set(camps.map(camp => camp.id));
  return [...new Set(value.ids.filter(id => typeof id === 'string' && known.has(id)))];
}
export function restoreLibrary(records, comparison, favorites) {
  const camps = restoreCamps(records);
  return { camps, comparisonIds: selectionIds(comparison, camps), favoriteIds: selectionIds(favorites, camps) };
}
export function persistLibrary(state, storage = localStorage) {
  const known = new Set(state.camps.map(camp => camp.id));
  if (state.comparisonIds.some(id => !known.has(id)) || state.favoriteIds.some(id => !known.has(id))) throw new Error('登録情報と選択状態が一致しません。');
  writeStorageEntries([
    [STORAGE_KEY, JSON.stringify({ version: 2, camps: state.camps })],
    [COMPARISON_KEY, JSON.stringify({ version: 1, ids: [...new Set(state.comparisonIds)] })],
    [FAVORITES_KEY, JSON.stringify({ version: 1, ids: [...new Set(state.favoriteIds)] })],
  ], storage);
}
export function migrateSelections(state, storage = localStorage) {
  const entries = [[COMPARISON_KEY, state.comparisonIds], [FAVORITES_KEY, state.favoriteIds]]
    .filter(([key]) => storage.getItem(key) === null).map(([key, ids]) => [key, JSON.stringify({ version: 1, ids })]);
  if (entries.length) writeStorageEntries(entries, storage); // Do not rewrite the original camp records during migration.
}
export function setMembership(ids, id, enabled) { return enabled ? [...new Set([...ids, id])] : ids.filter(value => value !== id); }
export function forgetCamp(state, id) {
  return { camps: state.camps.filter(camp => camp.id !== id), comparisonIds: state.comparisonIds.filter(value => value !== id), favoriteIds: state.favoriteIds.filter(value => value !== id) };
}
const osmRef = value => /^(node|way|relation)-\d+$/.test(value ?? '');
function identities(camp) {
  return new Set([locationId(camp.location), camp.id?.replace(/^place-/, ''), osmRef(camp.osmRef) ? camp.osmRef : null].filter(Boolean));
}
export function duplicateCamp(camps, candidate, excludedId = null) {
  const keys = identities(candidate);
  return camps.find(camp => {
    if (camp.id === excludedId) return false;
    if (camp.id && candidate.id && camp.id === candidate.id) return true;
    if ([...identities(camp)].some(key => keys.has(key))) return true;
    const a = camp.location, b = candidate.location;
    if (!a || !b) return false;
    const meters = Math.hypot((a.latitude - b.latitude) * 111320, (a.longitude - b.longitude) * 111320 * Math.cos(a.latitude * Math.PI / 180));
    if (meters < 1) return true;
    const name = normalizeCampName(camp.name);
    return name.length >= 2 && name === normalizeCampName(candidate.name) && meters < 80;
  });
}
