import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { INITIAL_CAMPS } from '../src/locations.js';
import { japanToday, addDays } from '../src/schedule.js';
const guidance = 'キャンプ場名で見つからない場合は、『住所で検索』または『地図で指定』をお試しください。';
const address = '千葉県君津市折木沢1306', fullwidth = '千葉県君津市折木沢１３０６';
const result = (name, lat = '35.215901', lon = '140.106592', id = 123499) => ({ name, display_name: address, lat, lon, osm_type: 'node', osm_id: id });
const readPoint = async page => {
  const text = await page.locator('#map-position').textContent();
  const [, lat, lon] = text.match(/緯度 (-?[\d.]+) \/ 経度 (-?[\d.]+)/) ?? [];
  return { latitude: Number(lat), longitude: Number(lon) };
};
await mkdir('test-results', { recursive: true });
for (const [engine, type] of [[chromium, 'chromium'], [webkit, 'webkit']]) {
  const browser = await engine.launch({ headless: true, ...(type === 'chromium' ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH ?? '/usr/bin/chromium' } : process.env.WEBKIT_EXECUTABLE_PATH ? { executablePath: process.env.WEBKIT_EXECUTABLE_PATH } : {}) });
  try {
    const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await context.newPage(), errors = [], searches = [], weather = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ camps, today }) => {
      if (!localStorage.getItem('camp-weather-camps-v2')) localStorage.setItem('camp-weather-camps-v2', JSON.stringify({ version: 2, camps }));
      if (!localStorage.getItem('camp-weather-trip-v1')) localStorage.setItem('camp-weather-trip-v1', JSON.stringify({ mode: 'manual', startDate: today, nights: 1 }));
    }, { camps: INITIAL_CAMPS, today: japanToday() });
    await page.route(url => url.pathname.endsWith('/v1/forecast'), async route => {
      const params = new URL(route.request().url()).searchParams; weather.push(Object.fromEntries(params));
      const start = params.get('start_date'), end = params.get('end_date');
      const dates = Array.from({ length: (Date.parse(end) - Date.parse(start)) / 86400000 + 1 }, (_, i) => addDays(start, i));
      await route.fulfill({ json: { daily_units: { temperature_2m_max: '°C', temperature_2m_min: '°C', wind_speed_10m_max: 'm/s', precipitation_probability_max: '%' }, daily: { time: dates, weather_code: dates.map(() => 1), precipitation_probability_max: dates.map(() => 10), temperature_2m_max: dates.map(() => 20), temperature_2m_min: dates.map(() => 8), wind_speed_10m_max: dates.map(() => 3) } } });
    });
    await page.route(url => url.pathname.endsWith('/search'), async route => {
      const q = new URL(route.request().url()).searchParams.get('q'); searches.push(q);
      await new Promise(resolve => setTimeout(resolve, 150));
      if (q.includes('通信エラー')) return route.fulfill({ status: 503, json: {} });
      if (q.includes('0件') || q.includes('見つからない')) return route.fulfill({ json: [] });
      if (q === '複数候補') return route.fulfill({ json: [result('候補A'), result('候補B', '35.223456', '140.112345', 555444)] });
      return route.fulfill({ json: [result('住所検索の候補')] });
    });
    await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lxkAAAAASUVORK5CYII=', 'base64') }));
    await page.goto(process.env.CAMP_PREVIEW_URL ?? 'http://127.0.0.1:5180/');
    const ready = n => page.waitForFunction(count => document.querySelector('#fetch-status').textContent.includes(`${count}施設の予報を比較可能`), n);
    await ready(3);
    const before = await page.evaluate(() => localStorage.getItem('camp-weather-camps-v2'));
    await page.locator('#add-camp').click();
    assert(await page.locator('#name-search-help').isHidden());
    await page.locator('#location-query').fill('見つからないキャンプ場');
    assert.equal(searches.length, 0, 'typing must not geocode');
    await page.locator('#search-location').click();
    assert(await page.locator('#name-search-help').isHidden(), 'hide help while searching');
    await page.locator('#name-search-help').waitFor(); assert.equal(await page.locator('#name-search-help').textContent(), guidance);
    assert.match(await page.locator('#search-status').textContent(), /通信は成功.*0件/);
    await page.locator('#location-query').fill('通信エラー施設');
    assert(await page.locator('#name-search-help').isHidden());
    await page.locator('#search-location').click();
    await page.waitForFunction(() => document.querySelector('#search-status').textContent.includes('通信エラー'));
    assert(await page.locator('#name-search-help').isHidden());
    await page.locator('[data-search-mode="address"]').click();
    assert.match(await page.locator('#address-input-help').textContent(), /番地などの数字は半角で入力してください。/);
    await page.locator('#location-query').fill(fullwidth); await page.locator('#search-location').click();
    await page.locator('[data-select="0"]').waitFor();
    assert.equal(searches.at(-1), address); assert.equal(await page.locator('#location-query').inputValue(), address);
    await page.locator('[data-select="0"]').click();
    await page.locator('#registration-name').fill('位置調整をしたキャンプ場');
    assert(await page.locator('#adjust-on-map').isVisible());
    await page.locator('#adjust-on-map').click(); await page.locator('#location-map.leaflet-container').waitFor();
    await page.locator('.camp-map-pin').waitFor();
    const initial = await readPoint(page); assert.deepEqual(initial, { latitude: 35.215901, longitude: 140.106592 });
    const mapBox = await page.locator('#location-map').boundingBox(), pinBox = await page.locator('.camp-map-pin').boundingBox();
    assert(Math.abs(pinBox.x + 18 - (mapBox.x + mapBox.width / 2)) < 3, 'candidate should center map longitude');
    assert(Math.abs(pinBox.y + 42 - (mapBox.y + mapBox.height / 2)) < 3, 'candidate should center map latitude');
    assert(await page.locator('#location-confirmation').isHidden(), 'moving map must not confirm location');
    await page.locator('#back-to-address').click();
    assert.equal(await page.locator('#location-query').inputValue(), address);
    assert.equal(await page.locator('[data-select="0"]').getAttribute('aria-pressed'), 'true');
    assert(await page.locator('#confirm-location').isDisabled(), 'pending adjustment must not silently register original coordinates');
    await page.locator('#adjust-on-map').click();
    const map = page.locator('#location-map');
    await map.scrollIntoViewIfNeeded();
    const touchBox = await map.boundingBox();
    assert.equal(await map.evaluate(el => getComputedStyle(el).touchAction), 'none', 'let Leaflet handle touch gestures');
    await page.touchscreen.tap(touchBox.x + touchBox.width * .68, touchBox.y + 180);
    const tapped = await readPoint(page); assert.notDeepEqual(tapped, initial);
    const marker = page.locator('.camp-map-pin'); await marker.scrollIntoViewIfNeeded();
    const box = await marker.boundingBox();
    await page.mouse.move(box.x + 18, box.y + 18); await page.mouse.down(); await page.mouse.move(box.x + 48, box.y + 38, { steps: 10 }); await page.mouse.up();
    let dragged = await readPoint(page); assert.notDeepEqual(dragged, tapped, 'dragging pin must update draft coordinates');
    if (type === 'chromium') {
      const client = await context.newCDPSession(page), finger = await marker.boundingBox();
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: finger.x + 18, y: finger.y + 18 }] });
      for (let step = 1; step <= 6; step++) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: finger.x + 18 + step * 4, y: finger.y + 18 + step * 2 }] });
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      const afterTouch = await readPoint(page);
      assert.notDeepEqual(afterTouch, dragged, 'native touch drag must adjust the pin'); dragged = afterTouch;
      await client.detach();
    }
    assert.match(await page.locator('#map-position').textContent(), /未確定/);
    assert.equal(await page.evaluate(() => localStorage.getItem('camp-weather-camps-v2')), before);
    await page.locator('#confirm-map-position').click();
    assert.equal(await page.locator('#registration-name').inputValue(), '位置調整をしたキャンプ場');
    await page.locator('#back-to-address').click();
    assert.match(await page.locator('#confirmation-details').textContent(), /登録位置：地図で確定した位置/);
    assert.match(await page.locator('#confirmation-details').textContent(), new RegExp(dragged.latitude.toFixed(6).replace('.', '\\.')));
    assert.equal(await page.locator('#location-query').inputValue(), address);
    await page.locator('#confirm-location').click(); await ready(4);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('camp-weather-camps-v2')).camps);
    const added = saved.find(camp => camp.name === '位置調整をしたキャンプ場');
    assert.equal(added.location.source, 'map-pin'); assert.equal(added.location.osmId, undefined);
    assert.deepEqual({ latitude: added.location.latitude, longitude: added.location.longitude }, dragged);
    assert.deepEqual(saved.filter(camp => camp.id !== added.id), INITIAL_CAMPS);
    assert(weather.some(request => Number(request.latitude) === dragged.latitude && Number(request.longitude) === dragged.longitude));
    await page.reload(); await ready(4);
    assert.equal(await page.locator(`[data-camp-id="${added.id}"]`).count(), 1);
    // Reuse the same address from a new dialog: normalized queries share the cache.
    await page.locator('#add-camp').click(); await page.locator('[data-search-mode="address"]').click();
    const addressCalls = searches.filter(q => q === address).length;
    await page.locator('#location-query').fill(address); await page.locator('#search-location').click(); await page.locator('[data-select="0"]').waitFor();
    assert.equal(searches.filter(q => q === address).length, addressCalls);
    await page.locator('#close-dialog').click(); await page.locator('#add-camp').click();
    await page.locator('[data-search-mode="map"]').click(); await page.waitForFunction(() => document.querySelector('#map-position').textContent.includes('未選択'));
    assert.equal(await page.locator('.camp-map-pin').count(), 0, 'new dialog must not reuse an old pin');
    await page.locator('#map-query').fill(fullwidth); await page.locator('#map-move').click();
    await page.waitForFunction(() => document.querySelector('#map-position').textContent.includes('未確定'));
    assert.deepEqual(await readPoint(page), initial);
    assert(await page.locator('#location-confirmation').isHidden());
    await page.locator('#confirm-map-position').click();
    const current = await page.locator('#map-position').textContent();
    for (const query of ['地図0件', '地図通信エラー']) {
      await page.locator('#map-query').fill(query); await page.locator('#map-move').click();
      await page.waitForFunction(expected => document.querySelector('#map-search-status').textContent.includes(expected), query.includes('0件') ? '0件' : '通信エラー');
      assert.equal(await page.locator('#map-position').textContent(), current);
      assert(await page.locator('#confirm-location').isEnabled());
    }
    await page.locator('#map-query').fill('複数候補'); await page.locator('#map-move').click(); await page.locator('[data-map-select="1"]').waitFor();
    assert.deepEqual(await readPoint(page), initial, 'multiple candidates do not move pin before choosing');
    await page.locator('[data-map-select="1"]').click();
    assert.deepEqual(await readPoint(page), { latitude: 35.223456, longitude: 140.112345 });
    assert(await page.locator('#location-confirmation').isHidden());
    for (const width of [320, 375, 390, 414, 768, 1024]) {
      await page.setViewportSize({ width, height: 844 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('#location-dialog').scrollWidth <= document.querySelector('#location-dialog').clientWidth), `${type} ${width}: overflow`);
      const fit = await page.evaluate(() => {
        const input = document.querySelector('#map-query').getBoundingClientRect(), button = document.querySelector('#map-move').getBoundingClientRect(), parent = document.querySelector('#map-search-form').getBoundingClientRect();
        return input.right <= button.left && button.right <= parent.right + 1;
      });
      assert(fit, `${type} ${width}: search input/button overlap`);
      if (width === 390) { await page.locator('#map-panel').scrollIntoViewIfNeeded(); await page.screenshot({ path: `test-results/registration-${type}-390.png` }); }
    }
    await page.locator('#close-dialog').click();
    assert.equal(await page.locator('.camp-card').count(), 4);
    assert.deepEqual(errors, []);
    console.log(`PASS ${type}: name zero/error/loading; address normalization/cache; address→map→back; centered seed; tap/drag; explicit confirmation; adjusted coordinate registration/forecast/storage/reload; direct map search/single/multiple/zero/error; preserved pin and initial camps; six widths`);
    await context.close();
  } finally { await browser.close(); }
}
