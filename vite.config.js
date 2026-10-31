import { defineConfig } from 'vite';
import { HttpsProxyAgent } from 'https-proxy-agent';

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
export default defineConfig({ base: './', server: { proxy: apiProxy } });
