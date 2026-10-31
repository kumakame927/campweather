import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRoutes, matrixRequest, normalizeMatrix, validateRouteRequest, MATRIX_URL } from '../server/routes-service.js';
import { sortedAccess, restoredDeparture, durationLabel } from '../src/access.js';

const now = Date.parse('2026-10-31T00:00:00Z');
const input = { origin: { latitude: 35, longitude: 139 }, mode: 'DRIVE', destinations: [{ id: 'a', latitude: 35.1, longitude: 139.2 }, { id: 'b', latitude: 36, longitude: 140 }] };
const env = { ROUTES_ENABLED: 'true', GOOGLE_ROUTES_API_KEY: 'server-only-test-key', UPSTASH_REDIS_REST_URL: 'https://counter.example.test', UPSTASH_REDIS_REST_TOKEN: 'server-only-counter-token', ROUTES_RATE_LIMIT_SECRET: 'server-only-rate-secret' };
const ok = value => ({ ok: true, json: async () => value });

test('課金未承認・キーや共有制限の未設定ではGoogleを一切呼ばない', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('must not fetch'); };
  assert.equal((await computeRoutes(input, { env: {}, fetchImpl })).status, 503);
  assert.equal((await computeRoutes(input, { env: { ...env, ROUTES_ENABLED: 'false' }, fetchImpl })).status, 503);
  assert.equal((await computeRoutes(input, { env: { ...env, UPSTASH_REDIS_REST_TOKEN: '' }, fetchImpl })).status, 503);
  assert.equal(calls, 0);
});
test('不正な座標・移動手段・重複ID・100件超過・公共交通日時は課金前に拒否', () => {
  assert.throws(() => validateRouteRequest({ ...input, mode: 'WALK' }, now));
  assert.throws(() => validateRouteRequest({ ...input, origin: { latitude: NaN, longitude: 139 } }, now));
  assert.throws(() => validateRouteRequest({ ...input, destinations: [input.destinations[0], input.destinations[0]] }, now));
  assert.throws(() => validateRouteRequest({ ...input, destinations: Array(101).fill(input.destinations[0]) }, now));
  assert.throws(() => validateRouteRequest({ ...input, mode: 'TRANSIT', departureTime: '2027-12-01T00:00:00Z' }, now));
  assert(validateRouteRequest({ ...input, mode: 'TRANSIT', departureTime: '2026-11-01T00:00:00Z' }, now));
});
test('車は渋滞なし、公共交通は指定日時。上位課金オプションを送らない', () => {
  const drive = matrixRequest(input);
  assert.equal(drive.routingPreference, 'TRAFFIC_UNAWARE');
  assert.equal(drive.departureTime, undefined);
  const transit = matrixRequest({ ...input, mode: 'TRANSIT', departureTime: '2026-11-01T08:00:00+09:00' });
  assert.equal(transit.departureTime, '2026-10-31T23:00:00.000Z');
  assert.equal(transit.routingPreference, undefined);
  assert.equal(transit.origins.length, 1);
});
test('返却順が不同でも施設に対応付け、経路なし・欠落値を推測しない', () => {
  const routes = normalizeMatrix([{ originIndex: 0, destinationIndex: 1, condition: 'ROUTE_EXISTS', status: {}, duration: '3600s', distanceMeters: 50000 }, { originIndex: 0, destinationIndex: 0, condition: 'ROUTE_NOT_FOUND', status: { code: 5 } }], input.destinations);
  assert.equal(routes[0].available, false);
  assert.equal(routes[1].durationSeconds, 3600);
  const noDistance = normalizeMatrix([{ originIndex: 0, destinationIndex: 0, condition: 'ROUTE_EXISTS', duration: '0s' }], input.destinations);
  assert.equal(noDistance[0].durationSeconds, 0);
  assert.equal(noDistance[0].distanceMeters, null);
  assert.equal(noDistance[1].available, false);
});
test('共有制限が故障・上限到達ならGoogleを呼ばず停止', async () => {
  for (const result of [1, 2, 3]) {
    const calls = [];
    const response = await computeRoutes(input, { env, now, ip: 'example-client', fetchImpl: async (url) => { calls.push(url); return ok({ result }); } });
    assert.equal(response.status, 429); assert.equal(calls.length, 1); assert.notEqual(calls[0], MATRIX_URL);
  }
  const response = await computeRoutes(input, { env, now, fetchImpl: async () => { throw new Error('counter down'); } });
  assert.equal(response.body.code, 'LIMIT_UNAVAILABLE');
});
test('Googleキーはサーバーヘッダーのみ。利用数は目的地数で予約し結果をキャッシュしない', async () => {
  const calls = [];
  const response = await computeRoutes(input, { env, now, ip: 'example-client', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url !== MATRIX_URL) return ok({ result: 0 });
    return ok([{ originIndex: 0, destinationIndex: 0, condition: 'ROUTE_EXISTS', duration: '120s', distanceMeters: 1000 }]);
  } });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.headers['X-Goog-Api-Key'], env.GOOGLE_ROUTES_API_KEY);
  assert(!JSON.stringify(response).includes(env.GOOGLE_ROUTES_API_KEY));
  assert.equal(JSON.parse(calls[0].options.body).at(-4), '2');
  assert(!calls[0].options.body.includes('example-client'));
  assert(!calls[0].options.body.includes('durationSeconds'));
  assert.equal(response.body.routes[1].available, false);
});
test('API失敗を取得可能な経路や直線距離に置き換えない', async () => {
  const response = await computeRoutes(input, { env, now, fetchImpl: async url => url === MATRIX_URL ? { ok: false, status: 403 } : ok({ result: 0 }) });
  assert.equal(response.status, 502);
  assert.equal(response.body.routes, undefined);
});
test('アプリ内の時間順と雨順の比較、出発地点の復元', () => {
  const camps = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  const routes = new Map([['a', { available: true, durationSeconds: 3600 }], ['b', { available: true, durationSeconds: 120 }]]);
  const day = rain => ({ rain, high: 20, low: 10, wind: 3, code: 1 });
  const forecast = id => id === 'c' ? null : { days: [day(0), day(id === 'a' ? 10 : 80)] };
  assert.deepEqual(sortedAccess(camps, routes, forecast, 'time').map(c => c.id), ['b', 'a', 'c']);
  assert.deepEqual(sortedAccess(camps, routes, forecast, 'rain').map(c => c.id), ['a', 'b', 'c']);
  assert.equal(restoredDeparture({ name: '出発駅', latitude: 35, longitude: 139 }).name, '出発駅');
  assert.equal(restoredDeparture({ name: '不正', latitude: 999, longitude: 0 }), null);
  assert.equal(durationLabel(3601), '1時間1分');
});
