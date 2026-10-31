import { defineConfig } from 'vite';
import { HttpsProxyAgent } from 'https-proxy-agent';
import routesHandler from './api/routes.js';

const agent = process.env.HTTPS_PROXY ? new HttpsProxyAgent(process.env.HTTPS_PROXY) : undefined;
const apiProxy = Object.fromEntries([
  ['open-meteo', 'https://api.open-meteo.com', '/v1/forecast'],
  ['nominatim', 'https://nominatim.openstreetmap.org', '/search'],
].map(([name, target, path]) => [`/api/${name}${path}`, {
  target, changeOrigin: true, secure: true, agent, headers: { 'User-Agent': 'CampWeather-preview/1.0' },
  rewrite: url => url.replace(`/api/${name}`, ''),
  configure(proxy) {
    proxy.on('error', (_error, _req, res) => {
      if (res.writeHead && !res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: true, reason: `${name}への接続に失敗しました。開発環境のネットワーク・プロキシ設定を確認してください。` }));
      }
    });
  },
}]));
// リレーは開発プレビュー専用。静的ビルドは外部 API に直接接続する。
function installRoutes(server) {
  server.middlewares.use(async (req, res, next) => {
    if (req.url.split('?')[0] !== '/api/routes') return next();
    try {
      if (req.method === 'POST') {
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 32000) { res.statusCode = 413; res.end('Request too large'); return; }
          chunks.push(chunk);
        }
        req.body = Buffer.concat(chunks).toString('utf8');
      }
      await routesHandler(req, res);
    } catch { res.statusCode = 500; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: '経路APIを起動できませんでした。' })); }
  });
}
export default defineConfig({ base: './', server: { proxy: apiProxy }, plugins: [{ name: 'camp-routes-preview', configureServer: installRoutes, configurePreviewServer: installRoutes }] });
