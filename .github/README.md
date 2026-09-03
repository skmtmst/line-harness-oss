# GitHub 設定の運用メモ

## Pull Request の検査

Pull Request の共通検査は `workflows/required-pr-gate.yml` で1回だけ実行します。
`deploy-scripts-ci.yml` と `worker-ci.yml` の検査内容は共通検査に含まれるため、
この2本は統合後の `push` と手動実行だけを担当します。

## 意図して置いていない設定

- `workflows/deploy-pages.yml`: 対象の `gh-pages` ブランチがなく、GitHub Pagesも使って
  いません。画面と文書の配備はCloudflare用workflowが担当します。
- `labeler.yml`: この設定を読むlabeler workflowがないため、置いても動きません。

上流同期でこれらが戻った場合も、利用するworkflowと運用目的が同時に追加されて
いなければ削除した状態を維持します。
