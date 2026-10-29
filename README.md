# Puretomo（GitHub Pages + GitHub Actions）

チョコットランド向けのPuretomoアシスタントです。従来の`puretomo`サイトと`bazzar`集計ロジックを、GitHub ActionsおよびGitHub Pagesへ移行しています。

## 公開サイト

https://ogatetsu-0501.github.io/pure/

## 更新方式

- Google Apps Scriptの5分トリガーからGitHub Actionsの `workflow_dispatch` を起動します。設定用コードは `gas/Code.gs` です。
- APIから出品・関連アイテム情報を取得してJSONを更新します。
- JSON変更時のみコミットし、同じワークフローでPagesへ反映します。
- 更新失敗時はジョブを失敗させ、従来の公開データを維持します。
- GASトリガーも実行時間に揺らぎがあります。GitHub側の `schedule` は起動実績がなかったため停止しました。

## 初回セットアップ

1. リポジトリの **Settings → Pages → Source** を **GitHub Actions** に設定します。
2. **Settings → Actions → General → Workflow permissions** で `Read and write permissions` を指定します。権限変更により初回のデータ自動コミットが可能になります。
3. **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens** で、対象リポジトリ `pure` のみ、権限 `Actions: Read and write` のトークンを作成します。期限を設定し、期限到来前に更新してください。
4. [Google Apps Script](https://script.google.com/) に新しいプロジェクトを作成して `gas/Code.gs` の内容を貼り付けます。プロジェクトのスクリプトプロパティに `GITHUB_TOKEN` を登録します（コードに記述しません）。
5. `runBazaarUpdate` を1回実行し、実行ログの `HTTP 204` を確認します。その後 GitHub Actionsで `workflow_dispatch` の実行・APIデータ更新が成功したことを確認します。
6. `installTrigger` を1回実行し、5分トリガーを作成します。
7. 停止するときは `removeTrigger` を実行します。
8. 初回実行では旧公開リポジトリ`ogatetsu-0501/puretomo`から元データ・画像を取り込みます。
9. 成功したらサイトを開き、画像・検索・価格履歴を確認します。

## 開発

Node.js 22以上で`npm test`、`npm run build`が実行できます。
実際の外部APIを取得する場合は`npm run update:bazaar`を実行します。

## 主要ファイル

- `index.html`: 公開画面
- `scripts/bazaar-core.mjs`: APIレスポンスからの集計
- `scripts/update-bazaar.mjs`: 外部API取得とローカルJSON更新
- `scripts/build-site.mjs`: GitHub Pages用ファイルの出力
- `scripts/test/`: 集計のテスト
- `gas/Code.gs`: GASの5分間隔GitHub起動コード
- `.github/workflows/update-and-deploy.yml`: 手動/API起動時の更新・公開

GitHub Pagesは静的サイトホスティングです。外部APIからの直接取得はGitHub Actionsが担当します。
