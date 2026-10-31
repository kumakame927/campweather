import { COMPARISON_KEY, FAVORITES_KEY } from './library.js';
import { writeStorageEntries } from './storage-transaction.js';
import { STORAGE_KEY, validLocation, loadLocal } from './locations.js';
import { TRIP_STORAGE_KEY, validDate, japanToday } from './schedule.js';
// Retain the existing optional access-branch setting without enabling that feature.
export const DEPARTURE_STORAGE_KEY = 'camp-note-departure-v1';
export const MAX_BACKUP_BYTES = 1024 * 1024;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function text(value, max) { return typeof value === 'string' && value.trim().length > 0 && value.length <= max; }
function fail() { throw new Error('バックアップの形式・登録情報が正しくありません。元のデータは変更していません。'); }
function safeCamp(camp) {
  if (!plain(camp) || !text(camp.id, 100) || !text(camp.name, 120) || !validLocation(camp.location) || !text(camp.location.address, 2000)) fail();
  if (camp.searchName !== undefined && !text(camp.searchName, 120)) fail();
  const point = camp.location;
  const location = { latitude: point.latitude, longitude: point.longitude, address: point.address };
  if (['node', 'way', 'relation'].includes(point.osmType) && /^\d+$/.test(String(point.osmId))) {
    location.osmType = point.osmType; location.osmId = String(point.osmId);
  } else {
    location.source = point.source; location.sourceId = point.sourceId;
    if (point.source === 'verified-listing') {
      if (!text(point.sourceName, 300)) fail();
      location.sourceName = point.sourceName; location.sourceUrl = point.sourceUrl;
    }
  }
  if (point.coordinateType !== undefined) { if (!['node', 'area-center'].includes(point.coordinateType)) fail(); location.coordinateType = point.coordinateType; }
  if (camp.osmRef !== undefined && !/^(node|way|relation)-\d+$/.test(camp.osmRef)) fail();
  return { id: camp.id, name: camp.name, ...(camp.osmRef ? { osmRef: camp.osmRef } : {}), ...(camp.searchName !== undefined ? { searchName: camp.searchName } : {}), location };
}
function safeDeparture(value) {
  if (!plain(value) || !text(value.name, 300) || !Number.isFinite(value.latitude) || Math.abs(value.latitude) > 90 || !Number.isFinite(value.longitude) || Math.abs(value.longitude) > 180) fail();
  return { name: value.name, latitude: value.latitude, longitude: value.longitude };
}
export function validateBackup(value) {
  if (!plain(value) || value.application !== 'hare-camp' || value.version !== 1 || !plain(value.camps) || value.camps.version !== 2 || !Array.isArray(value.camps.camps) || value.camps.camps.length > 500) fail();
  const camps = value.camps.camps.map(safeCamp);
  if (new Set(camps.map(camp => camp.id)).size !== camps.length) fail();
  const trip = value.trip;
  if (!plain(trip) || !validDate(trip.startDate) || ![0, 1, 2].includes(trip.nights) || !['manual', 'weekend'].includes(trip.mode)) fail();
  if (trip.mode === 'weekend' && (trip.nights !== 1 || new Date(`${trip.startDate}T00:00:00Z`).getUTCDay() !== 6)) fail();
  const known = new Set(camps.map(camp => camp.id));
  const selected = field => {
    const valueIds = value[field];
    if (valueIds === undefined) return { version: 1, ids: camps.map(camp => camp.id) };
    if (valueIds?.version !== 1 || !Array.isArray(valueIds.ids) || valueIds.ids.some(id => !known.has(id)) || new Set(valueIds.ids).size !== valueIds.ids.length) fail();
    return { version: 1, ids: [...valueIds.ids] };
  };
  return { application: 'hare-camp', version: 1, camps: { version: 2, camps }, comparison: selected('comparison'), favorites: selected('favorites'), trip: { startDate: trip.startDate, nights: trip.nights, mode: trip.mode }, ...(Object.hasOwn(value, 'departure') ? { departure: safeDeparture(value.departure) } : {}) };
}
export function parseBackup(content) {
  if (typeof content !== 'string' || new TextEncoder().encode(content).byteLength > MAX_BACKUP_BYTES) throw new Error('バックアップは1MB以下のJSONファイルを選んでください。');
  let payload;
  try { payload = JSON.parse(content); } catch { throw new Error('JSONファイルを読み取れませんでした。元のデータは変更していません。'); }
  return validateBackup(payload);
}
export function createBackup(camps, trip, departure, comparisonIds = camps.map(camp => camp.id), favoriteIds = camps.map(camp => camp.id)) {
  return { ...validateBackup({ application: 'hare-camp', version: 1, camps: { version: 2, camps }, comparison: { version: 1, ids: comparisonIds }, favorites: { version: 1, ids: favoriteIds }, trip, ...(departure ? { departure } : {}) }), exportedAt: new Date().toISOString() };
}
export function applyBackup(value, storage = localStorage) {
  const backup = validateBackup(value);
  const entries = [[STORAGE_KEY, JSON.stringify(backup.camps)], [TRIP_STORAGE_KEY, JSON.stringify(backup.trip)], [COMPARISON_KEY, JSON.stringify(backup.comparison)], [FAVORITES_KEY, JSON.stringify(backup.favorites)]];
  if (backup.departure) entries.push([DEPARTURE_STORAGE_KEY, JSON.stringify(backup.departure)]);
  writeStorageEntries(entries, storage);
  return backup;
}
export function initBackup({ getCamps, getTrip, getComparisonIds, getFavoriteIds }) {
  const $ = selector => document.querySelector(selector);
  let pending = null;
  $('#export-data').addEventListener('click', () => {
    try {
      const data = createBackup(getCamps(), getTrip(), loadLocal(DEPARTURE_STORAGE_KEY, null), getComparisonIds?.(), getFavoriteIds?.());
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `hare-camp-backup-${japanToday()}.json`; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      $('#backup-status').textContent = 'バックアップを作成しました。「ファイル」などに保存し、ホーム画面版で取り込んでください。';
    } catch (error) { $('#backup-status').textContent = `書き出せませんでした。${error.message}`; }
  });
  $('#import-data').addEventListener('change', async event => {
    pending = null;
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('バックアップは1MB以下のJSONファイルを選んでください。');
      pending = parseBackup(await file.text());
      $('#import-preview').textContent = `キャンプ場：${pending.camps.camps.length}件（比較中${pending.comparison.ids.length}件・お気に入り${pending.favorites.ids.length}件） ／ 開始日：${pending.trip.startDate} ／ ${pending.trip.nights === 0 ? '日帰り' : `${pending.trip.nights}泊`}${pending.departure ? ' ／ 保存した出発地点を含む' : ''}`;
      $('#backup-status').textContent = '';
      $('#import-dialog').showModal(); $('#cancel-import').focus();
    } catch (error) { $('#backup-status').textContent = error.message; }
    finally { event.target.value = ''; }
  });
  $('#cancel-import').addEventListener('click', () => $('#import-dialog').close());
  $('#import-dialog').addEventListener('close', () => { pending = null; $('#import-data').focus(); });
  $('#confirm-import').addEventListener('click', () => {
    if (!pending) return;
    try { applyBackup(pending); window.location.reload(); }
    catch (error) { $('#backup-status').textContent = error.message; $('#import-dialog').close(); }
  });
}
