import { requestTarget, ApiError } from './api.js';
export const FORECAST_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
export const DAILY_FIELDS = ['weather_code', 'precipitation_probability_max', 'temperature_2m_max', 'temperature_2m_min', 'wind_speed_10m_max'];

// 日付の基準は常に日本時間。日曜日に開いた場合は翌週末を表示する。
export function nextWeekend(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map(part => [part.type, part.value]));
  const day = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
  const offset = (6 - day.getUTCDay() + 7) % 7;
  day.setUTCDate(day.getUTCDate() + offset);
  const saturday = day.toISOString().slice(0, 10);
  day.setUTCDate(day.getUTCDate() + 1);
  return { saturday, sunday: day.toISOString().slice(0, 10) };
}
export function formatDate(iso) {
  const [, month, day] = iso.split('-').map(Number);
  return `${month}/${day}`;
}
export function forecastUrl(camp, weekend) {
  const url = new URL(FORECAST_ENDPOINT);
  url.search = new URLSearchParams({
    latitude: String(camp.location.latitude), longitude: String(camp.location.longitude),
    daily: DAILY_FIELDS.join(','), timezone: 'Asia/Tokyo', wind_speed_unit: 'ms',
    temperature_unit: 'celsius', start_date: weekend.saturday, end_date: weekend.sunday,
  }).toString();
  return url;
}
const isNumber = value => typeof value === 'number' && Number.isFinite(value);
function measured(value, min, max) {
  return isNumber(value) && value >= min && value <= max ? value : null;
}
export function parseForecast(payload, weekend) {
  const daily = payload?.daily;
  if (!daily || !Array.isArray(daily.time)) throw new Error('予報データの形式を確認できませんでした。');
  const units = payload.daily_units;
  if (!units || units.temperature_2m_max !== '°C' || units.temperature_2m_min !== '°C' || units.wind_speed_10m_max !== 'm/s' || units.precipitation_probability_max !== '%') {
    throw new Error('予報の単位を確認できませんでした。');
  }
  const read = date => {
    const index = daily.time.indexOf(date);
    if (index < 0) return null;
    const value = field => Array.isArray(daily[field]) ? daily[field][index] : null;
    return {
      date,
      code: measured(value('weather_code'), 0, 99),
      rain: measured(value('precipitation_probability_max'), 0, 100),
      high: measured(value('temperature_2m_max'), -100, 70),
      low: measured(value('temperature_2m_min'), -100, 70),
      wind: measured(value('wind_speed_10m_max'), 0, 200),
    };
  };
  const result = { saturday: read(weekend.saturday), sunday: read(weekend.sunday) };
  if (!result.saturday && !result.sunday) throw new Error('対象の週末の予報がありません。');
  return result;
}
export function comparable(forecast) {
  return ['saturday', 'sunday'].every(key => {
    const day = forecast?.[key];
    return day && ['rain', 'wind', 'high', 'low', 'code'].every(field => isNumber(day[field])) &&
      weatherLabel(day.code) !== '天気情報なし' && day.low <= day.high;
  });
}
export function compareForecasts(a, b) {
  const validA = comparable(a.forecast), validB = comparable(b.forecast);
  if (validA !== validB) return validA ? -1 : 1;
  if (!validA) return a.name.localeCompare(b.name, 'ja');
  const x = a.forecast, y = b.forecast;
  return x.sunday.rain - y.sunday.rain ||
    Math.max(x.saturday.wind, x.sunday.wind) - Math.max(y.saturday.wind, y.sunday.wind) ||
    x.saturday.rain - y.saturday.rain || a.name.localeCompare(b.name, 'ja');
}
export function sameConditions(a, b) {
  return comparable(a) && comparable(b) && a.sunday.rain === b.sunday.rain &&
    Math.max(a.saturday.wind, a.sunday.wind) === Math.max(b.saturday.wind, b.sunday.wind) && a.saturday.rain === b.saturday.rain;
}
export function weatherLabel(code) {
  const labels = {
    0: '快晴', 1: '晴れ', 2: '晴れ時々くもり', 3: 'くもり', 45: '霧', 48: '着氷性の霧',
    51: '弱い霧雨', 53: '霧雨', 55: '強い霧雨', 56: '弱い着氷性の霧雨', 57: '着氷性の霧雨',
    61: '小雨', 63: '雨', 65: '強い雨', 66: '弱い凍雨', 67: '凍雨',
    71: '弱い雪', 73: '雪', 75: '強い雪', 77: '霧雪', 80: '弱いにわか雨', 81: 'にわか雨', 82: '激しいにわか雨',
    85: '弱いにわか雪', 86: 'にわか雪', 95: '雷雨', 96: 'ひょうを伴う雷雨', 99: '激しいひょうを伴う雷雨',
  };
  return labels[code] ?? '天気情報なし';
}
export function weatherSymbol(code) {
  if (code === 0 || code === 1) return '☀';
  if (code === 2) return '⛅';
  if (code === 3) return '☁';
  if ([45, 48].includes(code)) return '≋';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return '❄';
  if ([95, 96, 99].includes(code)) return 'ϟ';
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return '☂';
  return '—';
}
export async function fetchJson(url, { signal, timeout = 15000 } = {}) {
  const target = requestTarget(url);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  let timedOut = false;
  let policyViolation = null;
  const policyListener = event => {
    if (event.blockedURI && (target.endpoint.startsWith(event.blockedURI) || String(event.blockedURI).startsWith(new URL(target.url, globalThis.location?.href ?? target.endpoint).origin))) {
      policyViolation = event.effectiveDirective;
    }
  };
  globalThis.document?.addEventListener('securitypolicyviolation', policyListener);
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
  const fail = (message, code, status) => new ApiError(message, { ...target, code, status });
  try {
    const response = await fetch(target.url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) {
      if (response.status === 429) throw fail('利用回数の制限中です（HTTP 429）。時間をおいて再試行してください。', 'rate-limit', 429);
      if (response.status === 403) throw fail('APIへの接続が拒否されました（HTTP 403）。ネットワークのアクセス制限やサービスの利用条件をご確認ください。', 'forbidden', 403);
      if (response.status >= 500) throw fail(`サービスまたは開発サーバーでエラーが発生しています（HTTP ${response.status}）。時間をおいて再試行してください。`, 'server', response.status);
      let detail = '';
      try { const body = await response.json(); if (typeof body.reason === 'string') detail = ` ${body.reason.slice(0, 250)}`; } catch { /* 本文が JSON でない HTTP エラーもステータスで報告する。 */ }
      throw fail(`APIリクエストが失敗しました（HTTP ${response.status}）。${detail}`, 'http', response.status);
    }
    const result = await response.json();
    if (result?.error) throw fail(`APIがエラーを返しました。${typeof result.reason === 'string' ? result.reason.slice(0, 250) : ''}`, 'provider', response.status);
    return result;
  } catch (error) {
    if (signal?.aborted) throw error;
    // CSP 違反イベントが非同期に通知されるブラウザでも、拒否理由を先に受け取る。
    if (error instanceof TypeError) await new Promise(resolve => setTimeout(resolve, 0));
    let failure = error;
    if (timedOut) failure = fail('接続がタイムアウトしました。時間をおいて再試行してください。', 'timeout');
    else if (error instanceof SyntaxError) failure = fail('APIの応答を読み取れませんでした。', 'invalid-json');
    else if (policyViolation) failure = fail(`プレビューの通信ポリシー（CSP: ${policyViolation}）で接続が遮断されました。プレビューの外部通信許可を確認してください。`, 'csp');
    else if (error instanceof TypeError) failure = globalThis.navigator?.onLine === false ?
      fail('オフラインです。ネット接続を確認して再試行してください。', 'offline') :
      fail('ブラウザがAPIの応答を受信できませんでした。ネット接続・プレビューの通信許可・CORSを確認してください（原因は未確定）。', 'network');
    console.error('[Camp Weather API]', { service: target.service, endpoint: target.endpoint, code: failure.code ?? 'unexpected', status: failure.status ?? null, message: failure.message });
    throw failure;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    globalThis.document?.removeEventListener('securitypolicyviolation', policyListener);
  }
}
