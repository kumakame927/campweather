import { createCatalogService } from '../server/catalog-service.js';
const service = createCatalogService();
export function catalogHandler(getCatalog = service) {
  return async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') { res.statusCode = 405; res.setHeader('Allow', 'GET'); res.end(JSON.stringify({ error: 'GETを利用してください。' })); return; }
    if ([...new URL(req.url, 'http://localhost').searchParams].length) { res.statusCode = 400; res.end(JSON.stringify({ error: '一覧の指定が不正です。' })); return; }
    try {
      const data = await getCatalog(); res.statusCode = 200;
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.setHeader('Vercel-CDN-Cache-Control', `public, s-maxage=${data.stale ? 300 : 3600}`);
      res.end(JSON.stringify(data));
    } catch (error) { res.statusCode = 503; res.end(JSON.stringify({ error: error.message })); }
  };
}
export default catalogHandler();
