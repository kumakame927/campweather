import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveArea } from '../server/jma-areas.js';
import { parseJmaForecast, createForecastService, FORECAST_TTL } from '../server/jma-forecast.js';
import { selectReference, japanTimestamp } from '../src/jma.js';
import { INITIAL_CAMPS } from '../src/locations.js';
import areaHandler from '../api/jma-area.js';
import { forecastHandler } from '../api/jma-forecast.js';
const payload = JSON.parse(readFileSync(new URL('./fixtures/jma-220000.json', import.meta.url), 'utf8'));
const now = Date.parse('2026-10-31T09:00:00Z');
const clone = () => structuredClone(payload);
const records = parseJmaForecast(payload, now);

test('初期3施設は公式ポリゴン・住所で東部/伊豆/茨城県北部へ対応する', () => {
  assert.deepEqual(INITIAL_CAMPS.map(camp => resolveArea(camp.location.latitude, camp.location.longitude, camp.location.address)?.code), ['220030', '220020', '080010']);
});
test('海上・国外・不正値・境界付近・住所矛盾では別地域を推測しない', () => {
  for (const pair of [[0, 0], [35, 150], [91, 139], [NaN, 139]]) assert.equal(resolveArea(...pair), null);
  const coastal = INITIAL_CAMPS[1].location;
  assert.equal(resolveArea(coastal.latitude, coastal.longitude), null);
  assert.equal(resolveArea(coastal.latitude, coastal.longitude, '静岡県富士宮市麓156'), null);
  const camp = INITIAL_CAMPS[0].location;
  assert.equal(resolveArea(camp.latitude, camp.longitude, '茨城県笠間市上郷'), null);
});
test('短期降水確率は00/06/12/18時のまま保持し、0%と欠測を区別する', () => {
  const short = records.filter(r => r.areaCode === '220020' && r.date === '2026-11-01' && r.rain);
  assert.deepEqual(short.map(r => r.rain.label), ['00–06時', '06–12時', '12–18時', '18–24時']);
  assert.deepEqual(short.map(r => r.rain.probability), [0, 0, 0, 0]);
  const p = clone(); p[0].timeSeries[1].areas[3].pops[1] = '';
  assert.equal(parseJmaForecast(p, now).find(r => r.areaCode === '220020' && r.date === '2026-11-01' && r.rain)?.rain.probability, null);
  assert(short.every(r => r.dailyRain === undefined));
});
test('週間予報の区域名・日単位の発表値を維持し天気コードを公式表記にする', () => {
  const weekly = records.find(r => r.kind === 'weekly' && r.date === '2026-11-02');
  assert.equal(weekly.areaName, '静岡県'); assert.equal(weekly.dailyRain, 70);
  assert.equal(weekly.weather, '曇時々雨');
  const p = clone(); p[1].timeSeries[0].areas[0].weatherCodes[0] = '999';
  assert.equal(parseJmaForecast(p, now).find(r => r.kind === 'weekly')?.weather, null);
});
test('短期はキャンプ場の区域、週間は一致コード/府県全体のみ使い他地域で補完しない', () => {
  const area = resolveArea(35.3985153, 138.5659069);
  const days = selectReference(records, area, ['2026-11-01', '2026-11-02', '2026-11-10']);
  assert.equal(days[0].short.find(r => r.weather).weather, '晴れ 朝晩 くもり');
  assert.equal(days[0].weekly.length, 0);
  assert.equal(days[1].weekly[0].areaName, '静岡県');
  assert.deepEqual(days[2], { date: '2026-11-10', short: [], weekly: [] });
  const unrelated = records.map(r => ({ ...r, areaCode: '130030' }));
  assert(selectReference(unrelated, area, ['2026-11-01'])[0].weekly.length === 0);
});
test('発表日時をJST表示し、日付がUTCでも取り違えない', () => {
  assert.match(japanTimestamp('2026-10-31T20:00:00Z'), /2026\/11\/1 05:00 JST/);
  assert.equal(japanTimestamp('broken'), '日時不明');
  assert.match(japanTimestamp(Date.parse('2026-10-31T09:00:00Z')), /2026\/10\/31 18:00 JST/);
});
test('仕様変更・古い発表・不正な時間帯・発表日時欠落を拒否する', () => {
  assert.throws(() => parseJmaForecast({}, now), /形式/);
  assert.throws(() => parseJmaForecast(payload, now + 37 * 3600000), /古い/);
  const p = clone(); delete p[0].reportDatetime; assert.throws(() => parseJmaForecast(p, now), /日時/);
  const q = clone(); q[0].timeSeries[1].timeDefines[0] = '2026-10-31T19:00:00+09:00'; assert.throws(() => parseJmaForecast(q, now), /時間帯/);
});
test('同一官署は並行・連続のリクエストを共有し、10分後に実取得する', async () => {
  let calls = 0, clock = now;
  const service = createForecastService({ now: () => clock, fetchJson: async url => { calls++; assert(url.endsWith('/220000.json')); return payload; } });
  const values = await Promise.all([service('220000'), service('220000'), service('220000')]);
  assert.equal(calls, 1); assert.equal(values[0].retrievedAt, new Date(now).toISOString());
  clock += FORECAST_TTL - 1; assert.equal(await service('220000'), values[0]); assert.equal(calls, 1);
  clock += 2; await service('220000'); assert.equal(calls, 2);
});
test('取得失敗時も60秒間は再通信を抑え、古い予報を返さない', async () => {
  let calls = 0, clock = now;
  const service = createForecastService({ now: () => clock, fetchJson: async () => { calls++; throw new Error('test offline'); } });
  await assert.rejects(service('220000')); await assert.rejects(service('220000')); assert.equal(calls, 1);
  clock += 60001; await assert.rejects(service('220000')); assert.equal(calls, 2);
});
function res() { return { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(s) { this.body = s ? JSON.parse(s) : null; } }; }
test('区域APIは無効座標を422、POSTを405にする', () => {
  const response = res(); areaHandler({ url: '/api/jma-area?latitude=&longitude=139', method: 'GET' }, response); assert.equal(response.statusCode, 422);
  const post = res(); areaHandler({ url: '/api/jma-area', method: 'POST' }, post); assert.equal(post.statusCode, 405);
});
test('予報APIは官署を限定し、任意URL・余分なキャッシュキーでは外部通信しない', async () => {
  let calls = 0; const handler = forecastHandler(async () => { calls++; });
  for (const url of ['/api/jma-forecast?office=https://other.test', '/api/jma-forecast?office=220000&x=1', '/api/jma-forecast?office=999999']) {
    const response = res(); await handler({ url, method: 'GET' }, response); assert.equal(response.statusCode, 400);
  }
  assert.equal(calls, 0);
});
test('予報APIはキャッシュ用のヘッダーを付け、失敗時はno-storeと独立したエラーを返す', async () => {
  const good = res(); await forecastHandler(async () => ({ records, retrievedAt: new Date().toISOString() }))({ url: '/api/jma-forecast?office=220000', method: 'GET' }, good);
  assert.equal(good.statusCode, 200); assert.match(good.headers['Vercel-CDN-Cache-Control'], /s-maxage=\d+/);
  const bad = res(); await forecastHandler(async () => { throw new Error('test upstream'); })({ url: '/api/jma-forecast?office=220000', method: 'GET' }, bad);
  assert.equal(bad.statusCode, 502); assert.equal(bad.headers['Cache-Control'], 'no-store'); assert.match(bad.body.error, /Open-Meteo/);
});
