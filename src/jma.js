import { dateLabel } from './schedule.js';
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const states = new Map(), officeRequests = new Map();
const TTL = 10 * 60 * 1000;
const keyFor = camp => camp.location ? `${camp.location.latitude},${camp.location.longitude},${camp.location.address}` : '';
const endpoint = name => `${import.meta.env?.BASE_URL ?? '/'}api/jma-${name}`;
export function japanTimestamp(value) {
  if (value === null || value === undefined || !Number.isFinite(new Date(value).getTime())) return '日時不明';
  return `${new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value))} JST`;
}
export function selectReference(records, area, dates) {
  // A weekly record is used only if its code is the actual primary area or the
  // entire parent office. Seasonal/special subdivisions are never guessed.
  return dates.map(date => {
    const short = records.filter(record => record.kind === 'short' && record.areaCode === area.code && record.date === date);
    const exact = records.filter(record => record.kind === 'weekly' && record.areaCode === area.code && record.date === date);
    const weekly = exact.length ? exact : records.filter(record => record.kind === 'weekly' && record.areaCode === area.officeCode && record.date === date);
    const hasWeather = short.some(record => record.weather), hasRain = short.some(record => record.rain?.probability !== null && record.rain?.probability !== undefined);
    return { date, short, weekly: !hasWeather || !hasRain ? weekly : [] };
  });
}
function issued(records) {
  return [...new Set(records.map(record => record.reportDatetime))].map(time => `<p class="jma-timestamp">予報発表日時：${escape(japanTimestamp(time))}</p>`).join('');
}
function referenceBody(camp, trip) {
  if (!camp.location) return '<p>位置が未確認のため、予報区域を判定できません。</p>';
  const state = states.get(keyFor(camp));
  if (!state || state.status === 'loading') return '<p role="status">気象庁の参考予報を取得しています…</p>';
  if (state.status === 'error') return `<p class="jma-error" role="status">${escape(state.error)}</p><button type="button" class="text-button" data-jma-retry>再取得する</button>`;
  const { area, forecast } = state;
  const days = selectReference(forecast.records, area, trip.dates);
  return `<p class="jma-area">府県予報の区域：<strong>${escape(area.officeName)} ${escape(area.name)}</strong></p><p class="jma-note">区域全体の予報です。キャンプ場や市町村のピンポイント予報ではありません。おすすめ順位には使用しません。</p><div class="jma-days">${days.map(({ date, short, weekly }) => {
    const weather = short.find(record => record.weather);
    const rain = short.filter(record => record.rain);
    const week = weekly[0];
    const covered = Boolean(weather || rain.length || week);
    return `<section class="jma-day"><h4>${dateLabel(date)}</h4>${!covered ? `<p>${forecast.records.some(record => record.date === date) ? '選択日の、この区域に対応する予報を確認できません。別区域の予報では補いません。' : '選択日は気象庁の予報対象期間外です。'}</p>` : ''}${short.length ? `<p class="jma-source-label">府県予報：${escape(area.officeName)} ${escape(area.name)}</p>${weather ? `<p>${escape(weather.weather)}</p>` : '<p>天気：発表なし</p>'}${rain.length ? `<p class="jma-source-label">降水確率（日本時間・6時間ごと）</p><dl class="jma-rain">${rain.map(record => `<div><dt>${escape(record.rain.label)}</dt><dd>${record.rain.probability === null ? '発表なし' : `${record.rain.probability}%`}</dd></div>`).join('')}</dl>` : '<p class="jma-note">6時間ごとの降水確率は発表されていません。</p>'}${issued(short)}` : ''}${week ? `<div class="jma-weekly"><p class="jma-source-label">週間予報の区域：<strong>${escape(week.areaName)}</strong></p>${!weather ? `<p>${week.weather ? escape(week.weather) : '天気：発表なし'}</p>` : ''}<p>降水確率（日単位・気象庁発表値）：<strong>${week.dailyRain === null || week.dailyRain === undefined ? '発表なし' : `${week.dailyRain}%`}</strong></p>${issued(weekly)}</div>` : ''}</section>`;
  }).join('')}</div><p class="jma-timestamp">気象庁データ取得日時：${escape(japanTimestamp(forecast.retrievedAt))}</p><p class="jma-note">出典：<a href="https://www.jma.go.jp/bosai/forecast/#area_type=offices&amp;area_code=${escape(area.officeCode)}" target="_blank" rel="noopener noreferrer">気象庁ホームページ（天気予報）↗</a>。気象庁の公開データを晴れキャンで選択・整形しています。確率の合算・平均・日最大への変換は行っていません。</p>`;
}
export function renderJma(camp, trip, open = false) {
  return `<details class="jma-reference" data-jma-camp="${escape(camp.id)}"${open ? ' open' : ''}><summary>気象庁の参考予報</summary><div class="jma-content">${open ? referenceBody(camp, trip) : ''}</div></details>`;
}
async function readJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  const json = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new Error(json?.error ?? `気象庁の参考予報に接続できません（HTTP ${response.status}）。Vercelのサーバー機能と通信状態を確認してください。`);
  if (!json) throw new Error('気象庁の参考予報サーバーの応答を確認できません。');
  return json;
}
function sharedForecast(office) {
  const cached = officeRequests.get(office);
  if (cached && Date.now() - cached.at < TTL) return cached.promise;
  const entry = { at: Date.now(), promise: readJson(`${endpoint('forecast')}?office=${encodeURIComponent(office)}`) };
  officeRequests.set(office, entry);
  entry.promise.catch(() => { if (officeRequests.get(office) === entry) officeRequests.delete(office); });
  return entry.promise;
}
export function initJma({ grid, getCamps, getTrip }) {
  function paint(key) {
    for (const details of grid.querySelectorAll('details.jma-reference[open]')) {
      const camp = getCamps().find(camp => camp.id === details.dataset.jmaCamp);
      if (camp && keyFor(camp) === key) details.querySelector('.jma-content').innerHTML = referenceBody(camp, getTrip());
    }
  }
  async function load(details, force = false) {
    const camp = getCamps().find(camp => camp.id === details.dataset.jmaCamp);
    if (!camp) return;
    const key = keyFor(camp);
    if (!key) { details.querySelector('.jma-content').innerHTML = referenceBody(camp, getTrip()); return; }
    const cached = states.get(key);
    if (!force && cached && (cached.status === 'loading' || Date.now() - cached.at < TTL)) { paint(key); return; }
    // Bound local memory without altering saved camps or trip data.
    if (states.size >= 100 && !states.has(key)) states.delete(states.keys().next().value);
    const state = { status: 'loading', at: Date.now() };
    states.set(key, state); paint(key);
    try {
      const params = new URLSearchParams({ latitude: String(camp.location.latitude), longitude: String(camp.location.longitude), address: camp.location.address });
      const { area } = await readJson(`${endpoint('area')}?${params}`);
      if (!area || !/^\d{6}$/.test(area.code) || !/^\d{6}$/.test(area.officeCode)) throw new Error('気象庁の予報区域を確認できません。');
      const forecast = await sharedForecast(area.officeCode);
      if (!Array.isArray(forecast.records) || forecast.officeCode !== area.officeCode || !Number.isFinite(Date.parse(forecast.retrievedAt))) throw new Error('気象庁の予報データの形式を確認できません。');
      if (states.get(key) === state) states.set(key, { status: 'ready', at: Date.now(), area, forecast });
    } catch (error) {
      if (states.get(key) === state) states.set(key, { status: 'error', at: Date.now(), error: error.name === 'TimeoutError' ? '気象庁の参考予報への接続がタイムアウトしました。時間をおいて再取得してください。' : error instanceof TypeError ? '通信エラーのため気象庁の参考予報を取得できませんでした。Open-Meteoの表示は引き続き利用できます。' : error.message });
    }
    paint(key);
  }
  grid.addEventListener('toggle', event => {
    if (event.target.matches('details.jma-reference[open]')) load(event.target);
  }, true);
  grid.addEventListener('click', event => {
    const retry = event.target.closest('[data-jma-retry]');
    if (retry) load(retry.closest('details.jma-reference'), true);
  });
}
