import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { makeTrip, nextWeekend } from '../src/schedule.js';
import { hourlyPayload } from './fixtures/hourly.js';
import { HOURLY_FIELDS } from '../src/hourly.js';

await mkdir('test-results', { recursive: true });
const trip = makeTrip(nextWeekend().saturday, 1);
for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const executablePath = name === 'chromium' ? process.env.CHROMIUM_EXECUTABLE_PATH : process.env.WEBKIT_EXECUTABLE_PATH;
  const browser = await engine.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, locale: 'ja-JP', timezoneId: 'America/Los_Angeles' });
    const page = await context.newPage(), requests = [], errors = [];
    let mode = 'normal';
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(trip => { if (!localStorage.getItem('camp-weather-trip-v1')) localStorage.setItem('camp-weather-trip-v1', JSON.stringify({ startDate: trip.startDate, nights: 1, mode: 'manual' })); }, trip);
    await page.route(url => url.pathname.endsWith('/v1/forecast'), async route => {
      const params = new URL(route.request().url()).searchParams; requests.push(params);
      if (mode === 'reject' && params.has('hourly')) { await route.fulfill({ status: 400, json: { error: true, reason: 'Test: hourly is unavailable' } }); return; }
      const payload = hourlyPayload(makeTrip(params.get('start_date'), (Date.parse(params.get('end_date')) - Date.parse(params.get('start_date'))) / 86400000));
      const latitude = Number(params.get('latitude'));
      payload.daily.precipitation_probability_max = payload.daily.time.map((_, index) => index === payload.daily.time.length - 1 ? latitude === 34.8888729 ? 10 : latitude === 36.3141326 ? 20 : 40 : 50);
      if (mode === 'partial') { payload.hourly.temperature_2m[33] = null; payload.hourly.relative_humidity_2m = []; }
      if (mode === 'none' || mode === 'reject') delete payload.hourly;
      await route.fulfill({ json: payload });
    });
    const ready = n => page.waitForFunction(count => document.querySelector('#fetch-status').textContent.includes(`${count}施設の予報を比較可能`), n);
    const dialog = page.locator('#weather-details-dialog');
    await page.goto(process.env.CAMP_PREVIEW_URL ?? 'http://127.0.0.1:5173/'); await ready(3);
    assert.equal(requests.length, 3); assert(requests.every(params => params.get('hourly') === HOURLY_FIELDS.join(',')));
    const initialOrder = await page.locator('.camp-card').evaluateAll(cards => cards.map(card => card.dataset.campId));
    assert.equal(initialOrder[0], 'izu-kakure');
    const card = page.locator('[data-camp-id="fumotoppara"]');
    assert.match(await card.locator('.comfort-summary').textContent(), /日中最高 20℃ \/ 夜間最低 5℃.*寒暖差 15℃.*最低体感 2℃/);
    await card.locator('.comfort-summary').click(); await dialog.waitFor();
    assert.equal(requests.length, 3, 'opening details must reuse the same forecast');
    assert.equal(await page.locator('#weather-details-title').textContent(), 'ふもとっぱら');
    assert.match(await page.locator('.detail-metrics').textContent(), /日中の最高気温.*12:00〜16:00.*20.*夜間の最低気温.*18:00.*09:00.*5/);
    assert.match(await page.locator('.detail-metrics').textContent(), /最終日の日内寒暖差.*00:00〜23:00.*12/);
    assert.equal(await page.locator('.hourly-table tbody tr').count(), 24);
    assert.equal(await page.locator('.temperature-chart svg path').count(), 2);
    await page.locator('[data-hour-day]').last().click();
    assert.match(await page.locator('.hourly-table caption').textContent(), new RegExp(`${Number(trip.endDate.slice(5,7))}/${Number(trip.endDate.slice(8,10))}`));
    assert.match(await page.locator('.hourly-table tbody tr').nth(9).textContent(), /09:00.*5.*2.*20.*3.*70/);
    assert.match(await page.locator('.equipment-advice').textContent(), /重ね着.*防寒着.*テント内の気温や寝袋の快適温度ではありません/);
    for (const width of [320,375,390,414,768,1280]) {
      await page.setViewportSize({ width, height: 844 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('#weather-details-dialog').scrollWidth <= document.querySelector('#weather-details-dialog').clientWidth), `${name} ${width}: horizontal overflow`);
      assert(await dialog.evaluate(element => element.scrollHeight > element.clientHeight));
    }
    await page.setViewportSize({ width:390, height:844 });
    await dialog.evaluate(element => element.scrollTop = 0);
    await page.screenshot({path:`test-results/details-${name}-390.png`});
    await page.keyboard.press('Escape'); assert(!(await dialog.isVisible()));
    assert.equal(await page.locator('[data-weather-details="fumotoppara"]').evaluate(element => element === document.activeElement), true);
    await page.keyboard.press('Enter'); await dialog.waitFor();
    assert.equal(await page.locator('#close-weather-details').evaluate(element => element === document.activeElement), true);
    await page.keyboard.press('Tab'); assert(await page.evaluate(() => document.activeElement.closest('#weather-details-dialog') !== null));
    await page.locator('#close-weather-details').click(); assert(!(await dialog.isVisible()));
    // Return to the original list position after closing a long modal.
    await page.locator('[data-weather-details="fumotoppara"]').scrollIntoViewIfNeeded();
    const scroll = await page.evaluate(() => scrollY);
    await page.locator('[data-weather-details="fumotoppara"]').click(); await dialog.waitFor();
    await dialog.evaluate(element => element.scrollTop = element.scrollHeight);
    await page.mouse.click(1, 1); assert(!(await dialog.isVisible()));
    assert(Math.abs(await page.evaluate(() => scrollY) - scroll) <= 1);
    // The other controls in a clickable card keep their original behavior.
    await card.locator('[data-favorite]').click(); assert(!(await dialog.isVisible())); assert.equal(await page.locator('.camp-card').count(), 3); assert.equal(requests.length, 3);
    await card.locator('.location-details > summary').click(); assert(!(await dialog.isVisible()));
    await card.locator('[data-location]').click(); assert(await page.locator('#location-dialog').isVisible()); assert(!(await dialog.isVisible())); await page.locator('#close-dialog').click();
    await card.locator('[data-remove]').click(); await ready(2); assert(!(await dialog.isVisible())); assert.equal(requests.length,3);
    await page.locator('#open-favorites').click(); await page.locator('#other-camps > summary').click(); await page.locator('[data-compare="fumotoppara"]').click(); await ready(3); await page.locator('#close-favorites').click();
    assert.equal(requests.length,4);
    for (const missing of ['partial','none','reject']) {
      mode=missing; const before=requests.length;
      await page.locator('#refresh-weather').click(); await ready(3);
      assert.equal(requests.length-before, missing==='reject'?6:3);
      assert.deepEqual(await page.locator('.camp-card').evaluateAll(cards=>cards.map(card=>card.dataset.campId)),initialOrder);
      await card.locator('[data-weather-details]').click(); await dialog.waitFor();
      assert.match(await page.locator('.detail-data-notice').textContent(), missing==='partial'?/不足/:/取得できません/);
      const summaries=await page.locator('.detail-metrics').textContent();
      assert.match(summaries,/夜間の最低気温.*--/);
      if(missing==='partial') { assert.match(summaries,/最低体感温度.*2/); assert.match(await card.locator('.comfort-summary').textContent(),/日中最高 20℃.*夜間最低 --℃/); }
      await page.locator('#close-weather-details').click();
    }
    mode='normal';await page.locator('#refresh-weather').click();await ready(3);
    await page.locator('#trip-nights').selectOption('0');await ready(3);await card.locator('[data-weather-details]').click();assert.match(await page.locator('.detail-metrics').textContent(),/日帰りのため対象外/);await page.keyboard.press('Escape');
    await page.locator('#trip-nights').selectOption('2');await ready(3);await card.locator('[data-weather-details]').click();assert.equal(await page.locator('[data-hour-day]').count(),3);assert.match(await page.locator('.detail-note').first().textContent(),/最初の夜/);await page.keyboard.press('Escape');
    await page.reload();await ready(3);assert.equal(await page.locator('#favorites-count').textContent(),'2');assert.equal(await page.locator('#trip-nights').inputValue(),'2');
    await card.locator('[data-weather-details]').click();await page.locator('[data-hour-day]').last().click();
    // A timer/foreground refresh must update an open dialog without losing its selected date or focus.
    await page.locator('#refresh-weather').evaluate(button=>button.click());await ready(3);
    assert.equal(await page.locator('[data-hour-day]').last().getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('[data-hour-day]').last().evaluate(button=>button===document.activeElement),true);
    await page.keyboard.press('Escape');
    assert.deepEqual(errors,[]);
    console.log(`PASS ${name}: hourly metrics/chart/table; JST independent of browser time zone; 6 widths; card/keyboard/backdrop/close and scroll restore; independent favorites/location/removal; cached details; missing data/400 fallback; daily rank unchanged; 1/2/3-day trips and persistence`);
    await context.close();
  } finally { await browser.close(); }
}
