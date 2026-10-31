# テスト公開の手順

作業ブランチ：`feat/camp-weather-vercel-preview`

この手順を書いた時点では、GitHub の作業ブランチへの保存までです。Vercel・GitHub Pages への実公開はまだ行っていません。

## どちらを選ぶ？

| | Vercel | GitHub Pages |
| --- | --- | --- |
| 画面とキャンプ場比較 | 対応 | 対応 |
| APIへの接続 | 同じドメインを経由 | ブラウザから外部APIへ直接 |
| API中継 | `vercel.json` の転送設定で対応 | 非対応。サーバー処理を実行できない |
| 作業ブランチだけでテスト | 対応。Preview Deployment を作る | 初回はワークフローを既定ブランチに入れる準備が必要 |

今回のようにプレビューで外部通信が拒否される場合は、APIを中継できるVercelをおすすめします。GitHub Pagesでも普通のブラウザからAPIへ接続できれば動きますが、Pages自体で通信制限やCORSを回避することはできません。

## A. Vercelで作業ブランチをテストする

1. [Vercel](https://vercel.com/) を開き、**Continue with GitHub** でログインします。
2. **Add New → Project** を選び、GitHub の `kumakame927/campweather` を **Import** します。リポジトリが見えなければ、GitHubとの連携設定でこのリポジトリへのアクセスを許可します。
3. プロジェクト作成時にブランチを選べる場合は `feat/camp-weather-vercel-preview` を選びます。`main` にはまだREADMEしかないため、mainの初回デプロイは失敗する場合があります。その場合もmainを書き換えず、次の操作で作業ブランチを指定してください。
4. プロジェクトの **Deployments → Create Deployment** を開き、Git Reference に次を入力します。

   ```text
   feat/camp-weather-vercel-preview
   ```

5. 設定は次を確認します。ブランチ内の `vercel.json` で指定済みです。Root Directory はリポジトリのルート（空欄または `./`）です。

   | 項目 | 値 |
   | --- | --- |
   | Framework | Vite |
   | Install Command | `npm ci` |
   | Build Command | `npm run build:vercel` |
   | Output Directory | `dist` |
   | 環境変数・APIキー | 追加不要 |

6. Production Branch は `main` のままにし、作業ブランチの **Preview** デプロイであることを確認して **Create Deployment** を押します。**Promote to Production** は押しません。
7. **Ready** になったら **Visit** を押します。プロジェクト設定の Deployment Protection でテストURLへのアクセス制限も確認できます。
8. 初期3施設の土日予報が出ること、「亀山湖オートキャンプ場」を検索して住所と出典を確認して登録できること、再読み込み後も4施設が残ることを確認してください。

Vercelでは `/api/open-meteo/v1/forecast` と `/api/nominatim/search` をそれぞれの実APIへ転送します。検索名・座標などのクエリも転送します。実際のVercel上での転送と提供元の応答は、最初のデプロイ後に確認が必要です。ローカルで設定を再現した確認を、Vercel上での確認と同一とは扱いません。

公式手順：[Git referenceを指定したデプロイ](https://vercel.com/docs/git#creating-a-deployment-from-a-git-reference)

## B. GitHub Pagesで公開する（API中継なし）

**Pages単独ではAPI中継はできません。** この方法はブラウザからNominatim・Open-Meteoへ直接接続します。`vercel.json` はPagesでは読み込まれません。

1. 公開してよい段階で、この作業ブランチの変更を確認し、Pull Requestで `main` に取り込みます。今の作業ではmainへの取り込みは実施していません。
2. GitHubで `kumakame927/campweather` を開き、**Settings → Pages** を開きます。
3. **Build and deployment → Source** を **GitHub Actions** にします。アカウント・リポジトリのプランによりPagesが利用可能である必要があります。
4. **Actions** タブで **Deploy Camp Weather to GitHub Pages** を選びます。
5. **Run workflow** を押し、`main` を選んで実行します。ワークフローは手動実行のみなので、pushしただけでは公開されません。
6. build と deploy の両方が緑になれば完了です。**Settings → Pages** に表示されるURLを開きます。通常は次です。

   ```text
   https://kumakame927.github.io/campweather/
   ```

7. 初期3施設の予報、検索・登録、再読み込み後の保持を確認します。

GitHubの仕様で `workflow_dispatch` を画面から実行するには、ワークフローファイルが既定ブランチに存在する必要があります。作業ブランチにしかない段階でActionsの実行ボタンが出なくても、不具合ではありません。mainへまだ入れたくない場合は、AのVercel Previewでテストしてください。

Pagesでは `npm run build` を使います。**`npm run build:vercel` は使いません。** 後者はAPI中継用パスを生成するため、バックエンドのないPagesでは検索・予報取得が404になります。

## 保存とエラーについて

- 登録はブラウザのlocalStorageに保存します。VercelとPagesではURLが異なるため、登録内容は共有されません。別のプレビューURLでも同様です。
- 「通信は成功・0件」は検索が成功したものの施設名に一致がない状態です。
- 「通信エラー」が出たら「通信エラーの詳細」でサービス・HTTP状態・接続方式を確認します。Vercelで接続方式が「外部APIへ直接」の場合は、Build Commandが `npm run build:vercel` かを確認してください。
- APIの利用制限や提供元の障害は、Vercelの中継だけでは解決できません。一般公開で利用が増える場合は、各APIの利用条件に適合する構成が必要です。
