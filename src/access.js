import { searchLocations, loadLocal, persist } from './locations.js';
import { comparable, forecastDays } from './weather.js';

const DEPARTURE_KEY = 'camp-note-departure-v1';
const pointValid = value => value && typeof value.latitude === 'number' && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90 && typeof value.longitude === 'number' && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180;
export function restoredDeparture(value) {
  return pointValid(value) && typeof value.name === 'string' && value.name.trim() && value.name.length <= 300 ? value : null;
}
export function sortedAccess(camps, routes, forecast, order) {
  const rain = camp => { const data = forecast(camp.id); return comparable(data) ? forecastDays(data).at(-1).rain : Infinity; };
  const seconds = camp => routes.get(camp.id)?.available ? routes.get(camp.id).durationSeconds : Infinity;
  const difference = (a, b) => a === b ? 0 : a < b ? -1 : 1;
  return [...camps].sort((a, b) => order === 'rain' ? difference(rain(a), rain(b)) || difference(seconds(a), seconds(b)) || a.name.localeCompare(b.name, 'ja') : difference(seconds(a), seconds(b)) || difference(rain(a), rain(b)) || a.name.localeCompare(b.name, 'ja'));
}
export function durationLabel(seconds) {
  const minutes = Math.ceil(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}時間${minutes % 60 ? `${minutes % 60}分` : ''}` : `${minutes}分`;
}
const escape = text => String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
export function initAccess({ getCamps, getForecast, getTrip }) {
  const $ = selector => document.querySelector(selector);
  let saved = restoredDeparture(loadLocal(DEPARTURE_KEY, null));
  let origin = saved;
  let mode = 'DRIVE';
  let results = new Map();
  let compared = false;
  let controller;
  let generation = 0;
  let busy = false;
  let signature = '';
  let initializedTime = false;
  let autoTimer;
  let activeTab = 'weather';
  let requestContext = '';
  let selectedSetting = null;
  const endpoint = () => new URL('./api/routes', document.baseURI);
  const finalRain = camp => { const data = getForecast(camp.id); return comparable(data) ? `${forecastDays(data).at(-1).rain}%` : '未取得'; };
  const updateSavedLabel = () => {
    $('#saved-departure').textContent = saved ? `${saved.name}（${saved.latitude.toFixed(5)}, ${saved.longitude.toFixed(5)}）` : '出発地点は未保存です。住所・駅名・地名から検索して保存できます。';
  };
  function showOrigin() {
    $('#selected-origin').textContent = origin ? `${origin.name} ／ ${origin.latitude.toFixed(5)}, ${origin.longitude.toFixed(5)}` : '出発地点を選択してください。';
  }
  function draw() {
    const camps = sortedAccess(getCamps(), results, getForecast, $('#access-sort').value);
    $('#access-empty').hidden = camps.length !== 0;
    $('#access-results').innerHTML = camps.map(camp => {
      const route = results.get(camp.id);
      return `<article class="access-card"><h3>${escape(camp.name)}</h3><dl><div><dt>所要時間</dt><dd>${route?.available ? escape(durationLabel(route.durationSeconds)) : route ? '取得不可' : '未取得'}</dd></div><div><dt>移動距離</dt><dd>${route?.available && route.distanceMeters !== null ? `${(route.distanceMeters / 1000).toFixed(1)} km` : route ? '取得不可' : '未取得'}</dd></div><div><dt>${getTrip().nights ? '撤収日' : '当日'}の降水確率 <small>Open-Meteo</small></dt><dd>${finalRain(camp)}</dd></div></dl>${route && !route.available ? `<p class="access-reason">${escape(route.reason)}</p>` : ''}${mode === 'TRANSIT' ? '<p class="access-reason">乗換・徒歩区間・最寄駅の詳細はこの比較APIでは未取得です。</p>' : ''}</article>`;
    }).join('');
    $('#route-compare').disabled = busy || !origin || camps.length === 0;
    $('#route-compare').textContent = busy ? '比較中…' : '所要時間と距離を比較';
    $('#transit-time-field').hidden = mode !== 'TRANSIT';
    $('#google-attribution').hidden = ![...results.values()].some(route => route.available);
  }
  function invalidate(message = '') {
    clearTimeout(autoTimer);
    generation++; controller?.abort(); busy = false; results = new Map();
    $('#access-context').textContent = '';
    if (message) $('#route-status').textContent = message;
    draw();
  }
  async function availability() {
    try {
      const response = await fetch(endpoint(), { headers: { Accept: 'application/json' } });
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error();
      const status = await response.json();
      $('#route-setup-status').textContent = status.enabled ? '経路APIの設定済みです。比較操作で取得を開始します。' : '経路情報を取得できません。利用できる経路APIが未設定です。天気比較と出発地点の保存は利用できます。';
    } catch { $('#route-setup-status').textContent = '経路情報を取得できません。経路比較用サーバーに接続できません。架空の時間・距離は表示しません。'; }
  }
  async function compare() {
    clearTimeout(autoTimer);
    if (!origin || !pointValid(origin) || !getCamps().length) return;
    compared = true;
    const time = $('#transit-departure').value;
    let departureTime;
    if (mode === 'TRANSIT') {
      if (!time || !Number.isFinite(Date.parse(`${time}+09:00`))) { $('#route-status').textContent = '公共交通の出発日時（日本時間）を指定してください。'; return; }
      departureTime = new Date(`${time}+09:00`).toISOString();
    }
    invalidate();
    controller = new AbortController();
    const requestController = controller;
    const signal = requestController.signal;
    const current = generation;
    busy = true;
    const destinations = getCamps().map(camp => ({ id: camp.id, latitude: camp.location?.latitude, longitude: camp.location?.longitude }));
    requestContext = `${origin.name}から ／ ${mode === 'DRIVE' ? '車（渋滞を考慮しない）' : `公共交通・${time.replace('T', ' ')} JST 出発`}`;
    $('#route-status').textContent = `${destinations.length}施設への経路を取得中…`;
    draw();
    try {
      for (let index = 0; index < destinations.length; index += 100) {
        const batch = destinations.slice(index, index + 100);
        const timeout = setTimeout(() => requestController.abort(), 25000);
        let response;
        try { response = await fetch(endpoint(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ origin: { latitude: origin.latitude, longitude: origin.longitude }, mode, ...(departureTime ? { departureTime } : {}), destinations: batch }), signal }); }
        finally { clearTimeout(timeout); }
        if (current !== generation) return;
        if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('経路APIに接続できません。Vercelの設定をご確認ください。');
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || `経路APIがHTTP ${response.status}を返しました。`);
        if (!Array.isArray(body.routes)) throw new Error('経路APIの結果を読み取れませんでした。');
        for (const item of body.routes) {
          if (typeof item.id !== 'string' || !batch.some(camp => camp.id === item.id)) continue;
          if (item.available && (typeof item.durationSeconds !== 'number' || !Number.isFinite(item.durationSeconds) || item.durationSeconds < 0 || (item.distanceMeters !== null && (typeof item.distanceMeters !== 'number' || !Number.isFinite(item.distanceMeters) || item.distanceMeters < 0)))) continue;
          results.set(item.id, item);
        }
      }
      if (current !== generation) return;
      for (const destination of destinations) if (!results.has(destination.id)) results.set(destination.id, { available: false, reason: '経路の応答がありませんでした。' });
      $('#route-status').textContent = `${[...results.values()].filter(item => item.available).length} / ${destinations.length}施設の経路を取得しました。`;
      $('#access-context').textContent = requestContext;
    } catch (error) {
      if (current !== generation) return;
      const reason = error.name === 'AbortError' ? '経路の取得がタイムアウトしました。再試行してください。' : error.message;
      for (const destination of destinations) if (!results.has(destination.id)) results.set(destination.id, { available: false, reason });
      $('#route-status').textContent = reason;
    } finally { if (current === generation) { busy = false; draw(); } }
  }
  $('#route-compare').addEventListener('click', compare);
  $('#travel-mode').addEventListener('change', () => {
    mode = $('#travel-mode').value;
    invalidate('移動手段を変更しました。');
    if (compared && origin) autoTimer = setTimeout(compare, 600);
  });
  $('#transit-departure').addEventListener('change', () => invalidate('出発日時を変更しました。比較ボタンで更新してください。'));
  $('#access-sort').addEventListener('change', draw);
  $('#origin-source').addEventListener('change', () => {
    const source = $('#origin-source').value;
    origin = source === 'saved' ? saved : null;
    $('#current-origin-button').hidden = source !== 'current';
    $('#origin-search-panel').hidden = source !== 'search';
    invalidate('出発地点を変更しました。比較ボタンで更新してください。'); showOrigin();
  });
  $('#current-origin-button').addEventListener('click', () => {
    if (!navigator.geolocation) { $('#origin-status').textContent = 'このブラウザでは現在地を取得できません。'; return; }
    origin = null; invalidate(); showOrigin();
    $('#origin-status').textContent = 'ブラウザの位置情報の許可を確認しています…';
    navigator.geolocation.getCurrentPosition(position => {
      if ($('#origin-source').value !== 'current') return;
      origin = { name: '現在地', latitude: position.coords.latitude, longitude: position.coords.longitude };
      $('#origin-status').textContent = '現在地を選択しました。比較ボタンで経路APIに送信します。';
      invalidate(); showOrigin();
    }, error => { $('#origin-status').textContent = error.code === 1 ? '位置情報が許可されませんでした。住所・駅名検索をご利用ください。' : '現在地を取得できませんでした。住所・駅名検索をご利用ください。'; }, { timeout: 10000, maximumAge: 60000, enableHighAccuracy: false });
  });
  function searchBox(prefix, onSelect) {
    let request;
    let counter = 0;
    const input = $(`#${prefix}-query`), list = $(`#${prefix}-results`), status = prefix === 'origin' ? $('#origin-search-status') : $(`#${prefix}-status`), button = $(`#${prefix}-submit`);
    input.addEventListener('input', () => { counter++; request?.abort(); list.replaceChildren(); status.textContent = ''; button.disabled = false; if (prefix === 'departure') { selectedSetting = null; $('#save-departure').disabled = true; } });
    $(`#${prefix}-form`).addEventListener('submit', async event => {
      event.preventDefault(); if (!input.value.trim()) return;
      request?.abort(); request = new AbortController(); const current = ++counter;
      button.disabled = true; list.replaceChildren(); status.textContent = '地点を検索中…';
      try {
        const results = await searchLocations(input.value, request.signal, { mode: 'address' });
        if (counter !== current) return;
        status.textContent = results.length ? `${results.length}件の候補。住所・座標を確認して選んでください。` : '通信は成功しましたが、候補は0件でした。';
        for (const place of results) {
          const card = document.createElement('div'); card.className = 'origin-result';
          const text = document.createElement('p'); text.textContent = `${place.name} ／ ${place.location.address}（${place.location.latitude.toFixed(5)}, ${place.location.longitude.toFixed(5)}）`;
          const select = document.createElement('button'); select.type = 'button'; select.className = 'button secondary'; select.textContent = 'この地点を選ぶ';
          select.addEventListener('click', () => onSelect({ name: place.name, latitude: place.location.latitude, longitude: place.location.longitude }));
          card.append(text, select); list.append(card);
        }
      } catch (error) { if (counter === current && error.name !== 'AbortError') status.textContent = `通信エラー：${error.message}`; }
      finally { if (counter === current) button.disabled = false; }
    });
  }
  searchBox('origin', value => { origin = value; invalidate(); showOrigin(); $('#origin-status').textContent = '出発地点を選択しました。'; });
  searchBox('departure', value => { selectedSetting = value; $('#departure-name').value = value.name; $('#save-departure').disabled = false; $('#departure-selection').textContent = `選択地点：${value.name}（${value.latitude.toFixed(5)}, ${value.longitude.toFixed(5)}）`; });
  $('#save-departure').addEventListener('click', () => {
    if (!selectedSetting) return;
    const name = $('#departure-name').value.trim();
    if (!name || name.length > 300) { $('#departure-name').reportValidity(); return; }
    const value = { ...selectedSetting, name };
    if (!persist(DEPARTURE_KEY, value)) { $('#departure-status').textContent = '出発地点を保存できません。ストレージ設定をご確認ください。'; return; }
    saved = value; updateSavedLabel(); $('#departure-status').textContent = '出発地点を保存しました。';
    if ($('#origin-source').value === 'saved') { origin = saved; invalidate(); showOrigin(); }
  });
  $('#remove-departure').addEventListener('click', () => {
    if (!confirm('保存した出発地点を削除しますか？')) return;
    if (!persist(DEPARTURE_KEY, null)) { $('#departure-status').textContent = '削除を保存できませんでした。'; return; }
    saved = null; updateSavedLabel(); if ($('#origin-source').value === 'saved') { origin = null; invalidate(); showOrigin(); }
  });
  function selectTab(tab) {
    activeTab = tab;
    document.querySelectorAll('[data-app-tab]').forEach(button => { const active = button.dataset.appTab === tab; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; });
    for (const name of ['weather', 'access', 'settings']) $(`#panel-${name}`).hidden = name !== tab;
    if (tab === 'access') {
      if (!initializedTime) { $('#transit-departure').value = `${getTrip().startDate}T08:00`; initializedTime = true; }
      availability(); draw();
    }
  }
  const tabs = [...document.querySelectorAll('[data-app-tab]')];
  tabs.forEach((button, index) => {
    button.addEventListener('click', () => selectTab(button.dataset.appTab));
    button.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) { event.preventDefault(); tabs[next].focus(); selectTab(tabs[next].dataset.appTab); }
    });
  });
  updateSavedLabel(); showOrigin();
  return { sync() {
    const next = JSON.stringify(getCamps().map(camp => [camp.id, camp.location?.latitude, camp.location?.longitude]));
    if (signature && signature !== next) invalidate('比較するキャンプ場が変わりました。比較ボタンで更新してください。');
    signature = next;
    if (activeTab === 'access') draw();
  } };
}
