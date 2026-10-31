import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { addDays } from '../src/schedule.js';

await mkdir('test-results', { recursive: true });
for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await engine.launch({ headless: true, ...(name === 'chromium' && process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}), ...(name === 'webkit' && process.env.WEBKIT_EXECUTABLE_PATH ? { executablePath: process.env.WEBKIT_EXECUTABLE_PATH } : {}) });
  try {
    for (const width of [320, 375, 390, 414, 600, 1024]) {
      const mobile = width <= 600;
      const context = await browser.newContext({ ...(mobile ? devices['iPhone 13'] : {}), viewport: { width, height: 844 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
      const page = await context.newPage();
      await page.route(url => url.pathname.endsWith('/v1/forecast'), async route => {
        const p = new URL(route.request().url()).searchParams, start = p.get('start_date'), end = p.get('end_date');
        const dates = Array.from({ length: (Date.parse(end) - Date.parse(start)) / 86400000 + 1 }, (_, index) => addDays(start, index));
        await route.fulfill({ json: { daily_units: { temperature_2m_max: '°C', temperature_2m_min: '°C', wind_speed_10m_max: 'm/s', precipitation_probability_max: '%' }, daily: { time: dates, weather_code: dates.map(() => 1), precipitation_probability_max: dates.map(() => 10), temperature_2m_max: dates.map(() => 20), temperature_2m_min: dates.map(() => 8), wind_speed_10m_max: dates.map(() => 3) } } });
      });
      await page.goto(process.env.CAMP_PREVIEW_URL ?? 'http://127.0.0.1:5173/');
      await page.waitForFunction(() => document.querySelectorAll('.camp-card').length === 3);
      const boxes = await page.evaluate(() => {
        const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }; };
        return { start: rect('#trip-start'), nights: rect('#trip-nights'), parent: rect('.trip-controls'), overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert(!boxes.overflow, `${name} ${width}: horizontal overflow`);
      assert(boxes.start.right <= boxes.parent.right + 1 && boxes.nights.right <= boxes.parent.right + 1);
      if (mobile) {
        assert(boxes.nights.top >= boxes.start.bottom, `${name} ${width}: overlapping inputs`);
        assert(Math.abs(boxes.start.width - boxes.parent.width) <= 1);
        assert(Math.abs(boxes.nights.width - boxes.parent.width) <= 1);
      } else assert(boxes.start.right <= boxes.nights.left);
      await page.locator('#trip-nights').selectOption('2');
      assert.equal(await page.locator('#trip-nights').inputValue(), '2');
      if (width === 390) await page.screenshot({ path: `test-results/layout-${name}-390.png`, fullPage: true });
      console.log(`PASS ${name} ${width}px: ${mobile ? '縦並び・幅100%' : '横並び'}、重なり・横スクロールなし`);
      await context.close();
    }
  } finally { await browser.close(); }
}
