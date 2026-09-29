# V6 22・24・25 画面の設計寄せ — 口が足りないところの引き継ぎ

作成: 2026-09-02 ／ 対象PR: `codex/kenta-v6-photo-notify-automation-fit`

対象は3画面。

| 設計Node | 画面 | ルート |
|---|---|---|
| `Qu6Vk` | V6 22-1 写真審査一覧 | `/nen-members` |
| `Q55bb` | V6 24-1-A お知らせの中身を編集する | 未実装（`/line-notifications?tab=customer` に折りたたみの編集欄だけがある） |
| `Rv8Jv` | V6 25-1-A ルールを作る | `/automations/new` |

このPRでやったのは**寸法と枠の設計寄せ**だけです。DB・API・実行エンジンは触っていません。
設計に描かれていて、いま**口が無いので作らなかったもの**を、ここに書き残します。

---

## 1. `Qu6Vk` 写真審査 — 右カラム「自動で戻す条件」

右カラム（390px）に枠だけ置き、値は `—` と「まだ繋がっていません。自動審査の口が接続されると表示されます。」にしてあります。

要件は `docs/v6-requirements/v6-22-photo-review-requirements-draft.md` §1・§5 で決まっています。設計に描かれている「3回以上通した人は自動公開」は**採用しません**。AIは注意候補と確認順の並べ替えだけに使い、公開の最終判断は人が行います。

### 要る口

- `GET /api/nen-members/photos?accountId=...` の各行に、次を足す。
  - `riskFlags: Array<{ kind: 'face' | 'blur' | 'dark' | 'logo' | 'duplicate'; confidence: number; area?: [number, number, number, number] }>`
  - `riskModel: { provider: string; model: string; version: string; checkedAt: string } | null`
  - `technicalReturnReason: 'decode_failed' | 'too_small' | 'unsupported_format' | null`
- 未評価と「評価して問題なし」を分ける。両方 `[]` にすると、画面が「安全だと判定済み」と読める。未評価は `riskModel: null` で表す。

### 返り値の決めごと

- `confidence` を合否の確率として画面に出さない。要件 §5 の禁止事項。
- 再評価で古い結果を上書きしない。画面は最新1件だけ読む。
- 権限が無いアカウントの写真は、存在も返さない。

### 状態番号

| 状態 | HTTP | code | 画面の言葉 |
|---|---|---|---|
| 取得失敗 | 500 | `photo_risk_unavailable` | 読み込めませんでした |
| 権限不足 | 403 | `forbidden` | 見る権限がありません |
| 未評価 | 200 | — | `—` ＋「まだ繋がっていません。…」 |

### 副作用

自動審査の評価は写真の状態を変えません。`pending_review` のまま並び順だけが変わります。
`technical_return` だけは状態を動かしますが、要件 §3 のとおり**審査回数に数えない**うえ、再投稿の導線を必ず出します。

---

## 2. `Q55bb` お知らせの中身を編集する — 画面ごと未実装

**このPRでは作っていません。**要件 `docs/v6-requirements/v6-24-line-notification-requirements-draft.md` §4-2 のルートは `/line-notifications/customer/{definitionId}` ですが、いまある口は `PUT /api/ec-commerce/settings/:eventType`（`api.ecCommerce.updateSetting`）だけで、**公開中の内容を直に書き換えます**。

設計は「下書きを保存」「テスト」「公開」を分け、公開済み版を不変にする前提です。版が無いまま画面だけ作ると、公開版を直接編集できる画面になり、送信待ちの通知が途中で変わります。だから作りませんでした。

### 要る口

| 操作 | 案 | 返り値 |
|---|---|---|
| 定義の取得 | `GET /api/line-notifications/customer/:definitionId?lineAccountId=` | 公開版・下書き版・最終更新者・きっかけ・差込項目の許可リスト |
| 下書き保存 | `PUT /api/line-notifications/customer/:definitionId/draft` | `{ draftVersionId, updatedAt }`。公開版は変えない |
| テスト送信 | `POST /api/line-notifications/customer/:definitionId/test` | `{ sent: number }`。テスト受信者だけへ送る |
| 公開 | `POST /api/line-notifications/customer/:definitionId/versions/:versionId/publish` | 新しい不変版 |
| 停止・再開 | `POST /api/line-notifications/customer/:definitionId/status` | 新規受付だけを止める |

### 入力

- 見出し（80文字）・ご案内文（800）・結びの文章（800）・ボタン名（20）・ボタンURL・画像URL
- 送るタイミング、送信対象外条件
- 差込項目は**イベント種別ごとの許可リストから選ぶ**。元データのJSONキーを直接入力させない（要件 §4-2）

### 状態番号

| 状態 | HTTP | code | 画面の言葉 |
|---|---|---|---|
| 入力不備 | 400 | `title_required` / `button_url_invalid` / `image_url_invalid` | 欄ごとに出す |
| 差込項目が許可外 | 400 | `placeholder_not_allowed` | 使えない差込項目です |
| 版の競合 | 409 | `draft_version_stale` | 読み込み直してください |
| 公開版の直接編集 | 409 | `published_version_immutable` | 公開中の内容は直せません。新しい版を作ってください |
| 権限不足 | 403 | `forbidden` | 操作する権限がありません |

### 副作用

- 公開すると新しい不変版ができる。**すでに送信待ちの通知は確定済み版のまま**送られる。
- 停止は新規受付だけを止める。送信中のものを取り消さない。
- テスト送信は実送信。LINEの月間送信枠を消費する。

### 画面ができるまでの扱い

`/line-notifications?tab=customer` の折りたたみ編集欄は残してあります。いまの `updateSetting` の意味（公開中の内容を直に書き換える）のままなので、**「下書きを保存」「公開する」という言葉を使っていません**。`customer-notifications-v6-contract.test.ts` がその2語と `/line-notifications/customer` の存在を見張っています。

---

## 3. `Rv8Jv` ルールを作る

### 3-1. 作ったもの

- 画面名を共通トップバーへ寄せ、本文の h1 を外した（トップバー・パンくず・h1 の三重を解消）
- 決めごと3段の番号バッジ（26×26・丸・12px・700）
- 主要ボタン 40/8/[0,14]/13/700、行の小操作 32/6、プルダウン 40/8/13
- 下部追従バー（共通部品・高さ72・角丸10）へ保存・キャンセルを寄せた
- 右カラム 390px
- **すること（動き）を複数持てるようにした。** `POST /api/automations` は前から `actions` を配列で受けている

### 3-2. きっかけの選択肢を絞った

`friend_added` `tag_added` `form_submitted` `link_clicked` を外しました。どれも `AutomationEventType` に無い値で、保存はできても `processAutomations` の完全一致に当たらず**一度も動きません**。要件 §4-2・§11 の「準備中の選択肢を出さない」に反していました。

いま出しているのは、`apps/worker` に `fireEvent` の呼び出し元がある4つだけです。

| 画面の言葉 | 値 | 発火元 |
|---|---|---|
| メッセージを受け取ったとき | `message_received` | `routes/webhook.ts` |
| 友だちになったとき | `friend_add` | `routes/webhook.ts` |
| タグが付いた・外れたとき | `tag_change` | `routes/friends.ts` / `services/friend-tag-attach.ts` |
| メニューやボタンが押されたとき | `postback_received` | `routes/webhook.ts` |

`automation-create-v6-contract.test.ts` が、画面の一覧と `fireEvent` の呼び出し元を突き合わせています。発火元の無いきっかけを足すと落ちます。

### 3-3. 要る口（このPRでは作っていない）

**a) 見込み人数。** 右カラムの「当てはまりそうな人数」は `—` と「まだ繋がっていません。見込み人数を数える口が接続されると表示されます。」にしてあります。

- `POST /api/automations/preview-audience` → `{ estimated: number, basis: 'exact' | 'sampled', checkedAt: string }`
- きっかけと条件を受け、いまの友だちのうち何人が当てはまるかを返す。取れないときは `null` を返し、0で埋めない。
- 副作用なし。実行台帳へ書かない。

**b) 下書きのまま止めておく。** いまは作った時点で `is_active` が立ちます。右カラムの「気をつけること」に「作ったルールはすぐ動きます」と書いてありますが、本来は要件 §4-2 の「下書き保存と『作成して有効にする』を分ける」が要ります。

- `POST /api/automations` に `isActive?: boolean`（既定 false）を足す。
- 追従バーは「下書きに保存」「作成して有効にする」の2つになる。

**c) タグが付いたときだけ／外れたときだけ。** `tag_change` は付け外しの両方で発火し、`matchConditions` は `eventData.action` を見ていません。`conditions.tag_action: 'add' | 'remove'` を `matchConditions` に足すまで、画面では「付いた・外れた」とだけ書いています。

**d) 選べる「すること」を増やす。** `executeAction` は `remove_tag` `start_scenario` `send_webhook` `switch_rich_menu` も実行できますが、選ぶための一覧（シナリオ・Webhook・リッチメニュー）をこの画面が読んでいません。読む口を足すときに選択肢も足してください。

### 3-4. 直していない不具合（Codexへ）

**`POST /api/automations` に `lineAccountId` を送っていません。** Worker側は受け取る用意があり（`routes/automations.ts`）、送らないと `line_account_id` が NULL になります。NULL は `event-bus.ts` の絞り込みで**全アカウント共通のルール**として扱われます（`!a.line_account_id` で素通り）。つまり、いま画面から作ったルールは全アカウントで動きます。

このPRで直さなかったのは、保存の意味が変わる変更で、25の実行エンジン移行（要件 §13 の1〜7）と同じ単位で扱うべきだからです。画面側は `useAccount()` の `selectedAccountId` をそのまま渡せます。既存のNULL行の扱い（要件 §6-3 の「旧全体設定として隔離」）と一緒に決めてください。

---

## 4. 共通部品で残した差（Claude側の宿題）

| 部品 | 設計（★V6） | いまの実装 | 残した理由 |
|---|---|---|---|
| `shared/button.tsx` | 高さ40 / 700 | 高さ36 / 600（★V5 `nBRKk`） | V5画面227枚が同じ部品を使う。V6寸法へ寄せるのは画面の作り替えと同じPRでやる |
| `shared/tabs.module.css` | 文字13 | 文字14（`--text-body`、★V5 `VPn1F`） | 同上。高さ44は一致している |
| `shared/select-field.module.css` | 高さ40 | 高さ42（★V5 `rpot9`、`v6-parts-contract.test.ts` が固定） | 同上 |

この3つは、V6の寸法を共通部品へ入れる専用のPRで一度に動かしてください。3画面の設計寄せに混ぜると、確認していない画面まで一緒に動きます。この3画面では、画面ごとのCSSモジュールで設計値を出しています。
