import { addDays, periodDates } from './schedule.js';

export const HOURLY_FIELDS = ['temperature_2m', 'apparent_temperature', 'precipitation_probability', 'wind_speed_10m', 'relative_humidity_2m', 'weather_code'];
const fields = {
  temperature: ['temperature_2m', '°C', -100, 70],
  apparent: ['apparent_temperature', '°C', -120, 90],
  rain: ['precipitation_probability', '%', 0, 100],
  wind: ['wind_speed_10m', 'm/s', 0, 200],
  humidity: ['relative_humidity_2m', '%', 0, 100],
  code: ['weather_code', 'wmo code', 0, 99],
};
const numeric = value => typeof value === 'number' && Number.isFinite(value);
export function hourTimes(dates) {
  return dates.flatMap(date => Array.from({ length: 24 }, (_, hour) => `${date}T${String(hour).padStart(2, '0')}:00`));
}
// API timestamps are local ISO strings. Do not parse them in the browser's time zone.
export function parseHourly(payload, period) {
  const expected = hourTimes(periodDates(period)), positions = new Map(), raw = payload?.hourly;
  const validZone = payload?.timezone === 'Asia/Tokyo' && payload?.utc_offset_seconds === 32400;
  if (validZone && Array.isArray(raw?.time) && raw.time.length <= 1000) {
    const allowed = new Set(expected);
    raw.time.forEach((time, index) => { if (allowed.has(time)) positions.set(time, positions.has(time) ? -1 : index); });
  }
  const hours = expected.map(time => {
    const index = positions.get(time);
    return { time, ...Object.fromEntries(Object.entries(fields).map(([key, [field, unit, min, max]]) => {
      const value = index >= 0 && payload.hourly_units?.[field] === unit && Array.isArray(raw?.[field]) ? raw[field][index] : null;
      return [key, numeric(value) && value >= min && value <= max && (key !== 'code' || Number.isInteger(value)) ? value : null];
    })) };
  });
  const available = hours.some(hour => Object.keys(fields).some(key => numeric(hour[key])));
  const complete = hours.every(hour => Object.keys(fields).every(key => numeric(hour[key])));
  return { hours, status: complete ? 'ready' : available ? 'partial' : 'unavailable', message: complete ? '' : available ? '時間別予報の一部が不足しています。欠測値と、必要な時刻が揃わない集計は「--」で表示します。' : '時間別予報を取得できません。日別予報とおすすめ順位は引き続き確認できます。' };
}
function completeValues(byTime, times, field) {
  const values = times.map(time => byTime.get(time)?.[field]);
  return values.length && values.every(numeric) ? values : null;
}
export function comfortWindows(period) {
  const dates = periodDates(period), start = dates[0], final = dates.at(-1), overnight = dates.length > 1;
  const daytime = hourTimes([start]).slice(12, 17);
  const night = overnight ? [...hourTimes([start]).slice(18), ...hourTimes([addDays(start, 1)]).slice(0, 10)] : [];
  return { start, final, overnight, daytime, night };
}
export function comfortMetrics(hourly, period) {
  const { start, final, overnight, daytime, night } = comfortWindows(period);
  const byTime = new Map((hourly?.hours ?? []).map(hour => [hour.time, hour]));
  const high = completeValues(byTime, daytime, 'temperature');
  const low = completeValues(byTime, night, 'temperature');
  const apparent = completeValues(byTime, night, 'apparent');
  const finalValues = completeValues(byTime, hourTimes([final]), 'temperature');
  const dayHigh = high ? Math.max(...high) : null, nightLow = low ? Math.min(...low) : null;
  return { dayHigh, nightLow, range: dayHigh !== null && nightLow !== null ? dayHigh - nightLow : null, minApparent: apparent ? Math.min(...apparent) : null, finalRange: finalValues ? Math.max(...finalValues) - Math.min(...finalValues) : null, start, final, overnight };
}
export function comfortComment(metrics) {
  if (metrics.minApparent !== null && metrics.minApparent <= 0) return '朝晩の厳しい冷え込みに備えましょう';
  if (metrics.dayHigh !== null && metrics.dayHigh >= 30) return '日中は暑さへの備えが必要です';
  if (metrics.dayHigh !== null && metrics.dayHigh >= 18 && metrics.dayHigh <= 26 && metrics.nightLow !== null && metrics.nightLow < 12) return '昼は過ごしやすく、朝晩は冷え込みます';
  if (metrics.minApparent !== null && metrics.minApparent < 10 || metrics.nightLow !== null && metrics.nightLow < 10) return '朝晩は冷え込みます';
  if (metrics.range !== null && metrics.range >= 10) return '昼夜の寒暖差が大きめです';
  return metrics.dayHigh !== null ? '服装・装備の目安を詳細で確認' : '時間別予報が不足しています';
}
