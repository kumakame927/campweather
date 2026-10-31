import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import assert from 'node:assert/strict';
import { chromium, request } from 'playwright';

// Vercel 本番そのものではなく、vercel.json の転送先とビルド成果物をローカルで検証する。
const config = JSON.parse(await readFile('vercel.json', 'utf8'));
const directory = resolve(config.outputDirectory);
const remote = await request.newContext(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const calls = [];
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const rewrite = config.rewrites.find(rule => rule.source === url.pathname);
    if (rewrite) {
      const target = new URL(rewrite.destination); target.search = url.search;
      const response = await remote.get(target.href, { headers: { 'User-Agent': 'CampWeather-vercel-preflight/1.0' } });
      calls.push({ path: url.pathname, status: response.status() });
      res.writeHead(response.status(), { 'Content-Type': response.headers()['content-type'] ?? 'application/json' });
      res.end(await response.body()); return;
    }
    const file = resolve(directory, url.pathname.slice(1) || 'index.html');
    if (!file.startsWith(directory + sep)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Content-Security-Policy': "connect-src 'self'" });
    res.end(body);
  } catch { res.writeHead(502).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const ready = count => page.waitForFunction(n => document.querySelector('#fetch-status').textContent === `${n}施設登録 · ${n}施設の予報を比較可能`, count, { timeout: 30000 });
  await ready(3);
  await page.locator('#add-camp').click();
  await page.locator('#location-query').fill('亀山湖オートキャンプ場');
  await page.locator('#search-location').click();
  await page.locator('[data-select="0"]').waitFor({ timeout: 20000 });
  assert.match(await page.locator('.search-result').first().textContent(), /亀山湖/);
  await page.locator('[data-select="0"]').click();
  await page.locator('#confirm-location').click();
  await ready(4);
  await page.reload(); await ready(4);
  const rain = (await page.locator('.sunday .rain dd').allTextContents()).map(parseFloat);
  assert.deepEqual(rain, [...rain].sort((a, b) => a - b));
  assert(calls.some(call => call.path === '/api/nominatim/search'));
  assert(calls.every(call => call.status === 200));
  assert.deepEqual(errors, []);
  console.log(`PASS Vercel構成のローカル確認: ${calls.length}件の実API通信がHTTP 200。初期3施設、亀山湖の登録、4施設の予報、保持、日曜降水確率順 ${rain.join(', ')}%。`);
} finally {
  await browser?.close(); await remote.dispose(); await new Promise(resolve => server.close(resolve));
}
