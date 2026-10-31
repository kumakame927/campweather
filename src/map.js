import * as L from '../node_modules/leaflet/dist/leaflet-src.esm.js';

export function createPicker(element, onPick) {
  const initial = [35.55, 139.1];
  const map = L.map(element, { scrollWheelZoom: false }).setView(initial, 8);
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
  }).addTo(map);
  tiles.on('tileerror', () => { document.querySelector('#map-tile-status').textContent = '地図画像を取得できません。通信状態を確認するか、住所検索をご利用ください。'; });
  let marker;
  function setPoint(point) {
    const latlng = L.latLng(point.latitude, point.longitude);
    if (marker) marker.setLatLng(latlng);
    else {
      marker = L.marker(latlng, { draggable: true, autoPan: true,
        title: '登録位置のピン（ドラッグして調整）', alt: '登録位置のピン',
        icon: L.divIcon({ className: 'camp-map-pin', html: '<span aria-hidden="true"></span>', iconSize: [36, 44], iconAnchor: [18, 42] }),
      }).addTo(map);
      marker.on('dragend', () => onPick(map.wrapLatLng(marker.getLatLng())));
    }
  }
  map.on('click', event => { setPoint({ latitude: event.latlng.lat, longitude: event.latlng.lng }); onPick(map.wrapLatLng(event.latlng)); });
  return {
    setPoint,
    setView(point) { map.setView([point.latitude, point.longitude], 16, { animate: false }); },
    invalidateSize() { map.invalidateSize(); },
    reset() { if (marker) { map.removeLayer(marker); marker = null; } map.setView(initial, 8, { animate: false }); },
  };
}
