import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { addDays, japanToday } from '../src/schedule.js';

const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}) });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: 35.68, longitude: 139.76 }, permissions: ['geolocation'] });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let enabled = true;
  const routeCalls = [];
  await page.addInitScript(() => {
    window.geoCalls = 0;
    const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    navigator.geolocation.getCurrentPosition = (...args) => { window.geoCalls++; return original(...args); };
  });
  await page.route(url => url.pathname.endsWith('/v1/forecast'), async route => {
    const params = new URL(route.request().url()).searchParams, first = params.get('start_date'), last = params.get('end_date');
    const dates = Array.from({ length: (Date.parse(last) - Date.parse(first)) / 86400000 + 1 }, (_, i) => addDays(first, i));
    const rain = Number(params.get('latitude')) === 35.3985153 ? 10 : 80;
    await route.fulfill({ json: { daily_units: { temperature_2m_max: '°C', temperature_2m_min: '°C', precipitation_probability_max: '%', wind_speed_10m_max: 'm/s' }, daily: { time: dates, weather_code: dates.map(() => 1), temperature_2m_max: dates.map(() => 20), temperature_2m_min: dates.map(() => 10), precipitation_probability_max: dates.map(() => rain), wind_speed_10m_max: dates.map(() => 3) } } });
  });
  await page.route(url => url.pathname.endsWith('/search'), route => route.fulfill({ json: [{ name: '東京駅', display_name: '東京駅, 千代田区, 東京都, 日本', lat: '35.681', lon: '139.767', osm_type: 'node', osm_id: 123 }] }));
  await page.route(url => url.pathname === '/api/routes', async route => {
    if (route.request().method() === 'GET') { await route.fulfill({ json: { enabled } }); return; }
    const body = route.request().postDataJSON(); routeCalls.push(body);
    if (!enabled) { await route.fulfill({ status: 503, json: { code: 'NOT_CONFIGURED', error: '経路情報を取得できません。経路APIは未設定です。' } }); return; }
    await route.fulfill({ json: { provider: 'Google Maps', routes: body.destinations.map(camp => camp.id === 'nikoniko' ? { id: camp.id, available: false, reason: '経路を取得できませんでした。' } : { id: camp.id, available: true, durationSeconds: camp.id === 'fumotoppara' ? (body.mode === 'DRIVE' ? 7200 : 10800) : 3600, distanceMeters: camp.id === 'fumotoppara' ? 150000 : 80000 }) } });
  });
  await page.goto(process.env.CAMP_PREVIEW_URL ?? 'http://127.0.0.1:5173/');
  await page.waitForFunction(() => document.querySelector('#fetch-status').textContent.includes('3施設の予報を比較可能'));
  assert.equal(await page.evaluate(() => window.geoCalls), 0);
  await page.locator('#tab-access').click(); assert(await page.locator('#panel-access').isVisible()); assert(!(await page.locator('#panel-weather').isVisible()));
  assert.equal(await page.locator('.access-card').count(), 3); assert(await page.locator('#route-compare').isDisabled());
  await page.locator('#tab-settings').click();
  await page.locator('#departure-query').fill('東京駅'); await page.locator('#departure-submit').click();
  await page.locator('#departure-results button').click(); await page.locator('#departure-name').fill('いつもの出発駅'); await page.locator('#save-departure').click();
  assert.match(await page.locator('#saved-departure').textContent(), /いつもの出発駅/);
  await page.locator('#tab-access').click(); await page.locator('#route-compare').click();
  await page.waitForFunction(() => document.querySelector('#route-status').textContent.startsWith('2 / 3'));
  assert.match(await page.locator('.access-card').first().textContent(), /伊豆/);
  assert.match(await page.locator('#access-results').textContent(), /2時間/); assert.match(await page.locator('#access-results').textContent(), /150.0 km/);
  assert.match(await page.locator('#access-results').textContent(), /取得不可/);
  assert(await page.locator('#google-attribution img').isVisible());
  const beforeSort = routeCalls.length;
  await page.locator('#access-sort').selectOption('rain'); assert.match(await page.locator('.access-card').first().textContent(), /ふもとっぱら/); assert.equal(routeCalls.length, beforeSort);
  await page.locator('#travel-mode').selectOption('TRANSIT');
  await page.waitForFunction(() => document.querySelector('#access-results').textContent.includes('3時間'));
  assert.equal(routeCalls.at(-1).mode, 'TRANSIT'); assert(routeCalls.at(-1).departureTime.endsWith('Z'));
  assert.match(await page.locator('#access-results').textContent(), /乗換.*未取得/);
  await page.locator('#transit-departure').fill(`${addDays(japanToday(), 1)}T09:00`); await page.locator('#transit-departure').dispatchEvent('change'); await page.locator('#route-compare').click();
  await page.waitForFunction(() => document.querySelector('#route-status').textContent.startsWith('2 / 3'));
  assert.equal(routeCalls.at(-1).departureTime, new Date(`${addDays(japanToday(), 1)}T09:00:00+09:00`).toISOString());
  for (const width of [320, 375, 390, 414, 1024]) { await page.setViewportSize({ width, height: 844 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/access-fixture.png', fullPage: true });
  assert(!(await page.evaluate(() => JSON.stringify({ ...localStorage }))).includes('durationSeconds'));
  await page.locator('#tab-weather').click(); assert.match(await page.locator('#recommendation-title').textContent(), /ふもとっぱら/);
  const beforeReload = routeCalls.length;
  await page.reload(); await page.locator('#tab-access').click();
  assert.match(await page.locator('#selected-origin').textContent(), /いつもの出発駅/); assert.equal(routeCalls.length, beforeReload);
  assert(!(await page.locator('#access-results').textContent()).includes('3時間'));
  assert.equal(await page.evaluate(() => window.geoCalls), 0);
  await page.locator('#origin-source').selectOption('current'); assert.equal(await page.evaluate(() => window.geoCalls), 0);
  await page.locator('#current-origin-button').click(); await page.waitForFunction(() => document.querySelector('#selected-origin').textContent.includes('現在地'));
  assert.equal(await page.evaluate(() => window.geoCalls), 1);
  enabled = false;
  await page.locator('#route-compare').click(); await page.waitForFunction(() => document.querySelector('#route-status').textContent.includes('未設定'));
  assert.equal(await page.locator('.access-card dd').filter({ hasText: '取得不可' }).count(), 6);
  await page.locator('#origin-source').selectOption('search'); await page.locator('#origin-query').fill('東京駅'); await page.locator('#origin-submit').click(); await page.locator('#origin-results button').click();
  assert.match(await page.locator('#selected-origin').textContent(), /東京駅/);
  assert.deepEqual(errors, []);
  console.log('PASS access UI (test responses only): tabs; departure search/save/reload; explicit geolocation; drive/transit in-app duration+distance; time/rain sort; transit timestamp; unavailable routes; no persisted route results; no invented values when disabled; 5 widths');
  await context.close();
} finally { await browser.close(); }
