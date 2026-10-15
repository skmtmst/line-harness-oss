# 公開前の安全点検表

調査日：2026-10-16。対象：B-265・B-332。コードの基点：`cd63dd961f5dc2613a8b16c39a21d01e2cf7c8ba`（取得済みの `origin/codex/development` と一致）。開始時の作業ツリーはクリーン、`DOCTOR_LOCAL=1 bash scripts/codex/doctor.sh` は「合格」。

## 判定の読み方

- **済**：その行に書いた確認を実施した。コードを読んだだけの行は、本番で動作したという意味ではない。
- **未**：残る作業またはコード上の懸念を特定した。担当者の対応・試験が必要。
- **分からない**：本番の設定や契約など、この調査では確認できなかった。未設定と断定しない。
- **危なさ「高」**：乗っ取り・別の店の情報閲覧・誤配信・漏えい・復旧不能につながるもの。「中」は負荷や運用への影響を含む。

**集計：40項目＝済18・未12・分からない10。未のうち危なさ「高」は11項目。** 件数はこの表の行数で、脆弱性の件数や事故件数ではない。

この調査ではコード・設定・既存試験を読み、追跡対象のファイル一覧、GitHubの公開状態、依存関係の警告を確認した。本番・検証環境へのログイン、Cloudflareのsecret一覧取得、DB照会、外部送信、既存の動作試験の再実行はしていない。秘密や顧客情報を抽出しない。

表のパスはリポジトリのルートから。命令は原則として読むだけ。「検証で確認」は、別途用意した架空データの環境で担当者が行う次の作業。実際のお客さまへ試し送信しない。

## ログインと権限

| ID | 点検・危なさ | 確かめ方（命令・画面） | 今の状態 | 根拠のファイル |
| --- | --- | --- | --- | --- |
| S01 | ログインした本人と有効なセッションを確認する・高 | `rg -n 'state\|nonce\|authenticateAdminSession\|expires' apps/worker/src/routes/admin-auth.ts apps/worker/src/middleware/auth.ts`。発行・期限・失効の分岐を読む | 済：OAuthとセッションの確認処理を確認。配備先のログイン成功は別確認 | `apps/worker/src/routes/admin-auth.ts`、`apps/worker/src/middleware/auth.ts`、`apps/worker/src/routes/admin-auth-sessions.test.ts` |
| S02 | Cookieと不正な外部操作への対策・高 | `auth.ts` のCookie属性と更新時のCSRF比較、`admin-auth-config.ts` の許可元を読む | 済：Secure・HttpOnlyのセッションCookie、CSRF比較、接続構成の検査がある | `apps/worker/src/middleware/auth.ts`、`apps/worker/src/middleware/admin-auth-config.ts` |
| S03 | 新しいAPIがスタッフへ無条件に開かない・高 | `permissionForApiPath` とスタッフの許可条件、網羅試験の分類を読む | 済：未分類の管理APIはスタッフを403で拒否する設計。全APIの安全の証明ではない | `apps/worker/src/middleware/auth.ts`、`apps/worker/src/middleware/route-guard-coverage.test.ts` |
| S04 | 統括・店・別アカウントの境界・高 | `tenant-scope.ts`、各APIの所属確認と境界試験を読む。画面の「統括／店」と内部のowner/admin/staffを同じ意味と考えない | 済：共通の所属範囲検査とAPI別の制限がある。全経路の実動作はS07 | `apps/worker/src/middleware/tenant-scope.ts`、`apps/worker/src/middleware/role-guard.ts`、`apps/worker/src/routes/calendar.security.test.ts` |
| S05 | 閲覧のみでは変更・鍵取得ができない・高 | `auth.ts` の安全なHTTPメソッド以外の拒否、`denyReadOnly` を読む | 済：更新の一律拒否と、鍵情報などを読むこと自体の拒否がある | `apps/worker/src/middleware/auth.ts`、`apps/worker/src/middleware/role-guard.ts`、`apps/worker/src/routes/staff-api-key.security.test.ts` |
| S06 | 代理ログインは範囲・理由・履歴で制限する・高 | `resolveImpersonation`、伏せ字、書き出し拒否、理由付き表示、禁止操作を読む | 済：セッションに結び付き、既定は閲覧のみ。個人情報は既定で伏せ、解約等を禁止する | `apps/worker/src/middleware/impersonation.ts`、`apps/worker/src/routes/ops.ts`、`apps/worker/src/middleware/train30-impersonation.test.ts` |
| S07 | 全APIの権限の抜けを実際のリクエストで点検する・高 | 開発担当がOpenAPIと経路一覧を突合し、未ログイン・統括・店・閲覧のみ・代理ログインで別の店のIDを指定する。GET・書き出し・更新・削除を含め、401/403/情報を返さない404を確認 | 未：共通処理と代表試験の読解まで。全API×役割の再実行と結果表は未作成 | `apps/worker/src/index.ts`、`apps/worker/src/routes/openapi.ts`、`apps/worker/src/middleware/route-guard-coverage.test.ts` |
| S08 | 2人と不要アカウントの実際の権限・高 | 各サービスのメンバー画面とmusuboのユーザー管理を2人で確認し、[権限表](TWO-FACTOR-SETUP.md#誰に何の権限があるか)へ名前・役割だけ記録 | 分からない：アカウントの実際の割り当ては取得していない | `docs/brain/Memory.md`、`apps/worker/src/routes/staff.ts` |
| S09 | 二段階認証と回復手段・高 | [設定手順](TWO-FACTOR-SETUP.md)で各自の設定を確認。musubo側も二段階認証の設定と暗号化用secretの有無を担当者と確認 | 分からない：登録・必須化のコードはあるが、2人の設定と本番の鍵は未確認 | `apps/worker/src/routes/admin-auth.ts`、`apps/worker/src/lib/mfa-config.ts`、`apps/worker/src/routes/admin-auth-mfa-enforcement.test.ts` |

## WebhookとLIFF（お客さまの画面）

Webhookは、外部サービスから届く通知の入口。署名は「正しい相手が作った通知か」を確かめるための印。

| ID | 点検・危なさ | 確かめ方（命令・画面） | 今の状態 | 根拠のファイル |
| --- | --- | --- | --- | --- |
| S10 | LINE通知の署名・高 | `webhook.ts` の生の本文に対する署名検証と、失敗後に処理へ進まない分岐を読む | 済：JSONを読む前に検証。本文上限・署名の形式検査もある | `apps/worker/src/routes/webhook.ts`、`packages/line-sdk/src/`、`apps/worker/src/routes/webhook.test.ts` |
| S11 | Stripe通知の署名・高 | 購入通知と統括課金の2入口、共通の `verifyStripeSignature` を読む | 済：生の本文・HMAC・前後5分の時刻・本文上限を検査。鍵なしは503、署名不正は401 | `apps/worker/src/routes/stripe.ts`、`apps/worker/src/routes/hq-billing.ts`、`apps/worker/src/services/stripe-signature.ts`、`apps/worker/src/routes/stripe.security.test.ts` |
| S12 | Googleの通知入口の有無・高 | `rg -n -i 'x-goog\|pubsub\|calendar.*watch\|google.*webhook' apps/worker/src --glob '!*.test.*'` とカレンダー経路を読む。Google Cloud・Apps Script等の外側の設定も担当者が確認する | 済：このコード内ではGoogle Calendarから直接受けるpush通知の入口は見当たらず、API呼出し方式。署名実装済みとは数えない。外側の設定はS35で確認 | `apps/worker/src/routes/calendar.ts`、`apps/worker/src/services/google-calendar.ts` |
| S13 | Meet完了通知をGoogle通知と混同しない・高 | `/api/meet-callback` と共通の署名検証、受信済み記録を読む | 済：Meet Harness独自のHMACと前後5分の時刻を検証。Googleが付けた署名ではない | `apps/worker/src/routes/meet-callback.ts`、`apps/worker/src/services/support-relay.ts`、`docs/meet-callback-security.md` |
| S14 | LIFFの本人確認・高 | `verifyCallerLineIdentity` のLINEへのIDトークン照会と対象チャネルの選択を読む。ブラウザが送った友だちIDだけでは本人としない | 済：LINEの検証APIへIDトークンとチャネルIDを送り、返された本人IDを使う共通処理がある | `apps/worker/src/services/liff-auth.ts`、`apps/worker/src/services/liff-auth.test.ts`、`apps/worker/src/routes/liff.ts` |
| S15 | LIFF全入口で別人・別店・期限切れを拒否する・高 | 架空の本人Aで本人Bの予約・回答・添付を指定し拒否を確認。別チャネル・期限切れ・トークン欠落でも確認。公開閲覧の入口と本人操作を分けて一覧化する | 未：共通処理の確認まで。各入口に独自処理もあり、一括の実動作確認はしていない | `apps/worker/src/routes/liff.ts`、`apps/worker/src/routes/booking.ts`、`apps/worker/src/routes/forms.security.test.ts`、`apps/worker/src/routes/liff-oauth-scenario-gate.test.ts` |

## 秘密の値・個人情報

| ID | 点検・危なさ | 確かめ方（命令・画面） | 今の状態 | 根拠のファイル |
| --- | --- | --- | --- | --- |
| S16 | 秘密の正規の置き場・高 | secretの案内と環境別設定を読む。Cloudflare Worker secret、GitHub Environment secrets、手元の未追跡設定の使い分けを確認する | 済：LINE暗号化鍵等はWorker secretへ置く手順。通常変数へ置かない規定がある。実値や本番の設定状況は取得していない | `docs/line-credential-encryption.md`、`apps/worker/wrangler.toml`、`apps/worker/wrangler.staging.toml`、`.github/workflows/deploy-cloudflare-staging.yml` |
| S17 | 本番・検証のsecretの存在と分離・高 | 各Workerの Settings → Variables and Secrets とGitHubのEnvironment secretsで名前・型・権限だけ確認。担当者がLINE・Stripe・Google・Slack・管理ログイン・暗号化の鍵を照合する | 分からない：doctorは検証用の配備資格情報の名前を確認しただけ。サービス用secretや別々の値であることは未確認 | `scripts/codex/doctor.sh`、`apps/worker/src/index.ts`、`.github/workflows/deploy-cloudflare-staging.yml` |
| S18 | 実際の.envや.dev.varsをGitへ入れない・高 | `git ls-files` のファイル名を確認し、`.env`・`.env.*`・`.dev.vars*` からexample/sample/templateを除く。内容を表示しない | 済：現在の追跡対象に実設定ファイル0、例示ファイル2。.gitignoreに除外あり。履歴全体の証明ではない | `.gitignore`、`.env.example`、`docs/.env.example` |
| S19 | 全履歴・全枝の秘密検査・高 | 担当者が承認済みのsecret検査を全履歴・対象の全枝へ行う。GitHubのSecurity → Secret scanningも確認。結果は場所と種類のみ記録 | 未：今回の.env一覧確認では、ソースへの直書き、削除済み履歴、画像内の秘密まで不在とは言えない | `.gitignore`、`.github/workflows/`、`docs/line-credential-encryption.md` |
| S20 | DBのLINE認証情報が暗号化済みか・高 | 担当者が鍵設定・移行結果を値なしの件数で確認。暗号文の欠落・復号失敗・平文への切替の有無を確認する | 分からない：AES-GCMの実装はあるが、従来の平文を読む経路も残る。本番DBの完了状態は未照会 | `packages/db/src/credential-crypto.ts`、`packages/db/src/line-accounts.ts`、`docs/line-credential-encryption.md` |
| S21 | Google Calendarの認証情報の保存・高 | `createCalendarConnection` の保存直前と読込を確認し、担当者が暗号化・鍵管理・既存分の移行方法を検討する | 未：この経路はアクセストークン・更新用トークン・APIキーを暗号化せずDBへ渡す。保存時の保護を要対応とする。実DBの値は未取得 | `apps/worker/src/routes/calendar.ts`、`packages/db/src/calendar.ts` |
| S22 | アプリのログへ顧客本文・秘密を出さない・高 | `index.ts` の未処理エラーと固定コードのログ、ログの静的検査を読む | 済：未処理エラーは固定コードと経路の型を出す。秘密・生の例外を防ぐ検査がある。全ての実行ログを閲覧したわけではない | `apps/worker/src/index.ts`、`apps/worker/src/security-console-contract.test.ts`、`apps/worker/src/security-log.test.ts` |
| S23 | Slackへ個人情報・URLのクエリを出さない・高 | `client-errors.ts` → `reportHarnessErrorToSlack` → `sanitizeSlackContent` を追う。架空の氏名・メール・クエリ入り経路を、外へ送らない試験で検証する | 未：報告本文・経路・スタックを受け取る経路があり、伏せ字は一部トークン形式中心。指紋作成時に除くクエリを送信文では除いておらず、任意の個人情報も保証できない。漏えいが起きた証拠ではない | `apps/worker/src/routes/client-errors.ts`、`apps/worker/src/services/codex-slack-relay.ts`、`apps/worker/src/services/codex-slack-relay.test.ts` |
| S24 | 画面・書き出しの個人情報制限・高 | 代理ログイン時のJSON伏せ字、ファイル拒否、理由付き表示と監査を読む | 済：共通処理がある。通常ログインの閲覧権限や全画面の確認はS07・S25 | `apps/worker/src/middleware/impersonation.ts`、`apps/worker/src/middleware/output-audit.ts`、`apps/worker/src/middleware/train30-output-audit.test.ts` |
| S25 | 配備先の画面・ログ・Slackの保管設定・高 | 架空データで画面と書き出しを確認。Cloudflareのログ閲覧権限・保持期間、Slackの参加者・保持期間、公開画像・添付の範囲を担当者が点検 | 分からない：本番画面や保存済みのログ・Slack履歴は閲覧していない | `apps/worker/src/middleware/impersonation.ts`、`apps/worker/src/routes/client-errors.ts`、`AGENTS.md` |

## 依存関係・回数の制限

| ID | 点検・危なさ | 確かめ方（命令・画面） | 今の状態 | 根拠のファイル |
| --- | --- | --- | --- | --- |
| S26 | 開発・試験道具を含む依存の穴・高 | `pnpm audit --json`。警告を出した版とlockfileを照合し、安全な更新または到達しない根拠を記録する | 未：全体はcritical 2・high 1・moderate 12・low 4。tinypoolとbracesを優先。警告は侵入の証拠ではないが、開発PC・CIも対象になる | `package.json`、`pnpm-lock.yaml`、この文書の「依存検査の記録」 |
| S27 | 製品用の依存の穴・中 | `pnpm audit --prod --json`。担当者がビルド後に含まれる物と利用条件を確認する | 未：critical/high 0、moderate 8・low 1。製品用依存の絞り込み結果であり、本番への影響なしとは断定しない | `pnpm-lock.yaml`、`apps/worker/package.json`、`apps/web/package.json` |
| S28 | ログイン・出力・アップロードの回数制限・高 | `rate-limit.ts` と `sensitive-rate-limit.ts` を読む | 済：一般の急増制限に加え、重要操作はD1で共有。共有側の失敗時は503で止める。一般のカウンターはWorkerごとのメモリで、再起動で消える | `apps/worker/src/middleware/rate-limit.ts`、`apps/worker/src/middleware/sensitive-rate-limit.ts`、`apps/worker/src/middleware/rate-limit-shared.test.ts` |
| S29 | 本番で制限と負荷対策が効くか・中 | 担当者が検証用の低い予算で429・Retry-After・D1障害時の503を確認。Cloudflare側の防御と請求の監視も確認 | 分からない：本番で大量の試しアクセスはしていない。D1の必要な表、配備版、防御設定も未確認 | `apps/worker/src/middleware/sensitive-rate-limit.ts`、`apps/worker/src/middleware/rate-limit-shared.test.ts` |

## バックアップ・環境分離・公開範囲

| ID | 点検・危なさ | 確かめ方（命令・画面） | 今の状態 | 根拠のファイル |
| --- | --- | --- | --- | --- |
| S30 | D1を戻すための仕組み・高 | migration実行前の復元点取得と失敗時の中止を読む。[復元手順](INCIDENT-RUNBOOK.md#dbを壊した)を確認 | 済：移行前にTime Travelの復元点を取る処理・手順がある。コードの巻き戻しとDB復元は別工程 | `scripts/deploy/migrate.ts`、`.github/workflows/migrate-d1.yml`、`docs/migration-runbook.md` |
| S31 | 本番の復元可能期間・安全な控え・担当・高 | CloudflareのD1画面と契約プラン、現在の復元点を確認。`pnpm exec wrangler d1 time-travel info <DB名> --config <対象設定>`。実値やDBの書き出しをGit/Slackへ置かない | 分からない：契約・復元点・別保管の有無を未確認。無料7日／有料30日が公式の上限で、古い手順の「30日」を一律に採用しない | `docs/migration-runbook.md`、`scripts/deploy/migrate.ts`、下記Cloudflare公式資料 |
| S32 | 実際に復元できるかの練習・高 | マサトさん承認の使い捨てDBで、架空データの控え→破損→復元→件数・予約・配信状態確認を行い、時間を記録 | 未：この調査では復元を実行していない。書類があることと戻せることは別 | `docs/migration-runbook.md`、`docs/DEPLOY-GATE.md` |
| S33 | D1以外の控え・中 | R2の添付・画像、設定、暗号化鍵の保管と復旧手段を確認する。DBとファイルが同じ時点へ戻せるか確認 | 分からない：D1のTime TravelではR2やsecretは戻らない。別保管・復元の実績は未確認 | `apps/worker/wrangler.toml`、`apps/worker/wrangler.staging.toml`、`docs/line-credential-encryption.md` |
| S34 | 本番と検証の資源を分ける・高 | 2本のwrangler設定でWorker・D1・画像保存先・公開先・環境名を比較する | 済：設定上は別の資源を指定。実際の配備先や秘密の分離はS17・S35 | `apps/worker/wrangler.toml`、`apps/worker/wrangler.staging.toml`、`docs/DEPLOY-GATE.md` |
| S35 | 実際の接続先・顧客データ・外部サービスの分離・高 | Cloudflare、LINE Developers、Stripeの本番／sandbox、Googleのプロジェクト・カレンダー・通知先を管理画面で照合。検証に本番の個人情報がないことも確認 | 分からない：実設定を未取得。設定ファイルが別でも、同じ鍵・通知先・データを使っていない証明にはならない | `apps/worker/wrangler.toml`、`apps/worker/wrangler.staging.toml`、`.github/workflows/deploy-cloudflare-staging.yml` |
| S36 | 本番でテスト用機能を閉じる・高 | 本番設定の `RESTAURANT_TEST_ENABLED` と実効値を担当者が確認。オーナーの方針と照合して修正・再検証する | 未：本番用ファイルがtrueで、Memoryの「本番では無効」と食い違う。現在の本番も有効とは未確認 | `apps/worker/wrangler.toml`、`docs/brain/Memory.md`、`apps/worker/src/middleware/feature-enforcement.ts` |
| S37 | 公開リポジトリの扱い（B-332）・高 | `gh repo view skmtmst/line-harness-oss --json visibility`。オーナー側で Settings → General → Danger Zone の非公開化を確認する | 未：調査時はPUBLIC。「落ち着いたら非公開に」は未実施。切替は司令塔へ。過去のコピーは非公開化では消えない | `AGENTS.md`、この文書の調査記録 |
| S38 | 公開する文書・画像・履歴に個人情報を残さない・高 | オーナーと担当者が現行・過去の顧客資料、スクリーンショット、添付、公開成果物を確認。削除の前に記録保全と必要な連絡を検討する | 未：今回はこの4文書への転記防止まで。既存リポジトリ全履歴の個人情報点検は未実施 | `docs/`、`.github/workflows/`、`.gitignore` |
| S39 | 事故対応を2人で練習する・高 | [事故の手順](INCIDENT-RUNBOOK.md)で、管理画面に入れない場合・誤配信・DB破損を机上練習。緊急停止の対象外も確認する | 未：手順は今回作成。連絡網の確認・停止・復元の練習は未実施 | `apps/worker/src/routes/operations.ts`、`apps/worker/src/services/operation-send-paths.ts`、`docs/DEPLOY-GATE.md` |
| S40 | ドメインを取り返せる管理体制・高 | 登録会社とDNS管理会社を請求・契約画面で確認し、二段階認証・更新期限・回復方法・権限を2人で照合 | 分からない：CloudflareでDNSを使っていても、登録会社が同じとは断定できない | `apps/worker/wrangler.toml`、`docs/security/TWO-FACTOR-SETUP.md` |

## 先に扱う項目と担当案

「未・高」は **S07・S15・S19・S21・S23・S26・S32・S36・S37・S38・S39**。

| 順番 | 対象 | 次の行動 | 担当案 |
| --- | --- | --- | --- |
| 1 | S21・S23・S36 | DBへ保存する秘密の保護、Slack報告の絞り込み、本番設定の食い違いを修正タスク化 | Codexが実装案、司令塔が割り当て。DB変更は番号ごとに承認 |
| 2 | S26・S27 | 依存の警告と実際の利用条件を確認し、開発PC・CIも含めて対処 | 開発担当・司令塔 |
| 3 | S07・S15 | APIとLIFFの全入口の権限確認を、架空データで実行して証拠を残す | API担当・画面担当 |
| 4 | S19・S38・S37 | 公開物の秘密・個人情報の検査とB-332の非公開化 | オーナー・マサトさん・司令塔 |
| 5 | S32・S39、「分からない」10件 | バックアップと事故練習、各サービスの権限・二段階認証・実設定を確認 | オーナー・マサトさん |

## 依存検査の記録

`pnpm audit --json` と `pnpm audit --prod --json` を実行。どちらも警告ありで終了1。修正や依存の追加はしていない。現在の警告データベースに対する結果なので、公開前に再実行する。

| 範囲 | critical | high | moderate | low |
| --- | --- | --- | --- | --- |
| 全体 | 2 | 1 | 12 | 4 |
| 製品用依存だけ（`--prod`） | 0 | 0 | 8 | 1 |

criticalの2件はtinypool、highの1件はbraces。表はpnpmが返したmetadataの集計であり、異なる部品や固有の警告番号の数ではない。lockfileにはtinypool 1.1.1とbraces 3.0.3があり、警告の対象版に含まれることを確認した。全体の監査応答では依存経路が空だったため、親パッケージや本番で攻撃が成立する条件は断定していない。[tinypoolの警告1](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3)、[警告2](https://github.com/advisories/GHSA-85c8-ppgw-ccpr)、[bracesの警告](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)で利用条件と修正方法を確認する。

S23は架空のメール形式・クエリ付きURLを既存の伏せ字関数へ渡すオフライン確認も実施し、両方が残ることを確認した。外部への送信や本物の顧客情報の使用はしていない。

生の監査結果は調査端末の一時ファイル（`/tmp/lh-prelaunch-audit-1016.json` と `-audit-prod-1016.json`）にあり、リポジトリには入れない。上の集計と命令を再確認の入口にする。

## コード整理との分担・既存手順

手元の `~/lh-work/design/v8/review/CLEANUP-PLAN-1016.md` の**④（§4「何も見張っていない試験・古い失敗」T01〜T03）**を参照する。この文書はリポジトリ外で、GitHubからは直接読めない。司令塔が手元の計画と対応付ける。

S07・S15・S22・S24・S28の「試験が本当の故障を見付けるか」は整理側のT01と重なる。旧い文字の確認だけを減らす場合も、権限・署名・本人確認・停止・失敗の動作試験は先に残す。整理で試験を消して安全対策済みにはしない。依存更新や秘密管理の修正を単なる不要コード削除へ混ぜない。

- [配備の承認・排他](../DEPLOY-GATE.md)：本番はマサトさんの明示承認と担当指定。現行AGENTS.mdの司令塔運用を優先する。
- [DBの移行と復元](../migration-runbook.md)：旧日付の件数・未適用番号・PR例を現在の状態として使わない。
- [LINEの秘密の暗号化](../line-credential-encryption.md)、[Meet完了通知](../meet-callback-security.md)。
- [D1のTime Travel公式資料](https://developers.cloudflare.com/d1/reference/time-travel/)：保持期間はプラン別。S31は契約画面でも確認する（2026-10-16参照）。

更新時は行に担当・確認日・秘密を除いた証拠を足し、集計と[入口](README.md)を同時に更新する。
