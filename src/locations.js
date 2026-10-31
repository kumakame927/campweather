import { normalizeCampName } from './catalog-data.js';
import { searchCampCatalog } from './catalog-client.js';
import { fetchJson } from './weather.js';
import { VERIFIED_PLACES } from './verified-places.js';

export const STORAGE_KEY = 'camp-weather-camps-v2';
export const LEGACY_STORAGE_KEY = 'camp-weather-camps-v1';
export const INITIAL_CAMPS = [
  // 公式住所 https://fumotoppara.net/ と OSM way/640260125 の住所を照合（2026-10-31）。
  { id: 'fumotoppara', name: 'ふもとっぱら', location: {
    latitude: 35.3985153, longitude: 138.5659069, address: '静岡県富士宮市麓156（ふもとっぱら）',
    osmType: 'way', osmId: '640260125',
  } },
  // 利用者指定住所と楽天トラベルキャンプ properties/1411 の正式表記を照合。
  // 施設の座標は Nominatim node/14285784581（2026-10-31）。地域中心点は使わない。
  { id: 'izu-kakure', name: '伊豆かくれオートキャンプ場', searchName: '伊豆隠れオートキャンプ場', location: {
    latitude: 34.8888729, longitude: 138.7690670, address: '静岡県伊豆市八木沢2929-5（伊豆隠れオートキャンプ場）',
    osmType: 'node', osmId: '14285784581',
  } },
  // 利用者が茨城県笠間市の施設と確認。座標は Nominatim の施設結果（2026-10-31）。
  { id: 'nikoniko', name: 'ニコニコキャンプ', location: {
    latitude: 36.3141326, longitude: 140.2297206, address: '茨城県笠間市上郷（にこにこキャンプ）',
    osmType: 'node', osmId: '14286833431',
  } },
];
export function loadLocal(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
export function persist(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
export function validLocation(location) {
  const validCoordinates = location && typeof location.latitude === 'number' && Number.isFinite(location.latitude) &&
    typeof location.longitude === 'number' && Number.isFinite(location.longitude) &&
    Math.abs(location.latitude) <= 90 && Math.abs(location.longitude) <= 180 &&
    typeof location.address === 'string' && location.address.trim().length > 0;
  if (!validCoordinates) return false;
  if (['node', 'way', 'relation'].includes(location.osmType) && /^\d+$/.test(String(location.osmId))) return true;
  if (location.source === 'map-pin' && location.sourceId === `map-${location.latitude.toFixed(6)}-${location.longitude.toFixed(6)}`) return true;
  return VERIFIED_PLACES.some(place => location.source === 'verified-listing' && location.sourceId === place.location.sourceId &&
    location.sourceUrl === place.location.sourceUrl && location.latitude === place.location.latitude && location.longitude === place.location.longitude);
}
export function locationId(location) {
  return location.osmId ? `${location.osmType}-${location.osmId}` : location.sourceId;
}
// Keep kanji numerals, long vowel marks and compatibility characters in names.
// Normalize only address digits, full-width spacing/hyphens and numeric separators.
export function normalizeAddress(value) {
  return value.replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ').replace(/－/g, '-').replace(/(\d)[‐‑‒–—−](?=\d)/g, '$1-').trim();
}
export function mapLocation(point, referenceAddress = '') {
  const latitude = Number(point.latitude.toFixed(6)), longitude = Number(point.longitude.toFixed(6));
  return { latitude, longitude, address: `地図指定地点（${referenceAddress ? `参考住所：${referenceAddress} / ` : ''}緯度 ${latitude} / 経度 ${longitude}）`,
    source: 'map-pin', sourceId: `map-${latitude.toFixed(6)}-${longitude.toFixed(6)}` };
}
export function nameMatches(query, name) {
  const needle = normalizeCampName(query), title = normalizeCampName(name);
  return needle.length >= 2 && title.length >= 2 && (title.includes(needle) || needle.includes(title));
}
export function restoreCamps(saved) {
  const current = saved?.version === 2 && Array.isArray(saved.camps);
  const records = current ? saved.camps : saved;
  const safe = Array.isArray(records) ? records.filter(camp => camp && typeof camp.id === 'string' && camp.id.length <= 100 &&
    typeof camp.name === 'string' && camp.name.trim().length > 0 && camp.name.length <= 120 && validLocation(camp.location)) : [];
  if (current) return [...new Map(safe.map(camp => [camp.id, camp])).values()];
  const camps = INITIAL_CAMPS.map(initial => ({ ...initial, ...safe.find(camp => camp.id === initial.id) }));
  const ids = new Set(camps.map(camp => camp.id));
  for (const camp of safe) {
    if (!ids.has(camp.id)) { camps.push({ id: camp.id, name: camp.name, location: camp.location }); ids.add(camp.id); }
  }
  return camps;
}
export function parseSearchResults(payload) {
  if (!Array.isArray(payload)) throw new Error('場所検索の応答を確認できませんでした。');
  return payload.flatMap(item => {
    const location = {
      latitude: typeof item.lat === 'string' && item.lat.trim() ? Number(item.lat) : NaN,
      longitude: typeof item.lon === 'string' && item.lon.trim() ? Number(item.lon) : NaN,
      address: typeof item.display_name === 'string' ? item.display_name : '',
      osmType: item.osm_type, osmId: String(item.osm_id ?? ''),
    };
    if (!validLocation(location)) return [];
    const name = typeof item.name === 'string' && item.name.trim() ? item.name : location.address.split(',')[0];
    return [{ name: name.slice(0, 120), location }];
  });
}
let lastSearchAt = 0;
const memoryCache = new Map();
export async function searchLocations(query, signal, { mode = 'name' } = {}) {
  if (mode === 'name') return searchCampCatalog(query, signal);
  const raw = mode === 'address' ? normalizeAddress(query) : query.normalize('NFKC').trim();
  const key = INITIAL_CAMPS.find(camp => camp.name === raw)?.searchName ?? raw;
  const cacheKey = `${mode}:${key}`;
  const stored = loadLocal('camp-weather-search-cache-v3', {});
  const cache = memoryCache.get(cacheKey) ?? (stored && typeof stored === 'object' ? stored[cacheKey] : null);
  if (cache && Date.now() - cache.timestamp < 86400000 && Array.isArray(cache.results)) {
    return cache.results.filter(result => result && typeof result.name === 'string' && validLocation(result.location) && (mode === 'address' || nameMatches(key, result.name)));
  }
  // Nominatim: 検索ボタンによる明示的な検索だけを行い、1秒間に1回を超えない。
  const request = async () => {
    const sharedLastSearch = loadLocal('camp-weather-last-search', 0);
    const last = Math.max(lastSearchAt, typeof sharedLastSearch === 'number' && sharedLastSearch <= Date.now() ? sharedLastSearch : 0);
    const wait = 1100 - (Date.now() - last);
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    if (signal?.aborted) throw new DOMException('検索を中止しました。', 'AbortError');
    lastSearchAt = Date.now();
    persist('camp-weather-last-search', lastSearchAt);
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.search = new URLSearchParams({ q: key, format: 'jsonv2', countrycodes: 'jp', limit: '5', addressdetails: '1', 'accept-language': 'ja' }).toString();
    const results = parseSearchResults(await fetchJson(url, { signal }));
    // 空の検索結果を24時間固定しない。通信失敗はここに到達せず、キャッシュしない。
    if (!results.length) return results;
    const entry = { timestamp: Date.now(), results };
    memoryCache.set(cacheKey, entry);
    // 保存する検索結果は直近20件に限定する。
    const entries = stored && typeof stored === 'object' && !Array.isArray(stored) ? Object.entries(stored) : [];
    const bounded = Object.fromEntries(entries.filter(([k]) => k !== cacheKey).slice(-19));
    Object.defineProperty(bounded, cacheKey, { value: entry, enumerable: true });
    persist('camp-weather-search-cache-v3', bounded);
    return results;
  };
  return navigator.locks ? navigator.locks.request('camp-weather-geocoding', { signal }, request) : request();
}
