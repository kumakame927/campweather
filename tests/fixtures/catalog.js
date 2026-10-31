import { readFileSync } from 'node:fs';
import { buildCatalog } from '../../scripts/update-camp-catalog.mjs';
import { CATALOG_REGIONS } from '../../src/catalog-data.js';
import { INITIAL_CAMPS } from '../../src/locations.js';
const real = JSON.parse(readFileSync(new URL('./osm-shobugahama.json', import.meta.url), 'utf8'));
export function catalogFixture() {
  const data = buildCatalog(CATALOG_REGIONS.map(([code]) => ({ code, data: { ...real, elements: code === '09' ? real.elements : [] } })));
  data.camps.push(...INITIAL_CAMPS.map(camp => ({ name: camp.name, aliases: camp.searchName ? [camp.searchName] : [], location: { ...camp.location, coordinateType: camp.location.osmType === 'node' ? 'node' : 'area-center' } })));
  data.camps.push({ name: '追加施設テスト', aliases: [], location: { latitude: 35.41, longitude: 138.58, address: 'テスト用の静岡県内地点', osmType: 'node', osmId: '999999', coordinateType: 'node' } });
  return data;
}
export async function mockCatalog(page, failure = () => false, beforeReply = () => Promise.resolve()) {
  await page.route(url => url.pathname.endsWith('/api/camp-catalog') || url.pathname.endsWith('/data/campgrounds.json'), async route => { await beforeReply(); return failure() ? route.fulfill({ status: 503, json: { error: 'テスト用の一覧通信エラー' } }) : route.fulfill({ json: { catalog: catalogFixture(), stale: false, notice: '' } }); });
}
