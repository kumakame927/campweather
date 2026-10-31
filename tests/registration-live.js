import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { japanToday } from '../src/schedule.js';
await mkdir('test-results', { recursive: true });
for (const [engine, type] of [[chromium, 'chromium'], [webkit, 'webkit']]) {
  const browser = await engine.launch({ headless: true, ...(type === 'chromium' ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH ?? '/usr/bin/chromium' } : process.env.WEBKIT_EXECUTABLE_PATH ? { executablePath: process.env.WEBKIT_EXECUTABLE_PATH } : {}) });
  try {
    const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await context.newPage(), errors = [], responses = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (/\/search\?|\/v1\/forecast\?|\/api\/jma-/.test(response.url())) responses.push({ url: response.url(), status: response.status() }); });
    page.on('request', request => { if (request.url().includes('/v1/forecast?')) requests.push(Object.fromEntries(new URL(request.url()).searchParams)); });
    await page.addInitScript(today => {
      if (!localStorage.getItem('camp-weather-trip-v1')) localStorage.setItem('camp-weather-trip-v1', JSON.stringify({ mode: 'manual', startDate: today, nights: 1 }));
    }, japanToday());
    const ready = n => page.waitForFunction(count => document.querySelector('#fetch-status').textContent.includes(`${count}施設の予報を比較可能`), n, { timeout: 45000 });
    await page.goto(process.env.CAMP_PREVIEW_URL ?? 'http://127.0.0.1:5181/'); await ready(3);
    await page.locator('#add-camp').click(); await page.locator('[data-search-mode="address"]').click();
    await page.locator('#location-query').fill('静岡県伊豆市八木沢'); await page.locator('#search-location').click();
    await page.locator('[data-select="0"]').waitFor({ timeout: 25000 }); await page.locator('[data-select="0"]').click();
    await page.locator('#registration-name').fill('操作確認用：八木沢の地図指定地点');
    await page.locator('#adjust-on-map').click(); await page.locator('.camp-map-pin').waitFor();
    const map = page.locator('#location-map'); await map.scrollIntoViewIfNeeded(); const box = await map.boundingBox();
    await map.click({ position: { x: box.width * .6, y: 165 } });
    assert.match(await page.locator('#map-position').textContent(), /未確定/);
    assert(await page.locator('#location-confirmation').isHidden());
    await page.screenshot({ path: `test-results/registration-real-${type}.png` });
    await page.locator('#confirm-map-position').click(); await page.locator('#back-to-address').click();
    assert.equal(await page.locator('#location-query').inputValue(), '静岡県伊豆市八木沢');
    assert.match(await page.locator('#confirmation-details').textContent(), /地図で確定した位置/);
    await page.locator('#confirm-location').click(); await ready(4);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('camp-weather-camps-v2')).camps);
    const camp = saved.find(camp => camp.name === '操作確認用：八木沢の地図指定地点');
    assert.equal(camp.location.source, 'map-pin');
    assert(requests.some(query => Number(query.latitude) === camp.location.latitude && Number(query.longitude) === camp.location.longitude));
    await page.locator(`[data-jma-camp="${camp.id}"] > summary`).click();
    await page.waitForFunction(id => document.querySelector(`[data-jma-camp="${id}"]`).textContent.includes('気象庁データ取得日時'), camp.id, { timeout: 40000 });
    assert.match(await page.locator(`[data-jma-camp="${camp.id}"]`).textContent(), /静岡県 伊豆/);
    await page.reload(); await ready(4);
    const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('camp-weather-camps-v2')).camps);
    assert.deepEqual(restored, saved);
    await page.locator('#add-camp').click(); await page.locator('[data-search-mode="map"]').click();
    await page.locator('#map-query').fill('ふもとっぱら'); await page.locator('#map-move').click();
    await page.locator('[data-map-select="0"]').waitFor({ timeout: 25000 });
    await page.locator('[data-map-select="0"]').click();
    assert.match(await page.locator('#map-position').textContent(), /未確定/);
    assert(await page.locator('#location-confirmation').isHidden());
    assert(responses.every(response => response.status === 200)); assert.deepEqual(errors, []);
    console.log(`PASS ${type} REAL Nominatim/OSM/Open-Meteo/JMA: address candidates→map tap→confirm→back→register adjusted coordinates→weather/JMA→reload saved; direct map campsite search; ${responses.length} API HTTP 200 responses; no page errors`);
    await context.close();
  } finally { await browser.close(); }
}
