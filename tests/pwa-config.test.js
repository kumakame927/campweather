import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
test('PWAの名称・スタンドアロン・相対scope/start_url・デザイン色が統一される', () => {
  assert.equal(manifest.name, '晴れキャン'); assert.equal(manifest.short_name, '晴れキャン');
  assert.equal(manifest.description, '今週末、晴れるキャンプ場はどこ？'); assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.id, './'); assert.equal(manifest.start_url, './'); assert.equal(manifest.scope, './');
  assert.equal(manifest.theme_color, '#244d40'); assert.equal(manifest.background_color, '#f6f7f4');
  assert.deepEqual(manifest.icons.map(icon => icon.sizes), ['192x192', '512x512']);
});
test('ユーザーに表示する旧名称をなくし、iPhone用の名称・メタ情報を設定する', () => {
  const html = readFileSync('index.html', 'utf8');
  assert.match(html, /apple-mobile-web-app-title" content="晴れキャン/);
  assert.match(html, /apple-touch-icon/); assert.match(html, /rel="manifest"/);
  for (const path of ['index.html', 'src/bootstrap.js', 'src/main.js', 'src/jma.js']) assert(!/Camp Note|CAMP NOTE|Camp Weather|CAMP WEATHER/.test(readFileSync(path, 'utf8')), path);
});
