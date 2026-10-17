# PR #1765 R430 の時刻依存の修正

確認日時：2026-10-17 21:01 JST。作業枝：`codex/kenta-train-42-1017`。製品・試験の確認版：`d1650b93c2f9974ce122a45f8c4fb411aaa25218`。
本線 `origin/codex/development` の `37baf106e5f730139eb993fc7b269e4b236c36d0`（#1767）を `git merge --no-ff` で競合なく取り込んだ。

## 原因と修正

`nowHeader` を作った後、受信の補助関数が別の `Date.now()` で署名を作っていた。署名の対象には秒単位の時刻も含まれるため、処理が秒をまたぐとヘッダーと署名が一致せず401になる。日付の表示形式や本体の受付期間の変更は不要だった。

修正前の試験に再送直前の1.1秒の実待機を一時的に加え、R430の再送が401で失敗することを再現した（8件合格・1件失敗、6.56秒）。修正後は同じ実待機でも9件すべて合格（6.41秒）。再現用の実待機は最終差分に残していない。

試験のDateだけを `2026-10-17T23:59:59.750Z` に固定し、SQLiteのnowも既存の試験用時計へ合わせた。実タイマーは残し、各試験の後で時計を戻してDB接続を閉じる。既存の9件の名前・期待値・再送処理は変更前と一致することを比較済み。本体の署名検査、受付期間、重複防止、制限時間・対象は変更していない。

## 連続確認

Node 22.23.3 / pnpm 9.15.4 / macOS。各回を別のVitestプロセスで直列実行した。

```sh
CI=true TZ=UTC pnpm --filter worker exec vitest run src/routes/webhook-incoming-receive-guards.test.ts
CI=true TZ=Asia/Bangkok pnpm --filter worker exec vitest run src/routes/webhook-incoming-receive-guards.test.ts
```

| 時間帯 | 回 | 結果 | 秒 |
| --- | --- | --- | ---: |
| UTC | 1 | 合格（9件） | 5.56 |
| UTC | 2 | 合格（9件） | 5.54 |
| UTC | 3 | 合格（9件） | 5.56 |
| UTC | 4 | 合格（9件） | 5.57 |
| UTC | 5 | 合格（9件） | 5.58 |
| Asia/Bangkok | 1 | 合格（9件） | 5.61 |
| Asia/Bangkok | 2 | 合格（9件） | 5.58 |
| Asia/Bangkok | 3 | 合格（9件） | 5.62 |
| Asia/Bangkok | 4 | 合格（9件） | 5.62 |
| Asia/Bangkok | 5 | 合格（9件） | 5.59 |

両時間帯で5回ずつ、計90件が連続合格。

## 本線取り込み後の検査

`CI=true TZ=UTC` と同じNode 22を使用。重い検査は既存の `~/lh-work/tools/hq/heavy.sh` を通して順番に実行した。

| 命令 | 結果 | 秒（枠の待ち時間込み） |
| --- | --- | ---: |
| `pnpm --filter worker typecheck` | 合格 | 22.84 |
| `pnpm --filter worker test` | 合格 | 402.58 |

Worker全試験：1,093ファイル・12,910件合格、失敗0。型検査も終了値0を確認。Vitestの最大4並列を維持。最終のfetchでも本線は同じ37baf106e5だった。

ログ：`/tmp/train42-r430-repro.log`、`/tmp/train42-r430-fixed-delay.log`、`/tmp/train42-r430-checks/`、`/tmp/train42-r430-final/`。

反映履歴：`docs/release-log/unreleased/1765-kenta-webhook-clock-checks.md`。コミットまでで司令塔へ引き継ぐ。push・DB更新・配備は実施しない。
