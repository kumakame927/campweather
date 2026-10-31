export const CATALOG_REGIONS = [
  ['08', '茨城県'], ['09', '栃木県'], ['10', '群馬県'], ['11', '埼玉県'], ['12', '千葉県'],
  ['13', '東京都'], ['14', '神奈川県'], ['19', '山梨県'], ['20', '長野県'], ['22', '静岡県'],
];
export function normalizeCampName(value) {
  return value.normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/ゖ/g, 'け').replace(/ゕ/g, 'か')
    .replace(/おーと|auto|きゃんぴんぐ|きゃんぷじょう|きゃんぷむら|きゃんぷ場|きゃんぷ村|きゃんぷ|campground|campsite|camping|camp/g, '')
    .replace(/[\s・･ー_\-－〜～]/g, '');
}
export function validateCatalog(value) {
  if (value?.version !== 1 || value.license !== 'ODbL-1.0' || !Number.isFinite(Date.parse(value.updatedAt)) || Date.parse(value.updatedAt) > Date.now() + 86400000 || !Array.isArray(value.regions) || CATALOG_REGIONS.some(([, name]) => !value.regions.includes(name)) || !Array.isArray(value.camps) || value.camps.length === 0 || value.camps.length > 20000) throw new Error('キャンプ場一覧の形式を確認できません。');
  const identities = new Set();
  for (const camp of value.camps) {
    const p = camp?.location;
    if (typeof camp?.name !== 'string' || !camp.name.trim() || camp.name.length > 120 || !Array.isArray(camp.aliases) || camp.aliases.length > 20 || !camp.aliases.every(name => typeof name === 'string' && name.length <= 200) || !p || !Number.isFinite(p.latitude) || Math.abs(p.latitude) > 90 || !Number.isFinite(p.longitude) || Math.abs(p.longitude) > 180 || !['node', 'way', 'relation'].includes(p.osmType) || !/^\d+$/.test(p.osmId) || typeof p.address !== 'string' || !p.address.trim() || p.address.length > 2000 || !['node', 'area-center'].includes(p.coordinateType)) throw new Error('キャンプ場一覧の施設・位置情報を確認できません。');
    const id = `${p.osmType}-${p.osmId}`;
    if (identities.has(id)) throw new Error('キャンプ場一覧に同じOSM IDが重複しています。');
    identities.add(id);
  }
  return value;
}
export function searchCatalog(catalog, query, limit = 20) {
  const needle = normalizeCampName(query);
  if (needle.length === 0) return [];
  return catalog.camps.flatMap(camp => {
    const names = [camp.name, ...camp.aliases].map(normalizeCampName);
    let score = Infinity;
    names.forEach((name, i) => { if (name.includes(needle)) score = Math.min(score, (name === needle ? 0 : name.startsWith(needle) ? 2 : 4) + (i ? 1 : 0)); });
    return Number.isFinite(score) ? [{ camp, score }] : [];
  }).sort((a, b) => a.score - b.score || a.camp.name.localeCompare(b.camp.name, 'ja')).slice(0, limit).map(({ camp }) => camp);
}
