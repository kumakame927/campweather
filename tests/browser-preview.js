import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, request } from 'playwright';
import { INITIAL_CAMPS } from '../src/locations.js';

const live = process.argv.includes('--live');
const root = resolve('.');
const output = resolve('test-results');
await mkdir(output, { recursive: true });
// ソースとビルドの両方を、Vite の変換なしで正しい MIME 型で配信する。
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const source = url.pathname.startsWith('/source/');
    const prefix = source ? '/source/' : '/campweather/';
    if (!url.pathname.startsWith(prefix)) { res.writeHead(404).end(); return; }
    const directory = source ? root : resolve(root, 'dist');
    const path = resolve(directory, decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html');
    if (!path.startsWith(directory + sep)) { res.writeHead(403).end(); return; }
    res.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(path));
  } catch { if (!res.headersSent) res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
let local;
try {
  // 実 API はセッションのプロキシ・証明書検証を使用する。
  // localhost の配信だけをローカル API クライアントで受け渡す。
  local = await request.newContext();
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}),
    ...(live && process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {}),
  });
  for (const mode of ['source', 'campweather']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors = [];
    const responses = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', response => {
      if (response.url().startsWith('https://api.open-meteo.com/')) {
        // 再読込でブラウザの応答本体が破棄される前に取得しておく。
        responses.push(response.json().then(payload => ({ status: response.status(), payload })).catch(error => ({ error })));
      }
    });
    await page.route(`${origin}/**`, async route => {
      const response = await local.get(route.request().url());
      await route.fulfill({ response });
    });
    let failure = null;
    if (!live) {
      await page.route('https://api.open-meteo.com/**', async route => {
        if (failure === 'forecast') { await route.fulfill({ status: 403, json: {} }); return; }
        const params = new URL(route.request().url()).searchParams;
        const latitude = Number(params.get('latitude'));
        const rain = latitude === INITIAL_CAMPS[0].location.latitude ? 37 : latitude === INITIAL_CAMPS[1].location.latitude ? 16 : 18;
        await route.fulfill({ json: {
          daily_units: { precipitation_probability_max: '%', temperature_2m_max: '°C', temperature_2m_min: '°C', wind_speed_10m_max: 'm/s' },
          daily: { time: [params.get('start_date'), params.get('end_date')], weather_code: [3, 1], precipitation_probability_max: [50, rain], temperature_2m_max: [20, 19], temperature_2m_min: [10, 9], wind_speed_10m_max: [3, 2] },
        } });
      });
      await page.route('https://nominatim.openstreetmap.org/**', async route => {
        if (failure === 'search') { await route.fulfill({ status: 429, json: {} }); return; }
        const extra = new URL(route.request().url()).searchParams.get('q') === '追加施設テスト';
        const camp = INITIAL_CAMPS[0];
        await route.fulfill({ json: [{ name: extra ? '追加施設テスト' : 'ふもとっぱらキャンプ場', display_name: camp.location.address,
          lat: String(camp.location.latitude), lon: String(camp.location.longitude), osm_type: 'way', osm_id: extra ? 999999 : 640260125 }] });
      });
    }
    const ready = count => page.waitForFunction(n => document.querySelector('#fetch-status').textContent === `${n}施設登録 · ${n}施設の予報を比較可能`, count, { timeout: 25000 });
    await page.goto(`${origin}/${mode}/`);
    await ready(3);
    assert.equal(await page.locator('.camp-card').count(), 3);
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `横はみ出し: ${mode}, ${width}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '＋ キャンプ場を追加', exact: true }).click();
    assert(await page.locator('#location-dialog').isVisible());
    await page.getByRole('searchbox', { name: /キャンプ場名/ }).fill('ふもとっぱら');
    await page.getByRole('button', { name: '検索', exact: true }).click();
    await page.locator('[data-select="0"]').waitFor({ timeout: 25000 });
    assert.match(await page.locator('.search-result').first().textContent(), /ふもとっぱら/);
    assert.match(await page.locator('.search-result').first().textContent(), /35\.398515/);
    await page.locator('[data-select="0"]').click();
    assert(await page.locator('#location-confirmation').isVisible());
    await page.locator('#confirm-location').click();
    await page.waitForFunction(() => !document.querySelector('#location-dialog').open);
    await ready(3);
    // 初期施設は二重登録せず、ユーザーが確認した位置を保存する。
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('camp-weather-camps-v1')));
    assert.equal(saved.length, 3);
    assert.equal(saved.find(camp => camp.id === 'fumotoppara').location.osmId, '640260125');
    await page.reload();
    await ready(3);
    assert.equal(await page.locator('.day').count(), 6);
    const sunday = (await page.locator('.sunday .rain dd').allTextContents()).map(parseFloat);
    assert(sunday.every(Number.isFinite));
    assert.deepEqual(sunday, [...sunday].sort((a, b) => a - b));
    assert(await page.locator('.recommendation-badge').count() >= 1);
    assert((await page.locator('.day dl').allTextContents()).every(text => text.includes('℃') && text.includes('m/s')));
    if (live) {
      assert(responses.length >= 9);
      for (const response of await Promise.all(responses)) {
        assert(!response.error, response.error?.message);
        assert.equal(response.status, 200);
        const { payload } = response;
        assert.equal(payload.daily_units.wind_speed_10m_max, 'm/s');
        assert.equal(payload.daily.time.length, 2);
      }
    }
    assert.deepEqual(errors, [], `ブラウザエラー: ${mode}`);
    await page.screenshot({ path: resolve(output, `${mode}-${live ? 'live' : 'fixture'}.png`), fullPage: true });
    console.log(`PASS ${mode} (${live ? '実API' : 'テスト応答'}): 初期3施設 → 追加ボタン → ふもとっぱら検索 → 確認・保存 → 土日予報 → 再読込・保持 → おすすめ順。日曜: ${sunday.join(', ')}%`);
    if (!live) {
      // 新規施設の追加も検証する。以下のデータはテスト応答だけに存在する。
      await page.locator('#add-camp').click();
      await page.locator('#location-query').fill('追加施設テスト');
      await page.locator('#search-location').click();
      await page.locator('[data-select="0"]').waitFor();
      await page.locator('[data-select="0"]').click();
      await page.locator('#confirm-location').click();
      await ready(4);
      await page.reload(); await ready(4);
      failure = 'forecast';
      await page.locator('#refresh-weather').click();
      await page.waitForFunction(() => document.querySelector('#fetch-status').textContent.includes('4施設は取得失敗'));
      assert.equal(await page.locator('.recommendation-badge').count(), 0);
      assert.equal(await page.locator('.card-status.error').count(), 4);
      assert.match(await page.locator('.card-status').first().textContent(), /403.*アクセス制限/);
      failure = 'search';
      await page.locator('#add-camp').click();
      await page.locator('#location-query').fill('通信失敗テスト');
      await page.locator('#search-location').click();
      await page.waitForFunction(() => document.querySelector('#search-status').textContent.includes('利用回数の制限'));
      console.log(`PASS ${mode}: 新規施設の追加・再読込での保持、予報403、検索429を画面に表示`);
    }
    await context.close();
    if (live) await delay(1100);
  }
} finally {
  await browser?.close();
  await local?.dispose();
  await new Promise(resolve => server.close(resolve));
}
