# アクセス比較：過去のGoogle案（現在は採用保留）

> 最新方針：Google Cloudの無料トライアル・課金設定は行いません。以下のGoogle設定手順は過去案の記録であり、実施指示ではありません。現行の調査結果は [FREE-ROUTING.md](FREE-ROUTING.md) を参照してください。

確認日：2026-10-31（日本時間）。**Google Cloudの課金有効化・有料APIへの実リクエスト・Redisの新規作成は行っていません。**

## 反映状態

- `main`：スマートフォンの日程入力修正のみ先行反映（`6f005da`）。WebKit/Chromiumで320・375・390・414・600・1024pxを検証済み。
- `feat/access-comparison`：アクセス比較を準備中。UI・サーバー処理・テストは用意したが、Google/Redisの実サービス確認前なのでmainには入れない。
- 天気・撤収日を優先する順位・日程・施設の追加削除・保存・OSM登録地図は維持する。

## APIの比較と採用案

| 候補 | 車 | 公共交通 | 判断 |
| --- | --- | --- | --- |
| Google Routes Compute Route Matrix | 対応 | `TRANSIT`で電車・バス・徒歩を含む経路に対応 | 今回の第一候補。時刻・地域・施設によって経路が存在しない可能性はある。日本の対象施設での実データは承認後に確認 |
| OSRM | 車・自転車・徒歩のプロファイル | ダイヤ付き公共交通を提供しない | 両手段の要件を単独では満たさない。公開デモを本番の保証された経路基盤として使わない |
| openrouteservice | 自動車・徒歩等のプロファイル別matrix | Matrix APIに電車・バスの時刻表経路はない | 同上 |
| NAVITIME API/SDK | 対応 | 日本の電車・バス等に対応 | 国内交通の有力な代替。契約条件・利用料金の確認、別アダプターの実装が必要。現時点で契約・申込みはしない |

Google Matrixは1回で最大625要素、`TRANSIT`は100要素、住所/Place ID利用時は別の50件制限がある。今回は座標と出発地1件を使い、100施設ずつ順次取得する。登録済み施設はすべて一覧に残し、取得できなかった行だけ「取得不可」にする。配列の返却順を仮定せずdestinationIndexで対応付ける。

公共交通は出発日時（日本時間）をRFC3339 UTCへ変換する。APIの検索範囲は現在を基準に7日前〜100日後。車は費用を抑えるため `TRAFFIC_UNAWARE` とし、渋滞を加味した時間ではないことを画面に明示する。

Matrixだけでは乗換回数・徒歩区間・最寄駅の詳細は返らない。現段階では「詳細は未取得」と明示する。将来必要なら施設を選んだときだけCompute Routesで経路ステップを取得する案があるが、追加API利用と料金を別途承認してから実装する。0回・徒歩0分・推定最寄駅といった架空の値で補わない。

## 料金と想定費用

公式のグローバル従量料金（USD、最初の料金帯）：

| SKU | 月間無料要素数 | 無料枠超過分 / 1,000要素 |
| --- | ---: | ---: |
| Compute Route Matrix Essentials | 10,000 | US$5 |
| Compute Route Matrix Pro | 5,000 | US$10 |
| Compute Route Matrix Enterprise | 1,000 | US$15 |

今回のリクエストは交通考慮・道路側指定・Heading等のPro/Enterpriseオプションを使わず、基本のEssentialsを想定する。TRANSIT指定だけは公式SKU資料の上位課金トリガーには載っていない。仕様と課金SKUは実API確認時にも検証する。

**無料枠内でもGoogle Cloud課金アカウントの設定が必要。無料になるという理由で勝手に有効化しない。** 無料枠は他の利用との合算等の影響を受けるため、無料を保証しない。料金は変更され得る。税・為替は別。

- 出発地1件・3キャンプ場：1比較 = 3要素。車と公共交通をそれぞれ1回比較すると計6要素。
- それぞれ1日10回、30日：`3 × 2 × 10 × 30 = 1,800要素`。無料枠が残っていればGoogle料金は0の想定。
- 同SKUを月12,000要素使用した場合、無料枠10,000要素を引いた2,000要素でUS$10の目安。
- 実装の既定上限は**全利用者合計で日100要素・月3,000要素**。このアプリのEssentials利用だけで考えると、無料枠がすでに消化済みでも月US$15が上限の目安。Google以外の料金、別APIキーや他アプリからの利用は含まない。

共有上限用Redisは、Upstash公式に無料プラン（250MB / 月500Kコマンド）の記載がある。有料従量プランはUS$0.2 / 100Kコマンドの表示。利用条件・既存の無料DB数等を確認してから選ぶ。今回新しいDBや有料契約は作成していない。Vercel自体のプラン・実行量による料金も別途確認が必要。

## キー・予算・キャッシュの設計

- `api/routes.js`のVercel FunctionだけがGoogle Routesを呼ぶ。キーは `GOOGLE_ROUTES_API_KEY` という**サーバー側環境変数**。`VITE_`を付けない。localStorage・ブラウザ応答・ソースHTMLにキーを書かない。
- `ROUTES_ENABLED=true` とキー・Redis・制限用秘密鍵がそろわない限り503で停止する。現在は未設定のため、Googleには一切送信しない。
- RedisのLua処理で、全体の日・月上限とIP由来のHMACによる短時間制限を**原子的に予約してから**Googleへ送信する。Vercelインスタンス内のメモリーカウンターには頼らない。Redisが落ちた場合はGoogleを呼ばず停止する。
- 既定の短時間上限は1クライアント10リクエスト。全体予算は要素数で数える。失敗したリクエストも安全側で予約済み数に残す。独自カウンターの日・月の区切りはUTCで、Googleの請求締めそのものではない。
- Googleの距離・時間の永続保存や任意の結果キャッシュは行わない。表示中の結果は並べ替え・タブ切替の再描画だけに利用し、入力が変わったら再取得する。Redisには利用数と制限キーだけを保存する。localStorageにはユーザーが選んだ出発地を保存し、Googleの経路結果は保存しない。
- 並べ替え・天気の更新・タブ切替だけでは経路取得を行わない。移動手段変更は比較済みの場合に短い待ち時間を置いて更新する。キャンプ場変更時は古い結果を無効化し、明示的に再比較する。
- Google Cloudの予算アラートは**自動停止ではない**。別途、Cloud Consoleで利用可能な割当上限を低く設定し、VercelのDeployment Protectionでまず自分だけのPreview検証とする。

## 規約・表示

Google Routesの結果は地図なしの一覧内に限定し、公式のGoogle Mapsロゴを同じコンテナーで表示する。既存のOSM地図は登録地点の指定専用で、Google経路・時間・距離を重ねない。Google規約には非Google地図との併用制限があるため、一般公開前に運用者がこの分離方法を含めて確認する。

保存可能なPlace IDや最大30日間の座標保存の例外を、所要時間・距離の自由なキャッシュ許可と解釈しない。利用条件とプライバシーのページ `legal.html` を用意した。公開時の運営者情報・問い合わせ先・公開URLは運営者がレビューする。

現在地はボタンを押したときだけブラウザの許可を得て取得する。比較実行時に出発地・施設の座標と公共交通日時をGoogleへ送信することを画面で説明する。現在地の自動保存はしない。

## 承認後の設定手順（まだ実施しない）

1. Google Cloudでテスト用プロジェクトを選び、課金アカウントの紐付けを承認する。Google Routes APIを有効化する。
2. APIキーを作成し、**API制限をRoutes APIのみにする**。サーバーからの呼び出しなのでブラウザHTTPリファラー制限は使わない。固定送信IPが使える環境でのみIP制限を追加する。キーは専用にする。
3. Google側の予算アラートと利用可能な割当上限を設定する。アラートだけで支出が止まるとは考えない。
4. 既存または無料枠を確認した専用Redis DBを用意する。無料DBが使えない場合に有料プランを勝手に選ばない。
5. Vercel Project → Settings → Environment Variablesで、**最初はPreview環境だけ**に以下を保存する。秘密値はチャットやGitHubに貼らない。

   | 変数名 | 値・用途 |
   | --- | --- |
   | `GOOGLE_ROUTES_API_KEY` | Routes専用キー |
   | `UPSTASH_REDIS_REST_URL` | 共有Redis RESTのHTTPS URL |
   | `UPSTASH_REDIS_REST_TOKEN` | Redisの秘密トークン |
   | `ROUTES_RATE_LIMIT_SECRET` | 32バイト以上の十分ランダムな秘密値（IPのHMAC用） |
   | `ROUTES_DAILY_ELEMENTS` | `100` |
   | `ROUTES_MONTHLY_ELEMENTS` | `3000` |
   | `ROUTES_CLIENT_REQUESTS_PER_MINUTE` | `10` |
   | `ROUTES_ENABLED` | 承認・設定完了後だけ `true` |

6. 承認後、mainには入れず作業ブランチをGitHubへpushしてVercel Previewへデプロイする。サーバーの環境変数を追加したら再デプロイする。Productionはまだ有効化しない。
7. 3施設について車・公共交通の実時間と距離、公共交通日時、経路なし、利用上限、課金SKUを確認する。天気の最終日ランキング、保存・削除・Safariレイアウトも再確認する。
8. 実APIと共有制限の検証完了後にのみmainへ反映する。Vercelの自動デプロイ設定自体は変更しない。

## 確認状況

- レイアウト修正：main反映済み。WebKitとChromiumの12条件、通常/Vercelビルド成功。
- アクセスUI：ブラウザの**隔離テスト応答**で、時間・距離のアプリ内表示、時間/雨順、車/公共交通切替、日時、現在地の明示取得、保存地点、取得不可を確認。
- 設定なしの実プレビュー：実際の天気と東京駅検索は成功。経路比較は503で停止し、3施設とも「取得不可」。架空の距離・時間は表示しない。
- サーバーの入力検証・設定待ち・共有制限失敗時の停止・応答対応付けは単体テスト済み。
- **Google Routes・Upstash Redisの実アカウントでの成功、実請求、公共交通の日本の対象区間、Vercel上のFunction実行は未検証。** このためアクセス機能を完成済みとしてmainへ反映しない。

## 公式資料

- [Compute Route Matrix](https://developers.google.com/maps/documentation/routes/compute_route_matrix)
- [公共交通](https://developers.google.com/maps/documentation/routes/transit-route)
- [Matrix REST仕様](https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRouteMatrix)
- [料金](https://developers.google.com/maps/billing-and-pricing/pricing)
- [SKU別の課金条件](https://developers.google.com/maps/billing-and-pricing/sku-details/routes)
- [利用・課金と割当](https://developers.google.com/maps/documentation/routes/usage-and-billing)
- [Routes表示・キャッシュポリシー](https://developers.google.com/maps/documentation/routes/policies)
- [サービス固有規約・19 Routes API](https://cloud.google.com/maps-platform/terms/maps-service-terms)
- [OSRM](https://project-osrm.org/docs/v5.24.0/api/)
- [openrouteservice Matrix](https://giscience.github.io/openrouteservice/api-reference/endpoints/matrix/)
- [NAVITIME API/SDK](https://api-sdk.navitime.co.jp/)
- [Upstash Redis料金](https://upstash.com/pricing/redis)
