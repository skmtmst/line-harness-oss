# 友だち追加時配信 V6 正式仕様

- 状態: 実装前の正本
- 承認日: 2026-08-25
- 対象: 開発・検証環境
- Pencil完成条件: `V7MEJc`
- Pencil一覧: `ZEChU`
- Pencil設定: `bKjC5`
- 開始時の `codex/development`: `54b5d2d207ea31b0c914dce2866f6b1a965f3b00`

## 1. 目的

友だち追加時に、次の2つを組み合わせて配信先を決める。

1. 初回追加か、再追加か
2. 今回使った流入リンクを取得できたか、取得できなかったか

V5までのメッセージ、タグ、友だち情報、対応マーク、シナリオ、マイレージ、優先順位は残す。現在未実装でも技術的に作れる機能は削除しない。

## 2. LINE側の制約

LINEのFollowイベントは、友だち追加とブロック解除の両方で届く。イベントにはユーザーIDは入るが、流入リンクやQRコードの識別子は入らない。

そのため、今回の流入リンクはLINEのWebhookだけでは取得できない。専用リンク、LINE Login、LIFFを通したときに、LINE Harness側で別に記録してFollowイベントと結び付ける。

また、`follow.isUnblocked`は追加とブロック解除を見分ける補助情報だが、LINE公式仕様上、完全な正確性は保証されていない。初回・再追加の主判定には既存のブロック履歴を使う。

公式資料:

- https://developers.line.biz/ja/reference/messaging-api/#follow-event
- https://developers.line.biz/ja/docs/line-login/link-a-bot/

## 3. 用語

| 用語 | 意味 |
|---|---|
| 初回追加 | `friends.unfollow_count = 0`の友だち追加 |
| 再追加 | 過去にブロックされた履歴がある友だちの追加・ブロック解除 |
| 初回流入リンク | その友だちを最初に獲得したリンク。現在の`friends.ref_code`で、上書きしない |
| 今回の流入リンク | 今回の友だち追加・再追加に使われたリンク。イベントごとに保存する |
| 取得できなかった追加 | Followイベントに対応する今回リンクが見つからない追加・再追加 |
| システム初期設定 | アカウント作成時または移行時に自動作成し、削除できない振り分け |

## 4. 画面に出す4経路

| 追加区分 | 今回リンク | 画面上の経路 |
|---|---|---|
| 初回追加 | 取得済み | 初回追加・リンク別振り分け |
| 初回追加 | 取得不能 | 初回追加・取得できなかった追加 |
| 再追加 | 取得済み | 再追加・リンク別振り分け |
| 再追加 | 取得不能 | 再追加・取得できなかった追加 |

「取得できなかった追加」は初回用と再追加用を最初から作る。

- 初期状態で有効
- 削除不可
- 名前、メッセージ、タグ、シナリオなどの内容は変更可能
- 停止しようとした場合は、代わりの既定ルートが必要
- 移行済みアカウントでは現在の初回・再追加設定を引き継ぎ、勝手に新しい文面を送らない
- 新規アカウントでは既存の有効な`friend_add`シナリオを使う互換動作を初期値とする

## 5. 振り分けの優先順位

上から最初に一致した1件だけを実行する。

1. 追加区分と今回リンクが完全一致する有効ルール
2. 今回リンクは取得済みだが専用ルールがない場合の、追加区分別アカウント既定ルール
3. 今回リンクを取得できなかった場合の、追加区分別システム初期設定
4. 移行前の設定しかない場合の互換処理

同じ優先順位のルールが複数一致する状態は保存時に拒否する。Webhook処理中に不整合を検知した場合は、最も小さい`display_order`だけを実行し、運用エラーとして記録する。

## 6. DB設計

### 6.1 `friend_add_events`

友だち追加・再追加1回ごとの判定結果を保存する。

| 列 | 型 | 必須 | 説明 |
|---|---|---:|---|
| `id` | TEXT | 必須 | UUID |
| `line_account_id` | TEXT | 必須 | 対象LINE公式アカウント |
| `friend_id` | TEXT | 必須 | 友だち |
| `webhook_event_id` | TEXT | 必須 | LINEのWebhook Event ID。重複処理防止 |
| `friend_kind` | TEXT | 必須 | `first_time` / `returning` |
| `is_unblocked_hint` | INTEGER | 任意 | LINEから来た補助値。主判定には使わない |
| `attribution_status` | TEXT | 必須 | `captured` / `unavailable` |
| `ref_code` | TEXT | 任意 | 今回の流入リンク |
| `entry_route_id` | TEXT | 任意 | 対応する流入経路 |
| `candidate_id` | TEXT | 任意 | 採用した候補記録 |
| `routing_rule_id` | TEXT | 任意 | 実行した振り分け |
| `routing_status` | TEXT | 必須 | `pending` / `completed` / `failed` / `suppressed` |
| `occurred_at` | TEXT | 必須 | LINEイベント日時 |
| `processed_at` | TEXT | 任意 | 振り分け完了日時 |
| `created_at` | TEXT | 必須 | 作成日時 |

制約と索引:

- `UNIQUE(line_account_id, webhook_event_id)`
- `(line_account_id, friend_id, occurred_at DESC)`
- `(line_account_id, routing_status, occurred_at)`
- `ref_code`には秘密値やOAuthの`state`を保存しない

### 6.2 `friend_add_attribution_candidates`

専用リンク・LINE Login・LIFF側で先に取得した「今回リンクの候補」を保存する。

| 列 | 型 | 必須 | 説明 |
|---|---|---:|---|
| `id` | TEXT | 必須 | UUID |
| `line_account_id` | TEXT | 必須 | 対象アカウント |
| `friend_id` | TEXT | 必須 | IDトークン検証後の友だち |
| `ref_code` | TEXT | 必須 | 今回リンク |
| `entry_route_id` | TEXT | 任意 | 対応する流入経路 |
| `source` | TEXT | 必須 | `line_login` / `liff` / `short_link` |
| `status` | TEXT | 必須 | `pending` / `consumed` / `expired` / `late` |
| `occurred_at` | TEXT | 必須 | 候補取得日時 |
| `consumed_by_event_id` | TEXT | 任意 | 結び付いた追加イベント |
| `expires_at` | TEXT | 必須 | 誤結合防止の有効期限 |
| `created_at` | TEXT | 必須 | 作成日時 |

同じ友だちが短時間に複数リンクを開いた場合は、Followイベントに最も近い未使用候補を1件だけ採用する。採用済み候補は再利用しない。

### 6.3 `friend_add_routing_rules`

| 列 | 型 | 必須 | 説明 |
|---|---|---:|---|
| `id` | TEXT | 必須 | UUID |
| `line_account_id` | TEXT | 必須 | 対象アカウント |
| `name` | TEXT | 必須 | 画面表示名 |
| `friend_kind` | TEXT | 必須 | `first_time` / `returning` |
| `match_type` | TEXT | 必須 | `exact_ref` / `account_default` / `unavailable` |
| `ref_code` | TEXT | 任意 | `exact_ref`だけ必須 |
| `scenario_id` | TEXT | 任意 | 開始するシナリオ |
| `timing` | TEXT | 必須 | `immediate` / `scenario` |
| `start_position` | TEXT | 必須 | `beginning` / `resume` |
| `is_system_default` | INTEGER | 必須 | システム初期設定か |
| `is_active` | INTEGER | 必須 | 有効状態 |
| `display_order` | INTEGER | 必須 | 同種ルール内の順番 |
| `created_at` | TEXT | 必須 | 作成日時 |
| `updated_at` | TEXT | 必須 | 更新日時 |

一意制約:

- `exact_ref`: アカウント、追加区分、`ref_code`の組み合わせで1件
- `account_default`: アカウント、追加区分ごとに1件
- `unavailable`: アカウント、追加区分ごとに1件

### 6.4 `friend_add_routing_actions`

現在の`FriendAddAction`を順番付きの行として保存する。

| 列 | 型 | 必須 | 説明 |
|---|---|---:|---|
| `id` | TEXT | 必須 | UUID |
| `routing_rule_id` | TEXT | 必須 | 親ルール |
| `action_type` | TEXT | 必須 | message / tag / friend_field / support_mark / scenario / common_var / mileage |
| `config_json` | TEXT | 必須 | 種類別設定。読込時に型検証する |
| `display_order` | INTEGER | 必須 | 実行順 |
| `created_at` | TEXT | 必須 | 作成日時 |
| `updated_at` | TEXT | 必須 | 更新日時 |

## 7. 今回リンクの結び付け

### 7.1 専用リンク・LIFF経由

1. `ref_code`を検証する
2. IDトークンを検証してアカウントと友だちを確定する
3. Followを促す前に候補を`pending`で保存する
4. Followイベントを保存する
5. 同じアカウント・友だちの有効な候補を時刻順で1件採用する
6. イベントを`captured`にして振り分ける

既存のLINE LoginではFollowイベントがOAuthコールバックより先に届く場合がある。この経路はイベントを短時間`pending`にして候補を待つ。初期値は3秒とし、計測結果を見て変更できるようにする。

### 7.2 直接追加・直接ブロック解除

候補がないまま待機時間を過ぎたら`unavailable`として確定し、追加区分別の「取得できなかった追加」を実行する。

後から候補が届いても、すでに配信済みのイベントを再振り分けしない。候補は`late`として記録し、二重配信を防ぐ。

### 7.3 初回流入リンクとの分離

`friends.ref_code`は今までどおり初回接点として保持し、上書きしない。今回リンクは`friend_add_events.ref_code`へ保存する。

画面には必要に応じて次を分けて表示する。

- 初回流入: Instagram広告
- 今回の再追加: セミナーLP

## 8. API設計

### 管理画面

| メソッド | パス | 用途 |
|---|---|---|
| GET | `/api/friend-add-routing/rules` | ルール一覧、システム初期設定、実績を取得 |
| POST | `/api/friend-add-routing/rules` | リンク別ルールを作成 |
| GET | `/api/friend-add-routing/rules/:id` | 編集用詳細を取得 |
| PATCH | `/api/friend-add-routing/rules/:id` | 条件・配信・アクション・順番を更新 |
| DELETE | `/api/friend-add-routing/rules/:id` | 通常ルールを削除。システム初期設定は409 |
| POST | `/api/friend-add-routing/preview` | 送信せずに判定結果と実行順を確認 |
| GET | `/api/friend-add-routing/events` | 追加イベントと取得結果を確認 |
| POST | `/api/friend-add-routing/events/:id/retry` | 配信失敗イベントだけを明示的に再実行 |

既存の`GET/PUT /api/friend-add-routing`は移行期間中だけ残し、新APIの形へ変換して返す。

### LIFF・内部処理

| メソッド | パス | 用途 |
|---|---|---|
| POST | `/api/liff/friend-add-intent` | Followを促す前に今回リンク候補を記録 |
| POST | 内部Queue | Followイベントを重複なく確定・振り分け |

`friend-add-intent`はIDトークンを必ず検証し、クライアントから渡された`friend_id`やアカウントIDを信用しない。

## 9. Webhook処理

1. LINE署名を検証する
2. `webhook_event_id`でイベントをINSERTする。重複なら成功応答して終了する
3. 自社履歴から`first_time` / `returning`を決める
4. 今回リンク候補を探す
5. 候補がなければ最大3秒だけ待機対象にする
6. `captured`または`unavailable`を確定する
7. 優先順位に従ってルールを1件決める
8. アクションを順番に実行する
9. 結果を`completed` / `failed` / `suppressed`で保存する

配信処理に失敗してもWebhookを再送させない。再送による二重処理を避け、失敗は管理画面と既存のエラー報告へ出す。

## 10. 移行

1. 新テーブルを追加する
2. LINEアカウントごとに`first_time/unavailable`と`returning/unavailable`を作る
3. 現在の`account_settings.friend_add_routing`を追加区分別のアカウント既定ルールへ変換する
4. アクションの順番を保って移す
5. 変換できない値があれば旧設定を残し、アカウント単位で移行失敗を記録する
6. 読み取りを新テーブル優先に切り替える
7. 十分な検証期間後に旧JSONへの書き込みを止める

移行時に新しいメッセージを勝手に送らない。移行直後の配信結果は移行前と同じにする。

## 11. 権限・安全性

- 閲覧権限: ルールと実績を閲覧可能
- 編集権限: ルール内容を変更可能
- 配信管理権限: 有効化、停止、失敗再実行が可能
- システム初期設定の削除は禁止
- 最後の有効な既定ルートを停止する操作は禁止
- 保存前に一致人数ではなく「4経路すべてに行き先があるか」を確認する
- テストは判定だけを行い、LINE送信、タグ付与、シナリオ登録をしない

## 12. 監視

個人情報や本文を含めず、次を集計する。

- 初回追加件数
- 再追加件数
- 今回リンク取得率
- 取得不能率
- 遅れて届いた候補数
- 既定ルート利用数
- 振り分け失敗数
- アクション失敗数

取得不能率が急増した場合は、LIFF・LINE Login・短縮リンクの連携障害として通知する。

## 13. 受け入れ条件

### 正常系

- 初回追加＋リンク取得済みで、対応するリンク別ルールを1回だけ実行する
- 初回追加＋リンク取得不能で、初回用システム初期設定を実行する
- 再追加＋リンク取得済みで、再追加用リンク別ルールを実行する
- 再追加＋リンク取得不能で、再追加用システム初期設定を実行する
- 再追加時にシナリオを「最初から」「続きから」から選べる
- 初回流入リンクを上書きせず、今回リンクを別に確認できる

### 安全系

- 同じWebhookが再送されても配信・タグ・シナリオを重複実行しない
- 同じ候補を複数イベントへ結び付けない
- 候補が遅れて届いても既定配信後に二重実行しない
- システム初期設定を削除できない
- 4経路のどれかに行き先がない設定を保存できない
- テスト実行では顧客データを変更しない
- アカウントをまたいで候補やルールを参照しない

### 互換系

- 旧設定だけのアカウントは移行前と同じ配信を行う
- `friends.ref_code`を初回流入として保持する
- 流入経路側の`run_account_friend_add_scenarios = 0`を尊重する
- 既存のメッセージ、タグ、友だち情報、対応マーク、シナリオ、共通情報、マイレージを失わない

## 14. 実装順

1. イベント台帳と今回リンク候補
2. 候補記録APIとWebhookの重複防止
3. ルール・アクションテーブルと旧設定移行
4. 4経路判定サービス
5. 一覧・編集・判定テスト・実績画面
6. 監視と検証環境での実追加テスト

本番DB更新・本番配備はこの仕様確定には含めない。
