# Puretomo（GitHub Pages + GitHub Actions）

チョコットランド向けのPuretomoアシスタントです。従来の`puretomo`サイトと`bazzar`集計ロジックを、GitHub ActionsおよびGitHub Pagesへ移行しています。

## 公開サイト

https://ogatetsu-0501.github.io/pure/

## 更新方式

- `.github/workflows/update-and-deploy.yml` を5分間隔で起動します。
- APIから出品・関連アイテム情報を取得してJSONを更新します。
- JSON変更時のみコミットし、同じワークフローでPagesへ反映します。
- 更新失敗時はジョブを失敗させ、従来の公開データを維持します。
- Actionsの実行は混雑時に遅延・スキップされることがあります。

## 初回セットアップ

1. リポジトリの **Settings → Pages → Source** を **GitHub Actions** に設定します。
2. **Settings → Actions → General → Workflow permissions** で `Read and write permissions` を指定します。権限変更により初回のデータ自動コミットが可能になります。
3. **Actions → Update bazaar and deploy Puretomo → Run workflow** から手動実行します。
4. 初回実行では旧公開リポジトリ`ogatetsu-0501/puretomo`から元データ・画像を取り込みます。
5. 成功したらサイトを開き、画像・検索・価格履歴を確認します。

## 開発

Node.js 22以上で`npm test`、`npm run build`が実行できます。
実際の外部APIを取得する場合は`npm run update:bazaar`を実行します。

## 主要ファイル

- `index.html`: 公開画面
- `scripts/bazaar-core.mjs`: APIレスポンスからの集計
- `scripts/update-bazaar.mjs`: 外部API取得とローカルJSON更新
- `scripts/build-site.mjs`: GitHub Pages用ファイルの出力
- `scripts/test/`: 集計のテスト
- `.github/workflows/update-and-deploy.yml`: 5分ごとの更新・公開

GitHub Pagesは静的サイトホスティングです。外部APIからの直接取得はGitHub Actionsが担当します。
