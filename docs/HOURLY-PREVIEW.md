# 体感温度・寒暖差のiPhone確認用Preview

## 本番公開への移行

iPhone SafariでのPreview実機確認が完了し、利用者からmain反映・本番公開の承認を受けた。公開準備として、Preview専用の `ignoreCommand` を削除し、既存mainと同じVercel設定へ戻す。URL・ドメイン・環境変数・認証設定は変更しない。以下はPreview段階の手順と制約の記録。

## 実機確認時の対象と制約

対象ブランチは `feat/hourly-camp-details`。既存のVercelプロジェクト `campweather` とGitHub連携を再利用した。Preview段階ではmainへのマージ、Productionの作成/昇格、公開URLやドメインの変更、新規サービス登録、課金設定、ライブラリ追加は行わなかった。

Preview確認時の `ignoreCommand` は `VERCEL_ENV=preview` のときだけ終了コード1（ビルド続行）を返し、それ以外や変数未設定では0（ビルド中止）を返していた。この設定は作業ブランチだけに置き、本番公開前に削除した。既存mainのデプロイ設定には適用していない。

## 承認後に行う操作

1. GitHubのmainが事前確認したコミットのままであることを読み取り確認する。
2. 作業ブランチだけを、forceなし・mainを指定せずにpushする。

   ```sh
   git push origin HEAD:refs/heads/feat/hourly-camp-details
   ```

3. 既存Git連携が作成するPreview Deploymentの状態を確認する。`npm ci` → `npm run build:vercel` → `dist` と既存のAPI中継/Functionsを使用する。
4. 生成されたHTTPSのPreview URLを取得する。Productionへ昇格する操作・GitHub Pagesの公開ワークフローの実行は行わない。
5. Preview URLでAPI通信・モーダル・体感温度/寒暖差・お気に入り・再読み込みをブラウザで検証する。mainのSHAと既存公開URLが変わっていないことも確認する。

公開リポジトリのブランチへpushするため、変更コードはGitHubで閲覧可能になる。Previewは本番とは別のURL・保存領域を持ち、本番の登録データを自動で読み書きしない。Vercelの既存のビルド/転送/Function利用枠を使用し、プランや支払い設定は変更しない。

## iPhone Safariでの確認

1. 報告された **Preview URL** をSafariで直接開く。本番URLのホーム画面アイコンは使わない。
2. Vercelの認証画面が出る場合は、プロジェクトにアクセスできるVercelアカウントでログインする。保護設定や認証情報を変更・共有する必要はない。
3. 「直近の土日」を選び、初期キャンプ場の予報が表示されるまで待つ。
4. カードの日中最高・夜間最低・寒暖差・最低体感温度を確認する。
5. カードの通常領域かキャンプ場名の「詳細」をタップする。基本情報・対象時間帯・グラフ・時間別の体感温度/湿度を確認する。
6. 日付ボタンで土日を切り替える。縦スクロールしても閉じるボタンを操作できるか確認する。
7. 閉じるボタン、画面端の背景タップで一覧に戻る。元の一覧位置が保持されるか確認する。
8. ☆/★でお気に入りを切り替えても比較カードが消えないこと、「比較から外す」でお気に入りが解除されないこと、一覧から比較に戻せることを確認する。
9. Safariで再読み込みし、お気に入りと日程が保持されることを確認する。

予報は変化するため固定の温度と一致することを期待しない。対象時刻のデータが不足すると `--` になる。データ取得日時を確認する。必要なら本番からバックアップを書き出し、Previewで確認して取り込めるが、本番データを自動移行しない。

## 自動デプロイ・認証に制約がある場合

- Vercelの既存プロジェクトを開き、Productionの追跡ブランチがmainであることを確認する。
- Deployments → Create Deploymentで上記作業ブランチを指定し、環境が **Preview** であることを確認する。新規プロジェクト作成やPromote to Productionは行わない。
- PreviewのVisitからHTTPS URLを取得する。自動取得できない場合はこのURLを共有して検証を続ける。
- 権限/プラン/保護の問題でPreviewを作成できない場合は操作を中止し、管理者に既存プロジェクトのPreview作成を依頼する。課金・公開範囲・認証設定は自動で変更しない。

仕様確認元：[Vercel environments](https://vercel.com/docs/deployments/environments)、[ignoreCommand](https://vercel.com/docs/project-configuration/vercel-json#ignorecommand)、[Ignored Build Step](https://vercel.com/docs/project-configuration/project-settings#ignored-build-step)。
