export const TRIP_STORAGE_KEY = 'camp-weather-trip-v1';
export function japanToday(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function addDays(date, amount) {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + amount);
  return day.toISOString().slice(0, 10);
}
export function nextWeekend(now = new Date()) {
  const today = japanToday(now);
  const offset = (6 - new Date(`${today}T00:00:00Z`).getUTCDay() + 7) % 7;
  const saturday = addDays(today, offset);
  return { saturday, sunday: addDays(saturday, 1) };
}
export function makeTrip(startDate, nights, mode = 'manual') {
  if (!validDate(startDate) || !Number.isInteger(nights) || nights < 0 || nights > 2) throw new Error('開始日と泊数を確認してください。');
  const dates = Array.from({ length: nights + 1 }, (_, index) => addDays(startDate, index));
  return { startDate, nights, dates, endDate: dates.at(-1), mode };
}
export function restoreTrip(saved, now = new Date()) {
  if (saved?.mode === 'manual' && validDate(saved.startDate) && [0, 1, 2].includes(saved.nights)) return makeTrip(saved.startDate, saved.nights);
  return makeTrip(nextWeekend(now).saturday, 1, 'weekend');
}
export function tripRangeError(trip, now = new Date()) {
  const today = japanToday(now), lastDate = addDays(today, 15);
  if (trip.startDate < today) return '過去の日程は予報を取得できません。今日以降の開始日を選んでください。';
  if (trip.endDate > lastDate) return `予報を取得できる期間は ${today} から ${lastDate} までです。最終日がこの期間に収まる日程を選んでください。`;
  return '';
}
export function periodDates(period) {
  return period.dates ?? [period.saturday, period.sunday];
}
export function dateLabel(iso) {
  const day = new Date(`${iso}T00:00:00Z`);
  return `${day.getUTCMonth() + 1}/${day.getUTCDate()}（${'日月火水木金土'[day.getUTCDay()]}）`;
}
