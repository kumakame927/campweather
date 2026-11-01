import { comfortMetrics, comfortWindows, hourTimes } from './hourly.js';
import { periodDates } from './schedule.js';

// Provisional camping guidelines, not safety limits. Keep all thresholds here.
export const CLOTHING_BANDS = Object.freeze([
  { min: 25, outfit: '半袖・通気性のよい服装' },
  { min: 20, outfit: '長袖シャツ・薄手の羽織り' },
  { min: 15, outfit: '長袖シャツ＋薄手ジャケット' },
  { min: 10, outfit: 'スウェット・フリース＋防風アウター' },
  { min: 5, outfit: 'フリース＋薄手ダウン' },
  { min: -Infinity, outfit: '厚手ダウン＋保温インナー・手袋・ニット帽' },
].map(Object.freeze));
export const ADVICE_THRESHOLDS = Object.freeze({ windproof: 5, strongWind: 8, rainGear: 40, heavyRain: 70, layering: 10, largeRange: 15, seatedWarmth: 20 });
const numeric = value => typeof value === 'number' && Number.isFinite(value);
const display = number => String(Math.round(number * 100) / 100);
export function clothingBand(temperature) {
  return numeric(temperature) ? CLOTHING_BANDS.find(band => temperature >= band.min) : null;
}
function completeValues(byTime, times, field) {
  const values = times.map(time => byTime.get(time)?.[field]);
  return values.length && values.every(numeric) ? values : null;
}
function phaseAdvice(byTime, times, night) {
  if (!times.length) return { state: 'not-applicable', message: '日帰りのため夜間〜早朝は対象外です。' };
  const apparent = completeValues(byTime, times, 'apparent'), real = completeValues(byTime, times, 'temperature');
  if (!apparent || !real) return { state: 'missing', message: 'この時間帯の体感温度・実気温データが不足しているため、服装を判定できません。時間別予報や現地情報を確認してください。' };
  const felt = night ? Math.min(...apparent) : apparent.reduce((sum, number) => sum + number, 0) / apparent.length;
  const actual = Math.min(...real), effective = Math.min(felt, actual), band = clothingBand(effective);
  return { state: 'ready', apparent: felt, actual, effective, corrected: actual < felt, outfit: band.outfit,
    message: night
      ? effective < ADVICE_THRESHOLDS.seatedWarmth ? '長時間屋外で座る場合は、保温性のある靴下・ブランケットもあると便利です。' : '座って過ごすときも、冷えを感じたら早めに服装を調整しましょう。'
      : '動くときは暑さや汗に合わせて、脱ぎ着して調整しましょう。' };
}
function weatherMaximum(forecast, period, field) {
  const dates = periodDates(period), daily = forecast?.days ?? [forecast?.saturday, forecast?.sunday];
  const dailyValues = dates.map(date => daily.find(day => day?.date === date)?.[field]);
  const byTime = new Map((forecast?.hourly?.hours ?? []).map(hour => [hour.time, hour]));
  const hourlyValues = hourTimes(dates).map(time => byTime.get(time)?.[field]);
  const complete = dailyValues.every(numeric) || hourlyValues.every(numeric);
  const values = [...dailyValues, ...hourlyValues].filter(numeric);
  // With partial data this is a known lower bound, never an assurance of mild weather.
  return { value: values.length ? Math.max(...values) : null, complete };
}
export function clothingAdvice(forecast, period) {
  const windows = comfortWindows(period), byTime = new Map((forecast?.hourly?.hours ?? []).map(hour => [hour.time, hour]));
  const day = phaseAdvice(byTime, windows.daytime, false), night = phaseAdvice(byTime, windows.night, true);
  const wind = weatherMaximum(forecast, period, 'wind'), rain = weatherMaximum(forecast, period, 'rain');
  const range = comfortMetrics(forecast?.hourly, period).range, extras = [];
  const windproofIncluded = [day, night].some(phase => phase.state === 'ready' && phase.outfit.includes('防風アウター'));
  if (numeric(wind.value) && wind.value >= ADVICE_THRESHOLDS.strongWind) {
    extras.push({ kind: 'wind', text: `風速${display(wind.value)}m/s${wind.complete ? 'の強風予報です。' : '以上の予報が取得できています。'}${windproofIncluded ? '' : '防風アウターもおすすめです。'}テントの固定・設営場所と、焚き火を行える状況か施設のルールを確認してください。` });
  } else if (numeric(wind.value) && wind.value >= ADVICE_THRESHOLDS.windproof && !windproofIncluded) {
    extras.push({ kind: 'wind', text: `風速${display(wind.value)}m/s${wind.complete ? 'の予報です。' : '以上の予報が取得できています。'}防風アウターも準備するのがおすすめです。` });
  }
  if (numeric(rain.value) && rain.value >= ADVICE_THRESHOLDS.heavyRain) {
    extras.push({ kind: 'rain', text: `降水確率${display(rain.value)}%${rain.complete ? 'の予報です。' : '以上の予報が取得できています。'}レインウェア・防水靴・荷物用の防水バッグと、濡れたときに交換する衣類・靴下を準備するのがおすすめです。` });
  } else if (numeric(rain.value) && rain.value >= ADVICE_THRESHOLDS.rainGear) {
    extras.push({ kind: 'rain', text: `降水確率${display(rain.value)}%${rain.complete ? 'の予報です。' : '以上の予報が取得できています。'}レインウェアや防水靴、荷物用の防水バッグがあると便利です。` });
  }
  if (numeric(range) && range >= ADVICE_THRESHOLDS.largeRange) {
    extras.push({ kind: 'range', text: `寒暖差が${display(range)}℃あります。日中と夜間で異なる防寒装備が必要になる可能性があります。重ね着できる服と、夜用の保温着を分けて準備するのがおすすめです。` });
  } else if (numeric(range) && range >= ADVICE_THRESHOLDS.layering) {
    extras.push({ kind: 'range', text: `寒暖差が${display(range)}℃あるため、重ね着できる服装がおすすめです。` });
  }
  const missing = [!wind.complete && '風速', !rain.complete && '降水確率', windows.overnight && !numeric(range) && '寒暖差'].filter(Boolean);
  if (missing.length) extras.push({ kind: 'missing', text: `${missing.join('・')}のデータが不足しています。追加装備を判断できない条件があるため、最新の予報や現地情報も確認してください。` });
  if (!extras.length) extras.push({ kind: 'general', text: '時間別予報を確認し、現地の状況に合わせて持ち物を調整してください。' });
  return { day, night, extras, windows, wind, rain, range };
}
