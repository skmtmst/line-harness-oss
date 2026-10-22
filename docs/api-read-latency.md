> 用途：管理画面APIの共通待ちの原因・修正・再計測の引き継ぎ｜区分：調査記録（要件の正本ではない）｜確認日：2026-10-22（日本時間）

# 管理画面APIの待ち時間

土台は `d04593f52cf7e7708b788b1b57c72c1fae3d3d9a`。2026-10-22に `origin/codex/development` を再取得し、同じSHAであることを確認した。配備・環境設定変更・DB更新は実施していない。以下の回数は実アプリのmiddlewareとhandlerをSQLiteに接続して測ったD1 Binding API呼出し回数。SQL文数とは異なり、batchは1往復として数える。インターネット上のHTTP要求やCORSのOPTIONSも別の数である。

## 原因と削減範囲

`index.ts` の順序は rate → auth（代理ログイン解決を含む）→ tenant → pii → audit → feature → sensitive → handler。通常GETの一般rate・役割判定・PII・変更監査はD1へ行かない。出力・アップロード・認証試行のrate制限は別で、今回変更していない。

下表のRは「WorkerからD1への1往復＋SQL処理」の時間。R自体は検証環境で未計測なので、依頼書のTTFB 460〜900msをすべてDB時間として割り当てることはできない。例のmsはR=50msと置いた場合の計算であり、実測でも達成の宣言でもない。

| 処理 | 変更前→後の往復 | 直列の待ちの変化 | R=50msでの削減例 |
|---|---:|---|---:|
| セッション＋有効スタッフ＋統括状態のJOIN | 1→1 | 必須のまま | 0ms |
| MFA必須方針＋登録済みセッションの確認 | 2→2 | 方針→確認を並行にする（登録済みの場合） | 約50ms |
| MFA必須だが未登録 | 確認印の読取1→0 | 取得しても許可できない印を省き、従来どおり失効させる | 約50ms |
| 代理ログインの期限切れ終了→有効行検索 | 2→1 | 2文の順序と期限・セッション紐付けを保ちbatchにする | 約50ms |
| 本人情報・可視範囲のスタッフ行 | 利用箇所ごとの再取得1→0 | 認証で読んだ同じ要求の行を使う | 最大約50ms/直列の再取得 |
| style-attentionの共通門番とhandlerの門番 | 2→0 | 両方の権限検査を保ち、認証の行を再利用 | 約100ms |
| 可視アカウント一覧 | 1→1 | 既存の要求内メモ化を保持。店舗限定の担当ID取得は追加1のまま | 0ms（スタッフ行と元から並行だった箇所は回数のみ減る） |
| アカウント一覧のタグ・フォルダ・集計 | 3→3 | 一覧本体の後で3本並行にする | 約100ms |
| auth/sessionの役割・招待状態・セッション情報 | 3本の独立読取は維持 | 並行化。別途、本人行の再取得1を省く | 非運営の通常fixtureでは約150ms |

スタッフ行は認証で毎要求作るオブジェクトを鍵にしたWeakMapへ置き、DBと本人IDも照合する。秘密列をstaff文脈やJSONへ追加しない。担当範囲・有効状態を含まない部分行も共有せず再取得する。代理ログイン・機能絞り込みでstaffオブジェクトが置換された経路、認証を省いた既存route単体試験は従来の再取得へ戻る。別要求・別DBの使い回しはしない。認証、役割、閲覧のみ、MFA、店舗限定、別統括の検査と応答形式を保つ。

## 口ごとの往復数（アプリ全体）

同じfixtureで土台と修正後を実行した。条件は非既定の1統括、owner、見える店舗1件、担当範囲all、代理ログインなし、外部サービス未設定。MFAありは鍵設定済み・TOTP登録済み・同セッションの確認印あり。MFAなしは鍵と登録の両方なし。件数・設定内容・Stripe接続・運営権限・店舗限定によって増減するため、全利用者に同じ数になるとは扱わない。

| API | MFAなし 前→後 | MFAあり 前→後 |
|---|---:|---:|
| `/api/staff/me` | 4→2 | 6→4 |
| `/api/tenants/me` | 4→3 | 6→5 |
| `/api/auth/session` | 5→4 | 7→6 |
| `/api/line-accounts` | 9→7 | 11→9 |
| `/api/hq/style-attention` | 9→5 | 11→7 |
| `/api/inbox/unanswered/count` | 6→4 | 8→6 |
| `/api/accounts/health-summary` | 6→4 | 8→6 |
| `/api/notifications/center?lineAccountId=store&limit=1` | 7→5 | 9→7 |
| `/api/settings/features/visibility?account_id=store` | 9→7 | 11→9 |
| `/api/settings/features?account_id=store` | 10→8 | 12→10 |
| `/api/hq/billing/summary` | 4→3 | 6→5 |

`api-read-roundtrips.test.ts` は実アプリの入口から11口×2認証状態を呼び、この予算を固定する。増えたら落ちる。別要求の停止・担当範囲変更、別統括の拒否、秘密列の非露出、MFA印なし・別人・方針offでも登録者の印必須、未登録者の拒否も検査する。style-attentionのhandler内の従来「64→10」と、この表の「認証から全体」の数は集計範囲・店舗数が異なる。

## 画面側の読み込み順

- style-attention：左メニューと画面は同じAPIクライアントを通り、同じ認証世代の取得中Promiseを1本に共有する。完了後は捨て、手動の読み直しや5分後の更新では新しく取る。失敗を保持せず、加工する応答は複製する。認証世代を識別できない場合は共有しない。
- 本人情報：既存の `prefetchLineAccounts()` から `/api/staff/me` も同時に始める。先読みはCSRFと管理セッションの指紋で区別し、30秒以内に最初の利用者へ一度だけ渡す。ログアウト・認証失効で捨てる。アカウント一覧が未完了でも本人情報を受け取れることを試験する。
- 請求summary：本人APIで確かめたowner/adminを待つのは必要。先読みでその確認を前へ移す。保存された役割や未確認の権限で先に請求を取る変更はしない。
- inbox件数・接続要約・通知center・機能visibility：現在選択しているアカウントが有効だと一覧で確認されるまで待つ必要がある。保存された店舗IDでの投機的な取得は加えない。アカウント一覧のhandler自体の直列待ちを短くする。
- 機能settingsの管理GET：owner/adminの本人確認が必要。visibilityの結果は不要であり、既に両者は並行に開始する実装だった。今回も維持する。

## 地域による待ちとの切り分け

検証設定 `apps/worker/wrangler.staging.toml` にはplacement指定がない。実際に動いたWorkerの地域・D1 primaryの地域・SQL単体時間はこの作業環境から確認しておらず、「D1が米国にある」等とは断定しない。

Cloudflare公式では、[D1の配置](https://developers.cloudflare.com/d1/configuration/data-location/)は作成時に決まり、[read replication未使用のD1](https://developers.cloudflare.com/d1/best-practices/read-replication/)は読書きともprimaryへ送る。[Workerのplacement](https://developers.cloudflare.com/workers/configuration/placement/)はDB等への距離を考慮できる。したがって、地域間の往復時間を直列SQLの数だけ繰り返す可能性がある、というのが今回の推論。地域や配置を変更する作業は含めていない。[D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)は順序を保ち、今回の期限切れ終了処理も省いていない。

次は司令塔が配備後に同じアカウント・回線・条件で、各APIのTTFB、既存の `Server-Timing` のauth/tenant/feature/handler、Workerの配置地域、D1の処理時間・地域を採取する。SQLの短さに比べauth等が長ければ距離の寄与を疑い、ネットワーク待ちとSQL実行を分ける。配置変更やread replica導入は、その証拠と認証失効の整合性を確認した別の判断にする。

## 検査・変更の所在

| 変更 | 場所 | コミット |
|---|---|---|
| MFA並行化・認証行の要求内共有 | `apps/worker/src/middleware/auth.ts:35`、`apps/worker/src/lib/authenticated-staff-record.ts:8` | `9306e86e86a` |
| 本人・可視範囲・統括門番で共有行を使う | `apps/worker/src/routes/staff.ts:363`、`apps/worker/src/services/account-access.ts:130`、`apps/worker/src/routes/styles-common.ts:17` | `9306e86e86a` |
| セッション情報とアカウント一覧の並行読取 | `apps/worker/src/routes/admin-auth.ts:872`、`apps/worker/src/services/line-account-list-metadata.ts:5` | `9306e86e86a` |
| 代理ログインの終了・検索をbatch化 | `packages/db/src/platform-admins.ts:346` | `9306e86e86a` |
| style-attentionの同時取得を共有 | `apps/web/src/lib/api/helpers/styles.ts:65` | `0531822ce26` |
| 本人情報の先読み・認証世代での破棄 | `apps/web/src/lib/api/transport/prefetch.ts:14`、`apps/web/src/lib/line-accounts-cache.ts:49`、`apps/web/src/lib/common-caches.ts:18` | `0531822ce26` |

- doctor：`DOCTOR_LOCAL=1 bash scripts/codex/doctor.sh` 最終行「合格」。
- Node：手元の専用22.23.4で検査。全体は既存heavy.sh経由・Vitest最大4で順番に実行。Worker全体：1,168ファイル・13,955件成功。Worker `tsc --noEmit` 成功。
- 往復数：土台22条件を計測し、修正後は22予算と拒否・更新境界6条件、計28件成功。追加の要求内共有3件・一覧並行読取1件も成功。
- 初回のWorker全体は部分的な認証行を使う既存fixtureで2件失敗し、中断した（終了130）。部分行を共有しない条件を加え、該当149件と安全確認104件、その後の全体13,955件の成功を確認した。失敗した初回を合格数へ数えていない。
- Web：2,384ファイル・14,303件成功。Web `tsc --noEmit`：成功。
- 全体の実行入口：`pnpm --filter worker test`、`NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web test`、各アプリで `tsc --noEmit`。ログは手元の `/tmp/lh-api-latency-{worker-final,web-full,worker-tsc-final,web-tsc-final}.log`。
- `pnpm quality:check --base d04593f` 成功。新規違反0、循環0、長大ファイル合計95,649行を維持。`scripts/structure/check.ts` は違反0。文書索引・リンク検査成功。基準値・上限・許可の追加なし。
- 開始時：`## codex/kenta-api-latency-1022...origin/codex/development` のみ（変更なし）。終了時：`## codex/kenta-api-latency-1022...origin/codex/development [ahead 3]` のみ（変更なし）。
- push・PR・マージ・配備・DB更新なし。実環境のTTFB改善と地域は未計測。

PR採番後、司令塔が反映履歴へ次の内容を実番号・日本時間で登録する：管理画面を開く際の重複取得と、共通の確認処理による待ち時間を減らした（担当kenta）。番号の推測やPR作成はこの作業ではしない。
