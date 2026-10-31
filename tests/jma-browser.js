import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { INITIAL_CAMPS } from '../src/locations.js';
import { japanToday, addDays } from '../src/schedule.js';
import { resolveArea } from '../server/jma-areas.js';
import { parseJmaForecast } from '../server/jma-forecast.js';
const fixture = JSON.parse(await readFile(new URL('./fixtures/jma-220000.json', import.meta.url), 'utf8'));
const original = parseJmaForecast(fixture, Date.parse('2026-10-31T09:00:00Z'));
const today = japanToday(), delta = Math.round((Date.parse(today) - Date.parse('2026-10-31')) / 86400000);
const live = process.argv.includes('--real');
await mkdir('test-results', { recursive: true });
for (const [engine, type] of [[chromium, 'chromium'], [webkit, 'webkit']]) {
  const browser = await engine.launch({ headless: true, ...(type === 'chromium' ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH ?? '/usr/bin/chromium' } : process.env.WEBKIT_EXECUTABLE_PATH ? { executablePath: process.env.WEBKIT_EXECUTABLE_PATH } : {}) });
  try {
    const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await context.newPage(), errors = [], calls = [];
    let failure = '';
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (/\/api\/jma-/.test(response.url())) calls.push({ url: response.url(), status: response.status() }); });
    await page.addInitScript(({ today, camps }) => {
      localStorage.setItem('camp-weather-trip-v1', JSON.stringify({ mode: 'manual', startDate: today, nights: 2 }));
      localStorage.setItem('camp-weather-camps-v2', JSON.stringify({ version: 2, camps }));
    }, { today, camps: INITIAL_CAMPS });
    if (!live) {
      await page.route(url => url.pathname.endsWith('/v1/forecast'), async route => {
        const params = new URL(route.request().url()).searchParams;
        const start = params.get('start_date'), end = params.get('end_date'), latitude = Number(params.get('latitude'));
        const dates = Array.from({ length: (Date.parse(end) - Date.parse(start)) / 86400000 + 1 }, (_, i) => addDays(start, i));
        await route.fulfill({ json: { daily_units: { temperature_2m_max: '°C', temperature_2m_min: '°C', wind_speed_10m_max: 'm/s', precipitation_probability_max: '%' }, daily: { time: dates, weather_code: dates.map(() => 1), precipitation_probability_max: dates.map(() => latitude === 34.8888729 ? 5 : 50), temperature_2m_max: dates.map(() => 20), temperature_2m_min: dates.map(() => 8), wind_speed_10m_max: dates.map(() => 3) } } });
      });
      await page.route(url => url.pathname.endsWith('/api/jma-area'), async route => {
        if (failure === 'area') return route.fulfill({ status: 422, json: { error: '予報区域を確定できません。推測で別地域の予報を表示しません。' } });
        const params = new URL(route.request().url()).searchParams;
        await route.fulfill({ json: { area: resolveArea(Number(params.get('latitude')), Number(params.get('longitude')), params.get('address')) } });
      });
      await page.route(url => url.pathname.endsWith('/api/jma-forecast'), async route => {
        if (failure === 'network') return route.fulfill({ status: 502, json: { error: '気象庁の参考予報を取得できませんでした。テスト用の通信エラーです。' } });
        const office = new URL(route.request().url()).searchParams.get('office');
        const records = original.map(record => ({ ...record, date: addDays(record.date, delta), ...(office === '080000' ? { areaCode: record.areaCode === '220030' ? '080010' : record.areaCode === '220000' ? '080000' : '080020', areaName: record.areaCode === '220000' ? '茨城県' : '北部' } : {}) }));
        await route.fulfill({ json: { officeCode: office, records, retrievedAt: new Date().toISOString() } });
      });
    }
    await page.goto(process.env.CAMP_PREVIEW_URL ?? 'http://127.0.0.1:5180/');
    await page.waitForFunction(() => document.querySelector('#fetch-status').textContent.includes('3施設の予報を比較可能'), null, { timeout: 40000 });
    assert.equal(calls.length, 0, 'closed reference sections must make no requests');
    assert.equal(await page.locator('.jma-reference[open]').count(), 0);
    const ranking = await page.locator('#recommendation-title').textContent();
    const saved = await page.evaluate(() => localStorage.getItem('camp-weather-camps-v2'));
    for (const camp of INITIAL_CAMPS) await page.locator(`[data-jma-camp="${camp.id}"] > summary`).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.jma-content')].every(el => el.textContent.includes('気象庁データ取得日時')), null, { timeout: 40000 });
    assert.equal(calls.filter(call => call.url.includes('/jma-forecast')).length, 2, 'two Shizuoka camps share one forecast request');
    assert(calls.every(call => call.status === 200));
    assert.match(await page.locator('[data-jma-camp="fumotoppara"]').textContent(), /静岡県 東部/);
    assert.match(await page.locator('[data-jma-camp="izu-kakure"]').textContent(), /静岡県 伊豆/);
    assert.match(await page.locator('[data-jma-camp="nikoniko"]').textContent(), /茨城県 北部/);
    const ref = page.locator('[data-jma-camp="fumotoppara"]');
    assert.match(await ref.textContent(), /予報発表日時：.*JST/);
    assert.match(await ref.textContent(), /6時間ごと/);
    assert.match(await page.locator('.card-footer').first().textContent(), /Open-Meteo データ取得日時：.*JST/);
    assert.equal(await page.locator('#recommendation-title').textContent(), ranking);
    assert.equal(await page.evaluate(() => localStorage.getItem('camp-weather-camps-v2')), saved);
    for (const width of [320, 375, 390, 414, 1024]) {
      await page.setViewportSize({ width, height: 844 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${type} ${width}: horizontal overflow`);
      if (width === 390) await page.screenshot({ path: `test-results/jma-${live ? 'real' : 'fixture'}-${type}.png`, fullPage: true });
    }
    await page.locator('#trip-start').fill(addDays(today, 10)); await page.locator('#trip-start').dispatchEvent('change');
    await page.locator('#trip-nights').selectOption('0');
    await page.waitForFunction(() => [...document.querySelectorAll('.jma-content')].every(el => el.textContent.includes('予報対象期間外')));
    assert.equal(await page.locator('.jma-reference[open]').count(), 3, 'rerender preserves open sections');
    assert.equal(calls.filter(call => call.url.includes('/jma-forecast')).length, 2);
    if (!live) {
      for (const kind of ['network', 'area']) {
        failure = kind; await page.reload();
        await page.waitForFunction(() => document.querySelector('#fetch-status').textContent.includes('3施設の予報を比較可能'));
        await page.locator('[data-jma-camp="fumotoppara"] > summary').click();
        await page.locator('[data-jma-camp="fumotoppara"] .jma-error').waitFor();
        assert.match(await page.locator('.jma-error').textContent(), kind === 'area' ? /確定できません/ : /通信エラー/);
        assert.equal(await page.locator('.recommendation-badge').count(), 1);
        assert(await page.locator('.day .rain dd').first().textContent() !== '—');
      }
    }
    assert.deepEqual(errors, []);
    console.log(`PASS ${type} ${live ? 'REAL weather/JMA APIs' : 'isolated test responses'}: collapsed/lazy; 3 correct areas; 2 shared office fetches; timestamps; 6-hour rain; date bounds; ranking/storage preserved; 5 widths; ${live ? 'HTTP 200' : 'network/ambiguous-area errors isolated'}`);
    await context.close();
  } finally { await browser.close(); }
}
