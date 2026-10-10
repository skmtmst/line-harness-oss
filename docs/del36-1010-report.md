# 回答・友だちデータの削除（B-215 / CODEX-NEXT 36）

## 作業範囲

- 作業場所：`/Users/kentakenta/lh-work/lh-pages-del36`。
- 専用枝：`codex/kenta-del36-1010`。列車16 `d3435b5c7de143234d1cfacb7cbfabc778398993` の上。
- 開始前のローカルDoctorは合格。開始時の作業ツリーはクリーン。
- 開始前fetchで本線 `41d2589c97fa1b783311081310c6284210235a5a` を確認。本線は取り込んでいない。
- 要件の不足を `docs/v8-requirements/form-file-attachments.md` §11 に先に定義してから実装。
- push・PR作成・D1更新・配備・実送信・外部サービスのデータ削除はしていない。親ECリポジトリも変更していない。

## 作ったもの

|経路|動作|
|---|---|
|`DELETE /api/forms/:id/submissions/:submissionId?account_id=...`|個別の回答・添付・検査記録・処理用の記録を消し、回答数と定員枠を更新|
|`DELETE /api/friends/:id/data`|友だちのプロフィール・トーク・回答・未添付の書類・写真・顧客参照と子の記録を削除|
|回答一覧・詳細の「…」|共通RowMenu → 共通ConfirmDialog（回答者・日時を表示） → 削除 → 一覧を再読込|
|友だち詳細の「…」|共通ConfirmDialogに消えるものの一覧を表示 → 削除 → 友だち一覧へ|

オーナー・管理者だけに操作を出し、APIでもスタッフ・閲覧のみ・未認証を403で断る。選択アカウントと所属を照合する。共有フォームの所属不明の回答は、全所属アカウントへの権限を要求する。成功済みの再実行でも所属を再確認する。

削除の開始・実行権・完了は既存のoperation_auditへ記録する。完了は共通のaudit_eventsにも同じDB batchで記録する。内部ID・実行者・日時・件数だけを使い、顧客本文・名前・LINEユーザーID・ファイル名・R2の鍵を記録しない。画面の成功通知は共通の白いトースト。

R2の実体を消してからDBを確定する。R2・DBの失敗時は、DBの親と保存先を残して503を返す。途中の添付取得・新しい書類の受取・後処理の再実行を止め、同じ対象から再試行できる。R2は一度に100個まで、DBの削除・回答数・完了監査は1つのbatch。同時押下は409、完了後の再押下は成功を返す。停止した実行は5分後に取り直し、古い実行は確定できない。

DBとR2を同時に巻き戻すことはできない。R2に成功した後のDB失敗でも、DBに鍵と親を残すことで削除対象が不明にならないようにした。後から増えた行・変わった鍵・所属や顧客参照の変更・保存対象の記録もDB確定直前に検査する。

友だち削除の対象表と関係は既存bootstrap・削除分類に基づく明示的なJSONで固定。複合外部キーを組にして照合し、実スキーマに対する網羅・コンパイル試験で将来の変更を検出する。ブロックの処理には接続していない。

## migrationの必要性と案（未作成・承認待ち）

回答削除と、保存対象の参照がない友だち削除はmigrationなしで動く。ただし、以下の保存対象が削除対象の親を参照している場合、現行構造のままでは監査・支払・審査を巻き添えに消す、または外部キー制約で失敗する。今回は `409 deletion_schema_approval_required` でR2・開始記録の変更前に止める。処理中に記録が増えた場合もDBを巻き戻す。

|保存する表|削除対象になる親|
|---|---|
|booking_audit_logs / booking_payments|bookings|
|mileage_adjustment_approval_events|mileage_adjustment_approval_requests|
|nen_photo_assessment_runs / nen_photo_original_download_audit / nen_photo_original_download_grants / nen_photo_review_events / nen_photo_risk_assessments|nen_photo_submissions|
|affiliate_payout_batch_lines / affiliate_payout_results / affiliate_settlements / affiliate_statements|affiliates|
|affiliate_settlement_lines|affiliates / affiliate_reward_entries / affiliate_adjustments|

また、紹介者を消すと別のお客さまの成果記録まで参照経由で消える場合がある。本人が別の友だちの記録も開始前に止め、別のお客さまのデータを消さない。

**案**：保存対象13表・15参照の外部キーをnullable・`ON DELETE SET NULL`へ変更し、個人情報を含まない旧親の内部IDを外部キーでない履歴用欄へ残す。別のお客さまの成果を消さずに紹介者の参照を切り離す変更も必要（conversion_events等のaffiliate参照を含めて調査）。nullになった参照を読むAPI・帳票・審査処理も合わせて直す。SQLiteの表作り直しには `-- migration-policy: table-rebuild` を付け、`<表名>_new`等と索引・トリガーの再作成を使う。承認後に具体的なSQL・保持範囲を再確認する。

**番号の仮案：634**。開始前fetchの本線は最大624、列車16は626・627、確認した公開PRは最大565。手元の並行枝には628・629・633もあるため、その次を仮案とした。番号は予約していない。作成直前に本線・公開PR・並行枝を再確認して確定する。今回migrationファイルは作っていない。

## 検証

APIのビルド値は `NEXT_PUBLIC_API_URL=https://nen-line-stg.skmtmst.workers.dev`。実データを削除するAPIは呼んでいない。API試験は実bootstrapのSQLite（外部キー有効）とR2の代役を使う。追加でローカルworkerd D1の実バインディングでも、全関係の削除・batchの巻き戻し・監査・再試行を確認する（クラウドD1には触れない）。

|検査|結果|
|---|---|
|削除APIと書類の関連試験|45件合格（削除27・書類18）|
|ローカルworkerd D1|3件合格。全試験内でも再確認|
|追加を含む画面の関連試験|24件合格|
|Web全試験|2,112ファイル・12,342合格、既存1件が5秒の時間切れ。該当ファイルの単独再試行は4件合格。既存1スキップ・1todo|
|scripts全試験|99ファイル・903件合格|
|型検査|全workspaceとscripts合格。D1試験・OpenAPI追加後のWorkerも合格。最後の確認文変更後のWebもビルドの型検査で合格|
|Web lint|合格（既存の警告あり）|
|bootstrap整合・migration方針|合格、既存525本。migration追加なし|
|共通部品の差分検査|v8-pattern-auditの新規未許可0件|
|選択部品の既存検査|飲食画面3件が失敗。列車16の同じ3ファイルの元の内容でも単独再検査が同じ3件、baseとのファイル差分なし|
|DB全試験|374ファイル・2,239件合格|
|CLI / MCP / 共有型 / SDK / LIFF / docs|52 / 68 / 357 / 53 / 418 / 6件合格。更新エンジン160件も合格|
|ビルド|全workspace合格。OpenAPI追記後のWorkerも合格。最後の確認文変更後のWebも合格|
|実ブラウザー|回答一覧・友だち詳細×1152・1440・1920の6通り。確認窓・取消・二重押下・遷移合格、横のはみ出し0。確認文変更後も6通り合格。撮影した画像を目でも確認|
|Worker全試験|920ファイル・10,892件合格・既存30スキップ（OpenAPI本体と基準一覧を追加後の全再実行）|

選択部品の3件は今回の変更箇所ではない。元のSHAのコードをgit showで取り出し、同じinspectPickersで検査して証拠を保存した。既存の検査や許可台帳は変更していない。

逆変異は権限・R2削除・DB batchの原子性・同時実行拒否・保存対象の事前検査・画面の権限の6種類で、AssertionErrorによる失敗を確認し、元のコードへ復旧した。実行権のトークン検査だけを外した実験は、別のスナップショット検査が防いで通ったため、成功した逆変異に数えていない。

初回の追加画面試験では確認窓の閉じる動きの待機とmockの呼出履歴初期化を修正。追加APIのOpenAPI本体と基準一覧への記載漏れは今回の不備として直し、Worker全試験を再実行した。全試験とビルドを同時実行したため、全試験内の既存ブラウザー試験が起動した開発サーバーと`.next`が競合した。これは今回の検証手順の誤りであり、既存不具合とは扱わない。ビルドを止め、全試験をworkspace-concurrency=1で順番にやり直した。既存ブラウザー試験も再実行で合格を確認。実ブラウザーの追加確認は、ビルド完了後の書き出しを静的サーバー1つで配り、Playwrightも1つずつ実行した。追加ブラウザー確認のAPI通信は全てローカルのモックまたはroute.fulfillへ差し替え、クラウドへ送っていない。確認用の認証/CORS差し替えとサーバー方式を直した初回は合格として数えていない。

証拠：`/Users/kentakenta/lh-work/design/v8/review/del36-1010/`。D1 batchの原子性・上限は [Cloudflareのbatch仕様](https://developers.cloudflare.com/d1/worker-api/d1-database/) と [上限](https://developers.cloudflare.com/d1/platform/limits/) も照合した。クラウドD1・実R2での検証はしていない。

## 残りと司令塔への引き継ぎ

1. オーナーが上記migrationの保持範囲・構造を承認した後、保存記録がある友だちも削除できるようにする。現時点でB-215の全件対応は完了ではない。
2. 追加した削除の口と確認窓をPencil ★V8へ反映・照合する。共通部品を使いCSSは変更していないが、1440・1152の90%画素照合は未実施。PASSED.tsvは更新していない。
3. 司令塔がコミットを列車へ取り込み、PR採番後に反映履歴の`#0000`とファイル名を実番号へ直す。

実装は `9750c27fe2`（要件）・`ac2ce203b9`（API）・`91c631ce6c`（画面）の3コミット。最終SHAとクリーン確認は指定の`codex-handoff/train16-last.md`へ追記する。
