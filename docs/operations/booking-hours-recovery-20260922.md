# 2026-09-22 検証用営業時間の誤保存からの復旧

## 対象と承認

監査担当の操作ミスで、03:23〜03:24 JSTごろ、然-NEN- TEST の未設定だった営業時間を月曜09:00〜18:00・同時1件、他曜日休業として保存した。製品不具合とは分ける。利用者は元の未設定状態への復旧、および対象を限定したGitHub修復処理の追加を承認済み。アプリの配備、本番操作、DB全体の巻き戻しは承認範囲に含めない。

- DB: staging `nen-line-stg` / `00bd7aca-950b-4d67-b865-fd7427b9c43f`
- LINEアカウント: `b9dac3d2-b9a7-44b8-bdcf-6d466fd3fb51`
- 復旧: 該当時間帯1行だけを取り除き、`business_hours_configured` を0に戻す。設定行は削除しない。版は+1、更新時刻は復旧時刻。他の予約ルールは保持する。
- 実行期限: 2026-09-29 00:00 JST。期限後は停止し、再承認・再点検なしに延長しない。

## GitHubでの手順

`Migrate D1` の専用 operation を使う。既存の migrate/verify-operational-path とは別ジョブであり、マイグレーションの実行や管理表作成はしない。既存のGitHub Environment承認を迂回しない。ローカルPCにはCloudflareの資格情報を入れない。

1. PR検査・統合を済ませる。競合する別担当の更新がないこと、作業ツリーがクリーンでHEADが最新開発と一致することを確かめる。配備は不要。
2. `codex/development`、operation=`restore-booking-hours-20260922`、environment=`staging`、mode=`dry-run` で起動。他の入力は空。
3. 実行結果、バックアップ artifact、設定行/時間帯のID・版・時刻を読む。行数1+1、月曜09〜18/同時1件、事故時刻03:20〜03:25 JSTの範囲、記録された他の設定値との一致を確認する。事前検査はSELECTのみで変更しない。
4. 出力の64桁の照合値を `recovery_digest` にコピーし、同じ条件でmode=`apply`、`recovery_confirmation=RESTORE-20260922-TEST-HOURS` として起動。
5. applyでも再度読み取り、照合値を比べる。バックアップのGitHub artifact保存成功後だけ、同一トランザクション内で事前条件検査・対象削除・フラグ復旧・版更新・結果取得を行う。同時変更があれば全体を中止する。
6. DBの再読込照合が成功したら、Chrome `/booking/staff/shifts` で全曜日が「未設定（現在は担当者の勤務時間どおり）」へ戻ることを確認。保存ボタンは押さない。事故記録と監査の再開点を更新する。

## 失敗時

- 間違った環境・アカウント・枝・ワークフロー、期限外、別変更、バックアップ失敗、版の不一致では復旧しない。
- 適用要求は1回だけ。HTTP失敗や結果不明で自動再試行しない。通信断のときは適用済みの可能性がある。再実行前に現在値を読取で確認し、元のバックアップと比較する。
- 再実行では既に復旧済みの状態も不一致として停止する。成功を推測しない。誤保存行の作り直しや版の巻き戻しはしない。
- バックアップは設定/時間帯/関連スキーマのみ、90日保管。顧客、予約本文、資格情報は取得しない。
- D1全体のTime Travel restoreは、無関係の変更を消すので使わない。復旧前へ戻すことも新たなデータ変更のため、この処理は自動ロールバック操作を提供しない。

## 検査と制約

`pnpm exec vitest run scripts/recovery/booking-hours-20260922.test.ts scripts/migrate-d1-workflow.test.ts` と `pnpm typecheck:scripts` を実行する。SQLiteで全成功/途中失敗/同時更新/二重実行を検証し、HTTPは模擬応答で固定URLと再試行なしを検証する。これだけでは実D1での復旧成功や実画面の確認済みにはしない。

SQLを同一D1 batchにまとめる根拠: [Cloudflareのバッチ実行の説明](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)、[RESTのbatch形式](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/)。明示的なBEGIN/COMMITはリモートへ送らず、D1のバッチ境界を使う。

監査の再発防止: 実画面で「入力不備なので止まるはず」と保存/実行を押さない。入力検証は通信なし試験に移し、実画面では閲覧・一時入力・取消だけを行う。
