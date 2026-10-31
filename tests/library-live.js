import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { japanToday } from '../src/schedule.js';
for (const [type, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await engine.launch({ headless: true, ...(type === 'chromium' ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH ?? '/usr/bin/chromium' } : process.env.WEBKIT_EXECUTABLE_PATH ? { executablePath: process.env.WEBKIT_EXECUTABLE_PATH } : {}) });
  try {
    const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await context.newPage(), errors = [], weather = [], geo = [], catalog = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { const url = new URL(request.url()); if (url.pathname.endsWith('/v1/forecast')) weather.push(url); if (url.pathname.endsWith('/search')) geo.push(url); if (url.pathname.endsWith('/api/camp-catalog')) catalog.push(url); });
    await page.addInitScript(today => { if (!localStorage.getItem('camp-weather-trip-v1')) localStorage.setItem('camp-weather-trip-v1', JSON.stringify({ mode: 'manual', startDate: today, nights: 1 })); }, japanToday());
    await page.goto(process.env.CAMP_PREVIEW_URL ?? 'http://127.0.0.1:5185/');
    const ready = n => page.waitForFunction(count => document.querySelector('#fetch-status').textContent.includes(`${count}施設の予報を比較可能`), n, { timeout: 45000 });
    await ready(3); assert.equal(weather.length, 3);
    await page.locator('#add-camp').click();
    for (const query of ['菖蒲ヶ浜キャンプ村', '菖蒲ヶ浜', '菖蒲']) {
      await page.locator('#location-query').fill(query); await page.locator('#search-location').click();
      await page.locator('[data-select="0"]').waitFor({ timeout: 25000 });
      assert.match(await page.locator('#search-results').textContent(), /菖蒲ヶ浜キャンプ場/);
      assert.match(await page.locator('#search-results').textContent(), /日光市中宮祠2485/);
    }
    assert.equal(geo.length, 0); assert.equal(catalog.length, 1);
    await page.locator('[data-select="0"]').click(); await page.locator('#favorite-location').click();
    assert.equal(weather.length, 3); assert.equal(await page.locator('#favorites-count').textContent(), '4');
    await page.locator('#open-favorites').click(); await page.locator('[data-compare="place-node-4105493143"]').click();
    await ready(4); assert.equal(weather.length, 4); assert.equal(Number(weather.at(-1).searchParams.get('latitude')), 36.7515948);
    await page.locator('#close-favorites').click();
    await page.locator('[data-jma-camp="place-node-4105493143"] > summary').click();
    await page.waitForFunction(() => document.querySelector('[data-jma-camp="place-node-4105493143"]').textContent.includes('気象庁データ取得日時'), null, { timeout: 40000 });
    assert.match(await page.locator('[data-jma-camp="place-node-4105493143"]').textContent(), /栃木県/);
    await page.locator('[data-favorite="place-node-4105493143"]').click(); assert.equal(await page.locator('.camp-card').count(), 4);
    await page.locator('[data-remove="place-node-4105493143"]').click(); await ready(3); assert.equal(weather.length, 4);
    await page.reload(); await ready(3); assert.equal(weather.length, 7);
    assert.equal(await page.locator('[data-camp-id="place-node-4105493143"]').count(), 0);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('camp-weather-camps-v2')).camps);
    assert.equal(stored.length, 4); assert(stored.some(camp => camp.location.osmId === '4105493143'));
    assert.deepEqual(errors, []);
    console.log(`PASS ${type} REAL 10-region OSM catalog: 3 Shobu spellings; one shared catalog request; 0 Nominatim; favorite-only 0 forecasts; compare adds one actual Open-Meteo forecast; actual JMA Tochigi; independent removal; reload does not fetch inactive camp`);
    await context.close();
  } finally { await browser.close(); }
}
