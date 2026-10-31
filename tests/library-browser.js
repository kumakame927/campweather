import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { INITIAL_CAMPS } from '../src/locations.js';
import { CATALOG_REGIONS } from '../src/catalog-data.js';
import { catalogFixture, mockCatalog } from './fixtures/catalog.js';
import { japanToday, addDays } from '../src/schedule.js';
await mkdir('test-results', { recursive: true });
for (const [type, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await engine.launch({ headless: true, ...(type === 'chromium' ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH ?? '/usr/bin/chromium' } : process.env.WEBKIT_EXECUTABLE_PATH ? { executablePath: process.env.WEBKIT_EXECUTABLE_PATH } : {}) });
  try {
    const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await context.newPage(), errors = [], calls = [], geocodes = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ camps, today }) => {
      if (!localStorage.getItem('camp-weather-camps-v2')) localStorage.setItem('camp-weather-camps-v2', JSON.stringify({ version: 2, camps }));
      if (!localStorage.getItem('camp-weather-trip-v1')) localStorage.setItem('camp-weather-trip-v1', JSON.stringify({ mode: 'manual', startDate: today, nights: 1 }));
    }, { camps: INITIAL_CAMPS, today: japanToday() });
    await mockCatalog(page);
    await page.route(url => url.pathname.endsWith('/v1/forecast'), async route => {
      const p = new URL(route.request().url()).searchParams; calls.push(Object.fromEntries(p));
      const dates = Array.from({ length: (Date.parse(p.get('end_date')) - Date.parse(p.get('start_date'))) / 86400000 + 1 }, (_, i) => addDays(p.get('start_date'), i));
      await route.fulfill({ json: { daily_units: { temperature_2m_max: '°C', temperature_2m_min: '°C', wind_speed_10m_max: 'm/s', precipitation_probability_max: '%' }, daily: { time: dates, weather_code: dates.map(() => 1), precipitation_probability_max: dates.map(() => Number(p.get('latitude')) === 34.8888729 ? 5 : 40), temperature_2m_max: dates.map(() => 20), temperature_2m_min: dates.map(() => 8), wind_speed_10m_max: dates.map(() => 3) } } });
    });
    await page.route(url => url.pathname.endsWith('/search'), route => { geocodes.push(route.request().url()); return route.fulfill({ json: [] }); });
    const ready = n => page.waitForFunction(count => document.querySelector('#fetch-status').textContent.includes(`${count}施設の予報を比較可能`), n);
    const base = process.env.CAMP_PREVIEW_URL ?? 'http://127.0.0.1:5184/';
    await page.goto(base); await ready(3);
    assert.equal(calls.length, 3); assert.equal(await page.locator('#favorites-count').textContent(), '3');
    assert.equal(await page.locator('[data-favorite][aria-pressed="true"]').count(), 3);
    // A favorite change never changes comparison or requests weather.
    await page.locator('[data-favorite="fumotoppara"]').click(); assert.equal(await page.locator('.camp-card').count(), 3); assert.equal(calls.length, 3);
    assert.equal(await page.locator('#favorites-count').textContent(), '2');
    await page.locator('[data-favorite="fumotoppara"]').click();
    await page.locator('[data-remove="fumotoppara"]').click(); await ready(2);
    assert.equal(calls.length, 3, 'removing one camp must not refetch unchanged camps'); assert.equal(await page.locator('#favorites-count').textContent(), '3');
    await page.reload(); await ready(2); assert.equal(calls.length, 5, 'inactive favorite must not fetch on reload');
    await page.locator('#open-favorites').click(); assert.equal(await page.locator('#favorites-list .favorite-row').count(), 3);
    assert.match(await page.locator('[data-library-id="fumotoppara"]').textContent(), /静岡県富士宮市/);
    await page.locator('[data-compare="fumotoppara"]').click(); await ready(3); assert.equal(calls.length, 6);
    await page.locator('[data-library-favorite="fumotoppara"]').click(); assert.equal(await page.locator('.camp-card').count(), 3); assert.equal(calls.length, 6);
    await page.locator('#close-favorites').click();
    await page.locator('[data-remove="fumotoppara"]').click(); await ready(2); assert.equal(calls.length, 6);
    await page.locator('#open-favorites').click(); await page.locator('#other-camps > summary').click();
    await page.locator('[data-library-favorite="fumotoppara"]').click();
    await page.locator('[data-compare="fumotoppara"]').click(); await ready(3); assert.equal(calls.length, 7);
    await page.locator('#close-favorites').click();
    const beforeFavoriteOnly = calls.length;
    await page.locator('#add-camp').click();
    for (const query of ['菖蒲ヶ浜キャンプ村', '菖蒲ヶ浜', '菖蒲']) {
      await page.locator('#location-query').fill(query); await page.locator('#search-location').click(); await page.locator('[data-select="0"]').waitFor();
      assert.match(await page.locator('#search-results').textContent(), /菖蒲ヶ浜キャンプ場/);
    }
    assert.equal(geocodes.length, 0, 'camp name search must not use Nominatim');
    await page.locator('[data-select="0"]').click(); await page.locator('#favorite-location').click();
    assert.equal(calls.length, beforeFavoriteOnly); assert.equal(await page.locator('.camp-card').count(), 3);
    assert.equal(await page.locator('#favorites-count').textContent(), '4');
    await page.reload(); await ready(3); assert.equal(calls.length, beforeFavoriteOnly + 3);
    await page.locator('#open-favorites').click();
    const shobu = 'place-node-4105493143';
    await page.locator(`[data-compare="${shobu}"]`).click(); await ready(4);
    assert.equal(calls.filter(p => Number(p.latitude) === 36.7515948).length, 1);
    await page.locator('#close-favorites').click();
    const oldCount = calls.length;
    await page.locator('#add-camp').click(); await page.locator('#location-query').fill('菖蒲ヶ浜キャンプ村'); await page.locator('#search-location').click(); await page.locator('[data-select="0"]').click(); await page.locator('#confirm-location').click(); await ready(4);
    assert.equal(calls.length, oldCount, 'duplicate comparison must not refetch or duplicate');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('camp-weather-camps-v2')).camps.length), 4);
    await page.locator('#open-favorites').click();
    await page.locator(`[data-forget="${shobu}"]`).click(); await page.locator('#cancel-delete').click(); assert.equal(await page.locator('.camp-card').count(), 4);
    await page.locator(`[data-forget="${shobu}"]`).click(); await page.locator('#confirm-delete').click(); await ready(3);
    assert.equal(calls.length, oldCount); assert.equal(await page.locator(`[data-library-id="${shobu}"]`).count(), 0);
    for (const width of [320, 375, 390, 414, 768, 1024]) {
      await page.setViewportSize({ width, height: 844 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('#favorites-dialog').scrollWidth <= document.querySelector('#favorites-dialog').clientWidth), `${type} ${width}: horizontal overflow`);
      if (width === 390) await page.screenshot({ path: `test-results/favorites-${type}.png` });
    }
    await page.locator('#close-favorites').click();
    for (const id of INITIAL_CAMPS.map(camp => camp.id)) await page.locator(`[data-remove="${id}"]`).click(); await ready(0);
    assert.equal(await page.locator('#favorites-count').textContent(), '3');
    await page.reload(); await ready(0); const zeroCalls = calls.length;
    assert(await page.locator('#empty-camps').isVisible()); assert.equal(calls.length, zeroCalls);
    assert(!((await page.locator('body').textContent()).includes('保存済みキャンプ場')));
    assert.deepEqual(errors, []);
    console.log(`PASS ${type}: legacy favorites+comparison migration; independent toggle/remove/reload; no inactive forecasts; one-tap restore; 3 Shobu spellings/no Nominatim; favorite-only/no fetch; duplicate prevention; confirmed permanent delete; zero comparison; 6 mobile/desktop widths`);
    await context.close();
  } finally { await browser.close(); }
}
