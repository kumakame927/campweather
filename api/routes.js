import { computeRoutes, routeConfig } from '../server/routes-service.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'GET') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ enabled: routeConfig(process.env), provider: 'Google Maps', message: routeConfig(process.env) ? '利用できます。' : '経路APIは管理者の設定・課金承認待ちです。' }));
    return;
  }
  if (req.method !== 'POST') { res.statusCode = 405; res.setHeader('Allow', 'GET, POST'); res.end(); return; }
  // 同一オリジンのみ。CORS を緩めず、外部サイトからブラウザ経由の濫用を抑える。
  if (req.headers['sec-fetch-site'] === 'cross-site') { res.statusCode = 403; res.end(JSON.stringify({ error: '外部サイトからのリクエストは利用できません。' })); return; }
  let body;
  try {
    const text = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (!text || Buffer.byteLength(text) > 32000) throw new Error();
    body = JSON.parse(text);
  } catch { res.statusCode = 400; res.end(JSON.stringify({ error: 'リクエストを読み取れませんでした。' })); return; }
  const ip = String(req.headers['x-vercel-forwarded-for'] ?? req.headers['x-real-ip'] ?? req.socket?.remoteAddress ?? 'unknown').split(',')[0].trim();
  const result = await computeRoutes(body, { ip });
  res.statusCode = result.status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(result.body));
}
