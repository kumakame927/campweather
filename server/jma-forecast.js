import { readFileSync } from 'node:fs';
import https from 'node:https';
import { offices } from './jma-areas.js';
const codes = JSON.parse(readFileSync(new URL('./data/jma-weather-codes.json', import.meta.url), 'utf8'));
export const FORECAST_TTL = 10 * 60 * 1000;
const MAX_AGE = 36 * 60 * 60 * 1000;
const dateParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });
function dateTime(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)); }
function day(value) { return dateParts.format(new Date(value)); }
function probability(value) {
  return typeof value === 'string' && /^(?:100|[1-9]?\d)$/.test(value) ? Number(value) : null;
}
export function parseJmaForecast(payload, now = Date.now()) {
  if (!Array.isArray(payload) || !payload.length) throw new Error('予報データの形式が変更された可能性があります。');
  const records = [];
  for (const report of payload) {
    if (!dateTime(report?.reportDatetime) || !Array.isArray(report.timeSeries)) throw new Error('予報発表日時・形式を確認できません。');
    const issued = Date.parse(report.reportDatetime);
    if (now - issued > MAX_AGE || issued > now + 15 * 60000) throw new Error('予報発表日時が古いか、不正なため表示できません。');
    for (const series of report.timeSeries) {
      if (!Array.isArray(series.timeDefines) || !series.timeDefines.every(dateTime) || !Array.isArray(series.areas)) throw new Error('予報の時間軸を確認できません。');
      for (const area of series.areas) {
        if (!/^\d{6}$/.test(area?.area?.code) || typeof area.area.name !== 'string') continue; // Exclude point temperature stations.
        const weekly = Array.isArray(area.weatherCodes) && Array.isArray(area.pops);
        const shortWeather = Array.isArray(area.weathers);
        const shortRain = !weekly && Array.isArray(area.pops);
        if (!weekly && !shortWeather && !shortRain) continue;
        for (let index = 0; index < series.timeDefines.length; index++) {
          const time = series.timeDefines[index];
          const record = { areaCode: area.area.code, areaName: area.area.name, kind: weekly ? 'weekly' : 'short', date: day(time), reportDatetime: report.reportDatetime };
          if (weekly || shortWeather) {
            const text = shortWeather ? area.weathers[index] : codes[area.weatherCodes[index]];
            record.weather = typeof text === 'string' && text.trim() ? text.trim().replace(/\s+/g, ' ') : null;
          }
          if (weekly) record.dailyRain = probability(area.pops[index]);
          if (shortRain) {
            const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', hourCycle: 'h23' }).format(new Date(time)));
            if (![0, 6, 12, 18].includes(hour)) throw new Error('降水確率の対象時間帯を確認できません。');
            record.rain = { label: `${String(hour).padStart(2, '0')}–${String(hour + 6).padStart(2, '0')}時`, probability: probability(area.pops[index]) };
          }
          records.push(record);
        }
      }
    }
  }
  if (!records.length || !records.some(record => record.weather)) throw new Error('天気予報の項目を確認できません。');
  return records;
}
// Use Node's HTTPS implementation with its normal TLS trust. The preview may
// inject an HTTPS proxy agent; Vercel uses its normal outbound connection.
export function getJson(url, agent) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { agent, headers: { Accept: 'application/json', 'User-Agent': 'CampNote/1.0 (+https://github.com/kumakame927/campweather)' } }, response => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`気象庁の応答がHTTP ${response.statusCode}でした。`)); return; }
      let content = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        content += chunk;
        if (content.length > 512000) request.destroy(new Error('気象庁の応答サイズを確認できません。'));
      });
      response.on('error', reject);
      response.on('end', () => { try { resolve(JSON.parse(content)); } catch { reject(new Error('気象庁の応答を読み取れません。')); } });
    });
    request.setTimeout(10000, () => request.destroy(new Error('気象庁への接続がタイムアウトしました。')));
    request.on('error', reject);
  });
}
export function createForecastService({ fetchJson = getJson, now = Date.now } = {}) {
  const cache = new Map(), inFlight = new Map(), failures = new Map();
  return async function getForecast(office) {
    if (!Object.hasOwn(offices, office)) throw new Error('対応する気象庁の発表官署がありません。');
    const cached = cache.get(office);
    if (cached && now() - cached.timestamp < FORECAST_TTL) return cached.value;
    if (inFlight.has(office)) return inFlight.get(office);
    const failed = failures.get(office);
    if (failed && now() - failed.at < 60000) throw failed.error;
    const work = (async () => {
      const sourceUrl = `https://www.jma.go.jp/bosai/forecast/data/forecast/${office}.json`;
      const payload = await fetchJson(sourceUrl);
      const timestamp = now();
      const value = { officeCode: office, officeName: offices[office].name, records: parseJmaForecast(payload, timestamp), retrievedAt: new Date(timestamp).toISOString(), sourceUrl };
      cache.set(office, { timestamp, value });
      return value;
    })();
    inFlight.set(office, work);
    try { const result = await work; failures.delete(office); return result; }
    catch (error) { failures.set(office, { at: now(), error }); throw error; }
    finally { inFlight.delete(office); }
  };
}
export const getForecast = createForecastService();
