import { readFileSync } from 'node:fs';
const catalog = JSON.parse(readFileSync(new URL('./data/jma-catalog.json', import.meta.url), 'utf8'));
const shapes = JSON.parse(readFileSync(new URL('./data/jma-areas.geojson', import.meta.url), 'utf8'));
export const offices = catalog.offices;
// Official map geometry is simplified. Do not resolve points within 1 km of an
// area boundary without corroborating municipality information, outside the
// mapped land, or in multiple overlapping polygons.
const BOUNDARY_MARGIN_KM = 1;
function ringContains([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function distanceToRing([lon, lat], ring) {
  const sx = 111.32 * Math.cos(lat * Math.PI / 180), sy = 111.32;
  let min = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = [(ring[i][0] - lon) * sx, (ring[i][1] - lat) * sy];
    const b = [(ring[j][0] - lon) * sx, (ring[j][1] - lat) * sy];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / (dx * dx + dy * dy || 1)));
    min = Math.min(min, Math.hypot(a[0] + t * dx, a[1] + t * dy));
  }
  return min;
}
export function resolveArea(latitude, longitude, address = '') {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const point = [longitude, latitude], matches = [];
  let nearBoundary = false;
  for (const feature of shapes.features) {
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const rings of polygons) {
      if (ringContains(point, rings[0]) && !rings.slice(1).some(ring => ringContains(point, ring))) {
        if (rings.some(ring => distanceToRing(point, ring) <= BOUNDARY_MARGIN_KM)) nearBoundary = true;
        matches.push(feature.properties.code);
      }
    }
  }
  const unique = [...new Set(matches)];
  if (unique.length !== 1) return null;
  const code = unique[0], area = catalog.areas[code];
  if (!area || !offices[area.office]) return null;
  // A complete Japanese prefecture + unsplit municipality address can corroborate
  // a coastal/boundary point. Contradictory addresses never override coordinates.
  const prefectures = new Set(Object.values(offices).map(office => office.prefecture).filter(prefecture => prefecture && address.includes(prefecture)));
  if (prefectures.size > 1 || prefectures.size === 1 && !prefectures.has(offices[area.office].prefecture)) return null;
  const addressed = new Set(catalog.municipalities.filter(municipality =>
    address.includes(municipality.prefecture) && new RegExp(`(^|[都道府県、,\\s])${municipality.name}(?=$|[0-9０-９、,\\s]|[^市区町村])`).test(address)
  ).map(municipality => municipality.area));
  if (addressed.size > 1 || addressed.size === 1 && !addressed.has(code)) return null;
  if (nearBoundary && !addressed.has(code)) return null;
  return { code, name: area.name, officeCode: area.office, officeName: offices[area.office].name };
}
