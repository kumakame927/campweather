import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATALOG_REGIONS, normalizeCampName, searchCatalog, validateCatalog } from '../src/catalog-data.js';
import { buildCatalog, queryForRegion } from '../scripts/update-camp-catalog.mjs';
import { createCatalogService } from '../server/catalog-service.js';
import { catalogHandler } from '../api/camp-catalog.js';
import { INITIAL_CAMPS, STORAGE_KEY, LEGACY_STORAGE_KEY, mapLocation } from '../src/locations.js';
import { restoreLibrary, migrateSelections, persistLibrary, setMembership, forgetCamp, duplicateCamp, COMPARISON_KEY, FAVORITES_KEY } from '../src/library.js';
import { createBackup, applyBackup, validateBackup } from '../src/backup.js';
import { makeTrip } from '../src/schedule.js';
const sample = JSON.parse(readFileSync(new URL('./fixtures/osm-shobugahama.json', import.meta.url), 'utf8'));
const fixtureParts = () => CATALOG_REGIONS.map(([code]) => ({ code, data: { ...sample, elements: code === '09' ? sample.elements : [] } }));
const catalog = buildCatalog(fixtureParts(), new Date());
const store = values => ({ values: new Map(Object.entries(values ?? {})), getItem(key) { return this.values.get(key) ?? null; }, setItem(key, value) { this.values.set(key, value); }, removeItem(key) { this.values.delete(key); } });
const initial = () => restoreLibrary({ version: 2, camps: structuredClone(INITIAL_CAMPS) }, null, null);

test('実際のOSM名「菖蒲ヶ浜キャンプ場」が指定3通りの検索ですべて見つかる', () => {
  for (const query of ['菖蒲ヶ浜キャンプ村', '菖蒲ヶ浜', '菖蒲']) {
    const result = searchCatalog(catalog, query);
    assert.equal(result[0].name, '菖蒲ヶ浜キャンプ場'); assert.equal(result[0].location.osmId, '4105493143');
    assert.equal(result[0].location.latitude, 36.7515948); assert.equal(result[0].location.address, '栃木県日光市中宮祠2485');
  }
});
test('全半角・空白・ひらがな/カタカナ・キャンプ村/場を正規化し部分一致する', () => {
  assert.equal(normalizeCampName('ﾆｺﾆｺ　キャンプ村'), normalizeCampName('にこにこキャンプ場'));
  assert.equal(normalizeCampName('菖蒲ヶ浜 キャンプ村'), normalizeCampName('菖蒲ケ浜キャンプ場'));
  const data = { ...catalog, camps: [{ ...catalog.camps[0], name: 'ニコニコ キャンプ場', aliases: ['Nikoniko Camp Site'] }] };
  assert.equal(searchCatalog(data, 'ﾆｺﾆｺ')[0].name, 'ニコニコ キャンプ場');
  assert.equal(searchCatalog(data, 'にこにこキャンプ村').length, 1);
  assert.equal(searchCatalog(catalog, '存在しない名前').length, 0); assert.equal(searchCatalog(catalog, 'キャンプ場').length, 0);
});
test('取得クエリは10都県のcamp_site/caravan_siteに限定し、対象外・広域取得を拒否する', () => {
  assert.equal(CATALOG_REGIONS.length, 10); assert(queryForRegion('09').includes('JP-09')); assert(queryForRegion('09').includes('camp_site|caravan_site'));
  assert.throws(() => queryForRegion('00')); assert.throws(() => queryForRegion('21'));
});
test('全地域未取得・Overpassの不完全応答を新しい一覧として採用しない', () => {
  assert.throws(() => buildCatalog(fixtureParts().slice(1)), /10都県/);
  const parts = fixtureParts(); parts[0].data.remark = 'runtime error'; assert.throws(() => buildCatalog(parts), /不完全/);
  assert.throws(() => validateCatalog({ ...catalog, license: 'unknown' }));
});
test('私有・座標不明・無名の施設を除き、敷地区域の中心座標は入口と区別する', () => {
  const parts = fixtureParts(), point = sample.elements[0];
  parts[0].data.elements = [{ ...point, id: 111, type: 'way', center: { lat: 36.7, lon: 139.4 } }, { ...point, id: 222, tags: { ...point.tags, access: 'private' } }, { ...point, id: 333, tags: { tourism: 'camp_site' } }];
  const result = buildCatalog(parts);
  assert.equal(result.camps.length, 2); assert.equal(result.camps.find(c => c.location.osmId === '111').location.coordinateType, 'area-center');
});
test('同一OSM施設が複数都県で返ってもID重複を作らず、未記載住所を推測しない', () => {
  const parts = fixtureParts(), point = { ...sample.elements[0], tags: { name: '県境の施設', tourism: 'camp_site' } };
  parts[0].data.elements = [point]; parts[1].data.elements = [point];
  const result = buildCatalog(parts); assert.equal(result.camps.length, 1);
  assert.match(result.camps[0].location.address, /茨城県/); assert.match(result.camps[0].location.address, /栃木県/); assert.match(result.camps[0].location.address, /未記載/);
});
test('カタログサーバーは並行取得を共有し、失敗時も実際の前回一覧と更新日を維持する', async () => {
  let calls = 0, clock = Date.now(), failure = false;
  const service = createCatalogService({ now: () => clock, fetchCatalog: async () => { calls++; if (failure) throw new Error('offline'); return catalog; }, fallback: () => null });
  await Promise.all([service(), service()]); assert.equal(calls, 1); await service(); assert.equal(calls, 1);
  clock += 16 * 60000; failure = true;
  const old = await service(); assert(old.stale); assert.equal(old.catalog.updatedAt, catalog.updatedAt); assert.match(old.notice, /前回/);
});
test('最新一覧がない場合も同梱実データへフォールバックし、両方ないときは0件扱いしない', async () => {
  const available = createCatalogService({ fetchCatalog: async () => { throw new Error(); }, fallback: () => catalog });
  assert.equal((await available()).catalog.camps.length, 1);
  const missing = createCatalogService({ fetchCatalog: async () => { throw new Error(); }, fallback: () => null }); await assert.rejects(missing(), /取得できません/);
});
test('カタログAPIの任意クエリ・POSTは取得せず、提供失敗は503にする', async () => {
  const response = () => ({ statusCode: 0, headers: {}, setHeader(k,v) { this.headers[k]=v; }, end(value) { this.body=JSON.parse(value); } });
  let calls=0;const handler=catalogHandler(async()=>{calls++;throw new Error('unavailable');});
  for(const [method,url,status] of [['POST','/api/camp-catalog',405],['GET','/api/camp-catalog?url=other',400],['GET','/api/camp-catalog',503]]) { const res=response();await handler({method,url},res);assert.equal(res.statusCode,status); }
  assert.equal(calls,1);
});
test('v1/v2の既存施設はすべてお気に入り・比較中として移行し、0件を復活させない', () => {
  for(const records of [INITIAL_CAMPS,{version:2,camps:INITIAL_CAMPS}]) { const state=restoreLibrary(records,null,null);assert.deepEqual(state.comparisonIds,state.camps.map(c=>c.id));assert.deepEqual(state.favoriteIds,state.comparisonIds); }
  assert.deepEqual(restoreLibrary({version:2,camps:[]},null,null),{camps:[],comparisonIds:[],favoriteIds:[]});
});
test('移行は既存キャンプ場の保存内容を一切書き換えず、独立キーだけを追加する', () => {
  const raw=JSON.stringify({version:2,camps:INITIAL_CAMPS,extra:'keep'}),storage=store({[STORAGE_KEY]:raw,[LEGACY_STORAGE_KEY]:'legacy'});
  migrateSelections(initial(),storage); assert.equal(storage.getItem(STORAGE_KEY),raw);assert.equal(storage.getItem(LEGACY_STORAGE_KEY),'legacy');
  assert.equal(JSON.parse(storage.getItem(FAVORITES_KEY)).ids.length,3);assert.equal(JSON.parse(storage.getItem(COMPARISON_KEY)).ids.length,3);
});
test('比較解除とお気に入り解除は互いの状態に影響せず、再読込しても維持する', () => {
  const state=initial(),id=state.camps[0].id;
  state.comparisonIds=setMembership(state.comparisonIds,id,false);assert(state.favoriteIds.includes(id));
  state.favoriteIds=setMembership(state.favoriteIds,state.camps[1].id,false);assert(state.comparisonIds.includes(state.camps[1].id));
  const storage=store();persistLibrary(state,storage);
  const restored=restoreLibrary(JSON.parse(storage.getItem(STORAGE_KEY)),JSON.parse(storage.getItem(COMPARISON_KEY)),JSON.parse(storage.getItem(FAVORITES_KEY)));assert.deepEqual(restored,state);
});
test('比較0件も独立して保持し、完全削除だけが登録・比較・お気に入りの全部から消す', () => {
  const state=initial();state.comparisonIds=[];const storage=store();persistLibrary(state,storage);
  assert.deepEqual(restoreLibrary(JSON.parse(storage.getItem(STORAGE_KEY)),JSON.parse(storage.getItem(COMPARISON_KEY)),JSON.parse(storage.getItem(FAVORITES_KEY))).comparisonIds,[]);
  const next=forgetCamp(state,'fumotoppara');assert.equal(next.camps.length,2);assert(!next.favoriteIds.includes('fumotoppara'));
});
test('重複防止はOSM ID・地図調整前のOSM参照・同一座標を使い、遠方の同名施設は残す', () => {
  const camp=INITIAL_CAMPS[0];assert.equal(duplicateCamp([camp],{...camp,name:'別の表示名'}),camp);
  const adjusted={id:'adjusted',name:'私の名前',osmRef:'node-4105493143',location:mapLocation({latitude:36.7517,longitude:139.451})};
  assert.equal(duplicateCamp([adjusted],{name:'菖蒲ヶ浜キャンプ場',osmRef:'node-4105493143',location:catalog.camps[0].location}),adjusted);
  assert.equal(duplicateCamp([camp],{name:camp.name,location:mapLocation({latitude:34,longitude:137})}),undefined);
});
test('バックアップに独立した両状態を含め、旧バックアップは全件お気に入り・比較中として読める', () => {
  const state=initial();state.comparisonIds=[state.camps[0].id];state.favoriteIds=[state.camps[1].id];
  const backup=createBackup(state.camps,makeTrip('2026-11-07',1),null,state.comparisonIds,state.favoriteIds);const storage=store();applyBackup(backup,storage);
  assert.deepEqual(JSON.parse(storage.getItem(COMPARISON_KEY)).ids,state.comparisonIds);assert.deepEqual(JSON.parse(storage.getItem(FAVORITES_KEY)).ids,state.favoriteIds);
  delete backup.comparison;delete backup.favorites;const old=validateBackup(backup);assert.equal(old.comparison.ids.length,3);assert.equal(old.favorites.ids.length,3);
});
test('不正な選択IDを取り込まず、保存失敗時はキャンプ場・両状態を元に戻す', () => {
  const backup=createBackup(INITIAL_CAMPS,makeTrip('2026-11-07',1));backup.favorites.ids.push('unknown');assert.throws(()=>validateBackup(backup));
  const original={[STORAGE_KEY]:'original camps',[COMPARISON_KEY]:'original comparison',[FAVORITES_KEY]:'original favorites'},storage=store(original),write=storage.setItem.bind(storage);
  storage.setItem=(key,value)=>{if(key===FAVORITES_KEY)throw new Error('quota');write(key,value);};assert.throws(()=>persistLibrary(initial(),storage));
  for(const [key,value] of Object.entries(original))assert.equal(storage.getItem(key),value);
});
