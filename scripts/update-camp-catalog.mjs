import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { CATALOG_REGIONS, validateCatalog } from '../src/catalog-data.js';
import { requestJson } from '../server/catalog-http.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OUTPUT = resolve(ROOT, 'public/data/campgrounds.json');
export function queryForRegion(code) {
  if (!CATALOG_REGIONS.some(([allowed]) => allowed === code)) throw new Error('対象外の都県です。');
  return `[out:json][timeout:90][maxsize:67108864];area["ISO3166-2"="JP-${code}"]["admin_level"="4"]->.pref;nwr(area.pref)["tourism"~"^(camp_site|caravan_site)$"];out tags center;`;
}
export function buildCatalog(parts, now = new Date()) {
  if (parts.length !== CATALOG_REGIONS.length || CATALOG_REGIONS.some(([code]) => !parts.some(part => part.code === code))) throw new Error('全10都県の取得が完了していません。以前の一覧を維持します。');
  const entries = new Map(); const timestamps = [];
  for (const { code, data } of parts) {
    if (data?.remark || !Array.isArray(data?.elements) || !Number.isFinite(Date.parse(data?.osm3s?.timestamp_osm_base))) throw new Error(`JP-${code}の応答が不完全です。`);
    timestamps.push(data.osm3s.timestamp_osm_base);
    const pref = CATALOG_REGIONS.find(([id]) => id === code)[1];
    for (const element of data.elements) {
      const tags = element.tags ?? {}, name = tags['name:ja'] || tags.name;
      if (!['camp_site', 'caravan_site'].includes(tags.tourism) || typeof name !== 'string' || !name.trim() || ['no', 'private'].includes(tags.access) || tags.disused === 'yes' || tags.abandoned === 'yes') continue;
      const point = element.type === 'node' ? element : element.center;
      if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon) || !['node', 'way', 'relation'].includes(element.type) || !Number.isSafeInteger(element.id) || element.id <= 0) continue;
      const id = `${element.type}-${element.id}`;
      if (entries.has(id)) { entries.get(id).prefectures.add(pref); continue; }
      entries.set(id, { element, name: name.trim().slice(0, 120), prefectures: new Set([pref]) });
    }
  }
  const camps = [...entries.values()].map(({ element, name, prefectures }) => {
    const tags = element.tags, point = element.type === 'node' ? element : element.center, prefs = [...prefectures].sort();
    const aliases = [...new Set(['name', 'name:ja', 'name:en', 'alt_name', 'short_name', 'old_name', 'name:ja-Hira', 'name:ja_kana', 'name:ja-Latn'].flatMap(key => typeof tags[key] === 'string' ? tags[key].split(';').map(value => value.trim().slice(0, 200)).filter(Boolean) : []))].filter(alias => alias !== name).slice(0, 20);
    const fields = ['addr:city', 'addr:town', 'addr:village', 'addr:suburb', 'addr:quarter', 'addr:street', 'addr:housenumber'].map(key => tags[key]).filter(value => typeof value === 'string' && value.trim());
    const detail = typeof tags['addr:full'] === 'string' ? tags['addr:full'].trim() : [...new Set(fields)].join('');
    const address = `${prefs.some(pref => detail.includes(pref)) ? '' : prefs.join('・')}${detail || '（市町村・番地はOSM未記載）'}`.slice(0, 2000);
    return { name, aliases, location: { latitude: point.lat, longitude: point.lon, address, osmType: element.type, osmId: String(element.id), coordinateType: element.type === 'node' ? 'node' : 'area-center' } };
  }).sort((a, b) => a.location.osmType.localeCompare(b.location.osmType) || Number(a.location.osmId) - Number(b.location.osmId));
  return validateCatalog({ version: 1, updatedAt: now.toISOString(), osmTimestampStart: timestamps.sort()[0], osmTimestampEnd: timestamps.at(-1), regions: CATALOG_REGIONS.map(([, name]) => name), license: 'ODbL-1.0', licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/', attribution: '© OpenStreetMap contributors', source: 'https://overpass-api.de/', camps });
}
export async function updateCatalog({ scheduled = false, reuseCache = false } = {}) {
  let previous;
  try { previous = validateCatalog(JSON.parse(await readFile(OUTPUT, 'utf8'))); } catch { /* First build still requires all real regions. */ }
  if (scheduled && previous && Date.now() - Date.parse(previous.updatedAt) < 7 * 86400000) { console.log('SKIP: 一覧は7日以内に更新されています。Overpassへのリクエストはありません。'); return; }
  const agent = process.env.HTTPS_PROXY ? new HttpsProxyAgent(process.env.HTTPS_PROXY) : undefined;
  const cache = '/tmp/hare-camp-osm-regions'; await mkdir(cache, { recursive: true });
  const parts = [];
  for (const [code, name] of CATALOG_REGIONS) {
    const path = `${cache}/${code}.json`; let data;
    if (reuseCache) {
      try { const saved = JSON.parse(await readFile(path, 'utf8')); if (Date.now() - saved.fetchedAt < 86400000) data = saved.data; } catch { /* No cache. */ }
    }
    if (!data) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          console.log(`GET JP-${code} ${name} (${attempt + 1}/3)`);
          data = await requestJson('https://overpass-api.de/api/interpreter', { agent, body: new URLSearchParams({ data: queryForRegion(code) }).toString(), timeout: 110000 });
          if (data.remark || !Array.isArray(data.elements) || !data.elements.length) throw new Error(`${name}の完全な応答がありません。`);
          await writeFile(path, JSON.stringify({ fetchedAt: Date.now(), data })); break;
        } catch (error) {
          if (attempt === 2 || error.status && ![429, 502, 503, 504].includes(error.status)) throw error;
          // Respect overload; no concurrent queries or endpoint rotation to evade limits.
          if (error.retryAfter > 120) throw new Error('提供元の再試行待機時間が長いため、今回は更新を中止して次回に再試行します。');
          const seconds = Math.max(30, error.retryAfter || (attempt + 1) * 30);
          console.log(`WAIT ${seconds}s: ${error.message}`);
          for (let remaining = seconds; remaining > 0; remaining -= 30) await new Promise(resolve => setTimeout(resolve, Math.min(30, remaining) * 1000));
        }
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    console.log(`OK ${name}: ${data.elements.length} OSM elements`); parts.push({ code, data });
  }
  const catalog = buildCatalog(parts);
  if (previous && catalog.camps.length < previous.camps.length * .5) throw new Error('施設数が大幅に減少したため、更新を中止して以前の一覧を維持します。');
  await mkdir(dirname(OUTPUT), { recursive: true });
  const temp = `${OUTPUT}.tmp`; await writeFile(temp, `${JSON.stringify(catalog)}\n`); await rename(temp, OUTPUT);
  console.log(`UPDATED ${catalog.camps.length} named camps; ${Buffer.byteLength(JSON.stringify(catalog))} bytes; ${catalog.updatedAt}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  updateCatalog({ scheduled: process.argv.includes('--scheduled'), reuseCache: process.argv.includes('--reuse-cache') }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
