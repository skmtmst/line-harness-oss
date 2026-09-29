# V6 33 LINE公式アカウント設定 要件定義（実装照合版・下書き）

作成日: 2026-09-03
対象: LINE公式アカウントの登録・検証・切替・停止・archive・乗り換え。現行 `/accounts`（`/hq` へ転送）、`/api/line-accounts`、`line_accounts`、資格情報暗号化、Webhook状態照合、BAN検知、トラフィックプール、Lステップのアカウント設定・データ移行

## 0. 結論と採点

全32本の要件書は `line_account_id` を所属の単位として前提にしているが、そのアカウントを「登録し、LINE側の実設定と突合し、切り替え、止め、退役させ、他ツールから乗り換える」要件書が無かった。本書はその欠落を埋める。V6 Pencil には33専用の画面が無いため、既存画面に載せるものと新規画面を §5 で分ける。

現行実装は新規構築ではない。`line_accounts` の登録・更新・並び順・階層、AES-256-GCM による資格情報の暗号化保存、保存後に値を返さない直列化、`verify-connection` による保存前の接続確認、LINE Developers に登録された Webhook URL の読み取り（`fetchWebhookEndpointState`）、owner だけの資格情報診断、BAN検知cron、トラフィックプール、既存友だち取込、設定コピーが動いている。一方で、物理削除しかなく archive が無い、LINE Login のチャネルシークレットが平文、Webhook の突合結果を保存せず毎回 LINE に問い合わせる、既定アカウントがブラウザの localStorage だけ、Lステップからの乗り換えは画面上「準備中」のボタンで止まっている。ここを直す。

| 評価軸 | 現在 | 要件反映後 | 判断 |
|---|---:|---:|---|
| V6 UI/UX | — | 98 | 専用画面が無い。§5 の新規画面をPencilへ追加して確定 |
| Lステップ対抗力 | 88 | 100 | Webhook突合、archive、BAN自動切替、乗り換えdry-runで上回る |
| 現行実装完成度 | 74 | 98 | 登録・暗号化・検証はある。archive、既定、乗り換えが不足 |
| データ安全性 | 66 | 100 | 平文列の残存、物理削除、Login secret平文が主な減点 |
| 実現可能性 | 96 | 99 | 既存route・DB・cronを拡張できる |
| 要件確定度 | 90 | 98 | Lステップ書き出し列の実機確認だけが残る |

除外するのは、LINE Developers 側のチャネル作成・Webhook URL 設定・LIFF 作成を Harness の API から代行すること（LINE がその API を提供しない）、資格情報の再表示、物理削除、異なるプロバイダー間の user ID 変換、名前だけでの友だち照合である。

## 1. 監査範囲と証拠制限

### 1-1. V6実Node

33 専用の画面は V6 に無い。関係する既存画面は次のとおり。

| Node ID | 画面 | この要件での役割 |
|---|---|---|
| `cBSCb` | 共通トップバー | `LINEアカウント` 切替プルダウンの正本。全画面に参照で入る |
| `c4R6F` | ★ V6 31-1 機能設定 | 会社としての機能オン・オフ。アカウント設定はここに混ぜない |
| `e3jz3` | ★ V6 30-1 ログインユーザー | 人ごとの既定アカウントと担当範囲 |
| `JN6mQ` | ★ V6 1-1 友だち追加QR | 登録直後の「友だち追加URL・QR」の行き先 |
| `H2S1T4` | 重要操作確認 | 停止・archive・乗り換え本実行の確認に使う |

不足する画面は §5-2 に「Pencil に追加が必要な画面」として列挙する。画像出力は他要件書と同じくノイズ化しており、ピクセル一致は画像出力復旧後に確認する。

### 1-2. 現行資産

- `line_accounts`: `channel_id`、`name`、`channel_access_token`、`channel_secret`、`channel_access_token_encrypted`、`channel_secret_encrypted`、`login_channel_id`、`login_channel_secret`、`liff_id`、`is_active`、`display_order`、`parent_line_account_id`、`tenant_id`、`token_expires_at`、`friend_capacity`、`capacity_warn_at`、`icon_url`、`timezone`、OG設定
- `packages/db/src/credential-crypto.ts`: AES-256-GCM、96bit IV、`v1.<iv>.<ciphertext>` 形式、鍵は Worker Secret `LINE_CREDENTIAL_ENCRYPTION_KEY`（`docs/line-credential-encryption.md`）
- `decryptLineAccountCredentials`: 暗号化列を優先し、移行期間に限り平文列へフォールバック。フォールバック時は値を含めず `line_credential_plaintext_fallback` を warn
- `GET /api/line-accounts`: 表示範囲内のアカウントに bot profile、Webhook状態、月間プラン、友だち数、稼働シナリオ数、今月送信数を付けて返す。資格情報は `channelAccessTokenConfigured` 等の真偽値だけ
- `POST /api/line-accounts/verify-connection`: `bot/info`、`channel/webhook/endpoint`、`channel/webhook/test` を順に確認し、DBへ書かない
- `fetchWebhookEndpointState`: `matched | mismatched | unconfigured | unknown` の4状態。期待URLは `WORKER_PUBLIC_URL + /webhook`
- `GET /api/line-accounts/:id/credential-health`: owner だけ。暗号化済みか、復号できるか、どちらの列を使っているか
- `PUT /api/line-accounts/:id`: owner だけ。資格情報の差し替え入口
- `PATCH /api/line-accounts/:id`、`/order`、`/hierarchy`: owner/admin。表示情報、並び、親子
- `login_channel_id` と `liff_id` はアカウント間で重複禁止（`checkUniqueLoginAndLiff`）
- `deleteLineAccount`: 物理削除
- `services/ban-monitor.ts`: cron で `bot/info` を叩き、403 を `danger`、429 と 1時間5,000通超を `warning` として `account_health_logs` に記録。状態が変わった時だけ運用者へ通知
- `routes/traffic-pools.ts`: `/pool/:slug` で友だち追加先アカウントを振り分ける。owner だけ
- `account_migrations`: 友だちを別アカウントへ移す一回限りの job（`from_account_id`、`to_account_id`、`status`、件数）
- `services/follower-import.ts`: 既存友だちの取込 job（検出、開始、段階実行）
- `services/account-copy.ts`: `accountSettings`、`scenarios`、`autoReplies` の設定コピー
- `routes/webhook.ts`: `X-Line-Signature` を稼働中アカウントの `channel_secret` で順に検証し、一致したアカウントへ束縛。不一致は 200 を返してログだけ残す
- `line_webhook_events`: `received | processing | succeeded | failed` の受信台帳と再処理
- `services/token-refresh.ts`: 期限が 7 日以内のトークンを cron で再発行
- `packages/create-line-harness`: 初期セットアップ CLI。チャネル ID・シークレット・アクセストークン・LINE Login チャネル ID・LIFF ID を対話入力し、暗号化鍵を生成して Secret に設定し、`line_accounts` へ平文列と暗号化列の両方を書く。LIFF は手順を表示して人が作る
- `apps/web/src/app/accounts/migration.tsx`: 引き継ぎコードの発行・受取が「準備中」の非活性ボタン。件数表示だけ動く
- `apps/web/src/contexts/account-context.tsx`: 選択中アカウントは localStorage `lh_selected_account`

「新規作成」ではない。上の資産を残し、archive、突合結果の保存、既定アカウント、乗り換え、監査を足す。

## 2. Lステップとの差

Lステップのアカウント設定（`/line/account`）は、アカウント情報、アカウント名、LINE公式アカウントチャネル設定、LINEログインチャネル設定、利用プラン、メッセージ設定、未確認メッセージ設定、テスト送信設定、管理画面設定、セキュリティ設定の10区分を持つ。Channel Secret は「登録済」とだけ表示し、「Lステップ Webhook URL」と「LINE公式アカウントに設定中の Webhook URL」を並べて表示する（`docs/lstep-liny-v4-source.md` §2-15）。データ移行は β 版で、対応表 #31 は引き継ぎコード方式を「今回追加」としている（`docs/lstep-feature-parity-matrix.md` #29・#31・#32）。

Lステップ最大の弱点は、初期設定が LINE Developers、LINE公式アカウントマネージャー、Lステップの複数画面にまたがることである（`docs/lstep-liny-screen-behavior-research-2026-08.md` §3-1）。

V6は次で上回る。

- Webhook URL を並べるだけでなく、一致・不一致・未設定・不明を判定し、結果を保存して運用状態32へ流す
- 保存前に接続確認を行い、失敗理由を項目ごとに返す
- 資格情報を暗号化保存し、再表示しない。owner だけが差し替えと診断を行える
- 削除ではなく archive。過去の配信・友だち・監査から読める
- BAN検知を cron で継続し、プールで友だち追加先を自動で切り替える
- 乗り換えを dry-run、件数照合、競合判断、切り戻しの4段で行う
- 複数アカウントの切替と既定を、組織の既定と人の既定の2層で持つ

同等にとどめる点は、Channel Secret の「登録済」表示、友だち追加URL、LINE Developers・LINE公式アカウントマネージャーへの外部リンクである。

## 3. この機能で達成すること

> owner が、LINE公式アカウントを安全に登録し、LINE側の実設定と一致していることを確認し、複数アカウントを切り替え、止め、退役させ、他ツールから友だちと属性を引き継げる。

1. チャネル ID・シークレット・アクセストークンを登録し、保存前に接続を確認する
2. Webhook URL を発行し、LINE側の実設定と突合する
3. LIFF アプリの ID を登録し、エンドポイント URL の一致を確認する
4. 複数アカウントを切り替え、組織と人それぞれの既定を持つ
5. 稼働停止・再開を、配信・受信・自動処理の全部に効かせる
6. 削除ではなく archive し、履歴を残す
7. BAN検知と自動切替で、友だち追加の受け皿を止めない
8. Lステップから友だち・タグ・友だち情報欄を引き継ぐ

## 4. 用語を固定する

| 用語 | 意味 |
|---|---|
| LINEアカウント | Harness に登録した LINE公式アカウント 1 件。`line_accounts` の 1 行 |
| チャネル情報 | Messaging API のチャネル ID・チャネルシークレット・チャネルアクセストークン |
| Login チャネル | LINE Login のチャネル ID・シークレット。LIFF と友だち追加 URL の認証に使う |
| 接続確認 | 保存前に LINE API へ問い合わせ、資格情報と Webhook を検査すること。DB へ書かない |
| Webhook 突合 | Harness が期待する URL と LINE Developers に登録された URL の比較 |
| 稼働 | `is_active = 1`。受信・配信・自動処理の対象 |
| 停止 | `is_active = 0`。受信は台帳に残すが処理しない。配信・自動処理は skip |
| archive | 退役。一覧の既定表示から外れ、書込を受け付けない。履歴からは読める |
| 既定アカウント | 切替プルダウンの初期選択。組織の既定と人の既定がある |
| 乗り換え | 他ツールで運用していた同じ LINE公式アカウントを Harness へ移すこと |
| 引き継ぎコード | 取込パッケージを受け取り側アカウントへ結び付ける 1 回限り・期限付きのコード |
| 取込パッケージ | 乗り換えで取り込む友だち・タグ・友だち情報欄の書き出しと、その検査結果の入れ物 |

## 5. 画面とルート

### 5-1. 既存画面に載せるもの

| 内容 | 載せる画面 | 理由 |
|---|---|---|
| アカウント切替 | 共通トップバー `cBSCb` の `LINEアカウント` プルダウン | 全画面共通。画面ごとに切替を作らない |
| 人の既定アカウント | 30 ログインユーザー（本人の詳細） | 人に属する設定。担当範囲と同じ場所 |
| 友だち追加 URL・QR | 1 ダッシュボード `JN6mQ` | 登録完了後の行き先。QR の正本は 01 §7 |
| 機能オン・オフ | 31 機能設定 `c4R6F` | アカウント設定に機能スイッチを混ぜない |
| 接続異常・BAN | 32 運用状態 | 監視と停止の正本は 32。33 は登録と設定 |
| 停止・archive・本実行の確認 | `H2S1T4` 重要操作確認 | 標準 `confirm()` を使わない |

### 5-2. Pencil に追加が必要な画面

| 画面 | 型 | 何をする画面か | 呼び出し元 | 行き先 |
|---|---|---|---|---|
| 新規画面 A: LINEアカウント一覧 | L | 稼働・停止・archive、接続状態、Webhook 突合、友だち数、既定の印を一覧で見る。並び順と親子を変える | サイドメニュー「設定」区分 | B、C、D |
| 新規画面 B: LINEアカウントを登録する | E | チャネル情報、Login チャネル、LIFF、名前、タイムゾーンを入力し、接続確認を経て保存する | A の `LINEアカウントを登録` | A、ダッシュボード `JN6mQ` |
| 新規画面 C: LINEアカウントの詳細・編集 | D | 登録内容、Webhook 突合、LIFF 確認、資格情報の差し替え、停止・再開、archive、設定コピー | A の行 | A、乗り換え D |
| 新規画面 D: 乗り換え・引き継ぎ | E | 引き継ぎコードの発行と受取、dry-run 結果、件数照合、競合の判断、本実行、切り戻し | C の `乗り換えを始める` | C、03 友だち |

新規画面 B と C の右 390 カラムは「Webhook 突合」→ `つながる先` → `気をつけること` の順。`つながる先` は 1 ダッシュボード、30 ログインユーザー、32 運用状態、03 友だちだけ。

### 5-3. ルート

| 画面 | ルート |
|---|---|
| 一覧 | `/accounts` |
| 登録 | `/accounts/new` |
| 詳細・編集 | `/accounts/{id}` |
| Webhook・LIFF の確認 | `/accounts/{id}?tab=connection` |
| 乗り換え | `/accounts/{id}/handover` |
| 乗り換えの実行詳細 | `/accounts/{id}/handover/{runId}` |

現行 `/accounts` は `/hq` へ、`/accounts/new` は `/restaurant-test/stores/new` へ転送している。この転送を廃止し、`/hq` は統括向けの店舗管理として残す。サイドメニュー「設定」区分の先頭に「LINEアカウント」を置く（`menu.ts` の `設定` 区分。`required: true`）。

## 6. 登録

### 6-1. 入力

- 表示名（必須、40 文字以内。CLI が入れた `LINE Harness` は初回に変更を促す）
- チャネル ID（必須、数字）
- チャネルシークレット（必須）
- チャネルアクセストークン（必須。長期トークンまたは v2.1 発行トークン）
- Login チャネル ID（任意。友だち追加 URL・LIFF を使うなら必須）
- Login チャネルシークレット（Login チャネル ID と対で必須）
- LIFF ID（任意。`{数字}-{英数字}` 形式）
- タイムゾーン（既定 `Asia/Tokyo`）
- アイコン、国・地域、役割メモ、親アカウント、友だち数上限と警告値

Login チャネル ID と LIFF ID は他アカウントと重複不可（現行 `checkUniqueLoginAndLiff` を維持）。警告値が上限を超える設定は拒否する（現行 `readCapacity`）。

### 6-2. 保存

- チャネルシークレットとアクセストークンは 26 外部連携 §10 と同じ暗号化基盤で保存する。現行の `credential-crypto` を使い、鍵は `LINE_CREDENTIAL_ENCRYPTION_KEY`
- Login チャネルシークレットも同じ基盤で暗号化する。現行は平文列 `login_channel_secret` に保存しており、これを移行対象にする
- 保存後、資格情報の値を画面・一覧・詳細・ログ・監査へ再表示しない。返すのは `channelAccessTokenConfigured` 等の真偽値、末尾 4 文字、更新日時だけ
- 平文列 `channel_access_token`、`channel_secret` への書込は暗号化列の充足確認後に止め、列自体は別承認で削除する（`docs/line-credential-encryption.md` の手順）
- 差し替えは「新しい値を入れて保存」だけ。現在値の表示や編集はしない
- 差し替え前に接続確認を通し、失敗したら保存しない

### 6-3. 接続確認

保存前に `verify-connection` を必ず通す。現行の検査順を維持する。

1. Login チャネル ID・シークレット・LIFF ID の形式
2. `GET /v2/bot/info` でアクセストークンの有効性
3. `GET /v2/bot/channel/webhook/endpoint` で登録 URL と利用設定
4. 期待 URL と一致し利用中なら `POST /v2/bot/channel/webhook/test`

結果は項目ごとに `ok | failed | skipped` と運用者向け文面で返す。文面は現行のもの（「Messaging API の Channel Access Token を確認してください」「Webhook URL の一致・利用設定・接続テストを確認してください」等）を 34 §9 の対応表へ登録し、画面はそこから引く。接続確認は DB へ書かない。

チャネルシークレットの検査は LINE API に無い。Webhook 受信で署名が一致した時点で `channel_secret_verified_at` を記録し、それまでは「未検証」と表示する。

## 7. Webhook URL の発行と突合

### 7-1. 発行

- Webhook URL は `WORKER_PUBLIC_URL + /webhook`。アカウントごとに変えない
- 画面に URL、コピー、LINE Developers への外部リンク、貼る場所の説明を出す
- Callback URL（`/auth/callback`）と LIFF エンドポイント URL（`?liffId=` 付き）も同じ場所に並べる（現行 `account-setup-urls.tsx`）

### 7-2. 突合

`fetchWebhookEndpointState` の 4 状態を正本にする。

| 状態 | 意味 | 表示 |
|---|---|---|
| `matched` | 登録 URL が一致し、利用設定がオン | 緑「接続済み」 |
| `mismatched` | URL が違う、または利用設定がオフ | 黄「LINE側の設定が違います」。登録されている URL を並べて表示 |
| `unconfigured` | URL 未登録 | 黄「Webhook URL が未設定です」 |
| `unknown` | LINE API へ問い合わせできない | ラベル「取得失敗」、値 `—` |

- 突合結果、登録されていた URL、確認日時を `line_account_connection_checks` に保存する。現行は一覧を開くたびに LINE へ問い合わせ、結果を残さない
- 一覧・詳細は保存済みの最新結果を表示し、`再確認` で明示的に取り直す
- 32 運用状態 §5-1 の LINE 接続 check はこの台帳を読む。同じ問い合わせを二重に走らせない
- `mismatched` のとき、Lステップ等の他ツールの URL が入っている場合は「他のツールが受信しています。切り替えると、そのツールへの受信が止まります」と出す（`docs/line-account-migration-options.md` §1-A）
- Webhook URL は 1 チャネルに 1 つ。並行稼働できないことを画面に固定表示する

### 7-3. 受信側との整合

- 署名検証は現行どおり稼働中アカウントのシークレットで行う。停止・archive のアカウントは検証対象から外す
- 署名一致で `channel_secret_verified_at` と `last_webhook_received_at` を更新する
- どのアカウントとも一致しない受信は、`line_webhook_events` に `rejected` として本文を残さず記録し、24 時間に 1 回だけ運用者へ通知する。現行はログだけで画面に出ない

## 8. LIFF アプリ

- LIFF の作成は LINE Developers で人が行う。Harness は作成しない（API が無い）
- 画面に手順、エンドポイント URL（`?liffId=` 付き）、必要 scope（`openid`、`profile`、`chat_message.write`）、サイズ Full、公開済みにする注意を出す。CLI の案内文と同じ内容にする
- 登録した LIFF ID で `GET /api/liff/config` 相当の自己確認を行い、`liff_id` の形式と Login チャネルの対応を検査する
- LIFF エンドポイント URL が Harness の URL と違う場合は「LIFF の URL が違います」を突合結果に加える。LINE API から取得できない場合は「未取得」
- README の「LIFF アプリの自動作成」は現行 CLI の動作（手順表示と ID 入力）と一致しない。要件は「手順案内と検証」に固定し、README を実装時に直す

## 9. 複数アカウントの切替と既定アカウント

### 9-1. 切替

- 切替はトップバー `cBSCb` のプルダウンだけ。画面内に別の切替を置かない
- 選択肢は 30 の担当範囲（`assignedLineAccountId` と子孫権限）内の稼働・停止アカウント。archive は「archive を表示」を選んだ時だけ
- 切替時は URL の `?account=` を更新し、再読込・共有で同じアカウントへ戻る。localStorage は補助にとどめる
- 切替直後は選択中アカウントの範囲外 ID を保持しない。開いていた詳細画面は一覧へ戻す

### 9-2. 既定

| 層 | 保存先 | 決める人 |
|---|---|---|
| 組織の既定 | `line_accounts.is_default`（組織内で 1 件） | owner |
| 人の既定 | `staff_members.default_line_account_id` | 本人または admin |

- 初期選択は「人の既定」→「組織の既定」→「表示順の先頭」の順
- 既定アカウントを停止・archive するときは、先に別の既定を選ばせる
- 1 アカウントだけの組織では既定の設定項目を出さない

## 10. 稼働停止・再開・archive

### 10-1. 停止

- `is_active = 0`
- 受信 Webhook は署名検証の対象から外す。届いた本文は処理しない
- 配信・シナリオ・リマインダ・自動応答・通知・オートメーションの dispatcher は runtime gate（共通基盤 §6-3）で `skipped` にする。理由は `account_inactive`
- 予約中の配信 job は取り消さず `skipped` で残す。再開後に自動再送しない
- 停止理由（手動、BAN 検知、資格情報失効）を記録する

### 10-2. 再開

- 接続確認を通してから `is_active = 1`
- 停止中に `skipped` になった job の一覧を表示し、再実行は運用者が選ぶ

### 10-3. archive

- `archived_at`、`archived_by`、理由を記録する。物理削除しない
- 前提: 停止済み、稼働中の配信 job が 0、既定アカウントではない、プールに入っていない
- archive 後は書込 API を 409 `ACCOUNT_ARCHIVED` で拒否する。読取は権限内で可能
- 友だち、配信結果、監査、分析の過去データはそのまま。集計の分母から自動で外さない
- 復元は owner だけ。復元後は停止状態から始める
- 現行 `deleteLineAccount` と `DELETE /api/line-accounts/:id` は archive へ置き換える。cross-review §6「delete endpoint は原則 archive」に従う

## 11. BAN検知と自動切替

### 11-1. 検知

現行 `ban-monitor.ts` を正本にし、判定を広げる。

- `bot/info` の 403 を `danger`、429 を `warning`
- 1 時間の送信数が上限（既定 5,000 通、31 で変更可能）を超えたら `warning`
- Webhook 受信が想定時間（既定 24 時間、31 で変更可能）無いときは `warning`。0 件が正常なアカウントは除外設定を持つ
- 状態が変わった時だけ通知する。定期確認のたびに増やさない
- 結果は `account_health_logs` に残し、32 運用状態 §5-1 が読む

### 11-2. 自動切替

- 対象はトラフィックプールに入ったアカウントだけ。プール外は通知にとどめる
- `danger` になったアカウントはプール内で `inactive` にし、友だち追加先を次の稼働アカウントへ切り替える（現行 `/pool/:slug` の振り分け）
- 既存友だちの移動は自動で行わない。`account_migrations` を使う移動は owner が dry-run と件数を見て実行する
- 切替が起きたら 24 運用者通知と 32 の履歴に記録する
- `danger` が解除されても自動で戻さない。owner が再開を選ぶ

## 12. Lステップからの乗り換え

### 12-1. 前提

- 同じ LINE公式アカウント（同じチャネル・同じプロバイダー）を使い続ける。user ID はそのまま維持される（`docs/line-account-migration-options.md` §0、§1-A）
- Webhook URL を Harness へ向けた瞬間から Lステップへの受信が止まる。切替日時を決めてから行う
- 別チャネルへ引っ越す場合の user ID 変換は 03 友だち §12 の UID 移行。本書では扱わない

### 12-2. 4 段階

```text
準備 → dry-run → 件数照合と競合判断 → 本実行 → 切り戻し点の保持
```

1. 準備: Harness にチャネル情報を登録し接続確認を通す。Webhook はまだ切り替えない
2. dry-run: 取込パッケージを検査し、追加・更新・競合・不明を件数で出す。DB を変えない
3. 件数照合と競合判断: Lステップ側の件数と dry-run の件数を並べ、差の理由を運用者が確認する。競合は 1 件ずつまたは規則で判断する
4. 本実行: 取込を 1 job で行い、`account_handover_runs` に結果を残す
5. Webhook 切替: LINE Developers で URL を Harness へ変更し、突合が `matched` になったことを確認する
6. 切り戻し: 取込前の切り戻し点から取込分だけを無効化する。Webhook は運用者が Lステップの URL へ戻す。戻し先の URL は切替前の突合結果から表示する

### 12-3. 取込パッケージと引き継ぎコード

- 取込パッケージの出どころは 2 つ。別の Harness アカウントからの書き出し、Lステップから書き出した CSV 群（友だちリスト、タグ、友だち情報欄）
- Lステップ CSV は運用者が R2 へ上げ、列の対応を画面で決める。列の自動推測はしない
- 引き継ぎコードは取込パッケージに対して発行する。1 回限り、既定 72 時間、hash 保存、使用後は失効
- 受け取り側は別アカウントでも同じアカウントでもよい。受け取り時に組織・権限・アカウント範囲を検査する
- 現行 `migration.tsx` の「準備中」ボタンはこの仕組みで置き換える。`出す＝使える` に戻す

### 12-4. 取り込むもの

| 対象 | 取込 | 照合キー |
|---|---|---|
| 友だち | 追加または更新 | LINE user ID。無ければ 03 §12-2 の検証済み対応表 |
| タグ | 定義を追加、付与を再現 | タグ名（同名は既存に結合） |
| 友だち情報欄 | 項目定義と値 | 項目名と型（04 §7-1 の型へ対応） |
| 対応マーク | 定義 | 名前 |
| 流入経路の名前 | 参考情報として値に保存 | 18 の経路は作らない |

取り込まないもの: トーク履歴、配信実績、クリック数、シナリオ本文、リッチメニュー画像。取り込めないことを画面に固定表示する。

### 12-5. 競合の判断

| 状況 | 既定 | 選べる規則 |
|---|---|---|
| 同じ user ID の友だちが既にいる | 更新しない | Lステップ側で上書き、項目ごとに新しい方 |
| 同名タグが既にある | 既存に結合 | 別名で追加 |
| 同名の友だち情報欄で型が違う | 取り込まない（要判断） | 文字列として別項目で追加 |
| 値が型に合わない | その値だけ不明にする | 空にする |
| user ID が無い行 | 未一致として保留 | 03 の対応表で再照合 |

「要判断」が 1 件でも残る間は本実行できない。規則で一括判断した件数を監査に残す。

### 12-6. 件数照合

- Lステップ側件数は運用者が入力する（自動取得の API は無い）
- 取込後、友だち数、タグ別付与数、情報欄別の値あり件数を Lステップ側件数と並べる
- 差がある行は理由の分類（未一致、ブロック中、重複、型不一致）を出す
- 照合結果は run に保存し、後から再表示できる

## 13. データ要件

既存 `line_accounts`、`account_health_logs`、`account_migrations`、`traffic_pools`、`line_webhook_events` を使う。

### 13-1. `line_accounts` へ追加

- `login_channel_secret_encrypted`
- `is_default`
- `archived_at`、`archived_by`、`archive_reason`
- `inactive_reason`: `manual | ban_detected | credential_invalid | null`
- `channel_secret_verified_at`
- `last_webhook_received_at`
- `revision`

### 13-2. 追加する台帳

`line_account_connection_checks`:

- アカウント ID
- 種別: `bot_info | webhook_endpoint | webhook_test | liff_config | token_refresh`
- 結果: `matched | mismatched | unconfigured | unknown | ok | failed`
- 登録されていた URL、利用設定、HTTP status
- 実行者（cron または人）、実行日時、相関 ID

`account_handover_packages`:

- 出どころ: `harness | lstep_csv`
- 元アカウント（Harness の場合）
- ファイル参照（R2）、列対応、hash
- 引き継ぎコードの hash、期限、使用日時
- 作成者、作成日時

`account_handover_runs`:

- パッケージ ID、受け取りアカウント
- 段階: `dry_run | reconciling | executing | completed | rolled_back | failed`
- 件数: 追加、更新、結合、競合、不明、保留
- 競合規則の snapshot
- Lステップ側の申告件数
- 切り戻し点（取込した友だち・タグ・値の ID 集合の参照）
- 実行者、開始・完了日時

### 13-3. `staff_members` へ追加

- `default_line_account_id`

## 14. API要件

| 方法 | API | 用途 |
|---|---|---|
| GET | `/api/line-accounts` | 一覧。保存済み突合結果と健全性を含む。LINE へ都度問い合わせない |
| POST | `/api/line-accounts` | 登録。接続確認を内包 |
| POST | `/api/line-accounts/verify-connection` | 保存前の接続確認。DB へ書かない |
| GET | `/api/line-accounts/{id}` | 詳細。資格情報の値は返さない |
| PUT | `/api/line-accounts/{id}/credentials` | 資格情報の差し替え。owner、step-up |
| PATCH | `/api/line-accounts/{id}` | 表示情報、Login、LIFF、上限 |
| POST | `/api/line-accounts/{id}/connection-checks` | Webhook・LIFF の再確認と保存 |
| POST | `/api/line-accounts/{id}/deactivate` | 停止。理由必須 |
| POST | `/api/line-accounts/{id}/activate` | 再開。接続確認を内包 |
| POST | `/api/line-accounts/{id}/archive` | archive。前提検査つき |
| POST | `/api/line-accounts/{id}/restore` | 復元。owner |
| PUT | `/api/line-accounts/default` | 組織の既定 |
| PUT | `/api/access/users/{id}/default-account` | 人の既定（30 の API 群） |
| GET | `/api/line-accounts/{id}/credential-health` | 既存。owner の診断 |
| POST | `/api/line-accounts/{id}/handover/packages` | 取込パッケージ作成、引き継ぎコード発行 |
| POST | `/api/line-accounts/{id}/handover/redeem` | 引き継ぎコードの受取 |
| POST | `/api/line-accounts/{id}/handover/runs` | dry-run |
| POST | `/api/line-accounts/{id}/handover/runs/{runId}/decide` | 競合の判断 |
| POST | `/api/line-accounts/{id}/handover/runs/{runId}/execute` | 本実行。確認済み |
| POST | `/api/line-accounts/{id}/handover/runs/{runId}/rollback` | 切り戻し |

- 全変更 API に `expected revision`、冪等キー、相関 ID
- 既存 `DELETE /api/line-accounts/{id}` は archive へ転送し、1 版後に廃止
- 応答形式は共通基盤 §10。競合 409、範囲外 404、入力不備 422

## 15. 権限

この表は役割 bundle の既定値であり、正本は `v6-30-login-users-requirements-draft.md` §7 の三段階（`edit` / `view` / `none`）と重要操作 permission である。表中の「個別権限」「指定者のみ」「二者承認」は、次の permission key を staff へ個別付与することを指す。

| permission key | 操作 | 既定で持つ役割 |
|---|---|---|
| `account.line.register` | 登録、接続確認 | owner |
| `account.credential.rotate` | 資格情報の差し替え。step-up TOTP 必須 | owner |
| `account.credential.diagnose` | 資格情報診断 | owner |
| `account.line.activate` | 停止・再開 | owner |
| `account.line.archive` | archive・復元 | owner |
| `account.default.set` | 組織の既定 | owner |
| `account.handover.execute` | 乗り換えの本実行・切り戻し。不可逆確認 | owner |
| `account.metadata.edit` | 表示名、並び、親子、上限、Login、LIFF | owner、admin |

- 一覧・詳細の閲覧は `view`。staff は担当範囲内だけ
- 資格情報の値はどの権限でも返さない
- 範囲外 ID は 404。存在の有無を漏らさない
- 現行の `requireRole('owner')`（PUT、credential-health、traffic-pools）と `requireRole('owner', 'admin')`（PATCH、order、hierarchy）の分け方をこの表へ移す

## 16. 監査

30 §13 の共通監査 writer へ次を記録する。

- 登録、資格情報差し替え（値は残さない。末尾 4 文字と更新前後の `configured` だけ）
- 接続確認の実行と結果
- Webhook 突合の状態変化
- 停止、再開、archive、復元と理由
- 既定の変更
- プールの自動切替（actor は system）
- 乗り換えの各段階、競合規則、件数、切り戻し
- 引き継ぎコードの発行、使用、失効

高危険操作（資格情報差し替え、archive、乗り換え本実行）は監査書込不能なら fail-closed。

## 17. 状態

- 空: アカウント 0 件。`fRgeK` まだありません＋ `LINEアカウントを登録`
- 読み込み中: `sZE9Q`
- 失敗: `OLMp0`＋再読込
- 権限不足: 一覧は閲覧可、操作ボタンは描かない。API は 403
- 接続確認中、接続確認失敗（項目別）
- Webhook 突合の 4 状態（§7-2）
- 資格情報: 暗号化済み・復号可、暗号化済み・復号不可（鍵未設定）、平文フォールバック中
- トークン期限: 7 日以内、期限切れ、更新失敗
- 停止中（理由つき）、archive 済み、既定
- BAN 検知: `normal | warning | danger`
- 乗り換え: dry-run 中、要判断あり、本実行中、完了、切り戻し済み、失敗
- 引き継ぎコード: 未使用、使用済み、期限切れ

未取得の表示は D8 のとおり。値は `—`、ラベルは「未取得」。理由が分かる場合は「取得失敗」「権限不足」「未接続」。「取得できません」は使わない。API の状態名は `unavailable | partial | stale` のまま。

## 18. 再試行

- LINE API の一時失敗（接続確認、Webhook 突合、bot profile、月間プラン）は共通基盤 §6-2 の既定に従う。`429` は `Retry-After` を優先
- 接続確認の恒久失敗（401、403、形式不備）は再試行しない。運用者へ理由を返す
- 乗り換えの本実行は内部処理。途中失敗は job を `failed` で止め、手動再試行は新しい attempt。取込済みの行を二重に作らない
- トークン再発行の失敗は cron の次回に持ち越し、3 回連続で `warning` を出す

## 19. 既存データ移行

1. `line_accounts` の暗号化列の充足を全件確認し、平文列の書込を止める
2. `login_channel_secret` を暗号化列へ移し、hash で照合してから平文列を空にする
3. `is_active = 0` の既存行に `inactive_reason = manual` を入れる
4. 組織ごとに `display_order` 先頭を `is_default` にする。複数組織は owner に確認
5. `DELETE` 呼び出し元を archive へ置き換え、物理削除を止める
6. CLI が入れた `LINE Harness` という表示名を初回ログインで変更するよう促す
7. `account_migrations` の既存 job を `account_handover_runs` に統合せず、友だち移動の台帳として残す
8. `migration.tsx` を新規画面 D で置き換え、「準備中」ボタンを消す
9. 件数、稼働数、既定、暗号化状態、Webhook 突合を移行前後で照合

## 20. 除外

- LINE Developers 側のチャネル作成、Webhook URL 設定、LIFF 作成の代行
- 資格情報の再表示、平文での保存継続
- 物理削除
- 異なるプロバイダー間の user ID 変換（03 §12 で扱う）
- 名前・画像だけでの友だち照合
- Lステップ側件数の自動取得
- BAN 検知による既存友だちの自動移動
- `danger` 解除後の自動再開
- Webhook の並行稼働
- 引き継ぎコードの再利用・延長

## 21. 完了条件

- V6 4 画面すべてで、空・読み込み中・失敗・権限不足の 4 状態が共通部品 `ListState` で描画され、契約テストが通る
- 主操作ごとに、成功・失敗・権限不足（`view` と `none`）の 3 経路を自動テストで確認する
- 画面遷移は `scripts/visual-qa/screens.mjs` の対象画面一覧と過不足なく一致する
- 設計との画像比較は共通工程ゲート（`v6-shared-platform-requirements.md` §10「工程ゲート」）に従う。要件の完了条件には含めない
- 資格情報の値が一覧・詳細・監査・ログ・エラー応答のどれにも出ないことを自動テストで確認する
- `login_channel_secret` の平文が新規保存で残らない
- 接続確認の 4 項目それぞれの失敗を再現し、DB が変わらないことを確認する
- Webhook 突合の 4 状態を再現し、`line_account_connection_checks` に保存され、32 が同じ結果を読む
- 停止中アカウントの受信・配信・自動処理が `skipped` になり、再開後に自動再送されない
- archive の前提検査（稼働中 job、既定、プール）が 409 で拒否する
- archive 後も過去の配信結果・友だち・監査を読める
- 組織の既定と人の既定の優先順が切替プルダウンの初期選択に反映される
- BAN 検知の `danger` でプール内の友だち追加先が切り替わり、通知と履歴が 1 回だけ出る
- 乗り換えの dry-run が DB を変えず、要判断が残る間は本実行できない
- 本実行後の件数照合と切り戻しで、取込前の件数へ戻る
- 引き継ぎコードが 1 回で失効し、期限切れを拒否する
- `準備中` のボタンが 1 つもない

## 22. 実装順

1. 用語、archive・停止の意味、権限表を固定
2. `login_channel_secret` 暗号化、平文列の書込停止
3. `is_default`、`archived_at`、`inactive_reason`、`revision` の追加
4. archive API と `DELETE` の置換、runtime gate の `account_inactive`
5. `line_account_connection_checks` と保存型の突合、32 との接続
6. 既定アカウント 2 層と切替プルダウンの初期選択
7. BAN 検知の判定拡張とプール自動切替の履歴化
8. 取込パッケージ、引き継ぎコード、dry-run、競合判断、本実行、切り戻し
9. 新規画面 A〜D を Pencil へ追加し、機能接続
10. 既存データ移行 dry-run、件数照合、画像比較

## 23. 実装前に固定する判断

- Lステップの友だちリスト CSV に LINE user ID が含まれるかを実機で確認する。含まれない場合は 03 §12-2 の対応表を必須にする（`docs/lstep-liny-v4-source.md` §8 でデータ移行は未検証）
- 引き継ぎコードの既定期限（72 時間）と桁数
- 乗り換え本実行の二者確認を求めるか。1 人運用では D6 と同じく件数の手入力による本人再確認で代替する
- 組織の既定を `line_accounts` に置くか、組織設定に置くか（統括 `tenant_id` との関係）
- Webhook 受信が無いときの `warning` の既定時間
- CLI の初期登録で LIFF を任意にするか必須のままにするか
- README の「LIFF アプリの自動作成」の文言修正
