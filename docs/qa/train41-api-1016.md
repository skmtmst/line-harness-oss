# 列車41：API列車取り込み後の再検査（2026-10-16）

## 取り込み

- 開始点 `a348ecc8d8`。既存の列車41を継続し、開始時クリーン、doctorは `DOCTOR_LOCAL=1` で合格。
- fetch後の#1744先頭は `47f4a431531bef7960b15d6cead4fddb8c1b5396`。`merge --no-ff` で `03b59c385f8f63ad572a06221e9bc72c6e16e8f0` へ取り込み。
- 検査の本線は `b34e4f5bab85f0647b947acc61d4a85da34794a2`（#1751）。API列車が包含しており、この列車にも包含済み。
- A〜Fの指定6コミットすべてを保持。元の取り込み順と方針は [前回報告](train41-1016.md)。rebase・force・stashなし。

## 競合

17パスの競合を解決。WebのAPI3パスとWorker9パスはAPI列車を正とした。DB4パスもAPI列車の分割済みの型・追加表の分類・初期構成を採用し、回答期間の絞り込みを保持。共有の公開入口はAPI列車に、列車41の支払い表示の公開を加えた。

前回「開始前本線」を保持した次の7パスは、API列車とファイル全体が一致することを確認。

- `apps/worker/src/index.ts`
- `apps/worker/src/middleware/route-guard-coverage.test.ts`
- `apps/worker/src/routes/booking.ts`
- `apps/worker/src/routes/hq-templates.ts`
- `apps/worker/src/services/hq-templates/distribution.ts`
- `apps/worker/src/routes/openapi.ts`
- `apps/worker/src/routes/openapi-coverage.test.ts`

画面・共通部品・LIFFの競合は0。API列車に含まれる本線#1751のLINE追加手順とその試験は通常の自動マージで包含した。列車41で取り込んだ各画面をAPI列車の古い画面へ戻していない。支払い表示の正本は引き続き `packages/shared/src/payment-status.ts`。

## 検査（実行中）

ci-localでコミット済みHEADを新品の作業ツリーへ出し、Node22・heavy経由で再検査する。PR未採番のためPR番号・題名に依存する工程は未実施として区別する。上限・許可・鍵は変更しない。

初回 `03b59c385f` の記録：`~/lh-work/tools/hq/ci-local/logs/20261016-103818-03b59c385f-46954/`。DBは既定の最大2 workers。後続のVitestも最大4にするため、DB工程後に自分の実行だけ停止し、VitestのCLIへ `--maxWorkers=4` を渡す手元のNode起動ラッパーで続きを実行する。試験内容や上限・許可は変更しない。

## 引き継ぎ

画面の見た目が必要な補修は実装せず、再検査後の指摘を画面の持ち主へ一覧で渡す。前回の鍵の差は承認せず、基準の変更も行わない。push・PR・番号の採番・DB適用・配備は司令塔。本作業はコミットまで。
