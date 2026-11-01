import { comfortMetrics, comfortComment, hourTimes } from './hourly.js';
import { clothingAdvice } from './clothing-advice.js';
import { dateLabel } from './schedule.js';
import { forecastDays, weatherLabel, weatherSymbol } from './weather.js';
import { japanTimestamp } from './jma.js';

const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const value = number => typeof number === 'number' && Number.isFinite(number) ? String(Math.round(number * 10) / 10) : '--';
export function renderClothingAdvice(forecast, trip) {
  const advice = clothingAdvice(forecast, trip);
  const reading = number => String(Math.round(number * 100) / 100);
  const phase = (name, data, night) => `<div class="clothing-block" data-clothing-period="${night ? 'night' : 'day'}"><h4>${name}</h4>${data.state === 'not-applicable' ? '' : `<p class="clothing-reading">${dateLabel(trip.startDate)} ${night ? `18:00〜${dateLabel(trip.dates[1])} 09:00` : '12:00〜16:00'}</p>`}${data.state === 'ready' ? `<p class="clothing-reading">体感温度（${night ? '最低' : '平均'}）${reading(data.apparent)}℃ / 実気温（最低）${reading(data.actual)}℃</p><p class="clothing-recommendation"><strong>${escape(data.outfit)}がおすすめです。</strong>${data.message}</p>${data.corrected ? '<p class="clothing-reading">実気温が体感温度より低いため、寒い側の服装を目安にしています。</p>' : ''}` : `<p class="clothing-recommendation">${data.message}</p>`}</div>`;
  return `<section class="equipment-advice" aria-labelledby="detail-advice-heading"><h3 id="detail-advice-heading">服装・装備の目安</h3>${trip.nights === 2 ? '<p class="detail-note">服装は開始日の日中と最初の夜を対象にしています。以降の日も時間別予報を確認してください。</p>' : ''}${phase('日中のおすすめ服装', advice.day, false)}${phase('夜間〜早朝のおすすめ服装', advice.night, true)}<div class="clothing-block"><h4>追加の装備・注意事項</h4><ul>${advice.extras.map(item => `<li data-advice-kind="${item.kind}">${escape(item.text)}</li>`).join('')}</ul></div><p class="detail-note">キャンプ向けの暫定基準による一般的な目安です。寒さの感じ方には個人差があります。体感温度はテント内の気温や寝袋の快適温度ではありません。寝具内の温度や焚き火の暖房効果は判定に含めていません。</p></section>`;
}
export function renderComfortSummary(forecast, trip) {
  const metrics = comfortMetrics(forecast?.hourly, trip);
  return `<div class="comfort-summary"><p class="comfort-temperatures">日中最高 <strong>${value(metrics.dayHigh)}℃</strong> / 夜間最低 <strong>${value(metrics.nightLow)}℃</strong></p><p class="comfort-extras"><span>寒暖差 <strong>${value(metrics.range)}℃</strong></span><span>最低体感 <strong>${value(metrics.minApparent)}℃</strong></span></p><p class="comfort-comment">${comfortComment(metrics)}</p></div>`;
}
function temperatureChart(hours) {
  const all = hours.flatMap(hour => [hour.temperature, hour.apparent]).filter(number => typeof number === 'number' && Number.isFinite(number));
  if (!all.length) return '<p class="detail-note">気温・体感温度の時間別データがありません。</p>';
  const low = Math.floor((Math.min(...all) - 2) / 5) * 5, high = Math.max(low + 10, Math.ceil((Math.max(...all) + 2) / 5) * 5);
  const left = 40, top = 15, width = 350, height = 160;
  const x = index => left + index / Math.max(1, hours.length - 1) * width;
  const y = number => top + (high - number) / (high - low) * height;
  const path = field => {
    let connected = false;
    return hours.map((hour, index) => {
      if (typeof hour[field] !== 'number' || !Number.isFinite(hour[field])) { connected = false; return ''; }
      const segment = `${connected ? 'L' : 'M'}${x(index).toFixed(2)},${y(hour[field]).toFixed(2)}`;
      connected = true; return segment;
    }).join(' ');
  };
  const ticks = Array.from({ length: 5 }, (_, index) => low + (high - low) * index / 4);
  const grid = ticks.map(tick => `<line x1="${left}" x2="${left + width}" y1="${y(tick)}" y2="${y(tick)}" stroke="#dce3dc"/><text x="${left - 6}" y="${y(tick) + 4}" text-anchor="end">${value(tick)}</text>`).join('');
  const labels = hours.flatMap((hour, index) => index % 24 === 0 || index === hours.length - 1 ? [`<text x="${x(index)}" y="200" text-anchor="${index === 0 ? 'start' : index === hours.length - 1 ? 'end' : 'middle'}">${Number(hour.time.slice(5, 7))}/${Number(hour.time.slice(8, 10))} ${hour.time.slice(11, 13)}時</text>`] : []).join('');
  return `<figure class="temperature-chart"><figcaption>全日程の気温・体感温度（℃・日本時間）</figcaption><div class="chart-legend"><span class="legend-temperature">気温 ━</span><span class="legend-apparent">体感温度 ┄</span></div><svg viewBox="0 0 400 214" role="img" aria-labelledby="temperature-chart-title temperature-chart-desc"><title id="temperature-chart-title">気温と体感温度の推移</title><desc id="temperature-chart-desc">緑の実線は気温、茶色の破線は体感温度。欠測部分の線はつなぎません。各時刻の数値は下の時間別予報で確認できます。</desc>${grid}${labels}<path d="${path('temperature')}" fill="none" stroke="#244d40" stroke-width="2.5"/><path d="${path('apparent')}" fill="none" stroke="#a95327" stroke-width="2.5" stroke-dasharray="6 4"/>${hours.flatMap((hour, index) => ['temperature', 'apparent'].filter(field => typeof hour[field] === 'number' && Number.isFinite(hour[field])).map(field => `<circle cx="${x(index)}" cy="${y(hour[field])}" r="1.8" fill="${field === 'temperature' ? '#244d40' : '#a95327'}"/>`)).join('')}</svg></figure>`;
}
function hourlyTable(hourly, date) {
  const byTime = new Map((hourly?.hours ?? []).map(hour => [hour.time, hour]));
  const rows = hourTimes([date]).map(time => {
    const hour = byTime.get(time);
    return `<tr><th scope="row">${time.slice(11)}<span class="hour-weather" aria-label="${escape(weatherLabel(hour?.code))}">${weatherSymbol(hour?.code)}</span></th><td>${value(hour?.temperature)}</td><td>${value(hour?.apparent)}</td><td>${value(hour?.rain)}</td><td>${value(hour?.wind)}</td><td>${value(hour?.humidity)}</td></tr>`;
  }).join('');
  return `<table class="hourly-table"><caption>${dateLabel(date)}の時間別予報（日本時間）</caption><thead><tr><th scope="col">時刻</th><th scope="col">気温<br>℃</th><th scope="col">体感<br>℃</th><th scope="col">降水<br>確率 %</th><th scope="col">風速<br>m/s</th><th scope="col">湿度<br>%</th></tr></thead><tbody>${rows}</tbody></table>`;
}
export function initWeatherDetails({ getDetail }) {
  const dialog = document.querySelector('#weather-details-dialog'), body = document.querySelector('#weather-details-body');
  let campId = null, selectedDay = null, originScroll, lastResult, lastPeriod, lastName, lastError;
  function render(model) {
    const { camp, result, trip, rangeError } = model, forecast = result?.data, days = forecastDays(forecast);
    if (!trip.dates.includes(selectedDay)) selectedDay = trip.dates[0];
    document.querySelector('#weather-details-title').textContent = camp.name;
    document.querySelector('#weather-details-period').textContent = `${trip.dates.map(dateLabel).join(' / ')} · 日本時間`;
    const metrics = comfortMetrics(forecast?.hourly, trip);
    const loading = !rangeError && (!result || result.state === 'loading');
    const message = rangeError || (loading ? '予報を取得しています…' : result?.state === 'error' ? `予報を取得できませんでした。${result.error}` : forecast?.hourly?.message ?? '時間別予報を取得できません。');
    const metric = (label, number, note) => `<div><dt>${label}<small>${note}</small></dt><dd>${value(number)}<small> ℃</small></dd></div>`;
    body.innerHTML = `<p class="detail-source">Open-Meteo（主予報）${result?.receivedAt && result.state === 'ready' ? ` · データ取得日時：${japanTimestamp(result.receivedAt)}` : ''}</p><div class="detail-weather-overview">${trip.dates.map((date, index) => `<p><strong>${dateLabel(date)}</strong><span>${weatherSymbol(days[index]?.code)} ${weatherLabel(days[index]?.code)}</span><small>日別最高 ${value(days[index]?.high)}℃ / 最低 ${value(days[index]?.low)}℃</small></p>`).join('')}</div><p class="detail-final-rain">${trip.nights ? '撤収日' : '当日'}（${dateLabel(trip.endDate)}）の降水確率：<strong>${value(days.at(-1)?.rain)}%</strong><small>日別最大・おすすめ順位の基準</small></p><section aria-labelledby="detail-comfort-heading"><h3 id="detail-comfort-heading">気温・体感温度と寒暖差</h3><dl class="detail-metrics">${metric('日中の最高気温', metrics.dayHigh, `${dateLabel(metrics.start)} 12:00〜16:00`)}${metric('夜間の最低気温', metrics.nightLow, metrics.overnight ? `${dateLabel(metrics.start)} 18:00〜${dateLabel(trip.dates[1])} 09:00` : '日帰りのため対象外')}${metric('最低体感温度', metrics.minApparent, metrics.overnight ? '上記の夜間・Open-Meteoの予報値' : '日帰りのため対象外')}${metric('日中と夜間の寒暖差', metrics.range, '上記の日中最高 − 夜間最低')}${metric('最終日の日内寒暖差', metrics.finalRange, `${dateLabel(metrics.final)} 00:00〜23:00`)}</dl><p class="detail-note">${trip.nights === 2 ? '2泊3日では開始日の日中と最初の夜を集計しています。' : ''}集計は各時間帯の毎正時の値を使い、両端の時刻を含みます。必要な時刻が1つでも不足する項目は「--」です。</p></section>${message ? `<p class="detail-data-notice" role="status">${escape(message)}</p>` : ''}<section aria-labelledby="detail-hourly-heading"><h3 id="detail-hourly-heading">時間別予報</h3>${temperatureChart(forecast?.hourly?.hours ?? [])}<div class="hour-day-switch" role="group" aria-label="時間別予報の日付">${trip.dates.map(date => `<button type="button" data-hour-day="${date}" aria-pressed="${date === selectedDay}">${dateLabel(date)}</button>`).join('')}</div><div id="detail-hourly-table">${hourlyTable(forecast?.hourly, selectedDay)}</div></section>${renderClothingAdvice(forecast, trip)}`;
    lastResult = result; lastPeriod = trip.dates.join(','); lastName = camp.name; lastError = rangeError;
  }
  function sync() {
    if (!dialog.open || !campId) return;
    const model = getDetail(campId);
    if (!model?.camp) { dialog.close(); return; }
    if (lastResult !== model.result || lastPeriod !== model.trip.dates.join(',') || lastName !== model.camp.name || lastError !== model.rangeError) {
      const scroll = dialog.scrollTop;
      const focusedDay = body.contains(document.activeElement) ? document.activeElement.dataset.hourDay : null;
      render(model);
      if (focusedDay) (body.querySelector(`[data-hour-day="${focusedDay}"]`) ?? document.querySelector('#close-weather-details')).focus({ preventScroll: true });
      dialog.scrollTop = scroll;
    }
  }
  function open(id) {
    const model = getDetail(id); if (!model?.camp || dialog.open) return;
    campId = id; selectedDay = model.trip.dates[0]; originScroll = { left: window.scrollX, top: window.scrollY };
    render(model); dialog.showModal(); dialog.scrollTop = 0;
    document.querySelector('#close-weather-details').focus({ preventScroll: true });
  }
  document.querySelector('#close-weather-details').addEventListener('click', () => dialog.close());
  const outside = event => { const box = dialog.getBoundingClientRect(); return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom; };
  let pointerOutside = false;
  dialog.addEventListener('pointerdown', event => { pointerOutside = event.target === dialog && outside(event); });
  dialog.addEventListener('click', event => { if (pointerOutside && event.target === dialog && outside(event)) dialog.close(); pointerOutside = false; });
  dialog.addEventListener('close', () => {
    const id = campId; campId = null;
    const trigger = [...document.querySelectorAll('[data-weather-details]')].find(button => button.dataset.weatherDetails === id);
    (trigger ?? document.querySelector('#add-camp')).focus({ preventScroll: true });
    if (originScroll) window.scrollTo({ ...originScroll, behavior: 'instant' });
  });
  body.addEventListener('click', event => {
    const button = event.target.closest('[data-hour-day]');
    if (!button) return;
    const model = getDetail(campId);
    if (!model?.trip.dates.includes(button.dataset.hourDay)) return;
    selectedDay = button.dataset.hourDay;
    body.querySelectorAll('[data-hour-day]').forEach(control => control.setAttribute('aria-pressed', String(control.dataset.hourDay === selectedDay)));
    document.querySelector('#detail-hourly-table').innerHTML = hourlyTable(model.result?.data?.hourly, selectedDay);
  });
  return { open, sync };
}
