# 11. フォーム & LIFF (Forms and LIFF)

## 概要

LINE Harnessのフォーム機能は、LINE内で動作するアンケート・回答フォームを提供する。LIFF (LINE Front-end Framework) を利用してLINEアプリ内にWebフォームを表示し、回答データを収集する。フォーム送信時に自動でタグ付与・シナリオ登録・メタデータ保存を実行できる。

L社の「回答フォーム」に相当する機能。

## レイアウト（forms.layout）

2026-08 に、平らな項目配列だけでは表せなかった3つを持てるようにした。

1. ページ分け（セクション）と、選択肢による分岐
2. 選択肢ごとの動作（タグを付ける／友だち情報に書く／動作を実行する）
3. 入力欄ではないブロック（画像・見出し・テキスト・ボタン）

中身は `forms.layout` に JSON で入る。型と、読み書き・検証の関数は
`packages/shared/src/form-layout.ts` にあり、**管理画面・回答画面・保存側の
3か所が同じものを使う**。ここが分かれると「画面では通ったのに保存で弾かれる」
が起きる。

```
FormLayout
├─ header   : FormBlock[]   共通ヘッダ（全ページの先頭に出る）
├─ sections : FormSection[] ページ。1枚ごとに blocks を持つ
└─ options  : FormOptions   フォーム全体の設定
```

### ブロックの種類

| kind / type | 何を出すか | 固有の設定 |
|---|---|---|
| `image` | 画像 | URL・幅・押したときに開くURL |
| `heading` | 見出し | 大きさ（1〜3） |
| `text` | 本文 | — |
| `button` | ボタン | 文字・URL・見た目 |
| `input` / `text` | 単一行 | 入力制限（形式・文字数） |
| `input` / `textarea` | 複数行 | 入力制限（文字数） |
| `input` / `radio` | ラジオボタン | 選択肢・横並び |
| `input` / `checkbox` | チェックボックス | 選択肢・横並び・選択数制限 |
| `input` / `select` | プルダウン | 選択肢 |
| `input` / `file` | ファイル添付 | 画像。R2（`IMAGES`）へ預け、回答にはURLが入る |
| `input` / `date` | 日付 | カレンダー／年月日・リマインダ起動 |
| `input` / `prefecture` | 都道府県 | 47都道府県で固定 |

### 選択肢の作り方

選択肢を持つブロックは `choiceMode` で、選んだときの動きが変わる。

| choiceMode | 選択肢ごとに持つもの | 使いどころ |
|---|---|---|
| `tag` | `tagId` | 「犬を選んだ人にだけ犬タグ」 |
| `friendField` | `value`（空ならラベル） | 回答をそのまま情報欄へ |
| `action` | `actions[]` | 送る・開始する・停止するを組む |

選択肢ごとに `capacity`（定員。埋まると受け付けない）と
`jumpToSectionId`（選んだ人だけ別のページへ）も持てる。

### 回答の登録先（destinations）

入力ブロックの回答は、複数の先へ同時に入れられる。

| 指定 | 入る先 |
|---|---|
| `friendFieldIds[]` | 友だち情報欄（複数可）。**EC側が正の項目には書かない** |
| `realName` | `friends.real_name` |
| `displayName` | `friends.system_display_name` |
| `note` | `friends.private_memo` |

### オプション設定（options）

回答期限 / 1人1回 / 全体の受付数 / 送信前の確認 / 送信後の案内（URL・文面） /
前回の回答を出しておく / ボタンの文字 / ページ見出しの出し方 / 回答後の動作。

**期限は日本時間で読む。** 管理画面の日時入力は時差を持たないので、そのまま
`new Date()` に渡すと Workers（UTC）で9時間ずれる。

### 添付画像の置き場

回答に画像を付けると、`POST /api/forms/:id/files` が R2 バケット `IMAGES` へ
預かり、**回答データにはURLだけが入る**。中身を回答の JSON に入れると1件で
数MBになり、回答一覧を開くだけで重くなる。

キーは `form-uploads/{formId}/{friendId}/{uuid}.{ext}`。誰の・どのフォームの
添付かがキーの形だけで分かるので、削除依頼が来たときに対象を絞り込める。

この口は**認証なしでも叩ける場所に生えている**（友だちが使うため）ので、
次の3つを満たしたときだけ受け取る。1つでも欠けると、フォームIDを知っている
だけで誰でも使える画像置き場になる。

1. LIFF の id_token で本人が特定できる（＝この公式アカウントの友だち）
2. フォームが公開中である
3. そのフォームに、実際にファイルを受け取るブロックがある

受け取るのは jpg / png / gif / webp / heic / heif の10MBまで。heic を入れて
あるのは、iPhone の既定の形式だから。

保存側は、回答が**自分が預かったURLの形**かどうかも見る（`/images/form-uploads/`
で始まること）。別の場所を指すURLを回答に書き込まれても受け付けない。

### fields との関係

`fields` は捨てていない。**保存のたびに layout の入力欄から作り直して書き戻す。**
送信時の必須チェック・回答一覧の見出し・友だち詳細は、これまでどおり `fields`
を読んで動く。layout がまだ無いフォームは、編集画面で開いたときに `fields`
から持ち上げる（開いただけではDBは変わらない）。

## データモデル

### forms テーブル

```sql
CREATE TABLE forms (
  id TEXT PRIMARY KEY,                                                 -- UUID
  name TEXT NOT NULL,                                                  -- フォーム名
  description TEXT,                                                    -- 説明文
  fields TEXT NOT NULL DEFAULT '[]',                                   -- JSON: フィールド定義の配列（layout から自動生成）
  layout TEXT,                                                         -- JSON: FormLayout。NULL なら fields だけのフォーム
  on_submit_tag_id TEXT REFERENCES tags (id) ON DELETE SET NULL,       -- 送信時に付与するタグ
  on_submit_scenario_id TEXT REFERENCES scenarios (id) ON DELETE SET NULL, -- 送信時に登録するシナリオ
  save_to_metadata INTEGER NOT NULL DEFAULT 1,                         -- 回答をfriends.metadataに保存するか
  is_active INTEGER NOT NULL DEFAULT 1,                                -- 受付中/停止
  submit_count INTEGER NOT NULL DEFAULT 0,                             -- 送信数キャッシュ
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### form_submissions テーブル

```sql
CREATE TABLE form_submissions (
  id TEXT PRIMARY KEY,                                    -- UUID
  form_id TEXT NOT NULL REFERENCES forms (id) ON DELETE CASCADE,
  friend_id TEXT REFERENCES friends (id) ON DELETE SET NULL,  -- NULL=匿名回答
  data TEXT NOT NULL DEFAULT '{}',                         -- JSON: 回答データ
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_form_submissions_form ON form_submissions (form_id);
CREATE INDEX idx_form_submissions_friend ON form_submissions (friend_id);
```

## フィールド定義

`fields` カラムはJSON配列で、各フィールドは以下の構造:

### FormField 型

```typescript
interface FormField {
  name: string        // フィールド識別子（英数字、回答データのキーになる）
  label: string       // 表示ラベル（日本語OK）
  type: 'text' | 'email' | 'tel' | 'number' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'date'
  required?: boolean  // 必須項目か（デフォルト: false）
  options?: string[]  // select, radio, checkbox で使用する選択肢
  placeholder?: string // プレースホルダーテキスト
}
```

### フィールドタイプ一覧

| type | 説明 | options必要 | 用途 |
|---|---|---|---|
| `text` | テキスト入力 | 不要 | 名前、自由記述 |
| `email` | メールアドレス | 不要 | メール収集 |
| `tel` | 電話番号 | 不要 | 電話番号収集 |
| `number` | 数値入力 | 不要 | 年齢、数量 |
| `textarea` | 複数行テキスト | 不要 | 長文回答 |
| `select` | ドロップダウン | 必要 | 都道府県、カテゴリ |
| `radio` | ラジオボタン | 必要 | 単一選択 |
| `checkbox` | チェックボックス | 必要 | 複数選択 |
| `date` | 日付選択 | 不要 | 生年月日、希望日 |

### フィールド定義例

```json
[
  { "name": "full_name", "label": "お名前", "type": "text", "required": true, "placeholder": "山田太郎" },
  { "name": "email", "label": "メールアドレス", "type": "email", "required": true },
  { "name": "phone", "label": "電話番号", "type": "tel" },
  { "name": "age", "label": "年齢", "type": "number" },
  { "name": "prefecture", "label": "お住まいの都道府県", "type": "select", "required": true, "options": ["東京都", "大阪府", "愛知県", "その他"] },
  { "name": "interest", "label": "興味のあるプラン", "type": "radio", "options": ["ベーシック", "プロ", "エンタープライズ"], "required": true },
  { "name": "features", "label": "気になる機能", "type": "checkbox", "options": ["ステップ配信", "リッチメニュー", "フォーム", "スコアリング"] },
  { "name": "message", "label": "ご質問・ご要望", "type": "textarea" },
  { "name": "preferred_date", "label": "希望日", "type": "date" }
]
```

## LIFF統合

### LIFFとは

LIFF (LINE Front-end Framework) は、LINEアプリ内でWebアプリを開くための仕組み。フォームをLIFF内で開くことで:

- LINEユーザーIDを自動取得（ログイン不要）
- LINEアプリ内のネイティブUIで表示
- 友だちとフォーム回答を自動紐付け

### LIFF設定

1. LINE Developers Consoleで LIFF アプリを作成
2. エンドポイントURLにフォーム表示ページを設定
3. `LIFF_URL` 環境変数に LIFF URL（例: `https://liff.line.me/2009554425-xxxxxxxx`）を設定

### フォーム表示URL

回答画面は `apps/liff/src/pages/Form.tsx`（ルートは `/forms/:id`）。
LIFF のURLにパスを足すと、LIFFアプリの同じパスへ転送される。

```
https://liff.line.me/{LIFF_ID}/forms/{FORM_UUID}
```

このURLは管理画面の回答フォーム編集にも「回答用URL」として出る（コピーできる）。

LIFF SDKがユーザーのプロフィール（`lineUserId`）を取得し、フォーム送信時に自動的に付与する。

## フォーム送信フロー

```
1. 友だちがLIFFフォームを開く
2. LIFF SDK → liff.getProfile() で lineUserId を取得
3. ユーザーがフォームに記入して送信
4. POST /api/forms/:id/submit に送信データ + lineUserId を送信
5. サーバー側処理:
   a. lineUserId → friends テーブルからfriendIdを解決
   b. 必須フィールドのバリデーション
   c. form_submissions にデータ保存
   d. forms.submit_count をインクリメント
   e. 副作用を実行（以下は best-effort、失敗しても送信は成功扱い）:
      - save_to_metadata=1 なら friends.metadata にマージ保存
      - on_submit_tag_id があればタグ付与
      - on_submit_scenario_id があればシナリオ登録
6. 成功レスポンスを返す
```

### 自動アクション

| 設定 | 動作 | 用途 |
|---|---|---|
| `onSubmitTagId` | フォーム送信時に指定タグを友だちに付与 | 「セミナー申込済み」タグ等 |
| `onSubmitScenarioId` | フォーム送信時に指定シナリオに登録 | 申込後のフォローアップシナリオ |
| `saveToMetadata` | 回答データを `friends.metadata` にマージ保存 | 名前・メール等をプロフィールに反映 |

### メタデータへの保存

`saveToMetadata: true` の場合、回答データが `friends.metadata` JSON にマージされる:

```json
// 既存の metadata
{ "utm_source": "instagram" }

// フォーム回答データ
{ "full_name": "田中太郎", "email": "tanaka@example.com", "age": 30 }

// マージ後の metadata
{ "utm_source": "instagram", "full_name": "田中太郎", "email": "tanaka@example.com", "age": 30 }
```

## カレンダー予約LIFF

LINE HarnessはGoogle Calendar連携機能も備えており、LIFF内で予約フォームを表示できる。詳細は `calendar_bookings` テーブルと `/api/calendar/*` エンドポイントを参照。

予約フォームでは:
1. 空き枠をGoogle Calendar APIから取得して表示
2. ユーザーが日時を選択
3. 予約データをLINE Harness + Google Calendarに保存
4. 友だちにリマインダーを自動登録可能（12-Reminders.md参照）

---

## APIエンドポイント

### フォーム一覧取得

```bash
curl -X GET "https://your-worker.your-subdomain.workers.dev/api/forms" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**レスポンス:**

```json
{
  "success": true,
  "data": [
    {
      "id": "form-uuid-1",
      "name": "セミナー申込フォーム",
      "description": "3月セミナーへの参加申込",
      "fields": [
        { "name": "full_name", "label": "お名前", "type": "text", "required": true },
        { "name": "email", "label": "メール", "type": "email", "required": true }
      ],
      "onSubmitTagId": "tag-uuid-seminar",
      "onSubmitScenarioId": "scenario-uuid-followup",
      "saveToMetadata": true,
      "isActive": true,
      "submitCount": 15,
      "createdAt": "2026-03-20T10:00:00.000",
      "updatedAt": "2026-03-22T14:00:00.000"
    }
  ]
}
```

### フォーム詳細取得

```bash
curl -X GET "https://your-worker.your-subdomain.workers.dev/api/forms/FORM_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### フォーム作成

```bash
curl -X POST "https://your-worker.your-subdomain.workers.dev/api/forms" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "無料相談申込",
    "description": "AIコンサルティング無料相談のお申込み",
    "fields": [
      { "name": "full_name", "label": "お名前", "type": "text", "required": true },
      { "name": "company", "label": "会社名", "type": "text" },
      { "name": "email", "label": "メールアドレス", "type": "email", "required": true },
      { "name": "phone", "label": "電話番号", "type": "tel" },
      { "name": "budget", "label": "予算感", "type": "select", "options": ["10万円以下", "10-50万円", "50-100万円", "100万円以上"] },
      { "name": "details", "label": "ご相談内容", "type": "textarea", "required": true }
    ],
    "onSubmitTagId": "tag-uuid-consultation-applied",
    "onSubmitScenarioId": "scenario-uuid-consultation-followup",
    "saveToMetadata": true
  }'
```

**レスポンス (201):**

```json
{
  "success": true,
  "data": {
    "id": "new-form-uuid",
    "name": "無料相談申込",
    "description": "AIコンサルティング無料相談のお申込み",
    "fields": [...],
    "onSubmitTagId": "tag-uuid-consultation-applied",
    "onSubmitScenarioId": "scenario-uuid-consultation-followup",
    "saveToMetadata": true,
    "isActive": true,
    "submitCount": 0,
    "createdAt": "2026-03-22T10:00:00.000",
    "updatedAt": "2026-03-22T10:00:00.000"
  }
}
```

### フォーム更新

```bash
curl -X PUT "https://your-worker.your-subdomain.workers.dev/api/forms/FORM_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "無料相談申込（更新版）",
    "isActive": false
  }'
```

### フォーム削除

```bash
curl -X DELETE "https://your-worker.your-subdomain.workers.dev/api/forms/FORM_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### フォーム回答一覧取得

```bash
curl -X GET "https://your-worker.your-subdomain.workers.dev/api/forms/FORM_UUID/submissions" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**レスポンス:**

```json
{
  "success": true,
  "data": [
    {
      "id": "submission-uuid-1",
      "formId": "FORM_UUID",
      "friendId": "friend-uuid-1",
      "data": {
        "full_name": "田中太郎",
        "email": "tanaka@example.com",
        "phone": "090-1234-5678",
        "budget": "10-50万円",
        "details": "AI活用の相談をしたいです"
      },
      "createdAt": "2026-03-22T14:30:00.000"
    }
  ]
}
```

### フォーム送信（LIFF/公開エンドポイント）

認証不要。LIFFアプリから呼び出される。

```bash
curl -X POST "https://your-worker.your-subdomain.workers.dev/api/forms/FORM_UUID/submit" \
  -H "Content-Type: application/json" \
  -d '{
    "lineUserId": "U1234567890abcdef",
    "data": {
      "full_name": "佐藤花子",
      "email": "sato@example.com",
      "budget": "50-100万円",
      "details": "チャットボットの導入を検討中"
    }
  }'
```

`friendId` で直接指定することも可能:

```bash
curl -X POST "https://your-worker.your-subdomain.workers.dev/api/forms/FORM_UUID/submit" \
  -H "Content-Type: application/json" \
  -d '{
    "friendId": "friend-uuid-123",
    "data": { "full_name": "佐藤花子", "email": "sato@example.com" }
  }'
```

**レスポンス (201):**

```json
{
  "success": true,
  "data": {
    "id": "submission-uuid",
    "formId": "FORM_UUID",
    "friendId": "friend-uuid-123",
    "data": { "full_name": "佐藤花子", "email": "sato@example.com" },
    "createdAt": "2026-03-22T15:00:00.000"
  }
}
```

**バリデーションエラー (400):**

```json
{
  "success": false,
  "error": "お名前 は必須項目です"
}
```

**フォーム停止中 (400):**

```json
{
  "success": false,
  "error": "This form is no longer accepting responses"
}
```

---

## 活用パターン

### パターン1: セミナー申込 → フォローアップシナリオ

```bash
# 1. セミナーフォローアップシナリオを作成
# 2. 「セミナー申込済み」タグを作成
# 3. フォーム作成（タグ+シナリオ連動）
curl -X POST ".../api/forms" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"セミナー申込","fields":[{"name":"name","label":"お名前","type":"text","required":true}],"onSubmitTagId":"SEMINAR_TAG_ID","onSubmitScenarioId":"FOLLOWUP_SCENARIO_ID","saveToMetadata":true}'
```

### パターン2: プログレッシブプロファイリング

複数のフォームを段階的に使って情報収集:

1. 初回: 名前・メールのみ（簡単）
2. 2回目: 会社名・予算感（関心が深まった段階で）
3. 3回目: 詳細な要件（商談前）

各フォームで `saveToMetadata: true` にすると、`friends.metadata` に回答が蓄積される。

## ソースコード参照

- Worker APIルート: `apps/worker/src/routes/forms.ts`
- DB クエリ: `packages/db/src/forms.ts`
- SDK リソース: `packages/sdk/src/resources/forms.ts`
- LIFF/認証ルート: `apps/worker/src/routes/liff.ts`
- マイグレーション: `packages/db/migrations/007_forms.sql`
