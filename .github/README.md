# GitHub 設定の運用メモ

## Pull Request の検査

Pull Request の共通検査は `workflows/required-pr-gate.yml` で1回だけ実行します。
`deploy-scripts-ci.yml` と `worker-ci.yml` の検査内容は共通検査に含まれるため、
この2本は統合後の `push` と手動実行だけを担当します。

G01で廃止した外観の固定検査の呼び出しは外し、現在の崩れ・権限・操作の
検査と故障対照を残しています。`required-pr-gate` の名前と依存ジョブは維持します。

YAML・シェル構文の工程では、直接書いたスクリプトの接続先も確認します。
手元では、PyYAMLのあるPythonで次をリポジトリ直下から実行できます。

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/security/test_workflow_commands.py
PYTHONDONTWRITEBYTECODE=1 python3 scripts/security/check_workflow_commands.py
```

対象は `node`・`tsx`・シェル・Pythonの直接呼び出しとNode試験のファイル列です。
変数で組み立てるパス、パッケージの命令、シェル内部の条件や間接呼び出しまで
解釈するものではありません。それらは従来どおり各ジョブの実行で確認します。
配備ロック、稼働設定・認証・DB検査、frozen-lockfileは引き続き維持します。

## 意図して置いていない設定

- `workflows/deploy-pages.yml`: 対象の `gh-pages` ブランチがなく、GitHub Pagesも使って
  いません。画面と文書の配備はCloudflare用workflowが担当します。
- `labeler.yml`: この設定を読むlabeler workflowがないため、置いても動きません。

上流同期でこれらが戻った場合も、利用するworkflowと運用目的が同時に追加されて
いなければ削除した状態を維持します。
