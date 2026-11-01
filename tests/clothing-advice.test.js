import test from 'node:test';
import assert from 'node:assert/strict';
import { clothingAdvice, clothingBand, ADVICE_THRESHOLDS } from '../src/clothing-advice.js';
import { parseForecast, compareForecasts } from '../src/weather.js';
import { makeTrip } from '../src/schedule.js';
import { hourlyPayload } from './fixtures/hourly.js';

const trip = makeTrip('2026-10-31', 1);
function fixture(day, night, { dayReal = day, nightReal = night, wind = 0, rain = 0, period = trip } = {}) {
  const payload = hourlyPayload(period);
  payload.hourly.time.forEach((time, index) => {
    const overnight = period.nights && time >= `${period.startDate}T18:00` && time <= `${period.dates[1]}T09:00`;
    payload.hourly.apparent_temperature[index] = overnight ? night : day;
    payload.hourly.temperature_2m[index] = overnight ? nightReal : dayReal;
    payload.hourly.wind_speed_10m[index] = wind; payload.hourly.precipitation_probability[index] = rain;
  });
  payload.daily.wind_speed_10m_max = period.dates.map(() => wind);
  payload.daily.precipitation_probability_max = period.dates.map(() => rain);
  return payload;
}
const advice = (payload, period = trip) => clothingAdvice(parseForecast(payload, period), period);
for (const [day, night, dayOutfit, nightOutfit] of [
  [25,18,'半袖・通気性のよい服装','長袖シャツ＋薄手ジャケット'],
  [20,10,'長袖シャツ・薄手の羽織り','スウェット・フリース＋防風アウター'],
  [15,5,'長袖シャツ＋薄手ジャケット','フリース＋薄手ダウン'],
  [10,0,'スウェット・フリース＋防風アウター','厚手ダウン＋保温インナー・手袋・ニット帽'],
]) test(`指定ケース：日中${day}℃・夜間${night}℃で衣類が適切に変わる`, () => {
  const result=advice(fixture(day,night));assert.equal(result.day.outfit,dayOutfit);assert.equal(result.night.outfit,nightOutfit);assert.match(result.night.message,/長時間.*靴下・ブランケット/);
});
test('6段階の境界値を含めて分類し、不明値を暖かい服装へ変換しない', () => {
  for (const [temperature,prefix] of [[25,'半袖'],[24.99,'長袖シャツ・'],[20,'長袖シャツ・'],[19.99,'長袖シャツ＋'],[15,'長袖シャツ＋'],[14.99,'スウェット'],[10,'スウェット'],[9.99,'フリース'],[5,'フリース'],[4.99,'厚手ダウン'],[0,'厚手ダウン'],[-10,'厚手ダウン']]) assert(clothingBand(temperature).outfit.startsWith(prefix),String(temperature));
  for(const unknown of [null,undefined,NaN,Infinity,'20']) assert.equal(clothingBand(unknown),null);
});
test('日中は5時刻の平均体感、夜間は16時刻の最低体感を使い、対象外を混ぜない', () => {
  const payload=fixture(25,10,{dayReal:30,nightReal:12});payload.hourly.apparent_temperature[12]=14;payload.hourly.apparent_temperature[33]=4.9;payload.hourly.apparent_temperature[17]=-100;payload.hourly.apparent_temperature[34]=-100;
  const result=advice(payload);assert.equal(result.day.apparent,22.8);assert.equal(result.day.outfit,'長袖シャツ・薄手の羽織り');assert.equal(result.night.apparent,4.9);assert.match(result.night.outfit,/厚手ダウン/);
});
test('体感が高くても最低実気温が低ければ寒い側へ補正する', () => {
  const result=advice(fixture(25,18,{dayReal:9,nightReal:0}));assert(result.day.corrected);assert.equal(result.day.effective,9);assert.equal(result.day.outfit,'フリース＋薄手ダウン');assert(result.night.corrected);assert.match(result.night.outfit,/厚手ダウン/);
  assert.equal(advice(fixture(15,10,{dayReal:25,nightReal:20})).night.effective,10);
});
test('風速5m/sで防風、8m/s以上でテントと焚き火の注意を1件だけ出す', () => {
  assert.equal(advice(fixture(25,18,{wind:4.99})).extras.filter(item=>item.kind==='wind').length,0);
  const moderate=advice(fixture(25,18,{wind:5})).extras.filter(item=>item.kind==='wind');assert.equal(moderate.length,1);assert.match(moderate[0].text,/防風アウター/);assert(!moderate[0].text.includes('焚き火'));
  const strong=advice(fixture(25,18,{wind:8})).extras.filter(item=>item.kind==='wind');assert.equal(strong.length,1);assert.match(strong[0].text,/強風.*防風アウター.*テント.*焚き火/);
});
test('上の服装に防風アウターがあれば追加で同じ衣類を繰り返さない', () => {
  assert.equal(advice(fixture(10,10,{wind:5})).extras.filter(item=>item.kind==='wind').length,0);
  const strong=advice(fixture(10,10,{wind:8}));assert.equal(strong.extras.filter(item=>item.kind==='wind').length,1);assert(!strong.extras.find(item=>item.kind==='wind').text.includes('防風アウター'));assert.match(strong.extras.find(item=>item.kind==='wind').text,/テント.*焚き火/);
});
test('降水確率40%で雨具、70%以上で交換衣類を追加し重複しない', () => {
  assert.equal(advice(fixture(25,18,{rain:39.99})).extras.filter(item=>item.kind==='rain').length,0);
  for (const rain of [40,69.99]) { const items=advice(fixture(25,18,{rain})).extras.filter(item=>item.kind==='rain');assert.equal(items.length,1);assert.match(items[0].text,/レインウェア.*防水/);assert(!items[0].text.includes('交換')); }
  const heavy=advice(fixture(25,18,{rain:70})).extras.filter(item=>item.kind==='rain');assert.equal(heavy.length,1);assert.match(heavy[0].text,/レインウェア.*防水.*交換する衣類・靴下/);
});
test('寒暖差10℃で重ね着、15℃以上で日中と夜間の別装備を1件で提案する', () => {
  assert.equal(advice(fixture(20,10.1)).extras.filter(item=>item.kind==='range').length,0);
  const moderate=advice(fixture(20,10)).extras.filter(item=>item.kind==='range');assert.equal(moderate.length,1);assert.match(moderate[0].text,/10℃.*重ね着/);assert(!moderate[0].text.includes('異なる防寒装備'));
  const large=advice(fixture(20,5)).extras.filter(item=>item.kind==='range');assert.equal(large.length,1);assert.match(large[0].text,/15℃.*日中と夜間で異なる防寒装備.*重ね着/);
});
test('必要な体感・実気温が1時刻でも欠損すれば当該時間帯の衣類を判定しない', () => {
  for(const field of ['apparent_temperature','temperature_2m']){
    const day=fixture(25,5);day.hourly[field][12]=null;const d=advice(day);assert.equal(d.day.state,'missing');assert.equal(d.day.outfit,undefined);assert.equal(d.night.state,'ready');
    const night=fixture(25,5);night.hourly[field][33]=null;const n=advice(night);assert.equal(n.night.state,'missing');assert.equal(n.night.outfit,undefined);assert.equal(n.day.state,'ready');
  }
  const none=fixture(25,5);delete none.hourly;const missing=advice(none);assert.equal(missing.day.state,'missing');assert.equal(missing.night.state,'missing');assert(missing.extras.some(item=>item.kind==='missing'));
});
test('湿度の不足は服装判定を妨げず、無効な単位や文字列の気温は判定しない', () => {
  const payload=fixture(25,5);payload.hourly.relative_humidity_2m=[];assert.equal(advice(payload).day.state,'ready');payload.hourly_units.apparent_temperature='°F';assert.equal(advice(payload).day.state,'missing');
  const invalid=fixture(25,5);invalid.hourly.temperature_2m[12]='25';assert.equal(advice(invalid).day.state,'missing');
});
test('風雨が部分的にしか取得できなくても既知の強風・高確率を隠さず、不足も明示する', () => {
  const forecast=parseForecast(fixture(25,5,{wind:8,rain:70}),trip);forecast.days[1].wind=null;forecast.days[1].rain=null;forecast.hourly.hours.forEach(hour=>{hour.wind=null;hour.rain=null;});
  const result=clothingAdvice(forecast,trip);assert(!result.wind.complete);assert(!result.rain.complete);assert.match(result.extras.find(item=>item.kind==='wind').text,/以上.*テント/);assert.match(result.extras.find(item=>item.kind==='rain').text,/以上.*交換/);assert.match(result.extras.find(item=>item.kind==='missing').text,/風速・降水確率/);
});
test('日帰りは夜間対象外、2泊3日も開始日と最初の夜を使い、風雨は全日程を見る', () => {
  const day=makeTrip('2026-11-02',0),result=advice(fixture(25,5,{period:day}),day);assert.equal(result.day.state,'ready');assert.equal(result.night.state,'not-applicable');assert(!result.extras.some(item=>item.kind==='missing'));
  const longer=makeTrip('2026-12-31',2),payload=fixture(25,5,{period:longer});payload.hourly.apparent_temperature[55]=-20;payload.daily.precipitation_probability_max[2]=70;
  const values=advice(payload,longer);assert.equal(values.night.apparent,5);assert.equal(values.windows.final,'2027-01-02');assert.match(values.extras.find(item=>item.kind==='rain').text,/70%/);
});
test('日別の風雨が欠測でも全時刻があれば時間別の既存データだけで判断する', () => {
  const forecast=parseForecast(fixture(25,5,{wind:8,rain:70}),trip);forecast.days.forEach(day=>{day.wind=null;day.rain=null;});
  const result=clothingAdvice(forecast,trip);assert(result.wind.complete);assert(result.rain.complete);assert(result.extras.some(item=>item.kind==='wind'));assert(result.extras.some(item=>item.kind==='rain'));
});
test('アドバイス生成で予報・既存ランキングを変更せず、閾値は定数で公開する', () => {
  const first={name:'撤収日が低雨',forecast:parseForecast(fixture(0,-10,{rain:5}),trip)},second={name:'暖かい場所',forecast:parseForecast(fixture(25,18,{rain:10}),trip)};
  const before=JSON.stringify(first.forecast);clothingAdvice(first.forecast,trip);assert.equal(JSON.stringify(first.forecast),before);assert(compareForecasts(first,second)<0);assert.equal(ADVICE_THRESHOLDS.strongWind,8);assert(Object.isFrozen(ADVICE_THRESHOLDS));
});
