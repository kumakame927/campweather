import { initPwa } from './pwa.js';
import { initBackup } from './backup.js';
import { initRegistration } from './registration.js';
import { initJma, renderJma, japanTimestamp } from './jma.js';
import { forecastDays, forecastUrl, parseForecast, comparable, compareForecasts, sameConditions, weatherLabel, weatherSymbol, fetchJson } from './weather.js';
import { STORAGE_KEY, LEGACY_STORAGE_KEY, loadLocal, persist, restoreCamps } from './locations.js';
import { usesSameOrigin } from './api.js';
import { TRIP_STORAGE_KEY, restoreTrip, makeTrip, tripRangeError, dateLabel, japanToday } from './schedule.js';

let camps = restoreCamps(loadLocal(STORAGE_KEY, null) ?? loadLocal(LEGACY_STORAGE_KEY, null));
let forecasts = new Map();
let trip = restoreTrip(loadLocal(TRIP_STORAGE_KEY, null));
let rangeError = tripRangeError(trip);
let deleteId = null;
let refreshController;
let refreshing = false;
let lastRefreshAt = 0;
let requestGeneration = 0;
const $ = selector => document.querySelector(selector);
const grid = $('#camp-grid');
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const number = value => value === null || value === undefined ? '—' : String(Math.round(value * 10) / 10);
function mapUrl(location) {
  if (!location.osmId) return `https://www.openstreetmap.org/?mlat=${location.latitude}&mlon=${location.longitude}#map=16/${location.latitude}/${location.longitude}`;
  return `https://www.openstreetmap.org/${location.osmType}/${location.osmId}#map=16/${location.latitude}/${location.longitude}`;
}
function locationDetails(location) {
  return `<p class="address">${escapeHtml(location.address)}</p><p class="coordinates">緯度 ${location.latitude.toFixed(6)} / 経度 ${location.longitude.toFixed(6)}</p><a class="map-link" href="${mapUrl(location)}" target="_blank" rel="noopener noreferrer">地図で場所を確認 ↗<span class="sr-only">（新しいタブ）</span></a>${location.source === 'verified-listing' && location.sourceUrl ? `<p class="coordinates">補足候補の出典：<a href="${escapeHtml(location.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(location.sourceName)}</a>。営業状況は施設にご確認ください。</p>` : ''}`;
}
function apiDetails(error) {
  return `サービス: ${error.service ?? '予報データの検証'}\n接続先: ${error.endpoint ?? 'Open-Meteo'}\n分類: ${error.code ?? error.name} / HTTP: ${error.status ?? '応答なし'}\n接続方式: ${usesSameOrigin ? 'サーバー経由（同一オリジン）' : '外部APIへ直接'}\n表示元: ${location.origin}\nネット接続: ${navigator.onLine ? 'オンライン' : 'オフライン'}`;
}
function saveCamps(next) {
  if (!persist(STORAGE_KEY, { version: 2, camps: next })) {
    $('#storage-notice').hidden = false;
    $('#storage-notice').textContent = 'ブラウザに保存できませんでした。登録内容は変更していません。ストレージ設定をご確認ください。';
    return false;
  }
  camps = next;
  $('#storage-notice').hidden = true;
  return true;
}
function dayColumn(day, date, index) {
  const final = index === trip.dates.length - 1;
  return `<section class="day ${final ? 'sunday' : ''}" aria-label="${dateLabel(date)}の予報"><h4>${dateLabel(date)}<small class="day-role">${trip.nights === 0 ? '日帰り' : final ? '撤収日' : index === 0 ? '開始日' : '滞在日'}</small></h4><p class="weather"><span class="weather-symbol" aria-hidden="true">${weatherSymbol(day?.code)}</span><span>${weatherLabel(day?.code)}</span></p><dl><div class="rain"><dt>降水確率 <small>最大</small></dt><dd>${number(day?.rain)}<small> %</small></dd></div><div><dt>最高 / 最低</dt><dd>${number(day?.high)} / ${number(day?.low)}<small> ℃</small></dd></div><div><dt>最大風速</dt><dd>${number(day?.wind)}<small> m/s</small></dd></div></dl></section>`;
}
function rankedCamps() {
  return camps.map(camp => ({ ...camp, forecast: forecasts.get(camp.id)?.data })).sort(compareForecasts);
}
function render() {
  const openJma = new Set([...grid.querySelectorAll('details.jma-reference[open]')].map(details => details.dataset.jmaCamp));
  const ranked = rankedCamps();
  const eligible = ranked.filter(camp => comparable(camp.forecast));
  const best = eligible[0];
  const leaders = best ? eligible.filter(camp => sameConditions(camp.forecast, best.forecast)) : [];
  const leaderIds = new Set(leaders.map(camp => camp.id));
  $('#weekend-period').textContent = trip.dates.length === 1 ? dateLabel(trip.startDate) : `${dateLabel(trip.startDate)} — ${dateLabel(trip.endDate)}`;
  $('#trip-start').value = trip.startDate;
  $('#trip-nights').value = String(trip.nights);
  $('#trip-range-error').textContent = rangeError;
  $('#trip-range-error').hidden = !rangeError;
  $('#empty-camps').hidden = camps.length !== 0;
  $('#ranking-rule').textContent = `${trip.nights ? '撤収日' : '当日'}の降水確率が低い順。同率なら日程中の最大風速、最終日以外の最大降水確率の順で比較。`;
  const rec = $('#recommendation');
  if (best) {
    rec.classList.add('has-recommendation');
    const wind = Math.max(...forecastDays(best.forecast).map(day => day.wind));
    rec.innerHTML = `<div><p class="eyebrow">${eligible.length === 1 ? '予報を取得できたキャンプ場' : leaders.length > 1 ? 'おすすめ候補 · 同条件' : '選択日程のおすすめ候補'}</p><h2 id="recommendation-title">${leaders.map(camp => escapeHtml(camp.name)).join(' / ')}</h2><p>${eligible.length === 1 ? '取得できた予報は1施設のみです。ほかの施設との比較はできていません。' : `${eligible.length}施設で比較。${trip.nights ? '撤収日' : '当日'}の降水確率を最優先に選んでいます。`}${eligible.length < camps.length ? ` 未取得・未確認の${camps.length - eligible.length}施設は対象外です。` : ''}</p><p class="recommendation-conditions">日程中の最大風速 ${number(wind)} m/s · 最低気温 ${number(Math.min(...forecastDays(best.forecast).map(day => day.low)))} ℃</p></div><div class="recommendation-rain"><span>${trip.nights ? '撤収日' : '当日'}の降水確率</span><strong>${number(forecastDays(best.forecast).at(-1).rain)}<small>%</small></strong></div>`;
  } else {
    rec.classList.remove('has-recommendation');
    rec.innerHTML = `<div><p class="eyebrow">選択日程の天気比較</p><h2 id="recommendation-title">${camps.length === 0 ? 'キャンプ場を追加してください' : rangeError ? '日程を確認してください' : refreshing ? '選択日程の予報を取得しています' : 'おすすめは予報取得後に表示します'}</h2><p>${camps.length === 0 ? 'キャンプ場名・住所・地図から、比較したい場所を追加できます。' : rangeError ? '予報取得可能期間内の日程を選ぶと比較を再開します。' : refreshing ? '登録済みのキャンプ場の予報を確認中です。' : '取得できない施設は順位に含めません。'}</p></div>`;
  }
  const located = camps.filter(camp => camp.location).length;
  const failed = [...forecasts.values()].filter(result => result.state === 'error').length;
  $('#fetch-status').textContent = refreshing ? `${located}施設の予報を更新中…` : `${camps.length}施設登録 · ${eligible.length}施設の予報を比較可能${failed ? ` · ${failed}施設は取得失敗` : ''}${located < camps.length ? ` · ${camps.length - located}施設は位置未確認` : ''}`;
  $('#refresh-weather').disabled = refreshing || located === 0 || Boolean(rangeError);
  $('#refresh-weather').textContent = refreshing ? '更新中…' : '予報を更新';
  grid.innerHTML = ranked.map(camp => {
    const result = forecasts.get(camp.id);
    const isComplete = comparable(camp.forecast);
    const recommended = eligible.length > 1 && leaderIds.has(camp.id);
    let message = '';
    if (rangeError) message = '選択した日程の予報は取得できません。日程を変更してください。';
    else if (!camp.location) message = '位置未確認：場所検索で住所と地図を確認してください。';
    else if (!result || result.state === 'loading') message = '予報を取得しています…';
    else if (result.state === 'error') message = `予報を取得できませんでした。${result.error}`;
    else if (!isComplete) message = '予報の一部を取得できませんでした。比較対象外です。';
    return `<article class="camp-card ${recommended ? 'recommended' : ''}" data-camp-id="${escapeHtml(camp.id)}"><div class="card-heading"><h3>${escapeHtml(camp.name)}</h3>${recommended ? '<span class="recommendation-badge">おすすめ候補</span>' : ''}</div>${camp.location ? `<details class="location-details"><summary>${escapeHtml(camp.location.address)}</summary>${locationDetails(camp.location)}</details>` : '<p class="unconfirmed-label">場所を確認すると天気を表示できます</p>'}<p class="forecast-source">Open-Meteo（主予報）</p><div class="forecast-days ${trip.nights === 2 ? 'three-days' : ''}" style="--days:${trip.dates.length}">${trip.dates.map((date, index) => dayColumn(forecastDays(camp.forecast)[index], date, index)).join('')}</div>${message ? `<p class="card-status ${result?.state === 'error' ? 'error' : ''}" role="status">${escapeHtml(message)}</p>${result?.debug ? `<details class="api-debug"><summary>通信エラーの詳細</summary><pre>${escapeHtml(result.debug)}</pre></details>` : ''}` : ''}${renderJma(camp, trip, openJma.has(camp.id))}<div class="card-footer"><span>${result?.receivedAt && result.state === 'ready' ? `Open-Meteo データ取得日時：${japanTimestamp(result.receivedAt)}` : '予報未取得'}</span><button class="text-button location-button" data-location="${escapeHtml(camp.id)}" type="button">${camp.location ? '場所を変更' : '場所を確認'}</button><button class="text-button delete-button" data-delete="${escapeHtml(camp.id)}" type="button" aria-label="${escapeHtml(camp.name)}を削除">削除</button></div></article>`;
  }).join('');
}
async function refreshWeather() {
  refreshController?.abort();
  refreshController = new AbortController();
  const { signal } = refreshController;
  const generation = ++requestGeneration;
  if (trip.mode === 'weekend') trip = restoreTrip(null);
  rangeError = tripRangeError(trip);
  const requestedTrip = trip;
  refreshing = !rangeError && camps.some(camp => camp.location);
  lastRefreshAt = Date.now();
  forecasts = new Map((rangeError ? [] : camps.filter(camp => camp.location)).map(camp => [camp.id, { state: 'loading' }]));
  render();
  // 同時接続を3件までに抑える。施設ごとの失敗はほかの取得を妨げない。
  const pending = rangeError ? [] : camps.filter(camp => camp.location);
  async function worker() {
    while (pending.length && !signal.aborted) {
      const camp = pending.shift();
      try {
        const payload = await fetchJson(forecastUrl(camp, requestedTrip), { signal });
        const data = parseForecast(payload, requestedTrip);
        if (generation !== requestGeneration) return;
        forecasts.set(camp.id, { state: 'ready', data, receivedAt: Date.now() });
      } catch (error) {
        if (signal.aborted || generation !== requestGeneration) return;
        forecasts.set(camp.id, { state: 'error', error: error.message, debug: apiDetails(error) });
      }
      if (generation === requestGeneration) render();
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, pending.length) }, worker));
  if (generation === requestGeneration) { refreshing = false; render(); }
}
const registration = initRegistration({ getCamps: () => camps, saveCamps, locationDetails, apiDetails, onSaved(targetId) {
  refreshWeather();
  if (targetId) {
    $('#storage-notice').hidden = false;
    $('#storage-notice').textContent = '登録済みのキャンプ場です。確認した位置を保存し、予報の再取得を開始しました。';
  }
} });
const openLocation = id => registration.open(id);
$('#empty-add-camp').addEventListener('click', () => openLocation());
$('#add-camp').addEventListener('click', () => openLocation());
$('#refresh-weather').addEventListener('click', refreshWeather);
grid.addEventListener('click', event => {
  const button = event.target.closest('[data-location]');
  if (button) openLocation(button.dataset.location);
  const deletion = event.target.closest('[data-delete]');
  if (deletion) {
    deleteId = deletion.dataset.delete;
    $('#delete-name').textContent = camps.find(camp => camp.id === deleteId).name;
    $('#delete-dialog').showModal();
    $('#cancel-delete').focus();
  }
});
setInterval(() => { if (!document.hidden) refreshWeather(); }, 30 * 60 * 1000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && (Date.now() - lastRefreshAt >= 30 * 60 * 1000 || (trip.mode === 'weekend' && restoreTrip(null).startDate !== trip.startDate))) refreshWeather();
});
function changeTrip(next) {
  if (!persist(TRIP_STORAGE_KEY, { startDate: next.startDate, nights: next.nights, mode: next.mode })) {
    $('#storage-notice').hidden = false;
    $('#storage-notice').textContent = '日程を保存できませんでした。ブラウザのストレージ設定をご確認ください。';
    render(); return;
  }
  trip = next;
  refreshWeather();
}
function dateChanged() {
  try { changeTrip(makeTrip($('#trip-start').value, Number($('#trip-nights').value))); }
  catch (error) { $('#trip-range-error').hidden = false; $('#trip-range-error').textContent = error.message; }
}
$('#trip-start').addEventListener('change', dateChanged);
$('#trip-nights').addEventListener('change', dateChanged);
$('#reset-weekend').addEventListener('click', () => changeTrip(restoreTrip(null)));
$('#trip-start').min = japanToday();
$('#cancel-delete').addEventListener('click', () => $('#delete-dialog').close());
$('#confirm-delete').addEventListener('click', () => {
  if (!deleteId || !camps.some(camp => camp.id === deleteId)) return;
  if (!saveCamps(camps.filter(camp => camp.id !== deleteId))) return;
  $('#delete-dialog').close();
  // 実行中の取得を中止し、削除済み施設が結果から復活しないようにする。
  refreshWeather();
  $('#add-camp').focus();
});
initPwa({ onReconnect: () => { if (!refreshing) refreshWeather(); } });
initBackup({ getCamps: () => camps, getTrip: () => trip });
initJma({ grid, getCamps: () => camps, getTrip: () => trip });
refreshWeather();
