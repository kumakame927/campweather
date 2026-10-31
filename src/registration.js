import { searchLocations, normalizeAddress, locationId, mapLocation } from './locations.js';

const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const coords = point => `緯度 ${point.latitude.toFixed(6)} / 経度 ${point.longitude.toFixed(6)}`;
export function initRegistration({ getCamps, saveCamps, onSaved, locationDetails, apiDetails }) {
  const $ = selector => document.querySelector(selector), dialog = $('#location-dialog');
  const fresh = () => ({ query: '', results: [], selected: null, status: '', error: '', zero: false, generation: 0, controller: null, loading: false });
  let mode = 'name', editingId = null, drafts, mapDraft, picker, pickerPromise, session = 0;
  const draftFor = () => mode === 'map' ? mapDraft.search : drafts[mode];
  const mapKey = () => mapDraft.point ? `${mapDraft.point.latitude.toFixed(6)},${mapDraft.point.longitude.toFixed(6)}` : null;
  const mapConfirmed = () => mapKey() !== null && mapDraft.confirmed === mapKey();
  function abort(draft) { draft.generation++; draft.controller?.abort(); draft.loading = false; }
  function cancelSearches() { if (drafts) Object.values(drafts).forEach(abort); if (mapDraft) abort(mapDraft.search); }
  function selection() {
    if (mode === 'map') return mapConfirmed() ? { name: '地図で指定したキャンプ場', location: mapLocation(mapDraft.point, mapDraft.origin?.location.address) } : null;
    const selected = drafts[mode].selected;
    if (selected && selected === mapDraft.linkedSelection) return mapConfirmed() ? { ...selected, location: mapLocation(mapDraft.point, mapDraft.origin?.location.address) } : null;
    return selected;
  }
  function renderConfirmation() {
    const selected = selection();
    const pending = mode !== 'map' && drafts[mode].selected && drafts[mode].selected === mapDraft.linkedSelection && !mapConfirmed();
    $('#location-confirmation').hidden = !selected && !pending;
    $('#confirm-location').disabled = !selected;
    $('#adjust-on-map').hidden = mode !== 'address' || !drafts.address.selected;
    $('#confirm-location').textContent = editingId ? 'この場所で登録' : 'キャンプ場を登録';
    $('#confirmation-details').innerHTML = pending ? '<p class="confirm-note">地図で調整した位置は未確定です。「地図で位置を調整」から位置を確定してください。</p>' : selected ? `${selected.location.source === 'map-pin' ? '<p class="position-confirmed">登録位置：地図で確定した位置</p>' : ''}${locationDetails(selected.location)}` : '';
  }
  function renderSearch() {
    const isMap = mode === 'map', draft = draftFor(), prefix = isMap ? 'map-' : '';
    $(`#${isMap ? 'map-search' : 'search'}-status`).textContent = draft.status;
    if (!isMap) {
      $('#name-search-help').hidden = !(mode === 'name' && draft.zero && !draft.loading && !draft.error);
      $('#search-error-details').hidden = !draft.error;
      $('#search-error-details pre').textContent = draft.error;
    }
    $(`#${isMap ? 'map-move' : 'search-location'}`).disabled = draft.loading;
    $(`#${isMap ? 'map-move' : 'search-location'}`).textContent = draft.loading ? '検索中…' : isMap ? '移動' : '検索';
    $(`#${isMap ? 'map-search' : 'search'}-results`).innerHTML = draft.results.map((result, index) => `<article class="search-result${draft.selected === result ? ' selected-result' : ''}"><h3>${escape(result.name)}</h3>${isMap ? `<p class="address">${escape(result.location.address)}</p><p class="coordinates">${coords(result.location)}</p>` : locationDetails(result.location)}<button class="button secondary select-location" data-${prefix}select="${index}" type="button" aria-pressed="${draft.selected === result}">${draft.selected === result ? isMap ? '表示中の候補' : '選択中の候補' : isMap ? 'この場所へ移動' : 'この候補を選ぶ'}</button></article>`).join('');
  }
  function renderMapPoint() {
    $('#map-origin').textContent = mapDraft.origin ? `元の検索候補：${mapDraft.origin.location.address}（${coords(mapDraft.origin.location)}）` : '';
    $('#map-position').textContent = mapDraft.point ? `${mapConfirmed() ? '確定した登録位置' : '調整中の位置（未確定）'}：${coords(mapDraft.point)}` : '登録位置は未選択です。地図をタップしてください。';
    $('#confirm-map-position').disabled = !mapDraft.point;
    $('#confirm-map-position').textContent = mapConfirmed() ? 'この位置で確定済み' : 'この位置を確定';
    $('#back-to-address').hidden = !mapDraft.linkedSelection;
  }
  function updatePoint(point) {
    mapDraft.point = { latitude: Number(point.lat.toFixed(6)), longitude: Number(point.lng.toFixed(6)) };
    mapDraft.confirmed = null;
    renderMapPoint(); renderConfirmation();
  }
  async function showMap() {
    const openedSession = session;
    try {
      if (!pickerPromise) pickerPromise = import('./map.js').then(({ createPicker }) => {
        picker = createPicker($('#location-map'), point => { if (dialog.open && mode === 'map') updatePoint(point); });
        return picker;
      }).catch(error => { pickerPromise = null; throw error; });
      await pickerPromise;
      if (session !== openedSession || !dialog.open || mode !== 'map') return;
      picker.invalidateSize();
      if (mapDraft.point) { picker.setPoint(mapDraft.point); picker.setView(mapDraft.point); }
      else picker.reset();
      $('#map-tile-status').textContent = '';
    } catch {
      if (session === openedSession && dialog.open) $('#map-tile-status').textContent = '地図を読み込めませんでした。住所・キャンプ場名検索をご利用ください。';
    }
  }
  function setMode(next, seed = null) {
    const previous = mode;
    if (drafts && previous !== next) {
      const draft = draftFor();
      if (draft.loading) { abort(draft); draft.status = '検索を中止しました。検索ボタンで再試行できます。'; }
    }
    if (next === 'map' && seed && mapDraft.linkedSelection !== seed) {
      mapDraft.origin = seed;
      mapDraft.linkedSelection = seed;
      mapDraft.point = { latitude: seed.location.latitude, longitude: seed.location.longitude };
      mapDraft.confirmed = null;
    }
    mode = next;
    document.querySelectorAll('[data-search-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.searchMode === mode)));
    $('#location-form').hidden = mode === 'map';
    $('#map-panel').hidden = mode !== 'map';
    $('#search-results').hidden = mode === 'map';
    $('#search-status').hidden = mode === 'map';
    $('#search-error-details').hidden = mode === 'map' || !draftFor().error;
    $('#name-search-help').hidden = true;
    $('#address-input-help').hidden = mode !== 'address';
    $('#location-intro').textContent = mode === 'map' ? '検索やタップで位置を調整し、「この位置を確定」のあとにキャンプ場を登録してください。' : '候補の住所と位置を確認して登録します。住所の候補は地図で位置を調整できます。';
    if (mode !== 'map') {
      $('#query-label').textContent = mode === 'address' ? '住所' : 'キャンプ場名';
      $('#location-query').placeholder = mode === 'address' ? '例：静岡県富士宮市麓156' : '例：ふもとっぱら';
      $('#location-query').value = drafts[mode].query;
      $('#location-query').setAttribute('aria-describedby', mode === 'address' ? 'address-input-help' : 'search-status');
    } else $('#map-query').value = mapDraft.search.query;
    renderSearch(); renderMapPoint(); renderConfirmation();
    if (mode === 'map') showMap(); else $('#location-query').focus();
  }
  function choose(result) {
    if (mode === 'map') {
      mapDraft.search.selected = result;
      mapDraft.origin = result;
      updatePoint({ lat: result.location.latitude, lng: result.location.longitude });
      picker?.setPoint(mapDraft.point); picker?.setView(mapDraft.point);
      $('#map-search-status').textContent = '候補付近へ移動しました。タップまたはピンのドラッグで調整し、位置を確定してください。';
      mapDraft.search.status = $('#map-search-status').textContent;
    } else {
      drafts[mode].selected = result;
      if (!$('#registration-name').value.trim()) $('#registration-name').value = editingId ? getCamps().find(camp => camp.id === editingId)?.name ?? result.name : result.name;
    }
    renderSearch(); renderMapPoint(); renderConfirmation();
    if (mode !== 'map') {
      (mode === 'address' ? $('#adjust-on-map') : $('#confirm-location')).focus({ preventScroll: true });
      $('#location-confirmation').scrollIntoView({ block: 'nearest' });
    }
  }
  async function search(isMap) {
    const submittedMode = mode, draft = draftFor(), input = $(isMap ? '#map-query' : '#location-query');
    if (isMap !== (mode === 'map')) return;
    const query = mode === 'name' ? input.value.trim() : normalizeAddress(input.value);
    input.value = query; draft.query = query;
    if (!query) return;
    abort(draft);
    if (submittedMode === 'address') mapDraft.linkedSelection = null;
    draft.controller = new AbortController();
    const generation = draft.generation, currentSession = session;
    draft.results = []; draft.selected = null; draft.zero = false; draft.error = '';
    draft.loading = true; draft.status = '場所を検索しています…';
    renderSearch(); renderConfirmation();
    try {
      const results = await searchLocations(query, draft.controller.signal, { mode: submittedMode === 'name' ? 'name' : 'address' });
      if (session !== currentSession || generation !== draft.generation) return;
      draft.results = results; draft.zero = results.length === 0;
      draft.status = results.length ? `${results.length}件の候補。${results.some(result => result.location.source === 'verified-listing') ? '出典を照合した補足候補を含みます。' : ''}${isMap ? '移動する場所を選んでください。' : '住所と位置を確認して候補を選んでください。'}` : '通信は成功しましたが、一致する検索結果は0件でした。住所・地名や表記を変えて検索してください。';
      if (isMap && results.length === 1 && mode === submittedMode) choose(results[0]);
    } catch (error) {
      if (session !== currentSession || generation !== draft.generation || error.name === 'AbortError') return;
      draft.status = `通信エラーのため検索を完了できませんでした。${error.message}`;
      draft.error = apiDetails(error);
    } finally {
      if (session === currentSession && generation === draft.generation) {
        draft.loading = false;
        if (mode === submittedMode) { renderSearch(); renderConfirmation(); }
      }
    }
  }
  $('#location-form').addEventListener('submit', event => { event.preventDefault(); search(false); });
  $('#map-search-form').addEventListener('submit', event => { event.preventDefault(); search(true); });
  for (const [selector, isMap] of [['#location-query', false], ['#map-query', true]]) {
    $(selector).addEventListener('input', () => {
      if (!drafts) return;
      const draft = isMap ? mapDraft.search : drafts[mode];
      if (!draft || isMap !== (mode === 'map')) return;
      if (!isMap && mode === 'address') mapDraft.linkedSelection = null;
      abort(draft); draft.query = $(selector).value; draft.results = []; draft.selected = null; draft.status = ''; draft.error = ''; draft.zero = false;
      renderSearch(); renderConfirmation();
    });
    $(selector).addEventListener('blur', () => {
      if (!drafts || !isMap && mode !== 'address') return;
      $(selector).value = normalizeAddress($(selector).value);
      (isMap ? mapDraft.search : drafts.address).query = $(selector).value;
    });
  }
  $('#search-results').addEventListener('click', event => {
    const button = event.target.closest('[data-select]');
    if (button && mode !== 'map') { const result = drafts[mode].results[Number(button.dataset.select)]; if (result) choose(result); }
  });
  $('#map-search-results').addEventListener('click', event => {
    const button = event.target.closest('[data-map-select]');
    if (button && mode === 'map') { const result = mapDraft.search.results[Number(button.dataset.mapSelect)]; if (result) choose(result); }
  });
  document.querySelectorAll('[data-search-mode]').forEach(button => button.addEventListener('click', () => {
    const next = button.dataset.searchMode;
    const seed = next === 'map' && mode === 'address' ? drafts.address.selected : null;
    setMode(next, seed);
  }));
  $('#adjust-on-map').addEventListener('click', () => { setMode('map', drafts.address.selected); $('#map-panel').scrollIntoView({ block: 'start' }); });
  $('#back-to-address').addEventListener('click', () => { setMode('address'); $('#location-query').focus(); });
  $('#confirm-map-position').addEventListener('click', () => {
    if (!mapDraft.point) return;
    mapDraft.confirmed = mapKey();
    renderMapPoint(); renderConfirmation();
    $('#location-confirmation').scrollIntoView({ block: 'nearest' });
    $('#registration-name').focus();
  });
  $('#confirm-location').addEventListener('click', () => {
    const selected = selection();
    if (!selected || !$('#registration-name').reportValidity()) return;
    const name = $('#registration-name').value.trim();
    if (!name) return;
    const { location } = selected;
    const duplicate = getCamps().find(camp => camp.id !== editingId && camp.location && locationId(camp.location) === locationId(location));
    if (duplicate && editingId) { $('#registration-save-status').textContent = `この場所は「${duplicate.name}」として登録済みです。`; return; }
    const targetId = editingId ?? duplicate?.id;
    const next = targetId ? getCamps().map(camp => camp.id === targetId ? { ...camp, name, location } : camp) : [...getCamps(), { id: `place-${locationId(location)}`, name, location }];
    if (!saveCamps(next)) { $('#registration-save-status').textContent = '保存できませんでした。ストレージ設定を確認して再試行してください。'; return; }
    dialog.close(); onSaved(targetId);
  });
  $('#close-dialog').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    session++; cancelSearches();
    const origin = editingId ? [...document.querySelectorAll('[data-location]')].find(button => button.dataset.location === editingId) : $('#add-camp');
    origin?.focus();
  });
  return {
    open(id = null) {
      session++; cancelSearches(); editingId = id;
      drafts = { name: fresh(), address: fresh() };
      mapDraft = { search: fresh(), origin: null, point: null, confirmed: null, linkedSelection: null };
      const camp = getCamps().find(camp => camp.id === id);
      drafts.name.query = camp ? camp.searchName ?? camp.name : '';
      $('#registration-name').value = camp?.name ?? '';
      $('#registration-save-status').textContent = '';
      $('#location-title').textContent = id ? 'キャンプ場の場所を確認' : 'キャンプ場を追加';
      dialog.showModal(); mode = 'name'; setMode('name');
    },
  };
}
