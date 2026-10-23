> 用途：管理画面APIの共通待ちの原因・修正・再計測の引き継ぎ｜区分：調査記録（要件の正本ではない）｜確認日：2026-10-23（日本時間）

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

## サーバー内訳の計測と残る重複（2026-10-22依頼）

今回の土台は司令塔指定の `adbca25dc2d`（`codex/kenta-train-beui2-1022`）。検査前に取得した `origin/codex/development` は `8a1ac75fd7e517c8f8b35f69abaabaac682f5bc9` で、土台に包含されていた。以下はこの土台からの追加変更。上の前回修正の数値とは比較元を分ける。配備・DB更新・設定変更はしていない。

### 返す内訳の読み方

`Server-Timing` を最外周へ移し、認証前の401、403、404、429、500、CORS事前確認、公開応答、静的応答にも付ける。CORS許可先に `Access-Control-Expose-Headers: Server-Timing` と `Timing-Allow-Origin` を付け、管理画面のDevTools・fetch・Resource Timingから読む。許可していないOriginにはTiming-Allow-Originを付けない。リダイレクト等のimmutableな応答は、本文を読み込まずにヘッダだけ複製する。WebSocketの101は接続を保持する。

| 指標 | 意味・単位 |
|---|---|
| `auth` / `tenant` / `feature` / `rate` / `pii` / `audit` / `sensitive` / `cors` | 各middleware自身の経過ms。下流の時間を差し引き、早期拒否と応答後加工も実行した段へ付ける |
| `handler` | すべての共通門番の後に実行した本体の経過ms |
| `session` | セッションハッシュ・本人行・MFA方針/確認印・必要時の失効の経過ms。認証時はauthに含む |
| `staff` | セッション/スタッフAPIキーで本人行を取得した経過ms。呼び出し元のsession/auth/handlerに含む |
| `scope` | 可視範囲を初めて解決した経過ms。解決を呼び出した段またはhandlerに含む。メモ化の再利用では加算しない |
| `impersonation` | 代理ログインの期限・セッション紐付け・運営資格の検査ms。authに含む |
| `total` | Workerに入ってから応答ヘッダ確定までのms。利用者とWorker間の通信やストリーム完了時間は含まない |
| `d1;dur=...` | 完了したD1 Binding呼出しの経過msの合計。SQL実行だけでなく通信・キュー・返却までを含む。並行処理の合計なのでtotalを超える場合がある |
| `d1_count;desc="整数"` | 応答までに開始したD1 Binding呼出し数。batchはSQL文数にかかわらず1往復。prepare/bind/withSessionは数えない。失敗した呼出しも数える |
| `d1_pending;desc="整数"` | 応答確定時に未完了の呼出し数。背景処理等の未完了時間はd1の合計へ入れない |
| `d1_sql;dur=...` / `d1_sql_count;desc="整数"` | all/run/batchのメタデータが得られたSQL実行msの合計と、そのSQL文数。0文ならSQL時間は未取得なのでd1_sqlを省略する。first/raw/execにはSQL内訳を補わない |

固定名と数値だけを出す。SQL文、束縛値、ID、地域名、スタッフ情報、顧客情報、外部例外はヘッダへ載せない。回数はmsではないのでdurへ偽装せず、Server-Timingのdescriptionを数字だけにする。段・内訳・D1時間は包含/重複するため、足し合わせない。Workersの時計はCPUだけの処理を細かく測れず、主にI/O待ちの切り分けに使う。[公式のタイマーの制約](https://developers.cloudflare.com/workers/runtime-apis/performance/)も参照する。

**SQL時間は部分計測。0文は未取得であり、SQLが0msだったという意味ではない。** D1のfirstはメタデータを返さないため、応答内容・例外・SQLを変えないよう、そのまま呼ぶ。`d1_sql_count` と `d1_count` はSQL文数と往復数で単位も異なる。全D1待ちからこの部分的なSQL合計を引いて「すべて通信時間だった」と断定してはいけない。SQLメタデータは[Cloudflareの返却値の定義](https://developers.cloudflare.com/d1/worker-api/return-object/)に従い、sql_duration_msを優先し、無ければmeta.durationを使う。

計測用DBは要求ごとに別のProxyで包み、共有env・Bindingを書き換えない。batchへは元のPreparedStatementを渡し、Bindingメソッドのthisとfirstの列指定・rawの指定・session/bookmarkを保つ。応答後のwaitUntil処理でも元のDB操作を続行でき、確定した計測値は変更しない。

### 原因の表と追加修正

Rは1回のD1呼出しの経過ms。実環境のRは未取得。例の50msは説明のための仮定であり、検証環境の実測ではない。

| 処理 | 今回の前→後の往復 | 経過時間の見込み（R=50msの例） | 判断 |
|---|---:|---|---|
| セッション＋本人＋統括状態 | 1→1 | R（50ms） | 毎要求の停止/失効の確認を維持 |
| MFA方針＋同セッションの確認印 | 登録済み2→2 | 前回修正で並行済みなので概ねR（50ms） | 別要求へのcacheや確認省略はしない |
| 代理ログインの期限終了＋有効行 | batch 1→1 | R（50ms） | 通常のcookie要求でも通る。期限・紐付けと終了記録を維持 |
| 最初の可視範囲 | 全店舗1→1、担当店舗限定2→2 | R / 2R（50 / 100ms） | 認証で取得済みの本人行を引き続き共有 |
| 機能で範囲を狭めた後の再計算 | 全店舗2→0、担当店舗限定3→0 | 全店舗は2本が並行のため約R削減（50ms）、担当限定は約2R（100ms） | 今回修正。元の範囲との積だけを要求内で再利用し、本人行も同じDB/本人のまま共有 |
| APIキーの最終利用記録 | 今回変更なし | 取得の後の更新は必須のまま | 回転・失効との同時実行をSQLで確かめる更新。単なる表示用の時刻ではないため後回しにしない |
| 通常セッションの最終アクセス更新 | 0→0 | 0ms | 毎要求のlast-access更新は見つからず。監査・失効の更新を一律にwaitUntilへ移さない |

機能による追加絞り込みのたびstaffオブジェクトが置換され、前回の要求内メモ化から外れていた。`restrictVisibleLineAccountScope` で、同一staff・同一DB・同じ入力のcacheがある場合だけ、既に認可した店舗との積を新しいstaffへ引き継ぐ。未割当は常に拒否し、元の担当外・別統括・一度除外した店舗を追加しない。cacheが無い場合は従来どおりDBから解決する。代理ログインによる統括の差し替えへは引き継がない。

### 追加したAPI別の予算

条件は前回と同じfixture（owner、非既定統括、見える店舗1件、担当範囲all）。beforeは今回の機能絞り込みだけを元に戻して同じ入口から実行し、2往復の差を確認した。

| API | MFAなし 今回の前→後 | MFAあり 今回の前→後 |
|---|---:|---:|
| `/api/auto-replies` | 13→11 | 15→13 |
| `/api/scenarios` | 10→8 | 12→10 |
| `/api/templates` | 13→11 | 15→13 |
| `/api/tags`（共通扱いの対照） | 4→4 | 6→6 |

前回の11口×2認証状態の予算も維持し、合計15口×2状態を固定した。外部から読める `d1_count` が独立に数えたBinding呼出し回数と一致することも守る。スタッフ/可視範囲/機能状態によって変わるため、上の数をすべての利用者に適用しない。

**`/api/staff/me`は今回2→2（MFAあり4→4）のまま。** この軽い口で残る460〜1200msを、一覧の重複再計算だけで説明したとは扱わない。新しいsession/staff/impersonation/D1の実測が必要。

### 地域・配置の案（未適用）

`wrangler.staging.toml` は既存のDB Bindingだけを指定し、`[placement]` はない。製品コードはwithSessionを使っていない。ダッシュボードの実効PlacementやD1のprimary地域・replication設定はこの作業では未取得。Workerが動く地域と利用者が入った地域を同じものと決めつけない。

- D1の場所は作成時に決まり、location hintも保証ではない。[公式の配置説明](https://developers.cloudflare.com/d1/configuration/data-location/)。既存DBへ設定を1行足して移動できるという案にはしない。
- 地域間往復が主なら、検証だけで `[placement]` / `mode = "smart"` を別変更として比較する候補がある。判断前に実効状態と `cf-placement` を確認する。[公式のPlacement説明](https://developers.cloudflare.com/workers/configuration/placement/)。解析に最大15分かかる場合や、交通量不足で最適化されない場合があり、追加すれば必ず速くなるとは扱わない。
- read replicationは別の設計判断。[公式説明](https://developers.cloudflare.com/d1/best-practices/read-replication/)では複製に遅れがあり、Sessions APIの整合性を考える必要がある。認証停止・MFA・権限を古いreplicaで判定する変更は今回しない。

司令塔の次の作業は、統合・手動の検証配備後、同じログイン・店舗・回線・時間帯で各口を5回ずつ採取し、TTFBと上表のヘッダを保存すること。まずstaff/meでauthの内訳を確認し、その後一覧のscope/feature/handlerを比較する。設定案の比較はコード修正の比較と分ける。地域を確かめる際も、SQLメタデータや設定の地域だけを安全な運用経路で取り、顧客本文・秘密値・Cookieを記録へ転記しない。

### 検査・コミットと統合時の注意（2026-10-23・日本時間）

実装は `85e54491ca8`（全応答の計測・D1計測・既存cacheの維持）と `077e68b7bfb`（機能絞り込み後の可視範囲の再利用・API別予算）。どちらも指定土台 `adbca25dc2d` からの変更。push・PR・実際のmerge・配備・検証/本番DB更新はしていない。応答本文・DBの形・wrangler設定・依存・品質基準は変更していない。

| 検査 | 結果 |
|---|---|
| `DOCTOR_LOCAL=1 bash scripts/codex/doctor.sh` | 合格。Cloudflare認証値は未設定のまま |
| Web関連 | 7ファイル・44件成功。先読み、本人情報、アカウントcache、style-attention等 |
| Web型 | `cd apps/web && ../../node_modules/.bin/tsc --noEmit -p .` 成功 |
| Worker型 | 既定の `pnpm --filter worker typecheck` 成功 |
| Worker全体 | 1,170ファイル・13,978件成功（修正後の全件再実行）。最大4worker |
| Worker build | `pnpm --filter worker build` 成功 |
| 指定土台の品質 | `pnpm quality:check --base adbca25dc2d` 成功。全12指標が指定土台の基準と一致。新規違反0、基準・許可の追加0 |
| V8の型点検 | 引数なしはusageで終了するため、正規の `--code . --base adbca25dc2d --out /tmp/lh-api-timing-pattern-audit` で実行。新規候補0・一時許可0・未許可0。画面の目視合格とは別 |
| 構成 | 8,616ファイル・25,672依存・違反0 |
| 文書 | 入口・掲載回数・ローカルリンク：合格 |

検査は専用Node 22.23.4で行った。WebのVitestは `NEXT_PUBLIC_API_URL=https://nen-line-stg.skmtmst.workers.dev` を指定。型・全試験・ビルド等の重い検査は既存heavy.shで順番に実行した。関連試験200件、単体57件、認証等118件、互換修正後77件の先行成功は上の全体件数へ重複加算しない。

初回のWorker型検査はSDK生成前でmodule未検出になった。既定のpretypecheckによるSDK生成後に型を再実行して成功した。初回のWorker全体は13,973成功・5失敗。1件は直接認証ヘルパーを呼ぶ模擬Contextにgetが無いこと、4件は計測付きDBを未包装のDBと関数参照ごと比較していたことが原因。計測情報の読取を任意にし、DBの比較は元Bindingの同一性と同じ要求内の受け渡しの同一性を確認する形にした。役割・スコープ・送信先・登録済み行・送信回数・一部失敗後の継続の期待は維持し、該当を含む77件成功後、全体13,978件を再実行して成功した。失敗した初回を成功扱いにしていない。

足した・書き換えた試験の目的：

| 試験 | 何を・なぜ |
|---|---|
| `api-read-roundtrips.test.ts` | 15口×MFA有無の予算とヘッダの回数の一致、CORS/401/robots、並行要求の分離を守る。共通の確認処理が再び増えたら落とす |
| `d1-timing.test.ts` | firstの列指定・raw・batch・session・失敗・背景処理と戻り値を守る。batchを二重計上せず、firstの顧客データにあるmetaをSQL時間と誤認しない |
| `server-timing.test.ts` | 全応答に固定名と数値だけを出す新しい依頼に合わせ、従来の「匿名には付けない」を更新。早期拒否・例外・段と内訳・許可Origin・immutable応答の本文を守る |
| `server-timing-workerd.test.ts` | 本物のD1 Bindingでthis・batch・sessionと回数を確認。リダイレクトとWebSocketの101を計測で壊さない |
| `account-access.test.ts` | 機能で絞った後に担当外・別統括・未割当・一度除外した店舗を加えず、別DB/別要求/入力変更では読み直す |
| `users-grouped.test.ts` | 既存TTLと明示更新を保ち、要求ごとの計測ラッパーが集計cacheを無効にしてD1を増やさない |
| `liff-friend-add-scenarios.test.ts` / `liff-oauth-scenario-gate.test.ts` | 計測付きでも元のDBと同じ要求のDBを各処理へ渡すことを確認。初回だけの送信・宛先・所属・失敗後の継続の検査を保つ |

故障対照は、機能絞り込みの新しい再利用を一時的に元のstaff複製へ戻した。3口×MFA有無の6件すべてが2往復超過で失敗し、元へ復元した。SQLや認証を省いて回数を合わせていない。ログは `/tmp/lh-api-timing-mutation.log`。

**最新開発版への統合ゲートは未完了。** 作業中、共有される `origin/codex/development` が開始時の `8a1ac75fd7e` から `e77d145e494`（PR #1793の統合）へ更新された。依頼どおりの `pnpm quality:check --base origin/codex/development` は、新しい本線で減らされた基準との比較になり失敗した。これは合格へ読み替えていない。指定土台では全指標が同じであり、今回の変更で品質の違反は増えていない。新しい本線の基準を引き上げる変更はしていない。

作業ツリーを変えない `git merge-tree --write-tree HEAD origin/codex/development` による試算では、指定土台と新本線の間に以下の2競合を確認した。実際のmergeはしておらず、競合状態を作業ツリーへ持ち込んでいない。

- `apps/web/src/v8/settings/emergency/history.tsx`（司令塔の画面領域）
- `scripts/structure/quality-baseline.json`（両側の実測値の統合）

司令塔が双方の変更を保って統合し、最新baseで品質・関連試験を再確認してから手動の検証配備へ進む。**配備前の直近タスクはこの統合であり、その後に上のServer-Timing実測を行う。**

主要ログ：`/tmp/lh-api-timing-web-related.log`、`/tmp/lh-api-timing-web-type.log`、`/tmp/lh-api-timing-worker-type-complete.log`、`/tmp/lh-api-timing-worker-full-complete.log`、`/tmp/lh-api-timing-worker-build.log`、`/tmp/lh-api-timing-quality-fixed.log`（指定土台の成功）、`/tmp/lh-api-timing-quality.log`（更新後originとの失敗）、`/tmp/lh-api-timing-upstream-merge-check.log`、`/tmp/lh-api-timing-pattern-complete.log`、`/tmp/lh-api-timing-structure.log`、`/tmp/lh-api-timing-docs.log`。初回全体の失敗は `/tmp/lh-api-timing-worker-full.log`、互換修正の成功は `/tmp/lh-api-timing-compatibility.log` に保存した。

開始時は `## codex/kenta-api-timing-1022` のみで変更なし。今回の変更だけを内容別にコミットし、最終の `git status --short --branch` でクリーンを確認して引き継ぐ。反映履歴は依頼どおり司令塔のPR採番後に作るため、この作業では追加していない。
