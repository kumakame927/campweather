import { createHmac } from 'node:crypto';

export const MATRIX_URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';
export const FIELD_MASK = 'originIndex,destinationIndex,status,condition,distanceMeters,duration';
const coordinate = value => value && typeof value.latitude === 'number' && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90 && typeof value.longitude === 'number' && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180;
export function validateRouteRequest(body, now = Date.now()) {
  if (!body || !coordinate(body.origin)) throw new Error('出発地点を選択してください。');
  if (!['DRIVE', 'TRANSIT'].includes(body.mode)) throw new Error('移動手段が不正です。');
  if (!Array.isArray(body.destinations) || body.destinations.length < 1 || body.destinations.length > 100) throw new Error('1回の比較は1〜100施設です。');
  const ids = new Set();
  for (const destination of body.destinations) {
    if (!coordinate(destination) || typeof destination.id !== 'string' || !destination.id || destination.id.length > 120 || ids.has(destination.id)) throw new Error('キャンプ場の位置情報を確認してください。');
    ids.add(destination.id);
  }
  if (body.mode === 'TRANSIT') {
    if (typeof body.departureTime !== 'string' || !Number.isFinite(Date.parse(body.departureTime))) throw new Error('公共交通の出発日時を指定してください。');
    const time = Date.parse(body.departureTime);
    if (time < now - 7 * 86400000 || time > now + 100 * 86400000) throw new Error('公共交通の日時は7日前から100日後までを指定してください。');
  }
  return body;
}
export function matrixRequest(input) {
  const waypoint = point => ({ waypoint: { location: { latLng: { latitude: point.latitude, longitude: point.longitude } } } });
  return {
    origins: [waypoint(input.origin)], destinations: input.destinations.map(waypoint),
    travelMode: input.mode, languageCode: 'ja', regionCode: 'JP', units: 'METRIC',
    ...(input.mode === 'DRIVE' ? { routingPreference: 'TRAFFIC_UNAWARE' } : { departureTime: new Date(input.departureTime).toISOString() }),
  };
}
export function normalizeMatrix(elements, destinations) {
  if (!Array.isArray(elements)) throw new Error('経路APIの応答形式が不正です。');
  const byIndex = new Map();
  for (const element of elements) {
    if (element.originIndex !== 0 || !Number.isInteger(element.destinationIndex) || element.destinationIndex < 0 || element.destinationIndex >= destinations.length || byIndex.has(element.destinationIndex)) continue;
    byIndex.set(element.destinationIndex, element);
  }
  return destinations.map((destination, index) => {
    const item = byIndex.get(index);
    const duration = typeof item?.duration === 'string' && /^\d+(\.\d+)?s$/.test(item.duration) ? Number(item.duration.slice(0, -1)) : null;
    const distance = typeof item?.distanceMeters === 'number' && Number.isFinite(item.distanceMeters) && item.distanceMeters >= 0 ? item.distanceMeters : null;
    if (!item || item.condition !== 'ROUTE_EXISTS' || (item.status?.code ?? 0) !== 0 || !Number.isFinite(duration) || duration === null) return { id: destination.id, available: false, reason: '経路を取得できませんでした。' };
    return { id: destination.id, available: true, durationSeconds: duration, distanceMeters: distance };
  });
}
function limit(env, key, fallback, maximum) {
  const value = Number(env[key] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error('サーバーの利用上限設定を確認してください。');
  return value;
}
export function routeConfig(env) {
  return env.ROUTES_ENABLED === 'true' && Boolean(env.GOOGLE_ROUTES_API_KEY && env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN && env.ROUTES_RATE_LIMIT_SECRET);
}
// Google の所要時間・距離はキャッシュしない。Redis には利用数と匿名化した制限キーのみを保存。
const RESERVE = `
local n=tonumber(ARGV[1])
if tonumber(redis.call('GET',KEYS[1]) or '0')+n>tonumber(ARGV[2]) then return 1 end
if tonumber(redis.call('GET',KEYS[2]) or '0')+n>tonumber(ARGV[3]) then return 2 end
if tonumber(redis.call('GET',KEYS[3]) or '0')>=tonumber(ARGV[4]) then return 3 end
redis.call('INCRBY',KEYS[1],n) redis.call('EXPIRE',KEYS[1],172800)
redis.call('INCRBY',KEYS[2],n) redis.call('EXPIRE',KEYS[2],2764800)
redis.call('INCR',KEYS[3]) redis.call('EXPIRE',KEYS[3],60)
return 0`;
export async function reserveUsage(env, fetchImpl, elements, ip, now) {
  const date = new Date(now).toISOString();
  const identity = createHmac('sha256', env.ROUTES_RATE_LIMIT_SECRET).update(ip).digest('hex');
  const url = new URL(env.UPSTASH_REDIS_REST_URL);
  if (url.protocol !== 'https:') throw new Error('Invalid rate limit backend');
  const command = ['EVAL', RESERVE, '3', `camp-routes:day:${date.slice(0, 10)}`, `camp-routes:month:${date.slice(0, 7)}`, `camp-routes:client:${identity}`, String(elements), String(limit(env, 'ROUTES_DAILY_ELEMENTS', 100, 10000)), String(limit(env, 'ROUTES_MONTHLY_ELEMENTS', 3000, 100000)), String(limit(env, 'ROUTES_CLIENT_REQUESTS_PER_MINUTE', 10, 60))];
  const response = await fetchImpl(url.href, { method: 'POST', headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command), signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Rate limit backend unavailable');
  const payload = await response.json();
  if (payload.error || !Number.isInteger(payload.result) || payload.result < 0 || payload.result > 3) throw new Error('Invalid rate limit response');
  return payload.result;
}
export async function computeRoutes(body, { env = process.env, fetchImpl = fetch, ip = 'unknown', now = Date.now() } = {}) {
  const unavailable = { status: 503, body: { code: 'NOT_CONFIGURED', error: '経路比較は管理者のAPI・課金承認・利用上限設定待ちです。所要時間と距離はまだ取得していません。' } };
  if (!routeConfig(env)) return unavailable;
  try { validateRouteRequest(body, now); }
  catch (error) { return { status: 400, body: { code: 'INVALID_REQUEST', error: error.message } }; }
  let reserved;
  try { reserved = await reserveUsage(env, fetchImpl, body.destinations.length, ip, now); }
  catch { return { status: 503, body: { code: 'LIMIT_UNAVAILABLE', error: '利用上限を確認できないため、課金防止のため経路APIを呼び出しませんでした。' } }; }
  if (reserved !== 0) return { status: 429, body: { code: 'LIMIT_EXCEEDED', error: reserved === 1 ? '1日の比較上限に達しました。' : reserved === 2 ? '今月の比較上限に達しました。' : '短時間の比較回数が上限に達しました。少し待ってください。' } };
  try {
    const response = await fetchImpl(MATRIX_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env.GOOGLE_ROUTES_API_KEY, 'X-Goog-FieldMask': FIELD_MASK }, body: JSON.stringify(matrixRequest(body)), signal: AbortSignal.timeout(15000) });
    if (!response.ok) return { status: 502, body: { code: 'PROVIDER_ERROR', error: `Googleの経路取得が失敗しました（HTTP ${response.status}）。API有効化・キー制限・割当を管理者が確認してください。` } };
    return { status: 200, body: { provider: 'Google Maps', mode: body.mode, fetchedAt: new Date(now).toISOString(), routes: normalizeMatrix(await response.json(), body.destinations) } };
  } catch { return { status: 502, body: { code: 'ROUTE_FAILED', error: '経路を取得できませんでした。時間をおいて再試行してください。' } }; }
}
