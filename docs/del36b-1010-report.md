# B-227：回答・友だち削除の保存記録（2026-10-10依頼）

## 基準と承認

- 作業枝：`codex/kenta-del36b-1010`、作業場所：`~/lh-work/lh-pages-del36b`。
- 列車17の `32a3a3ac3755471e854d4d84c7815437068e5024` から作成。開始時のDoctorは合格、作業ツリーはクリーン。
- オーナー承認：`~/lh-work/design/v8/APPROVED-MIGRATIONS` の634の行。保持範囲は `docs/del36-1010-report.md` の13表・15参照。
- 作成前と試験前にfetch。確認した本線SHAは `d797a14673e742f261a314568ccbef850653d66c`。依頼どおり本線は取り込んでいない。
- migration番号は **634**。本線は最大624、列車17は最大633、公開PR全38件は最大627。538ファイルのPR #1689はGraphQLの100件切りで見えないため、RESTの全ページも確認した。630〜632は飲食の承認枠であり、今回の634の承認行どおり633の次を使用。

## migrationの範囲と件数・時間

`634_customer_deletion_retained_references.sql` 1本。表を増やす変更はなく、以下の13表を `<表名>_new` で作り直す。15参照をNULL可・ON DELETE SET NULLにし、それぞれ `<参照列>_history` に元の内部IDを保存する。履歴列に外部キーはない。既存データの写しに加え、今後の追加・切り離しにも履歴IDを保存するトリガーを付けた。

|作り直す表|参照|固定データ試験の行数|コピーの安全上限（rowid）|
|---|---|---:|---:|
|booking_audit_logs|booking_id|2,000|100,000|
|booking_payments|booking_id|2,000|100,000|
|mileage_adjustment_approval_events|request_id|2,000|100,000|
|nen_photo_assessment_runs|photo_id|2,000|100,000|
|nen_photo_original_download_audit|photo_id|2,000|100,000|
|nen_photo_original_download_grants|photo_id|2,000|100,000|
|nen_photo_review_events|photo_id|2,000|100,000|
|nen_photo_risk_assessments|photo_id|2,000|100,000|
|affiliate_payout_batch_lines|affiliate_id|2,000|100,000|
|affiliate_payout_results|affiliate_id|2,000|100,000|
|affiliate_settlements|affiliate_id|2,000|100,000|
|affiliate_statements|affiliate_id|2,000|100,000|
|affiliate_settlement_lines|affiliate_id / entry_id / adjustment_id|4,000|100,000|

- **検証環境の実際の行数は未取得**。D1への操作禁止に従い、上の行数は実データの件数ではなく、固定データで確かめた規模。司令塔は適用前に各表の件数・rowid最小/最大・データ量を読み取りで確認する。
- コピーはrowidの範囲ごとに最大1,000行、各表100文。1未満または100,000超のrowidがあれば、最初のDROPより前にその表のガードで失敗し、**migration全体を巻き戻す**。ガードを外して適用してはいけない。上限外なら実行前にこの未適用migrationのコピー範囲と試験規模を見直す。
- SQL 1文は最大 **1,281バイト**、ファイル全体は約 **664KB**。D1の1文100,000バイト・ファイル5GBの上限内。1文あたり束縛は0。
- 外部キー有効の実SQLiteで、28,000件の保存記録を移す部分は約 **1.03秒**。空のDB・既存seedでは約0.29秒。固定データに対する手元の時間であり、D1の実行時間の保証ではない。検証環境の行数・大きなJSONの量・実行時間は今回測っていない。全体のbatchに30秒の上限があるため、適用担当が事前に確認する。
- リポジトリの適用経路は `wrangler d1 execute --remote --file`。インストール済みWrangler 4.77.0の実装で、ファイルはimport経路に送られ、失敗時は元の状態へ戻す仕様を確認した。Workerの1回の呼出しに全SQLを載せる経路は使わない（SQL文数が1,000を超える）。今回このコマンドは実行していない。
- 索引・既存トリガー・CHECKは保持。精算明細の「報酬か調整のどちらか一方」のCHECKだけは、切り離した履歴IDも含めて同じ制約を守る形に変更した。
- 根拠：[D1上限](https://developers.cloudflare.com/d1/platform/limits/)、[D1外部キー](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)。

## 削除と読み取り

- 保存記録がある友だちも削除できる。開始前に13表・15参照の適用状態を確認し、未適用・不完全な構造は引き続き409で止める。支払い・監査・審査・精算は消さず、親への参照だけを切り離す。
- 他のお客さま本人の成果・紹介判断は削除対象に含めない。既存のNULL可の紹介者参照を完了batch内で外す。紹介者コードと候補の紹介者名も外し、無関係の候補と成果は保つ。13表以外のスキーマは変更していない。
- 精算再開・明細書では「削除済みのお客さま」と表示する。履歴の内部IDで人数・明細・金額を数え、複数の削除済み紹介者をNULL1人として混ぜない。CSVに使う支払バッチも同じ内部IDで集計する。
- 削除後の精算明細から帳票を作れる。新たな支払バッチは消えた銀行プロフィールがない場合に、具体的な対象IDを伴う `bank_missing` で止める。本人用の閲覧権限は履歴IDで広げない。
- 予約が消えても入金を売上集計から落とさない。遅れて来た支払結果は保存した支払いに反映し、消えた予約への承認・通知は行わない。
- 消えた写真の原本取得・審査通知の実行権は取れない。審査受付の再実行は保存した記録と「削除済みのお客さま」を返し、再審査を起動しない。

## 試験と残り

|検査|結果|
|---|---|
|全workspace試験|26,709件合格。既存31スキップ・1todoは別|
|scripts全試験|99ファイル・903件合格|
|削除API|32件合格。権限、所属、13表の保存、金額、別のお客さま、途中失敗、再試行、二重押下、遅れた支払結果、CSVで2人を分けることを含む|
|実SQLiteのmigration試験|8件合格。外部キー有効、既存seedと28,000行、件数・列・索引・既存トリガー・CHECK・外部キーの照合、途中失敗の全巻き戻しと再実行、上限外rowid拒否、15履歴IDの保存|
|型検査|全workspace・scripts合格|
|migration方針・採番|530本合格。新規634は1本、同番号の使用なし|
|bootstrap整合・差分検査|合格|
|全workspaceビルド|指定API URLで合格|

初回の型検査では、共通の試験用データをWorkerのrootDir外のTypeScriptから読んだためTS6059になった。試験用データをmjsと型宣言へ分けて解消し、DB全2,247件・Worker全10,947件と全workspace・scriptsの型検査を再実行して合格を確認した。設定は変更していない。

- 逆変異5種類：保存記録の解放、別のお客さまの保護、削除後の精算読み取り、migrationのCASCADE、履歴トリガー。意図した試験失敗を確認し、元のコードを復元した。
- 残り：司令塔の取り込み・PR採番と `#0000` の置き換え、要件§11の承認待ち表示の更新。検証環境の件数と実行時間の確認・DB反映・配備は別の作業。
- push・PR作成・本線取り込み・検証・本番のD1への操作（dry-runを含む）・配備・実データ削除は未実施。親ECは読み取りのクリーン確認のみ。全試験に含まれる既存のローカルD1シミュレータは試験用データだけを使う。

## コミットと証拠

- migration・SQLite試験：`dffb47b7b78d9e47a0b2f7f0f2170524517c3dee`。
- API・読み取り・反映履歴：`18906a53fe63fd3d90c8ba2fdd7bbc929daf8b5c`。
- 試験・逆変異・型検査・ビルドのログ：`~/lh-work/design/v8/review/del36b-1010/`。`all-types-final` が修正後の型検査、`recheck-tests` が共通データ修正後のDB・Worker全試験。初回の失敗ログも理由の証拠として保存した。
- この報告のコミット後に作業ツリーのクリーン状態を再確認し、最終SHAを利用者へ返す。
