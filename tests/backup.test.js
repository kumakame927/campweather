import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackup, parseBackup, applyBackup, MAX_BACKUP_BYTES, DEPARTURE_STORAGE_KEY } from '../src/backup.js';
import { INITIAL_CAMPS, STORAGE_KEY, LEGACY_STORAGE_KEY, mapLocation, restoreCamps } from '../src/locations.js';
import { TRIP_STORAGE_KEY, makeTrip } from '../src/schedule.js';
const trip = makeTrip('2026-11-07', 1, 'manual');
const example = () => createBackup(INITIAL_CAMPS, trip);
function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { values, getItem(key) { return values.get(key) ?? null; }, setItem(key, value) { values.set(key, value); }, removeItem(key) { values.delete(key); } };
}
test('登録済みOSM・地図調整地点と日程を元の保存形式へ往復する', () => {
  const adjusted = { id: 'adjusted', name: '地図調整した施設', location: mapLocation({ latitude: 35.215, longitude: 140.106 }, '千葉県君津市') };
  const backup = createBackup([...INITIAL_CAMPS, adjusted], trip);
  const parsed = parseBackup(JSON.stringify(backup)); const saved = storage();
  applyBackup(parsed, saved);
  assert.deepEqual(restoreCamps(JSON.parse(saved.getItem(STORAGE_KEY))), [...INITIAL_CAMPS, adjusted]);
  assert.deepEqual(JSON.parse(saved.getItem(TRIP_STORAGE_KEY)), { startDate: trip.startDate, nights: 1, mode: 'manual' });
});
test('初期施設の削除・0件のバックアップをそのまま保存し、初期施設を復活させない', () => {
  const backup = createBackup([], trip); const saved = storage(); applyBackup(backup, saved);
  assert.deepEqual(restoreCamps(JSON.parse(saved.getItem(STORAGE_KEY))), []);
});
test('不正JSON・バージョン・数値・日程・重複ID・危険な位置出典を取り込まない', () => {
  assert.throws(() => parseBackup('{bad'), /JSON/);
  const mutations = [
    b => b.version = 2, b => b.application = 'other', b => b.camps.camps[0].location.latitude = 91,
    b => b.camps.camps[0].location.longitude = '139', b => b.trip.nights = 3, b => b.trip.startDate = '2026-02-30',
    b => b.camps.camps.push(b.camps.camps[0]), b => b.camps.camps[0].location = { latitude: 35, longitude: 139, address: 'test', source: 'verified-listing', sourceId: 'unknown', sourceUrl: 'javascript:alert(1)' },
  ];
  for (const mutate of mutations) { const b = example(); mutate(b); assert.throws(() => parseBackup(JSON.stringify(b))); }
});
test('ファイルサイズ・件数を制限し、大きすぎる取り込みを拒否する', () => {
  assert.throws(() => parseBackup(' '.repeat(MAX_BACKUP_BYTES + 1)), /1MB/);
  const b = example(); b.camps.camps = Array.from({ length: 501 }, (_, i) => ({ ...INITIAL_CAMPS[0], id: `camp-${i}` }));
  assert.throws(() => parseBackup(JSON.stringify(b)));
});
test('ファイル内の任意キー・prototype用のキーを保存先に使わない', () => {
  const b = JSON.parse(JSON.stringify(example())); b.localStorage = { token: 'bad' };
  b.camps.camps[0].__proto__ = { polluted: true };
  const saved = storage({ unrelated: 'keep', [LEGACY_STORAGE_KEY]: 'legacy' });
  applyBackup(b, saved);
  assert.equal(saved.getItem('unrelated'), 'keep'); assert.equal(saved.getItem(LEGACY_STORAGE_KEY), 'legacy');
  assert.equal(saved.getItem('token'), null); assert.equal({}.polluted, undefined);
});
test('途中の容量不足では更新済みキーを元へ戻し、未保存・既存データを保護する', () => {
  const saved = storage({ [STORAGE_KEY]: 'previous camps', [TRIP_STORAGE_KEY]: 'previous trip' });
  const write = saved.setItem.bind(saved); let fail = true;
  saved.setItem = (key, value) => { if (key === TRIP_STORAGE_KEY && fail) { fail = false; throw new Error('quota'); } write(key, value); };
  assert.throws(() => applyBackup(example(), saved), /元のデータは維持/);
  assert.equal(saved.getItem(STORAGE_KEY), 'previous camps'); assert.equal(saved.getItem(TRIP_STORAGE_KEY), 'previous trip');
  const empty = storage(); const set = empty.setItem.bind(empty);
  empty.setItem = (key, value) => { if (key === TRIP_STORAGE_KEY) throw new Error('quota'); set(key, value); };
  assert.throws(() => applyBackup(example(), empty)); assert.equal(empty.getItem(STORAGE_KEY), null);
});
test('別ブランチの出発地点は同じキーで保存し、含まれないファイルでは変更しない', () => {
  const departure = { name: '保存した駅', latitude: 35.68, longitude: 139.76 };
  const saved = storage({ [DEPARTURE_STORAGE_KEY]: 'existing' });
  applyBackup(example(), saved); assert.equal(saved.getItem(DEPARTURE_STORAGE_KEY), 'existing');
  const b = createBackup(INITIAL_CAMPS, trip, departure); applyBackup(b, saved);
  assert.deepEqual(JSON.parse(saved.getItem(DEPARTURE_STORAGE_KEY)), departure);
});
test('既存のキー名を改名せず、過去の有効な日程も失わない', () => {
  assert.equal(STORAGE_KEY, 'camp-weather-camps-v2'); assert.equal(TRIP_STORAGE_KEY, 'camp-weather-trip-v1');
  const old = createBackup(INITIAL_CAMPS, makeTrip('2025-01-01', 2));
  assert.equal(parseBackup(JSON.stringify(old)).trip.startDate, '2025-01-01');
});
