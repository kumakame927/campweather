# 晴れキャン：ホーム画面追加とデータ移行

キャッチコピー：**今週末、晴れるキャンプ場はどこ？**

## ホーム画面に追加する

本番URL：<https://campweather.vercel.app/>。リポジトリ名とVercelのURLは変更しない。

### iPhone

1. Safariで本番URLを開く。
2. 共有メニューから「ホーム画面に追加」を選ぶ。
3. 「Webアプリとして開く」が表示される場合はオンにし、名前が「晴れキャン」になっていることを確認して「追加」。
4. ホーム画面のアイコンから起動する。

### Android

1. Chromeで本番URLを開く。
2. 右上のメニューから「アプリをインストール」または「ホーム画面に追加」を選ぶ。
3. 表示された確認画面で「インストール」または「追加」を選ぶ。

端末やブラウザのバージョンによってメニューの位置・表記は異なる。iPhoneは追加済みアイコンの画像を端末内に保持する場合がある。画像URLのバージョンも更新するが、古い画像が残るときは、先に現在のホーム画面版からデータを書き出し、その後アイコンを削除してSafariから追加し直す。新しいホーム画面版で登録内容が見えない場合は、書き出したJSONを取り込む。

## 登録データを引き継ぐ

通常ブラウザとホーム画面版のlocalStorageが分かれる場合がある。名称変更では保存キーを変更せず、同じ保存領域では登録情報をそのまま使う。

1. 元のSafari／Chrome／旧ホーム画面版で、画面下の「ホーム画面追加・データの引き継ぎ」を開く。
2. 「データを書き出す」でJSONファイルを「ファイル」等へ保存する。
3. 移行先のホーム画面版で同じ欄を開き、保存したJSONを選ぶ。
4. キャンプ場数・日程を確認し、「上書きして取り込む」を押す。

取り込み前のキャンセルはデータを変更しない。取り込みは現在のキャンプ場と日程を置き換えるので、必要に応じて移行先も先に書き出す。バックアップに出発地点が含まれる場合だけ、その設定も取り込む。

- キャンプ場：既存の `camp-weather-camps-v2`（version 2）を維持。初期施設の削除や0件も保持する。旧v1キーや検索キャッシュを削除しない。
- 日程：既存の `camp-weather-trip-v1` を維持。過去の有効な日程も保存し、予報範囲の案内は既存の画面で行う。
- 別ブランチの保存出発地：存在する場合は既存の `camp-note-departure-v1` のまま移せる。アクセス比較機能そのものは今回mainへ入れない。
- 予報・経路の結果や検索キャッシュはバックアップに含めない。取り込み後は予報を取得し直す。
- JSONのみ、1MB以下・500施設まで。形式・バージョン・座標・識別子・位置情報の出典・日程・重複IDを検証し、任意の保存キーは取り込まない。
- 書き込み失敗時は元の値へ戻す。ストレージ自体が使えず復元も失敗した場合は、その旨を表示する。
- ファイルはブラウザ内だけで処理し、外部サーバーへ送らない。

## PWA構成とオンライン利用

`public/manifest.webmanifest` のname/short_nameは「晴れキャン」、displayはstandalone。id/start_url/scopeはmanifestと同じ場所の `./` とし、Vercelのルートとサブディレクトリの両方に対応する。色は既存の緑 `#244d40` と背景 `#f6f7f4`。

**今回はService Workerを登録しない。** ChromeのメニューからのインストールはAndroid Chrome 108以降でfetchハンドラーの条件が外れており、iPhoneのホーム画面追加にもService Workerは必須ではない。オンライン利用という要件に合わせ、予報やアプリファイルをCache Storageへ保存する機能は加えない。

Open-Meteoの取得は `cache: no-store` でブラウザキャッシュを使わない。気象庁の官署単位のサーバーキャッシュと、発表日時・実際のデータ取得日時は維持する。端末がオフラインになったら「表示中の予報はデータ取得日時時点」「最新の天気予報は取得できない」と画面上部に表示する。再接続時はOpen-Meteoを更新する。オフライン起動時の画面はブラウザの挙動に従い、オフラインで最新予報が使えるとは案内しない。

根拠：

- [Chrome：インストール条件の更新](https://developer.chrome.com/blog/update-install-criteria)
- [MDN：PWAをインストール可能にする](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)

## アイコン

`public/harecamp-icon-source.png` は、提供デザインの太陽・緑の山・湖・黄色いテントと配色・構図を維持し、背景を四辺・四隅まで補完した正方形のマスター画像。旧画像には白い外周と角丸が含まれていたため、余白・白い枠・画像自体の角丸を除去した。iOSによる角丸処理に任せ、PNGは透明部分のない正方形とする。

- `public/icons/icon-192.png`：192×192
- `public/icons/icon-512.png`：512×512
- `public/icons/apple-touch-icon.png`：180×180、透過なし
- `public/icons/favicon-32.png`：32×32

変換処理はマスターを直接リサイズし、白いキャンバス・余白・角丸マスクを追加しない。Manifestのpurposeはany。maskable画像は今回は追加しない。アイコン再生成は `python scripts/build-icons.py` または `npm run icons:build`（Pillowが必要）。通常のVercelビルドは生成済みPNGを配信するだけで、Pythonや画像ライブラリを追加導入しない。

## 確認方法

- `npm test`：既存34項目、バックアップ8項目、名称・PWA設定2項目。
- `npm run test:icons`：マスターと指定4サイズのPNG形式・寸法・不透明度・四隅と四辺に白い枠がないことを確認（Pillow使用）。
- `npm run test:pwa`：ビルド済みプレビューでChromium／WebKitの名称・Manifest・アイコン配信・キャッシュなし・オフライン案内・データ移行・保存・画面幅を確認。
- `npm run test:install`：一時的な通常プロファイルのAndroid Chrome相当で、DevTools Protocolのインストール条件エラーが0件であることを確認。
- 既存の登録操作・日程・気象庁・レイアウトテスト、および `node tests/registration-live.js` の実API操作確認も行う。

ブラウザテストにはビルドとプレビューの起動が必要。`CAMP_PREVIEW_URL`、`CHROMIUM_EXECUTABLE_PATH`、`WEBKIT_EXECUTABLE_PATH`で環境を指定できる。WebKitはiPhone Safari相当のWeb表示を検証するもので、実機OSのホーム画面追加メニューそのものを自動操作するものではない。
