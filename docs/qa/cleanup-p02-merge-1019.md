# P02：まとめ枝の取り込み（2026-10-19）

- 作業枝：`codex/kenta-train-cleanup-p02-1018`。開始 `77ec18eccacdc0259b682e49de8558f97a98f9af`、取り込み先 `684142dea6a9489b56cb24016ab48382f29ada8b`。
- `git merge codex/kenta-train-cleanup-all-1018` の競合は `packages/db/bootstrap-meta.json` の1件。両方の一覧を手で選ばず、Node 22で正規の生成器から `bootstrap.sql` と `bootstrap-meta.json` を再生成した。649本にT01の728/729/730/731/733/734とP02の735が各1回含まれる。SQL原本の変更・新規追加・実DB適用はない。
- P02の元の47ファイルのうち44ファイルは元のblobと一致。残る3ファイルは上記2生成物とOpenAPIの正規一覧で、写真の5口とEC集計の追加を両方保持する。上限・例外一覧・権限を変更していない。
- 検証は進行中。検証用に取り込みを先にコミットし、コミット済みのクリーンな枝を要求する `ci-local/run.sh` を実行する。実行結果はこの文書と外部の `P02-HANDOFF.md` / `DONE-P02.tsv` に追記する。
- 証拠：`~/lh-work/design/v8/review/CLEANUP-1017/P02-EVIDENCE/merge-1019/`。開始版と取り込み版は `merge-inputs.json`、47ファイルの照合は `preservation.json`。
- 親リポジトリの既存の `.nodeterm/project.json`・`.nodeterm/settings.json`・`lh-hq.code-workspace` は未変更。push・PR・DB更新・配備・外部への送信は行わない。

## 取り込み後のWorker検査の補修

8428b1a22eの全Worker試験は13,531成功・1失敗。取り込み元にもある `restaurant-delivery-ubereats-stores.ts` の2か所が直接consoleへJSONを書いており、共通logger必須の既存試験が検出した。例外や外部本文を足さず、既存の固定イベント名のまま `@line-crm/shared/server` のloggerへ移した。HTTP応答・再試行・結果不明の扱いは変更していない。

補修後、既存の安全検査とデリバリーのルート/境界の3ファイル114件が合格（`P02-EVIDENCE/merge-1019/logger-regression.log`）。見張りの期待や対象は変更0。Worker全件・型・buildは補修コミットで再実行する。他の製品ファイルは8428b1a22eと同一なので、進行中の全体CIは続行し、結果の対応する版を分けて記録する。
