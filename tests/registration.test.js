import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAddress, mapLocation, validLocation, restoreCamps } from '../src/locations.js';

test('住所の全角数字・ハイフン・空白と数字間の区切りを正規化する', () => {
  assert.equal(normalizeAddress('　静岡県伊豆市八木沢２９２９－５　'), '静岡県伊豆市八木沢2929-5');
  assert.equal(normalizeAddress('東京都　千代田区１−２–３'), '東京都 千代田区1-2-3');
  assert.equal(normalizeAddress('千葉県君津市折木沢1306'), '千葉県君津市折木沢1306');
});
test('漢数字・長音・地名・互換文字を住所正規化で書き換えない', () => {
  assert.equal(normalizeAddress('一宮市一丁目 コーポ① Ａ館ー北 ２号'), '一宮市一丁目 コーポ① Ａ館ー北 2号');
});
test('地図で確定した座標を独立した位置情報として保存・復元し参考住所と区別する', () => {
  const result = mapLocation({ latitude: 35.21612345, longitude: 140.10798765 }, '千葉県君津市折木沢1306');
  assert.equal(result.latitude, 35.216123); assert.equal(result.longitude, 140.107988);
  assert.equal(result.source, 'map-pin'); assert.equal(result.osmId, undefined);
  assert.match(result.address, /参考住所：千葉県君津市折木沢1306/); assert(validLocation(result));
  const saved = { id: 'custom', name: '調整後の場所', location: result };
  assert.deepEqual(restoreCamps({ version: 2, camps: [saved] }), [saved]);
});
