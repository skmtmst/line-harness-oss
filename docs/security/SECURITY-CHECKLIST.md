# 公開前の安全点検表

調査日：2026-10-16。対象：B-265・B-332。コードの基点：`cd63dd961f5dc2613a8b16c39a21d01e2cf7c8ba`（取得済みの `origin/codex/development` と一致）。開始時の作業ツリーはクリーン、`DOCTOR_LOCAL=1 bash scripts/codex/doctor.sh` は「合格」。

## 判定の読み方

- **済**：その行に書いた確認を実施した。コードを読んだだけの行は、本番で動作したという意味ではない。
- **未**：残る作業またはコード上の懸念を特定した。担当者の対応・試験が必要。
- **分からない**：本番の設定や契約など、この調査では確認できなかった。未設定と断定しない。
- **危なさ「高」**：乗っ取り・別の店の情報閲覧・誤配信・漏えい・復旧不能につながるもの。「中」は負荷や運用への影響を含む。

**修正後の集計：40項目＝済21・未9・分からない10。未のうち危なさ「高」は8項目。** 件数はこの表の行数で、脆弱性の件数や事故件数ではない。

初回調査ではコード・設定・既存試験を読み、追跡対象のファイル一覧、GitHubの公開状態、依存関係の警告を確認した。本番・検証環境へのログイン、Cloudflareのsecret一覧取得、DB照会、外部送信、既存の動作試験の再実行はしていない。秘密や顧客情報を抽出しない。

2026-10-16の修正では、`08c94923e3` を保持し、試験前に最新取得した開発枝 `5ace6976dc519607874959df2b9f6396868e27a2` をmergeした。続きでは開発枝 `765373beee065d1ef2e6f846cfc7d38f176f786c` を通常mergeした。担当：kenta / Codex。修正・残件・オーナーの手順・故障対照は[修正記録](SECURITY-FIXES-1016.md)。本番・検証DB、secret、配備先の設定は変更していない。

表のパスはリポジトリのルートから。命令は原則として読むだけ。「検証で確認」は、別途用意した架空データの環境で担当者が行う次の作業。実際のお客さまへ試し送信しない。

## ログインと権限

| ID | 点検・危なさ | 確かめ方（命令・画面） | 今の状態 | 根拠のファイル |
| --- | --- | --- | --- | --- |
| S01 | ログインした本人と有効なセッションを確認する・高 | `rg -n 'state\|nonce\|authenticateAdminSession\|expires' apps/worker/src/routes/admin-auth.ts apps/worker/src/middleware/auth.ts`。発行・期限・失効の分岐を読む | 済：OAuthとセッションの確認処理を確認。配備先のログイン成功は別確認 | `apps/worker/src/routes/admin-auth.ts`、`apps/worker/src/middleware/auth.ts`、`apps/worker/src/routes/admin-auth-sessions.test.ts` |
| S02 | Cookieと不正な外部操作への対策・高 | `auth.ts` のCookie属性と更新時のCSRF比較、`admin-auth-config.ts` の許可元を読む | 済：Secure・HttpOnlyのセッションCookie、CSRF比較、接続構成の検査がある | `apps/worker/src/middleware/auth.ts`、`apps/worker/src/middleware/admin-auth-config.ts` |
| S03 | 新しいAPIがスタッフへ無条件に開かない・高 | `permissionForApiPath` とスタッフの許可条件、網羅試験の分類を読む | 済：未分類の管理APIはスタッフを403で拒否する設計。全APIの安全の証明ではない | `apps/worker/src/middleware/auth.ts`、`apps/worker/src/middleware/route-guard-coverage.test.ts` |
| S04 | 統括・店・別アカウントの境界・高 | `tenant-scope.ts`、各APIの所属確認と境界試験を読む。画面の「統括／店」と内部のowner/admin/staffを同じ意味と考えない | 済：共通の所属範囲検査とAPI別の制限がある。全経路の実動作はS07 | `apps/worker/src/middleware/tenant-scope.ts`、`apps/worker/src/middleware/role-guard.ts`、`apps/worker/src/routes/calendar.security.test.ts` |
| S05 | 閲覧のみでは変更・鍵取得ができない・高 | `auth.ts` の安全なHTTPメソッド以外の拒否、`denyReadOnly` を読む | 済：更新の一律拒否と、鍵情報などを読むこと自体の拒否がある。続きでCSV・export・downloadの拒否も追加し、機能ごとの閲覧権限からの書出しも止める | `apps/worker/src/middleware/auth.ts`、`apps/worker/src/middleware/role-guard.ts`、`apps/worker/src/routes/staff-api-key.security.test.ts` |
| S06 | 代理ログインは範囲・理由・履歴で制限する・高 | `resolveImpersonation`、伏せ字、書き出し拒否、理由付き表示、禁止操作を読む | 済：セッションに結び付き、既定は閲覧のみ。個人情報は既定で伏せ、解約等を禁止する | `apps/worker/src/middleware/impersonation.ts`、`apps/worker/src/routes/ops.ts`、`apps/worker/src/middleware/train30-impersonation.test.ts` |
| S07 | 全APIの権限の抜けを実際のリクエストで点検する・高 | 開発担当がOpenAPIと経路一覧を突合し、未ログイン・統括・店・閲覧のみ・代理ログインで別の店のIDを指定する。GET・書き出し・更新・削除を含め、401/403/情報を返さない404を確認 | 未：実登録と照合した[全1,652経路の一覧](API-ROUTE-INVENTORY-1016.tsv)と[管理1,479経路の共通境界](API-BOUNDARY-RESULTS-1016.tsv)。一覧・履歴・集計・Google連携・旧共通資源・閲覧のみのCSV書出しの抜けを修正し、実データ付きの拒否試験を追加（[修正と残条件](API-ROUTE-REVIEW-1016.md)）。他店資源ID単独・代理ログインの全組合せの個別証拠は未完。旧スコア5経路はbehaviorfixと同じ410停止を維持 | `apps/worker/src/middleware/route-guard-coverage.test.ts`、`routes/security-scope-inventory.test.ts`、`test-utils/route-security-inventory.ts` |
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
| S15 | LIFF全入口で別人・別店・期限切れを拒否する・高 | 架空の本人Aで本人Bの予約・回答・添付を指定し拒否を確認。別チャネル・期限切れ・トークン欠落でも確認。公開閲覧の入口と本人操作を分けて一覧化する | 未：全入口は[経路一覧](API-ROUTE-INVENTORY-1016.tsv)へ収録。前回の予約14経路に加え、イベント8経路・待ち案内2経路・ウェビナー7経路の他店チャネルを拒否。未割当の他統括利用、停止統括の素材・案内・会員/ペット9経路、LIFFと店の指定不一致も修正。全入口×別人・別店・失効の実資源を使う検査は未完（[記録](API-ROUTE-REVIEW-1016.md)） | `routes/events-channel.security.test.ts`、`routes/webinars-channel.security.test.ts`、`services/liff-auth.test.ts`、`packages/db/test/friend-account-lookup.test.ts`、`packages/db/test/webinar-public-scope.test.ts` |

## 秘密の値・個人情報

| ID | 点検・危なさ | 確かめ方（命令・画面） | 今の状態 | 根拠のファイル |
| --- | --- | --- | --- | --- |
| S16 | 秘密の正規の置き場・高 | secretの案内と環境別設定を読む。Cloudflare Worker secret、GitHub Environment secrets、手元の未追跡設定の使い分けを確認する | 済：LINE暗号化鍵等はWorker secretへ置く手順。通常変数へ置かない規定がある。実値や本番の設定状況は取得していない | `docs/line-credential-encryption.md`、`apps/worker/wrangler.toml`、`apps/worker/wrangler.staging.toml`、`.github/workflows/deploy-cloudflare-staging.yml` |
| S17 | 本番・検証のsecretの存在と分離・高 | 各Workerの Settings → Variables and Secrets とGitHubのEnvironment secretsで名前・型・権限だけ確認。担当者がLINE・Stripe・Google・Slack・管理ログイン・暗号化の鍵を照合する | 分からない：doctorは検証用の配備資格情報の名前を確認しただけ。サービス用secretや別々の値であることは未確認 | `scripts/codex/doctor.sh`、`apps/worker/src/index.ts`、`.github/workflows/deploy-cloudflare-staging.yml` |
| S18 | 実際の.envや.dev.varsをGitへ入れない・高 | `git ls-files` のファイル名を確認し、`.env`・`.env.*`・`.dev.vars*` からexample/sample/templateを除く。内容を表示しない | 済：現在の追跡対象に実設定ファイル0、例示ファイル2。.gitignoreに除外あり。履歴全体の証明ではない | `.gitignore`、`.env.example`、`docs/.env.example` |
| S19 | 全履歴・全枝の秘密検査・高 | 担当者が承認済みのsecret検査を全履歴・対象の全枝へ行う。GitHubのSecurity → Secret scanningも確認。結果は場所と種類のみ記録 | 済：2026-10-16 kenta。公式Gitleaks 8.30.1をchecksum照合して使用。全ローカルref＋originの現行全枝/tagを隔離mirrorへ取得し、5,704参照・25,793コミットで検出0（終了0）。削除済み履歴の架空secretは終了1で検出し、出力の伏せ字も確認。未到達の履歴・画像内の文字・任意の秘密の不存在まで保証しない。GitHub側の監視設定はオーナー | `.gitignore`、`.github/workflows/`、`docs/line-credential-encryption.md` |
| S20 | DBのLINE認証情報が暗号化済みか・高 | 担当者が鍵設定・移行結果を値なしの件数で確認。暗号文の欠落・復号失敗・平文への切替の有無を確認する | 分からない：AES-GCMの実装はあるが、従来の平文を読む経路も残る。本番DBの完了状態は未照会 | `packages/db/src/credential-crypto.ts`、`packages/db/src/line-accounts.ts`、`docs/line-credential-encryption.md` |
| S21 | Google Calendarの認証情報の保存・高 | `createCalendarConnection` の保存直前と読込を確認し、担当者が暗号化・鍵管理・既存分の移行方法を検討する | 未：新規保存3種はAES-GCMへ修正済。鍵欠落・不正なら保存せず、平文・改ざんはGoogleへ渡さない（`calendar-credentials.security.test.ts`）。既存平文の処理と専用secret登録はオーナー作業が残る。実DBは未照会 | `apps/worker/src/routes/calendar.ts`、`packages/db/src/calendar.ts` |
| S22 | アプリのログへ顧客本文・秘密を出さない・高 | `index.ts` の未処理エラーと固定コードのログ、ログの静的検査を読む | 済：未処理エラーは固定コードと経路の型を出す。秘密・生の例外を防ぐ検査がある。全ての実行ログを閲覧したわけではない | `apps/worker/src/index.ts`、`apps/worker/src/security-console-contract.test.ts`、`apps/worker/src/security-log.test.ts` |
| S23 | Slackへ個人情報・URLのクエリを出さない・高 | `client-errors.ts` → `reportHarnessErrorToSlack` → `sanitizeSlackContent` を追う。架空の氏名・メール・クエリ入り経路を、外へ送らない試験で検証する | 済：2026-10-16 kenta。自動エラー報告を固定のエラー種別・許可した機能名・正規化した日時だけへ限定。自由文・スタック・動的ID・ホスト・クエリ・断片を通知と要対応metadataへ出さない。`codex-slack-relay.test.ts`のS23で全送信本文を検査し、旧実装では失敗することも確認。既存Slack履歴の点検はS25/S38 | `apps/worker/src/routes/client-errors.ts`、`apps/worker/src/services/codex-slack-relay.ts`、`apps/worker/src/services/codex-slack-relay.test.ts` |
| S24 | 画面・書き出しの個人情報制限・高 | 代理ログイン時のJSON伏せ字、ファイル拒否、理由付き表示と監査を読む | 済：共通処理がある。通常ログインの閲覧権限や全画面の確認はS07・S25 | `apps/worker/src/middleware/impersonation.ts`、`apps/worker/src/middleware/output-audit.ts`、`apps/worker/src/middleware/train30-output-audit.test.ts` |
| S25 | 配備先の画面・ログ・Slackの保管設定・高 | 架空データで画面と書き出しを確認。Cloudflareのログ閲覧権限・保持期間、Slackの参加者・保持期間、公開画像・添付の範囲を担当者が点検 | 分からない：本番画面や保存済みのログ・Slack履歴は閲覧していない | `apps/worker/src/middleware/impersonation.ts`、`apps/worker/src/routes/client-errors.ts`、`AGENTS.md` |

## 依存関係・回数の制限

| ID | 点検・危なさ | 確かめ方（命令・画面） | 今の状態 | 根拠のファイル |
| --- | --- | --- | --- | --- |
| S26 | 開発・試験道具を含む依存の穴・高 | `pnpm audit --json`。警告を出した版とlockfileを照合し、安全な更新または到達しない根拠を記録する | 未：司令塔の承認で開発専用Vitestを4.1.11へ更新し、tinypoolがなくなりCritical 2→0。全体はCritical 0 / High 1 / Moderate 5 / Low 4。bracesのHighは修正版なし。開発のNext lint経由で、深く入れ子にしたglob入力が悪用条件。現設定はglobを指定せず、その回避条件を `lint-glob-boundary.test.ts` で監視する。全検査と故障対照は修正記録へ | `package.json`、`pnpm-lock.yaml`、この文書の「依存検査の記録」 |
| S27 | 製品用の依存の穴・中 | `pnpm audit --prod --json`。担当者がビルド後に含まれる物と利用条件を確認する | 未：修正後critical/high 0、moderate 5・low 1（修正前8・1）。製品用依存の絞り込み結果であり、本番への影響なしとは断定しない | `pnpm-lock.yaml`、`apps/worker/package.json`、`apps/web/package.json` |
| S28 | ログイン・出力・アップロードの回数制限・高 | `rate-limit.ts` と `sensitive-rate-limit.ts` を読む | 済：一般の急増制限に加え、重要操作はD1で共有。共有側の失敗時は503で止める。一般のカウンターはWorkerごとのメモリで、再起動で消える | `apps/worker/src/middleware/rate-limit.ts`、`apps/worker/src/middleware/sensitive-rate-limit.ts`、`apps/worker/src/middleware/rate-limit-shared.test.ts` |
| S29 | 本番で制限と負荷対策が効くか・中 | 担当者が検証用の低い予算で429・Retry-After・D1障害時の503を確認。Cloudflare側の防御と請求の監視も確認 | 分からない：本番で大量の試しアクセスはしていない。D1の必要な表、配備版、防御設定も未確認 | `apps/worker/src/middleware/sensitive-rate-limit.ts`、`apps/worker/src/middleware/rate-limit-shared.test.ts` |

## バックアップ・環境分離・公開範囲

| ID | 点検・危なさ | 確かめ方（命令・画面） | 今の状態 | 根拠のファイル |
| --- | --- | --- | --- | --- |
| S30 | D1を戻すための仕組み・高 | migration実行前の復元点取得と失敗時の中止を読む。[復元手順](INCIDENT-RUNBOOK.md#dbを壊した)を確認 | 済：移行前にTime Travelの復元点を取る処理・手順がある。コードの巻き戻しとDB復元は別工程 | `scripts/deploy/migrate.ts`、`.github/workflows/migrate-d1.yml`、`docs/migration-runbook.md` |
| S31 | 本番の復元可能期間・安全な控え・担当・高 | CloudflareのD1画面と契約プラン、現在の復元点を確認。`pnpm exec wrangler d1 time-travel info <DB名> --config <対象設定>`。実値やDBの書き出しをGit/Slackへ置かない | 分からない：契約・復元点・別保管の有無を未確認。無料7日／有料30日が公式の上限で、古い手順の「30日」を一律に採用しない | `docs/migration-runbook.md`、`scripts/deploy/migrate.ts`、下記Cloudflare公式資料 |
| S32 | 実際に復元できるかの練習・高 | マサトさん承認の使い捨てDBで、架空データの控え→破損→復元→件数・予約・配信状態確認を行い、時間を記録 | 未：DB適用禁止のため復元練習は未実施。[オーナーがやること](#オーナーがやること)のS32に承認・架空データ・破損・復元・確認・記録の手順を記載 | `docs/migration-runbook.md`、`docs/DEPLOY-GATE.md` |
| S33 | D1以外の控え・中 | R2の添付・画像、設定、暗号化鍵の保管と復旧手段を確認する。DBとファイルが同じ時点へ戻せるか確認 | 分からない：D1のTime TravelではR2やsecretは戻らない。別保管・復元の実績は未確認 | `apps/worker/wrangler.toml`、`apps/worker/wrangler.staging.toml`、`docs/line-credential-encryption.md` |
| S34 | 本番と検証の資源を分ける・高 | 2本のwrangler設定でWorker・D1・画像保存先・公開先・環境名を比較する | 済：設定上は別の資源を指定。実際の配備先や秘密の分離はS17・S35 | `apps/worker/wrangler.toml`、`apps/worker/wrangler.staging.toml`、`docs/DEPLOY-GATE.md` |
| S35 | 実際の接続先・顧客データ・外部サービスの分離・高 | Cloudflare、LINE Developers、Stripeの本番／sandbox、Googleのプロジェクト・カレンダー・通知先を管理画面で照合。検証に本番の個人情報がないことも確認 | 分からない：実設定を未取得。設定ファイルが別でも、同じ鍵・通知先・データを使っていない証明にはならない | `apps/worker/wrangler.toml`、`apps/worker/wrangler.staging.toml`、`.github/workflows/deploy-cloudflare-staging.yml` |
| S36 | 本番でテスト用機能を閉じる・高 | 本番設定の `RESTAURANT_TEST_ENABLED` と実効値を担当者が確認。オーナーの方針と照合して修正・再検証する | 済：2026-10-16 kenta。コードでDEPLOY_ENV=productionならtrueでも無効化。管理API・外部通知・sandbox用内部入口をD1へ触る前に404へ（`restaurant-production.security.test.ts`、`environment-features.test.ts`）。cron・受信メールも同じ判定を使い、環境名の欠落・未知の値でも無効。本番設定ファイルのtrueは指示により変更せず、実配備確認と設定整理はオーナー作業 | `apps/worker/wrangler.toml`、`docs/brain/Memory.md`、`apps/worker/src/middleware/feature-enforcement.ts` |
| S37 | 公開リポジトリの扱い（B-332）・高 | `gh repo view skmtmst/line-harness-oss --json visibility`。オーナー側で Settings → General → Danger Zone の非公開化を確認する | 未：修正時も`gh repo view`でPUBLIC。非公開化は設定変更なので実施せず、[オーナーがやること](#オーナーがやること)のS37へ。過去のコピーは非公開化では消えない | `AGENTS.md`、この文書の調査記録 |
| S38 | 公開する文書・画像・履歴に個人情報を残さない・高 | オーナーと担当者が現行・過去の顧客資料、スクリーンショット、添付、公開成果物を確認。削除の前に記録保全と必要な連絡を検討する | 未：文書・画像・添付・公開成果物の全履歴点検は未実施。[オーナーがやること](#オーナーがやること)のS38で公開面ごとの担当・保全・確認を指定 | `docs/`、`.github/workflows/`、`.gitignore` |
| S39 | 事故対応を2人で練習する・高 | [事故の手順](INCIDENT-RUNBOOK.md)で、管理画面に入れない場合・誤配信・DB破損を机上練習。緊急停止の対象外も確認する | 未：2人の参加と停止操作の承認が必要で未実施。[オーナーがやること](#オーナーがやること)のS39で机上練習・使い捨て環境での故障・復旧確認を指定 | `apps/worker/src/routes/operations.ts`、`apps/worker/src/services/operation-send-paths.ts`、`docs/DEPLOY-GATE.md` |
| S40 | ドメインを取り返せる管理体制・高 | 登録会社とDNS管理会社を請求・契約画面で確認し、二段階認証・更新期限・回復方法・権限を2人で照合 | 分からない：CloudflareでDNSを使っていても、登録会社が同じとは断定できない | `apps/worker/wrangler.toml`、`docs/security/TWO-FACTOR-SETUP.md` |

## 先に扱う項目と担当案

今回扱った11項目のうち、S19の履歴検査、S23・S36のコード確認を「済」に更新。残る「未・高」は **S07・S15・S21・S26・S32・S37・S38・S39**。S07・S15・S21・S26にも修正・試験はあるが、残条件があるため「済」へ繰り上げない。

| 順番 | 対象 | 次の行動 | 担当案 |
| --- | --- | --- | --- |
| 1 | S21・S23・S36 | DBへ保存する秘密の保護、Slack報告の絞り込み、本番設定の食い違いを修正タスク化 | Codexが実装案、司令塔が割り当て。DB変更は番号ごとに承認 |
| 2 | S26・S27 | 依存の警告と実際の利用条件を確認し、開発PC・CIも含めて対処 | 開発担当・司令塔 |
| 3 | S07・S15 | APIとLIFFの全入口の権限確認を、架空データで実行して証拠を残す | API担当・画面担当 |
| 4 | S19・S38・S37 | 公開物の秘密・個人情報の検査とB-332の非公開化 | オーナー・マサトさん・司令塔 |
| 5 | S32・S39、「分からない」10件 | バックアップと事故練習、各サービスの権限・二段階認証・実設定を確認 | オーナー・マサトさん |

## 依存検査の記録

### 修正後（2026-10-16 kenta）

前回の修正時点（続きの更新前）：`pnpm audit --json`：critical 2 / high 1 / moderate 9 / low 4、`--prod`：critical/high 0 / moderate 5 / low 1（どちらも警告で終了1）。`fast-uri`は3.1.7→3.1.8、`ip-address`は10.7.0→10.7.1。監査件数に出ないLINE公式の安全上の更新案内も確認し、`@line/liff`は2.31.0→2.31.1へ更新（[公式](https://developers.line.biz/en/docs/liff/release-notes/#liff-v2-31-1)）。全lockfileの該当部品を検査する `scripts/security/patched-dependencies.test.ts` は、古い版が1つ混ざっても失敗する。修正版の根拠：[fast-uriの警告](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj)、[ip-addressの警告](https://github.com/advisories/GHSA-j6r3-76f7-8jcv)と[別の警告](https://github.com/advisories/GHSA-h3mg-xc3c-68pw)。本番に届く程度をこの件数だけでは判断しない。

続きではVitest 4.1.11へ更新し、Critical 0 / High 1 / Moderate 5 / Low 4、製品用0 / 0 / 5 / 1。両方警告による終了1。Highの到達条件と回避策は[続きの記録](SECURITY-FIXES-1016.md#修正版がないhigh-1件)。

前回止めた理由（司令塔が後に更新を承認）：Criticalの2件は同じtinypool 1.1.1。両方の修正版は2.1.2以上で、1→2系の更新になる。既存Vitest 3.2.7の依存範囲は1系で、強制overrideは互換性の試験が必要なため実施しない。braces 3.0.3のHighは監査上の修正版なし。S26は未のまま。[影響とオーナー判断](SECURITY-FIXES-1016.md#s26-依存の更新と止めた更新)。

### 初回調査（修正前）

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


## オーナーがやること

以下はオーナー側に残る作業。S19の一時点の履歴検査は実施済みで、公開直前の再検査とGitHubの監視設定は別。担当案はケンタさん・マサトさん、操作役は司令塔と相談して指定。実行日・対象環境・結果・秘密を除いた証拠だけを各行へ追記する。値・顧客本文・認証画面・復元点は貼らない。

| ID | 手順 | 完了の条件・故障の確かめ方 |
| --- | --- | --- |
| S19 | 今回のGitleaks 8.30.1による全参照検査と故障対照は済。公開直前に承認済みの端末で同じ版と検出設定を固定して再検査。全対象remoteの枝・tagを取得して対象ref数を記録し、`gitleaks git --redact=100 --log-opts="--all" .` を実行。レポートと標準出力はGit/Slack外の権限を絞った保管先へ。GitHub SecurityのSecret scanning・push protectionの利用可否と有効範囲も確認 | 別の使い捨てrepoで架空の検出対象を過去commit→削除し、全履歴検査が終了1になることを先に確認。問題発見時は種類・場所だけ記録し旧鍵を失効。検査の終了値と全対象refの網羅を確認してから済。画像内の秘密はS38で目視。[公式の使い方](https://github.com/gitleaks/gitleaks#usage) |
| S21 | 環境ごとに別の32バイト鍵を安全な端末で生成し、Worker secret `GOOGLE_CALENDAR_CREDENTIAL_ENCRYPTION_KEY` へ標準入力またはCloudflareの秘密設定画面で登録（通常変数・引数・履歴・ログへ置かない）。承認・控えを整え、既存平文はGoogleで失効後に暗号化対応した接続口から再登録し、旧接続と控えの扱いを確認。既存予約のconnection_id参照の付替えは別途承認済み移行手順を用意し、先に削除しない | 新規3種の暗号化と旧平文件数0を値なしの件数で確認。検証用接続で鍵欠落・改ざん時に保存/Google呼出しが止まることを確認。既存接続はこの修正後500で停止するため、secret設定と移行準備なしで配備しない。手順の詳細は修正記録 |
| S26 | 開発依存の大きい更新は司令塔が承認し、Vitest 4.1.11への更新でCriticalは0。bracesの上流修正版を確認し、公開後に更新。現行のlintではnext.rootDirを未指定のまま保ち、外部入力からパターンを作らない | 現在Critical 0 / High 1。旧Vitest・危険なtinypoolを混ぜる試験と、globの解析経路を再開すると落ちる試験で再発を防ぐ。Highは未解消として公開判断に残す |
| S32 | マサトさんが使い捨てDBと操作役を承認。本番データを使わず架空の友だち・予約・配信状態を作り、控え/復元点を取得。件数と状態を控え、故障（予約の変更・削除）を入れ、復元して同じ確認を繰り返す。送信は無効のまま | 故障後の確認は失敗し、復元後は件数・予約・配信状態が一致。開始/終了/所要時間と担当を記録。戻せない場合は未。復元点の実値とDBの中身は非公開保管 |
| S36 | コード反映時にDEPLOY_ENV=productionを値の種類だけで確認し、承認後に本番設定のRESTAURANT_TEST_ENABLEDをfalseへ整理。検証はstaging＋true。本番の設定や配備は今回は変更していない | 配備後に管理API・通知入口・内部sandbox入口が404、飲食店cron/予約メールも停止。架空の検証でstagingだけ動く。単に設定ファイルを直しただけでは実配備確認に数えない |
| S37 | オーナー/マサトさんがGitHub Settings → General → Danger Zone → Change repository visibilityで非公開化を実施し、共同開発者・Actions・Pagesへの影響を確認 | `gh repo view skmtmst/line-harness-oss --json visibility` がPRIVATE。未ログインの別ブラウザでソースが読めない。Pages等の公開は別に確認。過去のコピーや漏れた鍵は回収できないためS19/S38も続ける |
| S38 | 現在の枝・公開していた枝/tag・削除済み文書・画像・添付に加え、Releases/Actions artifacts/Pagesの公開物を一覧化し、文字は検査、画像/動画は目視。顧客資料は担当者が非公開環境で照合。記録保全と必要な連絡を決めてから公開停止・削除を実施 | 別の架空画像・架空顧客文書を混ぜた検査対象で、文字/目視の両方が見付けることを先に確認。対象件数・担当・確認結果だけ記録。履歴の書換え・forceは禁止のまま、既存履歴の扱いは司令塔へ |
| S39 | 2人で「全員ログインできない」「誤配信」「秘密漏えい」「DB破損」を各15分の机上練習。連絡網、判断役/操作役、手動返信など停止対象外、承認先、戻す版とDBの互換性を確認。承認した使い捨て環境で停止/復元を試す | 故障中は確認失敗、停止後は新しい自動送信0、復元後の予約/配信状態が一致。連絡不能の代替手段と実測時間を記録。実客への送信や本番停止を練習に使わない |
