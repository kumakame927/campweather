import { getForecast, FORECAST_TTL } from '../server/jma-forecast.js';
import { offices } from '../server/jma-areas.js';
export function forecastHandler(fetchForecast = getForecast) {
  return async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') { res.statusCode = 405; res.setHeader('Allow', 'GET'); res.end(JSON.stringify({ error: 'GETを利用してください。' })); return; }
    const params = new URL(req.url, 'http://localhost').searchParams, office = params.get('office');
    // A single canonical cache key per office, shared across camp locations and dates.
    if (!office || !Object.hasOwn(offices, office) || [...params.keys()].length !== 1) { res.statusCode = 400; res.end(JSON.stringify({ error: '予報区域の指定が不正です。' })); return; }
    try {
      const value = await fetchForecast(office);
      res.statusCode = 200;
      // Keep browser revalidation short, while sharing the result at Vercel's CDN.
      const remaining = Math.max(0, Math.min(600, Math.floor((Date.parse(value.retrievedAt) + FORECAST_TTL - Date.now()) / 1000)));
      res.setHeader('Cache-Control', `public, max-age=${Math.min(60, remaining)}`);
      res.setHeader('Vercel-CDN-Cache-Control', `public, s-maxage=${remaining}`);
      res.end(JSON.stringify(value));
    } catch (error) {
      console.error('[晴れキャン JMA]', error.message);
      res.statusCode = 502;
      res.end(JSON.stringify({ error: `気象庁の参考予報を取得できませんでした。${error.message} Open-Meteoの表示は引き続き利用できます。` }));
    }
  };
}
export default forecastHandler();
