import { nextWeekend, formatDate, forecastUrl, parseForecast, comparable, compareForecasts, sameConditions, weatherLabel, weatherSymbol, fetchJson } from './weather.js';
import { STORAGE_KEY, loadLocal, persist, restoreCamps, searchLocations, locationId } from './locations.js';
import { usesSameOrigin } from './api.js';

let camps = restoreCamps(loadLocal(STORAGE_KEY, []));
let forecasts = new Map();
let weekend = nextWeekend();
let refreshController;
let refreshing = false;
let lastRefreshAt = 0;
let requestGeneration = 0;
let editingId = null;
let selectedLocation = null;
let searchResults = [];
let searchController;
let searchGeneration = 0;
let returnFocusId = null;
const $ = selector => document.querySelector(selector);
const grid = $('#camp-grid');
const dialog = $('#location-dialog');
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const number = value => value === null || value === undefined ? '—' : String(Math.round(value * 10) / 10);
const timeLabel = value => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
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
  if (!persist(STORAGE_KEY, next)) {
    $('#storage-notice').hidden = false;
    $('#storage-notice').textContent = 'ブラウザに保存できませんでした。登録内容は変更していません。ストレージ設定をご確認ください。';
    return false;
  }
  camps = next;
  $('#storage-notice').hidden = true;
  return true;
}
function dayColumn(day, label, date) {
  return `<section class="day ${label === '日' ? 'sunday' : ''}" aria-label="${formatDate(date)} ${label}曜日の予報"><h4>${formatDate(date)} <span>(${label})</span></h4><p class="weather"><span class="weather-symbol" aria-hidden="true">${weatherSymbol(day?.code)}</span><span>${weatherLabel(day?.code)}</span></p><dl><div class="rain"><dt>降水確率 <small>最大</small></dt><dd>${number(day?.rain)}<small> %</small></dd></div><div><dt>最高 / 最低</dt><dd>${number(day?.high)} / ${number(day?.low)}<small> ℃</small></dd></div><div><dt>最大風速</dt><dd>${number(day?.wind)}<small> m/s</small></dd></div></dl></section>`;
}
function rankedCamps() {
  return camps.map(camp => ({ ...camp, forecast: forecasts.get(camp.id)?.data })).sort(compareForecasts);
}
function render() {
  const ranked = rankedCamps();
  const eligible = ranked.filter(camp => comparable(camp.forecast));
  const best = eligible[0];
  const leaders = best ? eligible.filter(camp => sameConditions(camp.forecast, best.forecast)) : [];
  const leaderIds = new Set(leaders.map(camp => camp.id));
  $('#weekend-period').textContent = `${formatDate(weekend.saturday)}（土）— ${formatDate(weekend.sunday)}（日）`;
  const rec = $('#recommendation');
  if (best) {
    rec.classList.add('has-recommendation');
    const wind = Math.max(best.forecast.saturday.wind, best.forecast.sunday.wind);
    rec.innerHTML = `<div><p class="eyebrow">${eligible.length === 1 ? '予報を取得できたキャンプ場' : leaders.length > 1 ? 'おすすめ候補 · 同条件' : '今週末のおすすめ候補'}</p><h2 id="recommendation-title">${leaders.map(camp => escapeHtml(camp.name)).join(' / ')}</h2><p>${eligible.length === 1 ? '取得できた予報は1施設のみです。ほかの施設との比較はできていません。' : `${eligible.length}施設で比較。日曜の降水確率を最優先に選んでいます。`}${eligible.length < camps.length ? ` 未取得・未確認の${camps.length - eligible.length}施設は対象外です。` : ''}</p><p class="recommendation-conditions">週末の最大風速 ${number(wind)} m/s · 最低気温 ${number(Math.min(best.forecast.saturday.low, best.forecast.sunday.low))} ℃</p></div><div class="recommendation-rain"><span>日曜の降水確率</span><strong>${number(best.forecast.sunday.rain)}<small>%</small></strong></div>`;
  } else {
    rec.classList.remove('has-recommendation');
    rec.innerHTML = `<div><p class="eyebrow">WEEKEND COMPARISON</p><h2 id="recommendation-title">${refreshing ? '週末の予報を取得しています' : 'おすすめは予報取得後に表示します'}</h2><p>${refreshing ? '位置を登録済みのキャンプ場の予報を確認中です。' : '施設の位置を確認すると、自動で土日の予報を取得します。取得できない施設は順位に含めません。'}</p></div>`;
  }
  const located = camps.filter(camp => camp.location).length;
  const failed = [...forecasts.values()].filter(result => result.state === 'error').length;
  $('#fetch-status').textContent = refreshing ? `${located}施設の予報を更新中…` : `${camps.length}施設登録 · ${eligible.length}施設の予報を比較可能${failed ? ` · ${failed}施設は取得失敗` : ''}${located < camps.length ? ` · ${camps.length - located}施設は位置未確認` : ''}`;
  $('#refresh-weather').disabled = refreshing || located === 0;
  $('#refresh-weather').textContent = refreshing ? '更新中…' : '予報を更新';
  grid.innerHTML = ranked.map(camp => {
    const result = forecasts.get(camp.id);
    const isComplete = comparable(camp.forecast);
    const recommended = eligible.length > 1 && leaderIds.has(camp.id);
    let message = '';
    if (!camp.location) message = '位置未確認：場所検索で住所と地図を確認してください。';
    else if (!result || result.state === 'loading') message = '予報を取得しています…';
    else if (result.state === 'error') message = `予報を取得できませんでした。${result.error}`;
    else if (!isComplete) message = '予報の一部を取得できませんでした。比較対象外です。';
    return `<article class="camp-card ${recommended ? 'recommended' : ''}" data-camp-id="${escapeHtml(camp.id)}"><div class="card-heading"><h3>${escapeHtml(camp.name)}</h3>${recommended ? '<span class="recommendation-badge">おすすめ候補</span>' : ''}</div>${camp.location ? `<details class="location-details"><summary>${escapeHtml(camp.location.address)}</summary>${locationDetails(camp.location)}</details>` : '<p class="unconfirmed-label">場所を確認すると天気を表示できます</p>'}<div class="forecast-days">${dayColumn(camp.forecast?.saturday, '土', weekend.saturday)}${dayColumn(camp.forecast?.sunday, '日', weekend.sunday)}</div>${message ? `<p class="card-status ${result?.state === 'error' ? 'error' : ''}" role="status">${escapeHtml(message)}</p>${result?.debug ? `<details class="api-debug"><summary>通信エラーの詳細</summary><pre>${escapeHtml(result.debug)}</pre></details>` : ''}` : ''}<div class="card-footer"><span>${result?.receivedAt && result.state === 'ready' ? `取得 ${timeLabel(result.receivedAt)} JST` : '予報未取得'}</span><button class="text-button location-button" data-location="${escapeHtml(camp.id)}" type="button">${camp.location ? '場所を変更' : '場所を確認'}</button></div></article>`;
  }).join('');
}
async function refreshWeather() {
  refreshController?.abort();
  refreshController = new AbortController();
  const { signal } = refreshController;
  const generation = ++requestGeneration;
  weekend = nextWeekend();
  refreshing = camps.some(camp => camp.location);
  lastRefreshAt = Date.now();
  forecasts = new Map(camps.filter(camp => camp.location).map(camp => [camp.id, { state: 'loading' }]));
  render();
  // 同時接続を3件までに抑える。施設ごとの失敗はほかの取得を妨げない。
  const pending = camps.filter(camp => camp.location);
  async function worker() {
    while (pending.length && !signal.aborted) {
      const camp = pending.shift();
      try {
        const payload = await fetchJson(forecastUrl(camp, weekend), { signal });
        const data = parseForecast(payload, weekend);
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
function openLocation(id = null) {
  editingId = id;
  returnFocusId = id;
  searchGeneration++;
  searchController?.abort();
  searchResults = [];
  selectedLocation = null;
  $('#location-confirmation').hidden = true;
  $('#search-results').replaceChildren();
  $('#search-status').textContent = '';
  $('#search-error-details').hidden = true;
  $('#search-location').disabled = false;
  $('#search-location').textContent = '検索';
  $('#location-title').textContent = id ? 'キャンプ場の場所を確認' : 'キャンプ場を追加';
  const camp = id ? camps.find(camp => camp.id === id) : null;
  $('#location-query').value = camp ? camp.searchName ?? camp.name : '';
  dialog.showModal();
  $('#location-query').focus();
}
$('#add-camp').addEventListener('click', () => openLocation());
$('#refresh-weather').addEventListener('click', refreshWeather);
grid.addEventListener('click', event => {
  const button = event.target.closest('[data-location]');
  if (button) openLocation(button.dataset.location);
});
$('#close-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => {
  searchGeneration++;
  searchController?.abort();
  // 予報更新中にカードが再描画された場合も、元の操作位置へ戻す。
  const origin = returnFocusId ? [...grid.querySelectorAll('[data-location]')].find(button => button.dataset.location === returnFocusId) : $('#add-camp');
  origin?.focus();
});
$('#location-query').addEventListener('input', () => {
  searchGeneration++;
  searchController?.abort();
  selectedLocation = null;
  searchResults = [];
  $('#search-results').replaceChildren();
  $('#location-confirmation').hidden = true;
  $('#search-status').textContent = '';
  $('#search-error-details').hidden = true;
  $('#search-location').disabled = false;
  $('#search-location').textContent = '検索';
});
$('#location-form').addEventListener('submit', async event => {
  event.preventDefault();
  const query = $('#location-query').value.trim();
  if (!query) { $('#search-status').textContent = 'キャンプ場名を入力してください。'; return; }
  searchController?.abort();
  searchController = new AbortController();
  const generation = ++searchGeneration;
  selectedLocation = null;
  searchResults = [];
  $('#location-confirmation').hidden = true;
  $('#search-results').replaceChildren();
  $('#search-error-details').hidden = true;
  $('#search-status').textContent = '場所を検索しています…';
  $('#search-location').disabled = true;
  $('#search-location').textContent = '検索中…';
  try {
    const results = await searchLocations(query, searchController.signal);
    if (generation !== searchGeneration) return;
    searchResults = results;
    $('#search-status').textContent = results.length ? `${results.length}件の候補。${results.some(result => result.location.source === 'verified-listing') ? 'Nominatimに施設名の一致がなかったため、出典を照合した補足候補を表示しています。' : ''}地図と住所を確認してください。` : '通信は成功しましたが、施設名に一致する検索結果は0件でした。都道府県・市町村や正式名称で検索してください。地図に未登録の施設は見つからない場合があります。';
    $('#search-results').innerHTML = results.map((result, index) => `<article class="search-result"><h3>${escapeHtml(result.name)}</h3>${locationDetails(result.location)}<button class="button secondary select-location" data-select="${index}" type="button">この候補を選ぶ</button></article>`).join('');
  } catch (error) {
    if (generation !== searchGeneration || error.name === 'AbortError') return;
    $('#search-status').textContent = `通信エラーのため検索を完了できませんでした。${error.message}`;
    $('#search-error-details').hidden = false;
    $('#search-error-details pre').textContent = apiDetails(error);
  } finally {
    if (generation === searchGeneration) { $('#search-location').disabled = false; $('#search-location').textContent = '検索'; }
  }
});
$('#search-results').addEventListener('click', event => {
  const button = event.target.closest('[data-select]');
  if (!button) return;
  selectedLocation = searchResults[Number(button.dataset.select)];
  if (!selectedLocation) return;
  const name = editingId ? camps.find(camp => camp.id === editingId).name : selectedLocation.name;
  $('#confirmation-details').innerHTML = `<p class="confirmation-name">${escapeHtml(name)}</p>${locationDetails(selectedLocation.location)}`;
  $('#location-confirmation').hidden = false;
  $('#confirm-location').textContent = editingId ? 'この場所で登録' : 'キャンプ場を登録';
  $('#confirm-location').focus();
});
$('#confirm-location').addEventListener('click', () => {
  if (!selectedLocation) return;
  const { location } = selectedLocation;
  const duplicate = camps.find(camp => camp.id !== editingId && camp.location && locationId(camp.location) === locationId(location));
  // 初期登録済みの施設を追加画面から選んだ場合は、その施設を再確認する。
  // 位置変更中に別の登録施設を選ぶ操作は、誤った施設の上書きを避けるため拒否する。
  if (duplicate && editingId) { $('#search-status').textContent = `この場所は「${duplicate.name}」として登録済みです。`; return; }
  const targetId = editingId ?? duplicate?.id;
  const next = targetId ? camps.map(camp => camp.id === targetId ? { ...camp, location } : camp) : [...camps, { id: `place-${locationId(location)}`, name: selectedLocation.name, location }];
  if (!saveCamps(next)) { $('#search-status').textContent = '保存できませんでした。ストレージ設定を確認して再試行してください。'; return; }
  dialog.close();
  refreshWeather();
  if (targetId) {
    $('#storage-notice').hidden = false;
    $('#storage-notice').textContent = '登録済みのキャンプ場です。確認した位置を保存し、予報の再取得を開始しました。';
  }
});
setInterval(() => { if (!document.hidden) refreshWeather(); }, 30 * 60 * 1000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && (Date.now() - lastRefreshAt >= 30 * 60 * 1000 || nextWeekend().saturday !== weekend.saturday)) refreshWeather();
});
// 以前の一覧アプリのお気に入り・メモは消さず、新しい保存領域を使用する。
refreshWeather();
