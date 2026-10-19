> 文書：本人確認・ログイン・保存期限の実装説明｜区分：今の説明｜最終確認：2026-10-19（日本時間）

# 本人確認・ログイン・保存期限の実装説明

要件の正本は追加要件と共通基盤。ここでは現在の呼び出し方と、配備前に確認する条件を説明する。配備・実通知・保存期限の有効化の完了を表さない。

## 本人確認の対象と画面への契約

既存 `POST /api/auth/step-up` にパスワードまたはTOTPと `purpose` を渡す。
返された確認票は `X-Step-Up-Token` で元の操作へ付ける。
不足は401、`code: STEP_UP_REQUIRED`、文言「この操作の前に、もう一度本人確認してください」。
401でログイン画面へ即移動せず、既存の本人確認の窓で受ける。
APIキーだけのプログラムには確認済みセッションがないため、重要操作を拒否する。
閲覧のみ・代理中の書き出しも拒否。運営本人の代理ログインの開始/書込/個人情報表示は本人確認を求める。
既存の10分の確認窓は同じ本人・セッションだけ。知らない端末は操作ごとの1回票。
鍵の再発行・MFA解除・原本取得など既存の強い1回票は維持する。

| 対象 | purpose | 適用 |
| --- | --- | --- |
| CSV、export/download、書き出し作成/作り直し | data.export | 全管理APIの共通入口、`format=csv`も含む |
| 配信のsend/send-segment/resume/retry-failed、統括の店ごとのretry、予約を有効にする保存 | broadcast.send | 共通入口。下書きの保存は再確認なし。既存の予約済み配信を変える口も再確認 |
| スタッフ・運営メンバーの追加/変更/停止 | staff.permissions.change | 共通入口と既存の担当別ガード。確認票は同一リクエストで二重消費しない |
| 代理ログインstart/write/pii-reveal | ops.impersonation | 共通入口、終了と閲覧への戻しは止めない |
| 鍵表示・成果受信鍵の発行 | secrets.reveal | 共通入口 |
| 配信承認、LINE接続と鍵の変更、Webhook鍵、個別API鍵、MFA、支払CSV、写真原本 | 既存の操作別purpose | 元のガードを保持。弱い共通の目的へ置き換えない |

管理画面用の型は `apps/web/src/lib/api/types/access.ts` の `StepUpPurpose`（公開口は `@/lib/api`）。ファイル取得は `downloadApiFile(path, filename, {stepUpToken})` で一回票も渡せる。画面側の接続と実環境での操作確認は別に点検する。

## ログイン

パスワードログイン `POST /api/auth/password/login` は既存のemail/password/rememberに
`turnstileToken` を追加する。未設定503、未確認/不正/通信失敗400、`TURNSTILE_REQUIRED`。
正常な検証が済む前にパスワードの検査・セッション発行をしない。画面のTurnstile部品から検証用の値を渡す。
同一メールへの10回/15分の失敗制限は既存のD1記録を使い、IPを変えても解除されない。
MFAの試行制限・LINEの署名済みログイン・API鍵用の既存制限は保つ。

新端末は726の `auth_known_devices` にスタッフID・端末のハッシュ・初回/最終日時だけ残す。
過去のセッションから比較の土台を引き継ぐ。新しいブラウザの印はSecure/HttpOnlyの1年cookieでサーバーが作り、DBにはそのハッシュだけを置く。同じブラウザ名の別PCも区別する。導入後の初回は新しい印の登録として通知する場合がある。生のIP/メール/ユーザーエージェントはこの表へ保存しない。
ログアウトでセッションがなくなっても新端末を見つける。ブラウザの版だけの更新は同じ端末として扱う。
検証/testでは `auth.login_notice.simulated` を監査へ残し、メールの外部送信をしない。
本番は既存のメール送信処理を呼ぶ。受信者にメールが登録されていなければ監査だけ。

## 配備前の設定点検

`scripts/security/deployment-safety.ts <staging|production> <実際に配備する設定>`。
Worker・Admin・検証の配備workflowで、配備より前に実行する。
Workerはビルド・CORS変数の注入後の設定を点検する。
CloudflareのGETだけを使い、実Workerの設定・secretの名前と型・R2の公開状態を確認する。
Workerの設定参照とR2の参照権限が必要。権限不足ならオーナーが最小の読取権限を確認する。エラー本文や設定値は出さない。不明・権限不足・応答不正・タイムアウトは配備を止める。

- 試験用の旗：本番のTEST/MOCK/DEMO/SANDBOX/BYPASSを検出。
- CORS：本番はadmin/api.musubo.jp、検証はstg-admin/stg-apiと検証Pagesの明示したホストだけ。
- R2：r2.devと独自ドメインの両方で非公開。IMAGESだけでなく全バインド先を確認。
- 必須secret：API_KEY、LINE_CREDENTIAL_ENCRYPTION_KEY、TURNSTILE_SECRET_KEY、GOOGLE_CALENDAR_CREDENTIAL_ENCRYPTION_KEY。名前と型だけを判定に使い、値は出力・保存しない。TOTPの鍵の必須化は保留B-351/7に従い追加しない（平文で置いた場合の検出はする）。
- 候補の設定と配備済みの設定を両方確認。不安全な配備先の修復が必要なら、オーナーが承認した修復の後に再実行。

CloudflareのAPI仕様は、[Workerと版の設定](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/script_and_version_settings/methods/get/)、[R2のr2.dev公開設定](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/domains/subresources/managed/methods/list/)、[R2の独自ドメイン](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/domains/subresources/custom/methods/list/)で照合した。
手元では実際の検証用設定と架空のAPI応答で合格を確認する。配備先の照会には専用の読み取り権限が必要。
本番設定に残るRESTAURANT_TEST_ENABLED=trueとAdminビルドの同等の旗は点検で停止する。
この作業で本番設定を変更せず、オーナーが止める手順を決める。実際の検証環境での合格は未確認。

## 保存期限と出力の印

設定は店ごとの既存 `account_settings` に `security.personalDataRetention.v1` として保存する。
値の形：`{ "enabled": false, "hold": false, "responseDays": 365, "blockedFriendDays": 365 }`。
**日数は案で、既定は無効**。店とオーナーが保存目的・期間・訴訟等の保留を確認してから有効にする。
不正な設定を削除日数0と解釈しない。hold=trueはその店の全対象を保留。
設定の口はGET/PUT `/api/account-settings/personal-data-retention`。
GETはaccountId、PUTはaccountId/expectedVersion/policyと `privacy.retention` の本人確認。
返す形は `{success:true,data:{version,policy}}`、競合409 `SAVE_CONFLICT`、別店/スタッフ/閲覧のみの保存は403。
管理者とオーナーだけ。画面用は `api-personal-data-retention.ts` の `personalDataRetentionApi.get/save`。
保存値は版とdataで包む。画面側の接続と実環境での操作確認は別に点検する。

| 情報 | 期限の案・起点 | 自動処理・例外 |
| --- | --- | --- |
| フォーム回答と添付 | 回答から365日 | 6時間レーン。既存の削除処理でR2を先に消す。他店や所属未確定の回答は推測で消さない |
| ブロック済みの人の個人情報 | 最後のブロックから365日 | 6時間レーン。本人の関連情報を既存の削除処理で消す。会計/審査/監査は保護を維持。稼働中のお客さまはプロフィール更新日だけで消さない |
| 以前に受け取った本人確認書類 | 店設定、既定90日 | 新しい受付は行わない。既存の期限と削除処理を維持し、短い専用期限を一般期限で延ばさない |
| 退会した統括の顧客情報 | 既存の退会後90日 | 既存の子から順の削除を維持 |
| Googleの受信コピー | 既存28日 | 既存の専用処理を維持 |
| スタッフの端末ハッシュ履歴 | 最後の利用から365日を案とする | スタッフ削除時は一緒に消す。日数による自動削除は未実装。新端末を見分ける比較元でもあるため、保持期間と消し方はオーナーの決定が残る |
| 会計・監査・審査等の保護対象 | 保管目的ごとに別途決定 | 履歴は勝手に物理削除しない。個人情報の残存範囲は個別確認が残る |

1回の削除候補は全店合計20件。成功・失敗の件数だけを記録。失敗は次回へ残し、削除処理の保護を迂回しない。
検証はcron停止中なので、WorkerのVitestの実SQLiteと架空のR2で確認する。本番/検証DBは触らない。
CSVはファイル名に操作者IDとUTC日時を付け、氏名は追加しない。既存のCSV取り込みはコメント行を受け付けないため、本文・BOM・列・行を全く変えず、取り込み直せることを試験する。ダウンロード用API関数も日本語の機能名と日本時間の日付を保って印を付ける。CORSは印の応答ヘッダーの参照だけを許可する。
CSV以外のダウンロードには同じ情報をファイル名・応答ヘッダーへ付ける。受領済み原本の内容は変えない。
新しく作る支払明細PDFには操作者IDと作成日時を本文にも入れる。画面側が応答のファイル名を使う接続は確認を続ける。


## 残る確認

保存期限の決定・有効化、端末履歴の期限削除、保護履歴に残る個人情報、全画面の接続、配備先設定、実メール、2人での鍵交換の練習は[点検表](SECURITY-CHECKLIST.md)で追う。手元の試験だけで済にしない。
