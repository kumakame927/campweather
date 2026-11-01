import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { makeTrip, nextWeekend } from '../src/schedule.js';

await mkdir('test-results', { recursive: true });
const trip = makeTrip(nextWeekend().saturday, 1);
const number = value => String(Math.round(value * 10) / 10);
for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const executablePath = name === 'chromium' ? process.env.CHROMIUM_EXECUTABLE_PATH : process.env.WEBKIT_EXECUTABLE_PATH;
  const browser = await engine.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    const context = await browser.newContext({ ...devices[name === 'chromium' ? 'Pixel 7' : 'iPhone 13'], viewport:{width:390,height:844}, locale:'ja-JP', timezoneId:'Asia/Tokyo' });
    const page = await context.newPage(), responses = [], errors = [];
    await page.addInitScript(trip => localStorage.setItem('camp-weather-trip-v1',JSON.stringify({mode:'manual',startDate:trip.startDate,nights:1})),trip);
    page.on('pageerror',error=>errors.push(error.message));
    page.on('response',response=>{ if(new URL(response.url()).pathname.endsWith('/v1/forecast')) responses.push(response.json().then(payload=>({latitude:Number(new URL(response.url()).searchParams.get('latitude')),payload,status:response.status()}))); });
    await page.goto(process.env.CAMP_PREVIEW_URL ?? 'http://127.0.0.1:5173/');
    await page.waitForFunction(()=>document.querySelector('#fetch-status').textContent.includes('3施設の予報を比較可能'),null,{timeout:45000});
    assert.equal(responses.length,3);
    const data=await Promise.all(responses), actual=data.find(response=>response.latitude===35.3985153);
    assert(data.every(response=>response.status===200));
    const raw=actual.payload.hourly;assert.equal(actual.payload.timezone,'Asia/Tokyo');assert.equal(raw.time.length,48);
    assert.equal(actual.payload.hourly_units.apparent_temperature,'°C');assert.equal(actual.payload.hourly_units.relative_humidity_2m,'%');
    const dayIndexes=raw.time.flatMap((time,index)=>time.startsWith(trip.startDate)&&Number(time.slice(11,13))>=12&&Number(time.slice(11,13))<=16?[index]:[]);
    const nightIndexes=raw.time.flatMap((time,index)=>time>=`${trip.startDate}T18:00`&&time<=`${trip.endDate}T09:00`?[index]:[]);
    assert.equal(dayIndexes.length,5);assert.equal(nightIndexes.length,16);
    const high=Math.max(...dayIndexes.map(index=>raw.temperature_2m[index])),low=Math.min(...nightIndexes.map(index=>raw.temperature_2m[index])),felt=Math.min(...nightIndexes.map(index=>raw.apparent_temperature[index]));
    assert([high,low,felt].every(Number.isFinite));
    const card=page.locator('[data-camp-id="fumotoppara"]');
    await card.scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/details-live-${name}-cards.png`});
    assert((await card.locator('.comfort-summary').textContent()).includes(`日中最高 ${number(high)}℃ / 夜間最低 ${number(low)}℃`));
    await card.locator('.forecast-days').click();await page.locator('#weather-details-dialog').waitFor();
    const values=await page.locator('.detail-metrics dd').allTextContents();
    assert.equal(parseFloat(values[0]),Number(number(high)));assert.equal(parseFloat(values[1]),Number(number(low)));assert.equal(parseFloat(values[2]),Number(number(felt)));assert.equal(parseFloat(values[3]),Number(number(high-low)));
    assert.equal(await page.locator('.hourly-table tbody tr').count(),24);
    assert.equal(await page.locator('.equipment-advice h4').count(),3);
    assert.equal(await page.locator('.clothing-recommendation strong').count(),2);
    assert.match(await page.locator('.equipment-advice').textContent(),/暫定基準.*個人差/);
    await page.locator('[data-hour-day]').last().click();
    const firstRow=await page.locator('.hourly-table tbody tr').first().locator('td').allTextContents();
    assert.equal(parseFloat(firstRow[1]),raw.apparent_temperature[24]);assert.equal(parseFloat(firstRow[4]),raw.relative_humidity_2m[24]);
    await page.locator('.temperature-chart').scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/details-live-${name}-chart.png`});
    await page.locator('#close-weather-details').click();assert.equal(responses.length,3);
    await card.locator('[data-favorite]').click();assert.equal(await page.locator('.camp-card').count(),3);assert.equal(responses.length,3);
    const rain=(await page.locator('.sunday .rain dd').allTextContents()).map(parseFloat);assert.deepEqual(rain,[...rain].sort((a,b)=>a-b));
    assert.deepEqual(errors,[]);
    console.log(`PASS ${name} REAL Open-Meteo ${trip.startDate}/${trip.endDate}: 3 shared daily+hourly requests; 48 JST hours; daytime ${high} / night ${low} / felt ${felt} / range ${number(high-low)}; humidity and hourly values match API; modal/chart/favorites; final-day rain ranking unchanged`);
    await context.close();
  } finally { await browser.close(); }
}
