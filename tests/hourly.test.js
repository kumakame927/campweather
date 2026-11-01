import test from 'node:test';
import assert from 'node:assert/strict';
import { HOURLY_FIELDS, parseHourly, comfortMetrics, comfortComment, equipmentAdvice } from '../src/hourly.js';
import { forecastUrl, parseForecast, fetchForecast, comparable, compareForecasts } from '../src/weather.js';
import { makeTrip } from '../src/schedule.js';
import { hourlyPayload } from './fixtures/hourly.js';
const trip = makeTrip('2026-10-31', 1), camp = { location: { latitude: 35, longitude: 139 } };
const metrics = payload => comfortMetrics(parseHourly(payload, trip), trip);
test('日別と6種類の時間別項目を1回の日本時間リクエストに含める', async () => {
  const url = forecastUrl(camp, trip); assert.equal(url.searchParams.get('hourly'), HOURLY_FIELDS.join(','));
  assert.equal(url.searchParams.get('timezone'), 'Asia/Tokyo'); assert.equal(url.searchParams.get('wind_speed_unit'), 'ms');
  let calls = 0; const result = await fetchForecast(camp, trip, { fetcher: async () => { calls++; return hourlyPayload(trip); } });
  assert.equal(calls, 1); assert.equal(result.hourly.hours.length, 48); assert.equal(result.hourly.status, 'ready');
});
test('指定窓の最高・最低・寒暖差・最低体感・日曜の24時間差を正しく集計する', () => {
  const result = metrics(hourlyPayload(trip));
  assert.equal(result.dayHigh, 20); assert.equal(result.nightLow, 5); assert.equal(result.range, 15); assert.equal(result.minApparent, 2); assert.equal(result.finalRange, 12);
});
test('土曜12時/16時と土曜18時/日曜9時を含み、その外側は夜間・昼間の集計から除外する', () => {
  const payload = hourlyPayload(trip), raw = payload.hourly;
  raw.temperature_2m[11]=60;raw.temperature_2m[12]=21;raw.temperature_2m[16]=22;raw.temperature_2m[17]=65;
  raw.temperature_2m[18]=-1;raw.temperature_2m[33]=-2;raw.temperature_2m[34]=-50;
  raw.apparent_temperature[17]=-80;raw.apparent_temperature[18]=-3;raw.apparent_temperature[33]=-4;raw.apparent_temperature[34]=-100;
  const result=metrics(payload);assert.equal(result.dayHigh,22);assert.equal(result.nightLow,-2);assert.equal(result.range,24);assert.equal(result.minApparent,-4);assert.equal(result.finalRange,67);
});
test('月末・年末・閏日でもJST文字列で日付境界を扱い、並び順に依存しない', () => {
  for (const start of ['2026-10-31','2026-12-31','2028-02-29']) {
    const selected=makeTrip(start,1),payload=hourlyPayload(selected);
    for (const [key,array] of Object.entries(payload.hourly)) payload.hourly[key]=[...array].reverse();
    const result=comfortMetrics(parseHourly(payload,selected),selected);assert.equal(result.range,15);assert.equal(result.minApparent,2);
  }
});
test('1時刻の気温不足で夜間最低・寒暖差・日内差を算出せず、体感の有効値は独立する', () => {
  const payload=hourlyPayload(trip);payload.hourly.temperature_2m[33]=null;
  const result=metrics(payload);assert.equal(result.nightLow,null);assert.equal(result.range,null);assert.equal(result.finalRange,null);assert.equal(result.minApparent,2);assert.equal(result.dayHigh,20);
});
test('体感の欠測を気温で補完せず、湿度の不足は気温の集計に影響しない', () => {
  const payload=hourlyPayload(trip);payload.hourly.apparent_temperature[18]=null;payload.hourly.relative_humidity_2m=[];
  const result=metrics(payload);assert.equal(result.minApparent,null);assert.equal(result.range,15);assert.equal(parseHourly(payload,trip).status,'partial');
});
test('時刻の重複・不正値・単位違いを欠測扱いし、0と負の値を保持する', () => {
  const payload=hourlyPayload(trip);payload.hourly.time[34]=payload.hourly.time[33];
  assert.equal(metrics(payload).nightLow,null);
  const values=hourlyPayload(trip);values.hourly.temperature_2m[33]=0;values.hourly.apparent_temperature[33]=-2;values.hourly.relative_humidity_2m[0]=101;values.hourly.precipitation_probability[0]='0';values.hourly.wind_speed_10m[0]=0;
  const parsed=parseHourly(values,trip);assert.equal(parsed.hours[0].rain,null);assert.equal(parsed.hours[0].humidity,null);assert.equal(parsed.hours[0].wind,0);assert.equal(comfortMetrics(parsed,trip).minApparent,-2);assert.equal(comfortMetrics(parsed,trip).nightLow,0);
  values.hourly_units.apparent_temperature='°F';assert.equal(metrics(values).minApparent,null);assert.equal(metrics(values).dayHigh,20);
});
test('UTCや時差未確認の時刻をJSTと誤認しない。hourlyなしでも日別は比較可能', () => {
  for (const zone of ['GMT',undefined]) { const payload=hourlyPayload(trip);payload.timezone=zone;const parsed=parseForecast(payload,trip);assert(comparable(parsed));assert.equal(parsed.hourly.status,'unavailable');assert.equal(comfortMetrics(parsed.hourly,trip).range,null); }
  const payload=hourlyPayload(trip);delete payload.hourly;assert(comparable(parseForecast(payload,trip)));assert.equal(parseForecast(payload,trip).hourly.status,'unavailable');
});
test('日帰りは夜間指標を算出せず、2泊3日と平日は開始日の最初の夜・最終日を明示集計', () => {
  const day=makeTrip('2026-11-02',0),dayValues=comfortMetrics(parseHourly(hourlyPayload(day),day),day);
  assert.equal(dayValues.dayHigh,20);assert.equal(dayValues.nightLow,null);assert.equal(dayValues.minApparent,null);assert.equal(dayValues.range,null);
  const long=makeTrip('2026-11-02',2),payload=hourlyPayload(long);payload.hourly.temperature_2m[60]=30;payload.hourly.temperature_2m[71]=0;
  const values=comfortMetrics(parseHourly(payload,long),long);assert.equal(values.range,15);assert.equal(values.finalRange,30);assert.equal(values.final,'2026-11-04');
});
test('時間別追加項目が400で拒否された場合だけ日別取得へ1回フォールバックする', async () => {
  const requests=[]; const result=await fetchForecast(camp,trip,{fetcher:async url=>{requests.push(url);if(url.searchParams.has('hourly'))throw Object.assign(new Error('unsupported hourly'),{status:400});const p=hourlyPayload(trip);delete p.hourly;return p;}});
  assert.equal(requests.length,2);assert(!requests[1].searchParams.has('hourly'));assert(comparable(result));assert.equal(result.hourly.status,'unavailable');
});
test('利用制限・通信失敗・中止では不要な再リクエストを行わない', async () => {
  for(const status of [429,403,503,undefined]){let calls=0;await assert.rejects(fetchForecast(camp,trip,{fetcher:async()=>{calls++;throw Object.assign(new Error('fail'),{status});}}));assert.equal(calls,1);}
  const controller=new AbortController();controller.abort();let calls=0;await assert.rejects(fetchForecast(camp,trip,{signal:controller.signal,fetcher:async()=>{calls++;throw Object.assign(new Error('aborted'),{status:400});}}));assert.equal(calls,1);
});
test('体感温度・寒暖差の値や欠測は、既存の日曜降水確率優先の順位に影響しない', () => {
  const first=hourlyPayload(trip),second=hourlyPayload(trip);first.daily.precipitation_probability_max=[90,5];second.daily.precipitation_probability_max=[0,10];delete first.hourly;
  const values=[{name:'気温快適',forecast:parseForecast(second,trip)},{name:'撤収日が低雨',forecast:parseForecast(first,trip)}];
  assert.deepEqual(values.sort(compareForecasts).map(c=>c.name),['撤収日が低雨','気温快適']);
});
test('アドバイスは取得値に基づき、寒暖差・冷え込み・暑さ・強風を条件分岐する', () => {
  const result=metrics(hourlyPayload(trip));assert.match(comfortComment(result),/朝晩/);assert.match(equipmentAdvice(result,9).join(' '),/重ね着.*防寒着.*風が強い/);
  const unavailable=comfortMetrics(null,trip);assert.match(comfortComment(unavailable),/不足/);assert.match(equipmentAdvice(unavailable,null).join(' '),/不足/);
});
