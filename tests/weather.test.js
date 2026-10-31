import test from 'node:test';
import assert from 'node:assert/strict';
import { nextWeekend, forecastUrl, parseForecast, comparable, compareForecasts, sameConditions, weatherLabel, fetchJson } from '../src/weather.js';
import { restoreCamps, parseSearchResults, nameMatches, searchLocations, locationId } from '../src/locations.js';
import { requestTarget } from '../src/api.js';

const weekend = { saturday: '2026-10-31', sunday: '2026-11-01' };
test('Pages用の直接接続とVercel用の同一オリジン接続でURL・クエリを維持する', () => {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=35&longitude=139';
  assert.equal(requestTarget(url, false).url, url);
  assert.equal(requestTarget(url, true).url, '/api/open-meteo/v1/forecast?latitude=35&longitude=139');
  assert.equal(requestTarget('https://nominatim.openstreetmap.org/search?q=camp', true).url, '/api/nominatim/search?q=camp');
  assert.equal(requestTarget('https://example.test/path', true).url, 'https://example.test/path');
});
function payload(overrides = {}) {
  return {
    daily_units: { temperature_2m_max: '°C', temperature_2m_min: '°C', wind_speed_10m_max: 'm/s', precipitation_probability_max: '%' },
    daily: { time: [weekend.saturday, weekend.sunday], weather_code: [2, 3], precipitation_probability_max: [40, 10], temperature_2m_max: [19, 18], temperature_2m_min: [9, 8], wind_speed_10m_max: [2.4, 3.1], ...overrides },
  };
}
const candidate = (name, rain, wind = [2, 3], satRain = 40) => ({ name, forecast: parseForecast(payload({ precipitation_probability_max: [satRain, rain], wind_speed_10m_max: wind }), weekend) });

test('日本時間の金曜から直近土日を選ぶ', () => {
  assert.deepEqual(nextWeekend(new Date('2026-10-30T14:59:59Z')), weekend);
});
test('土曜日は当日を含み、UTC日付には依存しない', () => {
  assert.deepEqual(nextWeekend(new Date('2026-10-30T15:00:00Z')), weekend);
  assert.deepEqual(nextWeekend(new Date('2026-10-31T14:59:59Z')), weekend);
});
test('日本時間の日曜日になったら次の週末に切り替える', () => {
  assert.deepEqual(nextWeekend(new Date('2026-10-31T15:00:00Z')), { saturday: '2026-11-07', sunday: '2026-11-08' });
});
test('年末・閏年の日付計算', () => {
  assert.deepEqual(nextWeekend(new Date('2026-12-31T12:00:00Z')), { saturday: '2027-01-02', sunday: '2027-01-03' });
  assert.deepEqual(nextWeekend(new Date('2028-02-28T12:00:00Z')), { saturday: '2028-03-04', sunday: '2028-03-05' });
});
test('予報のURLは確認した座標・日本時間・m/sと対象土日のみを指定', () => {
  const url = forecastUrl({ location: { latitude: 35.123, longitude: 138.456 } }, weekend);
  assert.equal(url.origin, 'https://api.open-meteo.com');
  assert.equal(url.searchParams.get('latitude'), '35.123');
  assert.equal(url.searchParams.get('wind_speed_unit'), 'ms');
  assert.equal(url.searchParams.get('timezone'), 'Asia/Tokyo');
  assert.equal(url.searchParams.get('start_date'), weekend.saturday);
  assert.equal(url.searchParams.get('end_date'), weekend.sunday);
});
test('APIの日付に対応して読み取り、0%と0m/s、負の気温を保持', () => {
  const data = parseForecast(payload({ time: [weekend.sunday, weekend.saturday], precipitation_probability_max: [0, 20], wind_speed_10m_max: [0, 3], temperature_2m_min: [-2, 0] }), weekend);
  assert.equal(data.sunday.rain, 0);
  assert.equal(data.sunday.wind, 0);
  assert.equal(data.sunday.low, -2);
  assert.equal(data.saturday.rain, 20);
  assert(comparable(data));
});
test('欠測値や対象日の不足を0扱いせず比較対象から外す', () => {
  const missing = parseForecast(payload({ precipitation_probability_max: [0, null] }), weekend);
  assert.equal(missing.sunday.rain, null);
  assert(!comparable(missing));
  assert(!comparable(parseForecast(payload({ time: [weekend.saturday] }), weekend)));
  assert(!comparable(parseForecast(payload({ wind_speed_10m_max: [null, 1] }), weekend)));
  assert.throws(() => parseForecast(payload({ time: ['2026-01-01'] }), weekend), /対象/);
});
test('不正な単位・数値を除外し、未知の天気コードは晴れと扱わない', () => {
  const invalid = payload(); invalid.daily_units.wind_speed_10m_max = 'km/h';
  assert.throws(() => parseForecast(invalid, weekend), /単位/);
  assert.equal(parseForecast(payload({ precipitation_probability_max: [20, '0'] }), weekend).sunday.rain, null);
  assert.equal(parseForecast(payload({ precipitation_probability_max: [20, 101] }), weekend).sunday.rain, null);
  assert.equal(weatherLabel(null), '天気情報なし');
  assert.equal(weatherLabel(42), '天気情報なし');
  assert(!comparable(parseForecast(payload({ weather_code: [42, 0] }), weekend)));
});
test('日曜降水確率、週末最大風速、土曜降水確率の優先順で比較', () => {
  const values = [candidate('多雨', 50, [0, 0]), candidate('強風', 10, [9, 0]), candidate('土曜雨', 10, [2, 3], 90), candidate('第一候補', 10, [2, 3], 0), { name: '欠測', forecast: null }];
  assert.deepEqual(values.sort(compareForecasts).map(item => item.name), ['第一候補', '土曜雨', '強風', '多雨', '欠測']);
  assert(sameConditions(candidate('A', 10).forecast, candidate('B', 10).forecast));
  assert(!sameConditions(candidate('A', 10).forecast, candidate('B', 10, [6, 2]).forecast));
});
test('検索の住所・OSM座標を保持し、不正な座標やOSM識別子を排除', () => {
  const source = { name: 'テスト施設', display_name: '東京都 テスト住所', lat: '35.123', lon: '139.456', osm_type: 'way', osm_id: 123 };
  const found = parseSearchResults([source, { ...source, lat: '' }, { ...source, lon: '181' }, { ...source, osm_type: 'invalid' }]);
  assert.equal(found.length, 1);
  assert.equal(found[0].location.latitude, 35.123);
  assert.equal(found[0].location.address, source.display_name);
  assert.throws(() => parseSearchResults({}), /応答/);
});
test('確認済みの初期座標を使い、不正な施設情報は復元しない', () => {
  const initial = restoreCamps(null);
  assert.equal(initial.length, 3);
  assert.equal(initial[0].location.osmId, '640260125');
  assert.equal(initial[1].location.osmId, '14285784581');
  assert.equal(initial[2].location.osmId, '14286833431');
  const location = parseSearchResults([{ display_name: '検索結果の住所', lat: '35.123', lon: '139.456', osm_type: 'node', osm_id: 123 }])[0].location;
  const camps = restoreCamps([{ id: 'nikoniko', name: '別名', location }, { id: 'custom', name: '追加施設', location }, { id: 'invalid', name: '不正', location: {} }]);
  assert.equal(camps.length, 4);
  assert.equal(camps.find(camp => camp.id === 'nikoniko').name, '別名');
  assert.deepEqual(camps.find(camp => camp.id === 'nikoniko').location, location);
});
test('HTTPエラー・利用制限・タイムアウトを成功扱いしない', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 429 }));
  await assert.rejects(fetchJson('https://example.test'), /利用回数/);
  globalThis.fetch.mock.mockImplementation(async () => ({ ok: false, status: 503 }));
  await assert.rejects(fetchJson('https://example.test'), /503/);
  globalThis.fetch.mock.mockImplementation(async () => ({ ok: false, status: 403 }));
  await assert.rejects(fetchJson('https://example.test'), /接続が拒否.*アクセス制限/);
  globalThis.fetch.mock.mockImplementation(async () => ({ ok: true, json: async () => { throw new SyntaxError('invalid JSON'); } }));
  await assert.rejects(fetchJson('https://example.test'), /応答を読み取れません/);
  globalThis.fetch.mock.mockImplementation(async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
  await assert.rejects(fetchJson('https://example.test', { timeout: 10 }), /タイムアウト/);
});


test('施設名と無関係の検索結果を一致と判定しない', () => {
  assert(!nameMatches('亀山湖オートキャンプ場', '曽原湖オートキャンプ場'));
  assert(nameMatches('ふもとっぱら', 'ふもとっぱらキャンプ場'));
  assert(nameMatches('ニコニコキャンプ', 'にこにこキャンプ'));
});
test('通信成功時の補足候補は出典確認済みの座標を使い、再読み込み用に復元可能', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => [] }));
  const found = await searchLocations('亀山湖オートキャンプ場', new AbortController().signal);
  assert.equal(found.length, 1);
  assert.equal(found[0].location.latitude, 35.215901);
  assert.equal(found[0].location.sourceUrl, 'https://www.nap-camp.com/chiba/11955');
  const restored = restoreCamps([{ id: locationId(found[0].location), ...found[0] }]);
  assert.equal(restored.length, 4);
  assert.equal(restored[3].location.sourceId, 'nap-camp-11955');
});

test('選択日程は1〜3日、月末・年末をまたいでも正しく作る', async () => {
  const { makeTrip, restoreTrip } = await import('../src/schedule.js');
  assert.deepEqual(makeTrip('2026-12-31', 2).dates, ['2026-12-31', '2027-01-01', '2027-01-02']);
  assert.equal(makeTrip('2026-11-01', 0).dates.length, 1);
  assert.equal(makeTrip('2026-11-01', 1).endDate, '2026-11-02');
  assert.throws(() => makeTrip('2026-02-30', 1));
  assert.throws(() => makeTrip('2026-11-01', 3));
  assert.equal(restoreTrip({ mode: 'manual', startDate: '2026-11-05', nights: 2 }).endDate, '2026-11-07');
  assert.equal(restoreTrip(null, new Date('2026-11-01T01:00:00Z')).startDate, '2026-11-07');
});
test('予報範囲は日本時間の今日から15日後まで、最終日を検証', async () => {
  const { makeTrip, tripRangeError } = await import('../src/schedule.js');
  const now = new Date('2026-10-31T00:00:00Z');
  assert.equal(tripRangeError(makeTrip('2026-11-15', 0), now), '');
  assert.equal(tripRangeError(makeTrip('2026-11-13', 2), now), '');
  assert.match(tripRangeError(makeTrip('2026-11-14', 2), now), /最終日/);
  assert.match(tripRangeError(makeTrip('2026-10-30', 0), now), /過去/);
});
test('日帰り・2泊3日のAPI期間・欠測判定と撤収日優先の順位', async () => {
  const { makeTrip } = await import('../src/schedule.js');
  const trip = makeTrip('2026-10-31', 2);
  assert.equal(forecastUrl({ location: { latitude: 35, longitude: 139 } }, trip).searchParams.get('end_date'), '2026-11-02');
  const three = overrides => parseForecast(payload({ time: trip.dates, weather_code: [1, 2, 3], precipitation_probability_max: [0, 10, 90], temperature_2m_max: [20, 20, 20], temperature_2m_min: [10, 10, 10], wind_speed_10m_max: [1, 1, 1], ...overrides }), trip);
  const dryFinish = { name: '撤収日が乾く', forecast: three({ precipitation_probability_max: [100, 100, 0] }) };
  const rainyFinish = { name: '初日が乾く', forecast: three({}) };
  assert(compareForecasts(dryFinish, rainyFinish) < 0);
  assert(!comparable(three({ precipitation_probability_max: [0, null, 0] })));
  const day = makeTrip('2026-10-31', 0);
  assert.equal(parseForecast(payload(), day).days.length, 1);
  assert(comparable(parseForecast(payload(), day)));
});
test('保存v2は初期施設の削除と0件を保持し、v1は追加済み施設を移行', () => {
  const original = restoreCamps(null);
  const custom = { ...original[0], id: 'my-camp', name: '以前に追加した施設' };
  assert.equal(restoreCamps([custom]).length, 4);
  assert.deepEqual(restoreCamps({ version: 2, camps: [] }), []);
  const deleted = restoreCamps({ version: 2, camps: [original[1], custom] });
  assert.deepEqual(deleted.map(camp => camp.id), ['izu-kakure', 'my-camp']);
  const map = { id: 'map-camp', name: '地図の地点', location: { latitude: 35, longitude: 139, address: '選んだ地点', source: 'map-pin', sourceId: 'map-35.000000-139.000000' } };
  assert.equal(restoreCamps({ version: 2, camps: [map] }).length, 1);
});
