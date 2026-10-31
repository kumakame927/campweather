import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { INITIAL_CAMPS } from '../src/locations.js';
import { japanToday, addDays } from '../src/schedule.js';
const base = process.env.CAMP_PREVIEW_URL ?? 'http://127.0.0.1:5182/';
await mkdir('test-results', { recursive: true });
for (const [engine, type, device] of [[chromium, 'chromium', 'Pixel 7'], [webkit, 'webkit', 'iPhone 13']]) {
  const browser = await engine.launch({ headless: true, ...(type === 'chromium' ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH ?? '/usr/bin/chromium' } : process.env.WEBKIT_EXECUTABLE_PATH ? { executablePath: process.env.WEBKIT_EXECUTABLE_PATH } : {}) });
  try {
    const options = { ...devices[device], viewport: { width: 390, height: 844 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', acceptDownloads: true };
    const context = await browser.newContext(options), page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    async function stubWeather(p) {
      await p.route(url => url.pathname.endsWith('/v1/forecast'), async route => {
        const params = new URL(route.request().url()).searchParams, start = params.get('start_date'), end = params.get('end_date');
        const dates = Array.from({ length: (Date.parse(end) - Date.parse(start)) / 86400000 + 1 }, (_, i) => addDays(start, i));
        await route.fulfill({ json: { daily_units: { temperature_2m_max: '°C', temperature_2m_min: '°C', wind_speed_10m_max: 'm/s', precipitation_probability_max: '%' }, daily: { time: dates, weather_code: dates.map(() => 1), precipitation_probability_max: dates.map(() => Number(params.get('latitude')) > 35 ? 50 : 10), temperature_2m_max: dates.map(() => 20), temperature_2m_min: dates.map(() => 8), wind_speed_10m_max: dates.map(() => 3) } } });
      });
    }
    const ready = (p, n) => p.waitForFunction(count => document.querySelector('#fetch-status')?.textContent.includes(`${count}施設の予報を比較可能`), n);
    await page.addInitScript(({ camps, today }) => {
      if (!localStorage.getItem('camp-weather-camps-v2')) localStorage.setItem('camp-weather-camps-v2', JSON.stringify({ version: 2, camps }));
      if (!localStorage.getItem('camp-weather-trip-v1')) localStorage.setItem('camp-weather-trip-v1', JSON.stringify({ startDate: today, nights: 1, mode: 'manual' }));
    }, { camps: INITIAL_CAMPS.slice(1), today: japanToday() });
    await stubWeather(page); await page.goto(base); await ready(page, 2);
    assert.match(await page.title(), /^晴れキャン/); assert.equal(await page.locator('.brand').textContent(), '晴れキャン');
    assert.equal(await page.locator('#page-title').textContent(), '今週末、晴れるキャンプ場はどこ？');
    assert.equal(await page.locator('meta[name="apple-mobile-web-app-title"]').getAttribute('content'), '晴れキャン');
    const manifestUrl = await page.locator('link[rel="manifest"]').evaluate(el => el.href);
    const manifest = await page.evaluate(url => fetch(url).then(response => response.json()), manifestUrl);
    assert.equal(manifest.display, 'standalone'); assert.equal(manifest.name, '晴れキャン');
    assert.equal(new URL(manifest.scope, manifestUrl).href, new URL('./', manifestUrl).href);
    {
      for (const icon of manifest.icons) {
        const image = await page.evaluate(url => fetch(url).then(response => ({ status: response.status, type: response.headers.get('content-type') })), new URL(icon.src, manifestUrl).href);
        assert.equal(image.status, 200); assert.match(image.type, /image\/png/);
      }
      for (const selector of ['link[rel="apple-touch-icon"]', 'link[rel="icon"]']) {
        const url = await page.locator(selector).evaluate(el => el.href); assert.equal(await page.evaluate(url => fetch(url).then(response => response.status), url), 200);
      }
    }
    assert.deepEqual(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then(items => items.map(item => item.scope))), []);
    assert.deepEqual(await page.evaluate(() => caches.keys()), []);
    if (type === 'chromium') {
      const client = await context.newCDPSession(page); await client.send('Page.enable');
      const result = await client.send('Page.getInstallabilityErrors');
      assert.deepEqual(result.installabilityErrors.filter(item => item.errorId !== 'in-incognito'), []);
      await client.detach();
    }
    const original = await page.evaluate(() => localStorage.getItem('camp-weather-camps-v2'));
    await page.locator('#data-settings > summary').click();
    for (const width of [320, 390, 414, 1024]) {
      await page.setViewportSize({ width, height: 844 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${type} ${width} overflow`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const file = page.waitForEvent('download'); await page.locator('#export-data').click();
    const download = await file, content = await readFile(await download.path(), 'utf8'), backup = JSON.parse(content);
    assert.equal(backup.application, 'hare-camp'); assert.equal(backup.camps.camps.length, 2);
    assert.equal(await page.evaluate(() => localStorage.getItem('camp-weather-camps-v2')), original);
    await page.locator('#import-data').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{invalid') });
    await page.waitForFunction(() => document.querySelector('#backup-status').textContent.includes('JSON'));
    assert.equal(await page.evaluate(() => localStorage.getItem('camp-weather-camps-v2')), original);
    const destination = await browser.newContext(options), target = await destination.newPage();
    await stubWeather(target); await target.goto(base); await ready(target, 3);
    await target.locator('#data-settings > summary').click();
    const destinationBefore = await target.evaluate(() => localStorage.getItem('camp-weather-camps-v2'));
    const upload = () => target.locator('#import-data').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(content) });
    await upload(); await target.locator('#import-dialog').waitFor();
    assert.match(await target.locator('#import-preview').textContent(), /2件/);
    await target.locator('#cancel-import').click();
    assert.equal(await target.evaluate(() => localStorage.getItem('camp-weather-camps-v2')), destinationBefore);
    await upload(); await target.locator('#confirm-import').click(); await ready(target, 2);
    assert.deepEqual(await target.evaluate(() => JSON.parse(localStorage.getItem('camp-weather-camps-v2'))), backup.camps);
    assert.deepEqual(await target.evaluate(() => JSON.parse(localStorage.getItem('camp-weather-trip-v1'))), backup.trip);
    await target.reload(); await ready(target, 2); assert.equal(await target.locator('[data-camp-id="fumotoppara"]').count(), 0);
    await destination.close();
    await context.setOffline(true); await page.locator('#offline-notice').waitFor();
    assert.match(await page.locator('#offline-notice').textContent(), /最新.*取得できません/);
    assert(await page.evaluate(() => fetch('./api/jma-forecast?office=220000', { cache: 'no-store' }).then(() => false).catch(() => true)));
    await context.setOffline(false); await page.goto(base); await ready(page, 2);
    assert.equal(await page.evaluate(() => localStorage.getItem('camp-weather-camps-v2')), original);
    await page.screenshot({ path: `test-results/pwa-${type}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    console.log(`PASS ${type}: name/manifest; no service worker/caches; offline notice/API failure; backup download→isolated storage→confirmation/cancel→import/reload; invalid JSON; saved keys; 4 widths; icon delivery/installability`);
    await context.close();
  } finally { await browser.close(); }
}
