> 文書：APIの現役入口から試験までの案内｜区分：今の説明｜最終確認：2026-10-20（日本時間）

# APIを追う順序

| 順序 | 入口と読む物 |
|---|---|
| 画面 → ブラウザのAPI | 機能READMEのAPI欄 → [api.ts](../apps/web/src/lib/api.ts)・[公開index](../apps/web/src/lib/api/index.ts)。個別クライアントはその機能のimportを確認 |
| API → HTTP登録 | [Workerの入口](../apps/worker/src/index.ts) → `routes/` の登録。固定パス・動的パス・middlewareの順序を維持 |
| HTTP → 業務処理 | routeのimport → `features/<機能>/` の公開index・本体。`services/` の旧公開口も互換用途を確かめる |
| 処理 → 保存 | [DBの公開名](../packages/db/src/index.ts) → 各機能のSQL・型。別店舗の条件、bind、CAS、履歴を確かめる |
| 型 → 応答・公開API説明 | [共有の公開名](../packages/shared/src/index.ts)、[エラー契約](error-codes.md)、[API文書の一覧](README.md#api)。OpenAPIの登録先はWorker入口から追う |
| 試験 | Web/Workerは同所の `*.test.ts(x)`、DBは `packages/db/test/`、共有は対象の隣。外部I/Oを模擬し実処理の結果で判定 |

これは経路の案内です。method・path・入力・応答・権限を別の表へ複製しません。追加・移動したAPIの対応は司令塔の `API-CONTRACT-*.md` と `DONE-*.tsv` を読み、現在の本体・共有型・試験へ照合してください。

認証・別店舗・閲覧のみ・入力・成功の包み・HTTP状態は保持します。予期しない例外は共通onErrorへ、業務の失敗は既存の共通形式へ渡します。事故番号・秘密の伏せ方を独自に作りません。外部呼出しの回数・期限・結果不明の停止・サガ・cacheは [段2の共通契約](v8-requirements/cleanup-stage2-contract.md) が正本です。

新しいmigrationの番号案は報告時点の候補であり、予約・承認ではありません。過去の727などを未使用と推測せず、最新開発と公開PRを再照合して番号ごとの承認を受けます。D02は新しいAPI・表・列を作らず、番号案もありません。
