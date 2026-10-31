import { resolveArea } from '../server/jma-areas.js';
export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  if (req.method !== 'GET') { res.statusCode = 405; res.setHeader('Allow', 'GET'); res.end(JSON.stringify({ error: 'GETを利用してください。' })); return; }
  const params = new URL(req.url, 'http://localhost').searchParams;
  const lat = params.get('latitude'), lon = params.get('longitude');
  const area = lat?.trim() && lon?.trim() ? resolveArea(Number(lat), Number(lon), (params.get('address') ?? '').slice(0, 500)) : null;
  if (!area) {
    res.statusCode = 422;
    res.end(JSON.stringify({ error: '気象庁の予報区域を確定できません。区域の境界付近・海上・対応未確認の地点では、推測で別地域の予報を表示しません。' }));
    return;
  }
  res.statusCode = 200;
  res.end(JSON.stringify({ area }));
}
