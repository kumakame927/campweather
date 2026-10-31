import * as L from '../node_modules/leaflet/dist/leaflet-src.esm.js';

export function createPicker(element, onPick) {
  const map = L.map(element, { scrollWheelZoom: false }).setView([35.55, 139.1], 8);
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
  }).addTo(map);
  const hint = document.querySelector('#map-status');
  tiles.on('tileerror', () => { hint.textContent = '地図画像を取得できません。一部の画像が表示されない場合は、施設名・住所検索をご利用ください。'; });
  let marker;
  map.on('click', event => {
    if (marker) marker.setLatLng(event.latlng);
    else marker = L.circleMarker(event.latlng, { radius: 9, color: '#a95327', fillOpacity: 0.8 }).addTo(map);
    onPick(event.latlng);
  });
  return map;
}
