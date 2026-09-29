> **廃止(2026-09-03)。読まない・判断に使わない。** これは V2〜V5 世代の要件・仕様で、V6(2026-08-26 正本化)で置き換えられた。現在の正本は `docs/v6-requirements/v6-requirements-master-index.md` と `docs/v6-common-rules.md`。歴史の確認以外の目的で開かない。

# LINE Harness / 然-NEN- v0.24.0 要件定義書

V2デザイン（PC 85画面）を実装に落とすための要件定義。**このドキュメントだけを見て一気に実装できる**ことを目標に、テーブル定義・APIの入出力・画面遷移・エラーの扱い・実装順序まで書く。

- 作成日: 2026-08-16
- 対象リポジトリ: `line-harness-nen`
- 次バージョン: **0.24.0**

### バージョンの決め方（このプロジェクトの運用）

**マイグレーションの束でマイナーを1つ上げる。**

| 版 | 内容 |
|---|---|
| 0.23.0 | 列追加を伴う9件（`088`〜`096`）。`packages/db` は 0.3.0 |
| 0.24.0 | 新規5件 ← **今回** |

そのため次は **0.24.0**。

> **注意：`package.json` の表記が実態から遅れている。**
> root / `apps/web` / `apps/worker` / `packages/sdk` / `packages/mcp-server` はいずれも `0.20.0` のまま、`apps/worker/src/routes/capabilities.ts` の `HARNESS_VERSION` に至っては `0.12.0` です。Gitタグも未作成。
> v0.24.0 のリリース作業で**すべて 0.24.0 に揃え、以後はマイグレーション束と同時に上げる**（§6-7）。

---

## 1. このバージョンで達成すること

**「一覧はあるのに作る画面が無い」「画面はあるのに裏が無い」を全部潰し、V2の85画面がすべて動く状態にする。**

| # | 達成条件 |
|---|---|
| 1 | V2の85画面すべてに対応するルートが `apps/web/src/app` に存在する |
| 2 | 各画面が叩くAPIがすべて実装され、`{ success, data }` 形式で返る |
| 3 | 画面から到達できるすべてのボタン・リンクに遷移先がある（行き止まりゼロ） |
| 4 | 新規作成・編集・削除で、外部要因（LINE API・Google API）が落ちても管理画面が500にならない |
| 5 | 既存データに対してマイグレーションが後方互換で当たる |

### 1-1. スコープ外（v0.24.0ではやらない）

| 項目 | 理由 |
|---|---|
| 400店舗のLINEアカウント移行 | 利用者判断で保留中（`docs/line-account-migration-options.md`） |
| 飲食店・多店舗向け機能（R-系8画面） | 本部/店舗の親子構造が未確定。機能としては作るがメニューからは隠す方針 |
| スマホ専用アプリ | レスポンシブWebで代替（`docs/v1-to-v2-inventory.md` §5） |
| 上位プラン相当の機能調査 | Lステップ側の検証アカウントが未契約 |

---

## 2. 棚卸し

### 2-1. 全体の数字

| 区分 | 数 |
|---|---|
| V2デザイン（PC） | 85画面 |
| 実装済みのWebページ | 50ページ（`apps/web/src/app/**/page.tsx`） |
| Workerのルートファイル | 60本超（`apps/worker/src/routes/`） |
| D1のテーブル | 本体67 ＋ マイグレーション追加42 |
| 適用済みマイグレーション | 097 まで |

### 2-2. 画面の対応表

**A：画面もAPIもある（そのまま or 微修正）**

| V2 | Webルート | Workerルート | 備考 |
|---|---|---|---|
| 0-1 ログイン | `/login` | `admin-auth.ts` | ✅ |
| 1-1 ダッシュボード | `/` | 複数集計 | ✅ 出荷予定・ケアフラグは実装済み |
| 2-1 受信箱 | `/chats` | `chats.ts` `conversations.ts` `inbox.ts` `support-inbox.ts` | △ `/support` `/users` を統合する必要あり |
| 2-2 友だち | `/friends` | `friends.ts` | △ `/duplicates` `/users` をタブへ統合 |
| 3-1 タグ管理 | `/tags` | `tags.ts` | ✅ `tag_groups` でフォルダ相当あり |
| 4-1 シナリオ配信 | `/scenarios` | `scenarios.ts` | ✅ |
| 4-1-1 シナリオ編集 | `/scenarios/detail` | 同上 | ✅ |
| 4-2 一斉配信 | `/broadcasts` | `broadcasts.ts` | ✅ `aggregation_unit` 列あり |
| 4-3 テンプレート | `/templates` | `templates.ts` `message-templates.ts` | ✅ |
| 4-4 リマインダ | `/reminders` | `reminders.ts` | ✅ |
| 4-5 自動応答 | `/auto-replies` | `auto-replies.ts` | ✅ 時間帯・クールダウン列あり |
| 4-6 友だち追加時の配信 | `/friend-add-settings` | `scenarios.ts` | ✅ |
| 4-7 リッチメニュー | `/rich-menus` | `rich-menus.ts` `rich-menu-groups.ts` | ✅ タブ（切替）も `rich_menu_pages` で対応可 |
| 4-7-1 リッチメニュー編集 | `/rich-menus/edit` | 同上 | ✅ |
| 4-7-3 リッチメニューを作る | `/rich-menus/new` | 同上 | ✅ |
| 4-8 ウェビナー | `/webinars` | `webinars.ts` | ✅ |
| 4-8-1 ウェビナーの編集 | `/webinars/edit` | 同上 | ✅ |
| 4-8-2 ウェビナーを作る | `/webinars/new` | 同上 | ✅ |
| 6-1 成果とアフィリエイト | `/conversions` | `conversions.ts` `affiliates.ts` | △ `/affiliates` をタブへ統合 |
| 6-1-2 案件 | `/affiliate-offers` | `affiliate-offers.ts` | ✅ |
| 6-2 流入経路 | `/inflow-links` | `entry-routes.ts` `tracked-links.ts` | ✅ |
| 6-2-1 流入経路の詳細 | `/inflow-links/detail` | 同上 | ✅ |
| 6-3 回答フォーム | `/form-submissions` | `forms.ts` | ✅ |
| 6-4 マイル | `/scoring` | `scoring.ts` | ✅ |
| 6-11 検索からの流入 | `/search-console` | `search-console.ts` | ✅ Google Service Account 経由。7/28/90日も実装済み |
| 7-1 オートメーション | `/automations` | `automations.ts` | ✅ |
| 7-2 外部連携 | `/webhooks` | `webhooks.ts` `notifications.ts` | △ `/notifications` をタブへ統合 |
| 8-1 予約管理 | `/booking/bookings` | `booking.ts` | ✅ |
| 8-2 予約設定 | `/booking/menus` | `booking.ts` | △ `/booking/staff` `/booking/staff/shifts` をタブへ統合 |
| 8-2-3 受付時間・カレンダー | `/booking/staff/shifts` | `booking.ts` `calendar.ts` | ✅ |
| 8-2-4 メニュー×スタッフ | `/booking/menus/staff` | `booking.ts` | ✅ `staff_menus` テーブルあり |
| 8-3 イベント予約 | `/events` | `events.ts` | ✅ |
| 8-3-1 イベントの編集 | `/events/edit` | 同上 | ✅ |
| 8-3-2〜4 イベントを作る | `/events/new` | 同上 | △ V2は3ステップ。現状1画面 |
| 8-3-5 イベントの予約者 | `/events/bookings` | 同上 | ✅ |
| 9-1 NEN配信 | `/nen-campaigns` | `nen-campaigns.ts` | ✅ |
| 9-2 写真審査 | `/health` | `health.ts` | ✅ |
| 9-3 EC連携 | `/ec-commerce` | `ec-commerce.ts` `ec-integrations.ts` | ✅ |
| 10-1 アカウント | `/accounts` | `line-accounts.ts` | △ `/pools` をタブへ統合 |
| 10-2 ログインユーザー | `/staff` | `staff.ts` `admin-auth.ts` | ✅ |
| 10-4 運用状態 | `/emergency` | `health.ts` `admin-version.ts` | △ `/updates` をタブへ統合 |

**B：APIはあるが画面が無い（画面だけ作ればよい）**

| V2 | 追加するWebルート | 使うWorker API |
|---|---|---|
| 1-1-1 友だち追加のQRコード | `/?qr`（ダッシュボード上のモーダル） | `GET /api/qr` |
| 2-2-1 友だち詳細 | `/friends/[id]` | `friends.ts` `chats.ts` `scoring.ts` |
| 3-1-1 タグを作る | `/tags/new` | `POST /api/tags` |
| 4-2-1 一斉配信の作成 | `/broadcasts/new` | `broadcasts.ts` `broadcast-message-assets.ts` |
| 4-2-2 配信の詳細 | `/broadcasts/[id]` | `broadcasts.ts`（`broadcast_insights`） |
| 4-3-1 テンプレート編集 | `/templates/edit` | `templates.ts` |
| 4-3-2 テンプレートの詳細 | `/templates/[id]` | 同上 |
| 4-4-1 リマインダを作る | `/reminders/new` | `reminders.ts` |
| 4-5-1 自動応答編集 | `/auto-replies/edit` | `auto-replies.ts` |
| 4-7-2 メニューのエリアを編集する | `/rich-menus/edit?areas` | `rich-menus.ts`（`rich_menu_areas`） |
| 6-1-1 成果地点を作る | `/conversions/new` | `conversions.ts`（`conversion_points`） |
| 6-1-3 案件を作る | `/affiliate-offers/new` | `affiliate-offers.ts` |
| 6-1-4 アフィリエイターを追加する | `/affiliates/new` | `affiliates.ts` |
| 6-2-2 リンクを発行する | `/inflow-links/new` | `entry-routes.ts` `tracked-links.ts` |
| 6-3-1 回答フォーム編集 | `/form-submissions/edit` | `forms.ts` |
| 6-4-1 付与ルールを作る | `/scoring/new` | `scoring.ts`（`mileage_rules`） |
| 6-8 広告連携 | `/inflow-links?tab=ads` | `ad-platforms.ts`（`ad_platforms` `ad_conversion_logs`） |
| 6-10 URLクリック測定 | `/analytics?tab=clicks` | `tracked-links.ts`（`tracked_links` `link_clicks`） |
| 7-1-1 ルールを作る | `/automations/new` | `automations.ts` |
| 7-2-1 Webhookを追加する | `/webhooks/new` | `webhooks.ts`（`outgoing_webhooks`） |
| 8-1-1 予約の詳細 | `/booking/bookings/[id]` | `booking.ts` |
| 8-2-1 メニューを追加する | `/booking/menus/new` | `booking.ts`（`menus`） |
| 8-2-2 予約スタッフを登録する | `/booking/staff/new` | `booking.ts`（`staff`） |
| 9-1-1 NENコラムを編集する | `/nen-campaigns/edit` | `nen-campaigns.ts`（`nen_columns`） |
| 10-1-1 LINEアカウントを追加する | `/accounts/new` | `line-accounts.ts` |
| 10-1-2 プールを作る | `/pools/new` | `traffic-pools.ts` |
| 10-2-1 ユーザーを追加する | `/staff/new` | `staff.ts` |
| 10-5 データ移行 | `/accounts?tab=migration` | `line-accounts.ts`（`account_migrations`） |

**C：裏側から作る必要がある（テーブルもAPIも画面も無い）** ← v0.24.0 の本体

| V2 | 追加するWebルート | 必要な新規テーブル |
|---|---|---|
| 2-1-1 テンプレートを選ぶ | `/chats?template` | なし（既存テンプレートを引くだけ） |
| 3-2 友だち情報欄 | `/tags?tab=fields` | `friend_fields` `friend_field_values` |
| 3-2-1 項目を追加する | `/tags/fields/new` | 同上 |
| 3-3 対応マーク管理 | `/tags?tab=marks` | `support_marks` ＋ `friends.support_mark_id` |
| 3-4 保存した検索 | `/tags?tab=searches` | `saved_searches` |
| 4-3-3 カルーセルの編集 | `/templates/carousel` | なし（`templates.message_type='carousel'` を構造化JSONで運用） |
| 5-1 メディアライブラリ | `/contents` | `media` `media_usages` |
| 5-2 共通情報 | `/contents?tab=vars` | `common_vars` `common_var_schedules` |
| 5-2-1 共通情報を追加する | `/contents/vars/new` | 同上 |
| 6-5 アクセス解析 | `/analytics` | なし（`messages_log` `broadcast_insights` を集計） |
| 6-6 サイトスクリプト | `/inflow-links?tab=script` | `site_visitors` `site_events` |
| 6-7 クロス分析 | `/analytics?tab=cross` | なし（既存を交差集計） |
| 6-9 ファネル分析 | `/analytics?tab=funnel` | `funnels` `funnel_steps` |
| 10-3 機能設定 | `/settings` | なし（`account_settings` の key/value を使う） |

### 2-3. 実装にあってV2に無いルート（統合して消す）

| 現行ルート | 統合先 | 対応 |
|---|---|---|
| `/duplicates` | `/friends?tab=duplicates` | 中身をタブへ移し、旧ルートは308リダイレクト |
| `/users` | `/friends?tab=merged` | 同上 |
| `/support` | `/chats?channel=email` | 同上 |
| `/notifications` | `/webhooks?tab=notify` | 同上 |
| `/updates` | `/emergency?tab=history` | 同上 |
| `/pools` | `/accounts?tab=pools` | 同上（`/pools/new` は残す） |
| `/affiliates` | `/conversions?tab=affiliates` | 同上（`/affiliates/new` は残す） |
| `/booking/staff` | `/booking/menus?tab=staff` | 同上 |
| `/nen-members` | **要確認** | V2に対応画面が無い。`/ec-commerce` のタブに寄せるか、独立で残すかを決める |

> **リダイレクトは消さずに残すこと。** ブックマーク・社内Wiki・LINEのリッチメニューから旧URLを踏んでいる可能性があるため、`next.config` の `redirects()` で恒久308を返す。

---

## 3. データベース

マイグレーションは `packages/db/migrations/` に **098〜102 の5件** を追加する（現行の最終は 097）。
0.23.0 が列追加9件だったのに対し、**0.24.0 は新規テーブル中心の5件**という束ね方にする。

| ファイル | 中身 | 主な用途 |
|---|---|---|
| `098_folders_and_fields.sql` | `folders` / `friend_fields` / `friend_field_values` ＋ 各テーブルへの `folder_id` | 汎用フォルダと友だち情報欄 |
| `099_friend_attributes.sql` | `support_marks` / `saved_searches` ＋ `friends` への列追加 | 対応マーク・保存した検索・表示状態 |
| `100_content_library.sql` | `media` / `media_usages` / `common_vars` / `common_var_schedules` | メディアライブラリと共通情報 |
| `101_analytics.sql` | `site_visitors` / `site_events` / `funnels` / `funnel_steps` | サイトスクリプトとファネル |
| `102_ops_and_flags.sql` | `login_audit` ＋ `admin_users` `auto_replies` `scenarios` `broadcasts` への列追加 | 運用・権限・配信の細かい設定 |

`packages/db` のバージョンは 0.3.0 → **0.4.0**（新規テーブルが入るため）。

### 3-1. 共通の書き方

- 主キーは `TEXT PRIMARY KEY`（アプリ側で ULID/UUID を採番）
- 日時は `TEXT`、既定値は JST 固定の `(strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))`
- 真偽値は `INTEGER NOT NULL DEFAULT 0`
- JSON列は `CHECK (col IS NULL OR json_valid(col))` を必ず付ける
- 既存テーブルへの列追加は `ALTER TABLE ... ADD COLUMN`（D1/SQLiteは1文1列）。**NOT NULL を足すときは必ず DEFAULT を付ける**

### 3-2. 098_folders_and_fields.sql（1/3）— 汎用フォルダ

現在フォルダ相当は `tag_groups`（タグ専用）しかない。V2は一覧13画面すべてにフォルダがあるので汎用化する。

```sql
CREATE TABLE IF NOT EXISTS folders (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN (
                  'tag','template','scenario','reminder','auto_reply',
                  'rich_menu','webinar','form','media','common_var',
                  'mileage_rule','automation','event','entry_route')),
  name          TEXT NOT NULL,
  parent_id     TEXT REFERENCES folders(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_folders_kind ON folders(kind, display_order);

ALTER TABLE templates ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
ALTER TABLE templates ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE scenarios ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
ALTER TABLE scenarios ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE auto_replies ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
ALTER TABLE auto_replies ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reminders ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
```

`tags.group_id`（既存）は残し、`folders` へは移行しない。**タグだけ二重管理になるのを避けるため、`tag_groups` を `folders(kind='tag')` のビュー相当として扱うか、098で移送するかを実装前に1回だけ決める。**推奨は移送（`tag_groups` の行を `folders` に写し、`tags.folder_id` を追加、`tags.group_id` は残置して読まない）。

### 3-3. 098_folders_and_fields.sql（2/3）— 友だち情報欄

V2で最も影響範囲が広い。**4機能が1本の線で繋がっている**（`docs/lstep-gap-analysis.md`）。

```
回答フォームの項目 → 登録先 → 友だち情報欄 → 友だち詳細のタブ → テンプレートの差し込み変数
```

```sql
CREATE TABLE IF NOT EXISTS friend_fields (
  id             TEXT PRIMARY KEY,
  folder_id      TEXT REFERENCES folders(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  field_key      TEXT NOT NULL UNIQUE,          -- 差し込み変数名 {pet_name} など
  type           TEXT NOT NULL CHECK (type IN ('text','textarea','number','date','select','multi_select','checkbox','url','tel','email')),
  options_json   TEXT CHECK (options_json IS NULL OR json_valid(options_json)),
  default_value  TEXT,
  source         TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','form','ec','automation')),
  ec_field_path  TEXT,                          -- EC連携時のマッピング元
  ec_is_master   INTEGER NOT NULL DEFAULT 0,    -- 1ならEC側を正とし管理画面から編集不可
  is_personal    INTEGER NOT NULL DEFAULT 0,    -- 本名・電話・住所など。閲覧権限を絞る
  is_starred     INTEGER NOT NULL DEFAULT 0,
  display_order  INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);

CREATE TABLE IF NOT EXISTS friend_field_values (
  friend_id   TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  field_id    TEXT NOT NULL REFERENCES friend_fields(id) ON DELETE CASCADE,
  value       TEXT,
  updated_by  TEXT,                             -- staff.id / 'form' / 'ec' / 'automation'
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  PRIMARY KEY (friend_id, field_id)
);
CREATE INDEX IF NOT EXISTS idx_ffv_field ON friend_field_values(field_id, value);
```

**`field_key` の制約**：`^[a-z][a-z0-9_]{0,31}$`。テンプレート差し込みで `{key}` として使うため、日本語・記号を許すと置換が壊れる。APIで正規表現バリデーションを必須にする。

### 3-4. 099_friend_attributes.sql（1/2）— 対応マークと表示状態

```sql
CREATE TABLE IF NOT EXISTS support_marks (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  color          TEXT NOT NULL DEFAULT '#94A3B8',
  is_default     INTEGER NOT NULL DEFAULT 0,    -- 新規友だちの初期値。1行だけ1にする
  auto_on_inbound INTEGER NOT NULL DEFAULT 0,   -- 友だちから受信したとき自動でこれにする
  display_order  INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);
ALTER TABLE friends ADD COLUMN support_mark_id TEXT REFERENCES support_marks(id) ON DELETE SET NULL;
ALTER TABLE friends ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE friends ADD COLUMN real_name TEXT;
ALTER TABLE friends ADD COLUMN system_display_name TEXT;
ALTER TABLE friends ADD COLUMN private_memo TEXT;
CREATE INDEX IF NOT EXISTS idx_friends_mark ON friends(support_mark_id);

INSERT OR IGNORE INTO support_marks (id, name, color, is_default, auto_on_inbound, display_order) VALUES
  ('mark_untouched','未対応','#F59E0B',1,1,0),
  ('mark_working','対応中','#3B82F6',0,0,1),
  ('mark_done','解決済','#10B981',0,0,2);
```

`is_hidden` は**「こちらから非表示にした友だち」**。LINE公式アカウントに「運営側からブロック」という概念は無いため自社実装（`docs/lstep-parity-verification.md` §1-11）。一斉配信の絞り込み条件「表示状態」がこれを見る。

### 3-5. 099_friend_attributes.sql（2/2）— 保存した検索

```sql
CREATE TABLE IF NOT EXISTS saved_searches (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  scope           TEXT NOT NULL DEFAULT 'friends' CHECK (scope IN ('friends','chats','bookings')),
  conditions_json TEXT NOT NULL CHECK (json_valid(conditions_json)),
  created_by      TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  is_shared       INTEGER NOT NULL DEFAULT 1,
  display_order   INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);
```

`conditions_json` の形は Lステップに合わせて **AND群 / OR群の2グループ**（`docs/lstep-feature-parity-matrix.md` §2-3）。

```json
{
  "all": [ {"kind":"tag","op":"has","value":"tag_xxx"},
           {"kind":"field","key":"pet_kind","op":"eq","value":"犬"} ],
  "any": [ {"kind":"purchase","op":"count_gte","value":1},
           {"kind":"form","formId":"f_xxx","op":"answered"} ],
  "visibility": "visible_only"
}
```

**上限50件**（Lステップと同じ）。51件目は 422 で弾く。

### 3-6. 100_content_library.sql（1/2）— メディアライブラリ

```sql
CREATE TABLE IF NOT EXISTS media (
  id          TEXT PRIMARY KEY,
  folder_id   TEXT REFERENCES folders(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('image','video','audio','file')),
  filename    TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  width       INTEGER,
  height      INTEGER,
  duration_ms INTEGER,
  r2_key      TEXT NOT NULL UNIQUE,
  public_url  TEXT,
  uploaded_by TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);

CREATE TABLE IF NOT EXISTS media_usages (
  media_id  TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  ref_kind  TEXT NOT NULL CHECK (ref_kind IN ('template','broadcast','rich_menu','scenario_step','nen_column','event','webinar')),
  ref_id    TEXT NOT NULL,
  scanned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  PRIMARY KEY (media_id, ref_kind, ref_id)
);
```

`media_usages` は**削除前の警告**のために使う（V1の発明「5か所で使われています。削除すると、その箇所の本文が空になります。」を全機能に展開）。Cronで本文をスキャンして再構築する。

### 3-7. 100_content_library.sql（2/2）— 共通情報

```sql
CREATE TABLE IF NOT EXISTS common_vars (
  id          TEXT PRIMARY KEY,
  folder_id   TEXT REFERENCES folders(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  var_key     TEXT NOT NULL UNIQUE,             -- {shop_hours} など。制約は field_key と同じ
  type        TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text','url','image','number')),
  value       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);

CREATE TABLE IF NOT EXISTS common_var_schedules (
  id             TEXT PRIMARY KEY,
  var_id         TEXT NOT NULL REFERENCES common_vars(id) ON DELETE CASCADE,
  effective_from TEXT NOT NULL,                 -- JST の ISO8601
  value          TEXT NOT NULL,
  applied_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_cvs_pending ON common_var_schedules(var_id, effective_from) WHERE applied_at IS NULL;
```

**日付での自動切り替え**は V2 の上乗せ機能。Cronが `effective_from <= now AND applied_at IS NULL` の行を `common_vars.value` に反映し `applied_at` を打つ。

### 3-8. 101_analytics.sql（1/2）— サイトスクリプト

```sql
CREATE TABLE IF NOT EXISTS site_visitors (
  id           TEXT PRIMARY KEY,               -- 1st party cookie に入れる値
  friend_id    TEXT REFERENCES friends(id) ON DELETE SET NULL,
  first_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  last_seen_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  linked_at    TEXT,                            -- 友だちと突合できた時刻
  linked_by    TEXT CHECK (linked_by IS NULL OR linked_by IN ('entry_route','liff','form','manual'))
);
CREATE INDEX IF NOT EXISTS idx_site_visitors_friend ON site_visitors(friend_id);

CREATE TABLE IF NOT EXISTS site_events (
  id          TEXT PRIMARY KEY,
  visitor_id  TEXT NOT NULL REFERENCES site_visitors(id) ON DELETE CASCADE,
  friend_id   TEXT REFERENCES friends(id) ON DELETE SET NULL,
  event_type  TEXT NOT NULL CHECK (event_type IN ('page_view','click','scroll_depth','custom','purchase')),
  path        TEXT,
  label       TEXT,
  value_num   INTEGER,
  referrer    TEXT,
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_site_events_friend ON site_events(friend_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_site_events_path ON site_events(path, occurred_at);
```

**個人情報を載せない。** `path` にクエリ文字列が含まれる場合はサーバ側で除去する（メールアドレス等が入る事故を防ぐ）。

### 3-9. 101_analytics.sql（2/2）— ファネル分析

```sql
CREATE TABLE IF NOT EXISTS funnels (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  segment_json TEXT CHECK (segment_json IS NULL OR json_valid(segment_json)),
  window_days INTEGER NOT NULL DEFAULT 30,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);

CREATE TABLE IF NOT EXISTS funnel_steps (
  id          TEXT PRIMARY KEY,
  funnel_id   TEXT NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
  step_order  INTEGER NOT NULL,
  label       TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('tag','field','form','site_event','purchase','link_click','conversion')),
  match_json  TEXT NOT NULL CHECK (json_valid(match_json)),
  UNIQUE (funnel_id, step_order)
);
```

### 3-10. 102_ops_and_flags.sql — 運用・権限・配信の細かい設定

```sql
-- ログイン履歴（V2 10-2）
CREATE TABLE IF NOT EXISTS login_audit (
  id          TEXT PRIMARY KEY,
  admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL CHECK (action IN ('login','logout','fail','view_personal','export')),
  screen      TEXT,
  ip          TEXT,
  user_agent  TEXT,
  result      TEXT NOT NULL DEFAULT 'ok',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_login_audit_user ON login_audit(admin_user_id, created_at);

-- 二要素認証（V2 10-2-1）
ALTER TABLE admin_users ADD COLUMN two_factor_enabled INTEGER NOT NULL DEFAULT 0;

-- 自動応答の優先順位・対象メッセージ種別・友だち条件（V2 4-5-1）
ALTER TABLE auto_replies ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
ALTER TABLE auto_replies ADD COLUMN message_kinds_json TEXT CHECK (message_kinds_json IS NULL OR json_valid(message_kinds_json));
ALTER TABLE auto_replies ADD COLUMN friend_conditions_json TEXT CHECK (friend_conditions_json IS NULL OR json_valid(friend_conditions_json));

-- シナリオの購読重複ポリシー（V2 4-1-1）
ALTER TABLE scenarios ADD COLUMN allow_concurrent INTEGER NOT NULL DEFAULT 0;

-- 一斉配信のステルス配信（V2 4-2-1）
ALTER TABLE broadcasts ADD COLUMN stealth_spread_minutes INTEGER NOT NULL DEFAULT 0;
```

**`login_audit.action='view_personal'`** は、`friend_fields.is_personal=1` の値を画面で開いたときに残す。個人情報保護法上の利用記録として必要（`docs/lstep-parity-verification.md` §3）。

### 3-11. 機能設定（10-3）に新テーブルは要らない

`account_settings(line_account_id, key, value)` が既に汎用のkey/valueストアで、`packages/db/src/account-settings.ts` に `getAccountSetting` / `setAccountSetting` がある。機能のオン/オフはここに入れる。

```
key = 'feature.<機能キー>'   value = '{"enabled":true}'
key = 'sidebar.order'        value = '["dashboard","inbox",...]'
```

---

## 4. API

### 4-1. 共通の約束（既存に合わせる）

| 項目 | 決まり |
|---|---|
| 成功 | `c.json({ success: true, data })` |
| 失敗 | `c.json({ success: false, error: '<人が読める文>' }, <status>)` |
| 例外 | `try/catch` で握り、`console.error('<METHOD> <path> error:', err)` してから 500 |
| 権限 | `requireRole('owner','admin')` を**更新系すべてに付ける**。参照系は付けない（既存の慣習） |
| 置き場所 | `apps/worker/src/routes/<name>.ts` に `new Hono<Env>()` を作り、`index.ts` で `app.route('/', <name>)` |
| DBアクセス | 直書きせず `packages/db/src/<name>.ts` にヘルパを置き、`@line-crm/db` から export |

### 4-2. 新規エンドポイント一覧

**友だち情報欄**

| メソッド | パス | 用途 |
|---|---|---|
| GET | `/api/friend-fields` | 一覧（`?folderId=` `?withUsage=1`） |
| POST | `/api/friend-fields` | 追加。`field_key` の正規表現検証と重複チェック |
| PATCH | `/api/friend-fields/:id` | 更新。**`type` の変更は既存値が壊れるので不可（422）** |
| DELETE | `/api/friend-fields/:id` | 削除。使用中なら件数を返して 409 |
| GET | `/api/friends/:id/fields` | その友だちの全項目と値 |
| PUT | `/api/friends/:id/fields` | まとめて更新。`ec_is_master=1` の項目は無視して警告を返す |
| POST | `/api/friend-fields/bulk` | 選択した友だちの値を一括書き換え（V2 2-2 の一括操作） |

**対応マーク**

| メソッド | パス | 用途 |
|---|---|---|
| GET / POST | `/api/support-marks` | 一覧・追加 |
| PATCH / DELETE | `/api/support-marks/:id` | 更新・削除（既定マークは削除不可 409） |
| PATCH | `/api/friends/:id/support-mark` | 1人の変更 |
| POST | `/api/friends/support-mark/bulk` | 一括変更 |

**保存した検索**

| メソッド | パス | 用途 |
|---|---|---|
| GET / POST | `/api/saved-searches` | 一覧・保存（51件目は 422） |
| PATCH / DELETE | `/api/saved-searches/:id` | 更新・削除 |
| POST | `/api/friends/search` | 条件JSONで検索。`{ total, items, appliedConditions }` を返す |

**メディア・共通情報**

| メソッド | パス | 用途 |
|---|---|---|
| GET | `/api/media` | 一覧（`?kind=` `?folderId=`） |
| POST | `/api/media` | R2へアップロード。**MIMEと拡張子の両方を検証** |
| DELETE | `/api/media/:id` | 削除。`media_usages` があれば 409 で使用箇所を返す |
| GET | `/api/media/:id/usages` | 使用箇所 |
| GET / POST | `/api/common-vars` | 一覧・追加 |
| PATCH / DELETE | `/api/common-vars/:id` | 更新・削除（使用中なら 409） |
| POST | `/api/common-vars/:id/schedules` | 日付での切り替え予約 |

**分析**

| メソッド | パス | 用途 |
|---|---|---|
| GET | `/api/analytics/messages` | 送信数の日次（`messages_log` 集計） |
| GET | `/api/analytics/cross` | クロス集計（`?rows=tag&cols=field:pet_kind`） |
| GET | `/api/analytics/link-clicks` | URLクリック測定（`tracked_links` `link_clicks`） |
| GET / POST | `/api/funnels` | ファネル定義 |
| GET | `/api/funnels/:id/result` | 段ごとの到達人数と離脱率 |
| POST | `/api/site/collect` | サイトスクリプトの受け口。**認証なし・CORS許可・レート制限必須** |
| GET | `/api/site/script` | 埋め込むJSを返す（サイトIDを差し込んだもの） |

**設定・その他**

| メソッド | パス | 用途 |
|---|---|---|
| GET / PUT | `/api/settings/features` | 機能のオン/オフ（`account_settings`） |
| GET | `/api/login-audit` | ログイン履歴（`?userId=` `?limit=`） |
| GET / POST | `/api/folders` | 汎用フォルダ（`?kind=`） |
| PATCH / DELETE | `/api/folders/:id` | 更新・削除（中身は未分類へ移す） |

### 4-3. 既存APIへの追加

| 対象 | 追加すること |
|---|---|
| `broadcasts.ts` | 作成時に `stealth_spread_minutes` を受ける。絞り込み条件に `visibility`（`is_hidden=0`）を追加 |
| `broadcasts.ts` | 配信前チェック `POST /api/broadcasts/preflight` を新設（対象人数・20人未満の警告・過剰配信の警告・送信残枠） |
| `auto-replies.ts` | `priority` `message_kinds_json` `friend_conditions_json` を受ける。**一覧は `priority ASC, created_at ASC` で返す** |
| `scenarios.ts` | `allow_concurrent` を受ける。既定は 0（Lステップと同じ「1人1シナリオ」） |
| `templates.ts` | `message_type='carousel'` のとき `message_content` を構造化JSONとして検証（§6-4） |
| `forms.ts` | 項目の「登録先」に `friend_fields.id` を持たせ、回答時に `friend_field_values` へ書く |
| `ec-integrations.ts` | `friend_fields.source='ec'` の項目へ EC の本名・電話・住所を流し込む同期処理 |
| `capabilities.ts` | `FEATURES` に `friend_fields` `media` `common_vars` `analytics` `site_tracking` `support_marks` `saved_searches` を追加し、`HARNESS_VERSION` を `0.24.0` へ |

---

## 5. 画面遷移

### 5-1. 遷移の原則

| 原則 | 内容 |
|---|---|
| **一覧 → 作る** | すべての一覧の主ボタンは「◯◯を作成」で、必ず作成画面かモーダルへ行く。行き止まりを作らない |
| **作る → 戻る** | 保存したら一覧へ戻り、作った行をハイライトする。「保存して続けて作る」も置く |
| **編集 → 削除** | 削除は必ず使用箇所チェックを挟む。使われていれば件数と一覧を出してから確認 |
| **タブはURLに出す** | `?tab=` をクエリに持たせ、ブラウザバックとブックマークを壊さない |
| **モーダルもURLに出す** | `?template` `?qr` のようにクエリで表す。直リンクで開ける |
| **パンくず** | 2階層以上は必ず出す。1階層目は必ず親一覧へ戻る |

### 5-2. 主要な遷移表

**受信箱まわり**

| 元 | 操作 | 先 |
|---|---|---|
| `/chats` | 会話を選ぶ | `/chats?id=<threadId>`（3ペインの中央が変わる） |
| `/chats?id=x` | 「テンプレートを選ぶ」 | `/chats?id=x&template`（モーダル。背面は受信箱のまま） |
| `/chats?id=x&template` | 「この内容を入れる」 | `/chats?id=x` に戻り、入力欄に本文が入る |
| `/chats?id=x` | 右ペインの「友だち詳細」 | `/friends/<friendId>` |
| `/chats` | チャネル切替 | `/chats?channel=line` / `?channel=email` |

**友だちまわり**

| 元 | 操作 | 先 |
|---|---|---|
| `/friends` | 行をクリック | `/friends/<id>` |
| `/friends` | タブ | `/friends?tab=duplicates` / `?tab=merged` |
| `/friends` | 「詳細検索」 | 条件パネルを開く（画面遷移なし） |
| `/friends` | 「この条件を保存」 | `POST /api/saved-searches` → `/friends?search=<id>` |
| `/friends/<id>` | 「トークを開く」 | `/chats?id=<threadId>` |
| `/friends/<id>` | 情報欄タブの「項目を追加」 | `/tags/fields/new?back=/friends/<id>` |

**友だち属性（4タブ）**

| 元 | 操作 | 先 |
|---|---|---|
| `/tags` | 「タグを作成」 | `/tags/new` → 保存 → `/tags?highlight=<id>` |
| `/tags?tab=fields` | 「項目を追加」 | `/tags/fields/new` → 保存 → `/tags?tab=fields&highlight=<id>` |
| `/tags?tab=marks` | 「マークを追加」 | インラインで行を足す（別画面にしない） |
| `/tags?tab=searches` | 行をクリック | `/friends?search=<id>` |

**配信まわり**

| 元 | 操作 | 先 |
|---|---|---|
| `/broadcasts` | 「配信を作成」 | `/broadcasts/new` |
| `/broadcasts/new` | 「配信前チェック」 | `POST /api/broadcasts/preflight` → 同画面に結果表示 |
| `/broadcasts/new` | 「下書き保存」 | `/broadcasts?highlight=<id>` |
| `/broadcasts/new` | 「送信」 | 確認ダイアログ → `/broadcasts/<id>` |
| `/broadcasts/<id>` | 「同じ内容で作る」 | `/broadcasts/new?copyFrom=<id>` |
| `/templates` | 「テンプレートを作成」 | 種別選択 → テキストは `/templates/edit`、カルーセルは `/templates/carousel` |
| `/templates/<id>` | 「削除」 | 使用箇所を出す → 0件なら削除 → `/templates` |
| `/scenarios` | 「シナリオを作成」 | `/scenarios/detail?new=1` |
| `/scenarios/detail` | ステップの「＋」 | ステップ編集モーダル（`?step=new`） |
| `/rich-menus` | 「メニューを作成」 | `/rich-menus/new` → 「作成して編集へ」 → `/rich-menus/edit?id=<id>` |
| `/rich-menus/edit` | 「エリアを編集」 | `/rich-menus/edit?id=<id>&areas` |
| `/auto-replies` | 「ルールを作成」 | `/auto-replies/edit?new=1` |
| `/reminders` | 「リマインダを作成」 | `/reminders/new` |
| `/webinars` | 「ウェビナーを作成」 | `/webinars/new` → 「作成」 → `/webinars/edit?id=<id>` |

**コンテンツ**

| 元 | 操作 | 先 |
|---|---|---|
| `/contents` | 「アップロード」 | インライン（画面遷移なし） |
| `/contents` | ファイルの「使用箇所」 | パネルを開き、各行から対象画面へ |
| `/contents?tab=vars` | 「共通情報を追加」 | `/contents/vars/new` |

**成果と分析**

| 元 | 操作 | 先 |
|---|---|---|
| `/conversions` | 「成果地点を作成」 | `/conversions/new` |
| `/conversions?tab=offers` | 「案件を作成」 | `/affiliate-offers/new` |
| `/conversions?tab=affiliates` | 「アフィリエイターを追加」 | `/affiliates/new` |
| `/inflow-links` | 「リンクを発行」 | `/inflow-links/new` |
| `/inflow-links` | 行をクリック | `/inflow-links/detail?id=<id>` |
| `/analytics` | タブ | `?tab=cross` / `?tab=funnel` / `?tab=clicks` / `/search-console` |
| `/analytics?tab=cross` | 「この条件で配信」 | `/broadcasts/new?search=<savedSearchId>` |
| `/analytics?tab=funnel` | 「ファネルを作成」 | `?tab=funnel&new=1`（モーダル） |

**予約・イベント**

| 元 | 操作 | 先 |
|---|---|---|
| `/booking/bookings` | 行をクリック | `/booking/bookings/<id>` |
| `/booking/menus` | 「メニューを追加」 | `/booking/menus/new` |
| `/booking/menus?tab=staff` | 「スタッフを登録」 | `/booking/staff/new` |
| `/booking/menus?tab=staff` | 「担当を割り当て」 | `/booking/menus/staff` |
| `/events` | 「イベントを作成」 | `/events/new`（3ステップ。`?step=2` `?step=3`） |
| `/events/new?step=3` | 「保存して公開」 | `/events?highlight=<id>` |
| `/events` | 行の「予約者」 | `/events/bookings?eventId=<id>` |

**設定**

| 元 | 操作 | 先 |
|---|---|---|
| `/accounts` | 「アカウントを追加」 | `/accounts/new` |
| `/accounts?tab=pools` | 「プールを作る」 | `/pools/new` |
| `/accounts?tab=migration` | 「引き継ぎコードを発行」 | 同画面にコードを表示 |
| `/staff` | 「ユーザーを追加」 | `/staff/new` |
| `/staff` | 行の「ログイン履歴」 | `/staff?userId=<id>&tab=audit` |
| `/emergency` | タブ | `?tab=ban` / `?tab=history` / `?tab=stop` |
| `/settings` | 機能のオン/オフ | 即時保存（トースト表示）。サイドバーはリロードなしで反映 |

### 5-3. 行き止まりチェック（実装後に必ずやる）

以下を機械的に検証するテストを `apps/web` に置く。

1. `apps/web/src/app` 配下の全 `page.tsx` を列挙 → V2の85画面と突き合わせ、欠けがゼロ
2. 各ページのソースから `href=` / `router.push(` を抽出 → 遷移先がすべて実在するルートかを検証
3. リダイレクト対象の旧ルート9本が `next.config` に定義されている

---

## 6. 裏側でエラーを出さないための決め事

### 6-1. LINE Messaging API の確定した制約

`docs/lstep-parity-verification.md` で公式ドキュメントから裏取り済み。**設計を変える必要があるもの**を再掲する。

| 制約 | 実装での扱い |
|---|---|
| `customAggregationUnit` は**月1,000種類まで**、1メッセージに1つ | 一斉配信は「1配信＝1ユニット」。**シナリオはステップ単位で固定名を使い、期間で切らない**。1,000に近づいたら管理画面に警告 |
| 配信対象が**20人未満だと開封・クリックが `null`** | 集計表示は「—」とし、「20人未満のため表示されません」と添える。`null` を 0 として描画しない |
| **個人単位の開封は取れない** | 「誰が読んだか」のUIを作らない。「読んだところから再開」は**既読ではなく「配信済みステップの次から」**と定義し、この定義を画面にも書く |
| **既読は取得できない** | 受信箱に既読表示を出さない |
| リッチメニューのタップ領域は**全体で最大20個** | タブを増やすとこの枠を食う。エリア追加時に残り枠を表示し、21個目は 422 |
| カルーセルは**最大10枚 / 本文60文字 / 1枚3ボタン** | 入力時にカウンタを出し、超過は保存前に弾く |
| クーポンは Messaging API で作成できるが**下書き状態にはできない** | 「下書き保存」ボタンを出さない |

### 6-2. 外部APIが落ちても管理画面を落とさない

**原則：外部APIの失敗は 500 にしない。** `{ success: true, data: { status: 'unavailable', reason } }` を返し、画面はその旨を出す。`search-console.ts` が既にこの形（未設定なら `status: 'not_configured'`）なので、これを全外部連携の標準にする。

| 対象 | 失敗時 |
|---|---|
| LINE Messaging API（送信） | 再送キューに積み、`messages_log` に `status='failed'` と理由を残す。画面には失敗件数と再送ボタン |
| LINE Messaging API（統計） | `status:'unavailable'`。数字は「—」 |
| Google Search Console | `status:'not_configured'` / `'unavailable'`（実装済み） |
| Googleカレンダー | 同期失敗は受付停止を**行わない**（開けすぎるより閉めすぎる事故のほうが重い、という判断を明示して反転させない） |
| Google広告オフラインCV | 送信失敗は `ad_conversion_logs` に残し、Cronで再試行 |
| Stripe / EC | Webhook は必ず 200 を返し、処理は非同期。`stripe_events` で重複排除（実装済み） |

### 6-3. 冪等性

| 場面 | 方法 |
|---|---|
| 一斉配信 | `broadcasts.line_request_id` と `batch_offset` `batch_lock_at`（実装済み）。**二重送信の再発防止テストを必ず残す** |
| 予約 | `booking_idempotency_keys` `event_booking_idempotency_keys`（実装済み） |
| Webhook受信 | `incoming_webhooks` にイベントIDを記録して重複排除 |
| 共通情報の日付切り替え | `common_var_schedules.applied_at` が NULL の行だけ処理 |
| マイル付与 | `mileage_event_queue` ＋ `mileage_ledger`（実装済み） |

### 6-4. バリデーション（保存前に必ず弾く）

| 対象 | ルール | 違反時 |
|---|---|---|
| `friend_fields.field_key` | `^[a-z][a-z0-9_]{0,31}$`、既存と重複不可、予約語（`name` `id` `tag`）不可 | 422 |
| `common_vars.var_key` | 同上 | 422 |
| `friend_fields.type` の変更 | 既存値がある場合は不可 | 422（「先に値を消してください」） |
| 保存した検索 | 50件まで | 422 |
| カルーセル | 1〜10枚 / 本文60文字 / 1枚3ボタン / 画像比率 1.51:1 か 1:1 | 422（どのパネルかを名指し） |
| リッチメニュー | エリア合計20個まで、画像 2500×1686 または 2500×843 | 422 |
| メディア | MIMEと拡張子の両方を検証。画像10MB、動画200MBまで | 413 |
| 削除全般 | 使用箇所があれば件数と一覧を返す | 409 |
| テンプレートの差し込み変数 | 未定義の `{key}` があれば警告（保存は許可） | 200＋`warnings[]` |

### 6-5. 権限と個人情報

| 対象 | 決まり |
|---|---|
| 更新系API | `requireRole('owner','admin')` を全件に付ける。**付け忘れ検出は `route-guard-coverage.test.ts` が既にあるので、新規ルートを必ずそこに登録する** |
| `friend_fields.is_personal=1` | 既定で `owner` `admin` のみ閲覧。開いたら `login_audit` に `view_personal` を残す |
| `ec_is_master=1` の項目 | 管理画面から編集不可（UIでも `readonly`、APIでも無視して `warnings[]` に理由を返す） |
| CSV書き出し | `login_audit` に `export` を残す。個人情報項目を含む場合は権限チェック |
| `POST /api/site/collect` | 認証なし。**レート制限必須**（`middleware/rate-limit.ts` を流用）。個人情報はクエリごと落とす |

### 6-6. まだ決まっていないこと

| 項目 | 状況 | v0.24.0での扱い |
|---|---|---|
| 自動応答の優先順位 | Lステップの公式記載が見つからず（`docs/lstep-behavior-research.md` §7） | **一覧の並び順＝評価順、上から順に評価し最初に一致した1件だけ実行**で確定させる。`auto_replies.priority` で並べる |
| `/nen-members` の行き先 | V2に対応画面が無い | 実装前に1回確認。決まるまで現状のまま残す |
| `tag_groups` → `folders` の移送 | 二重管理を避けたい | 移送を推奨。実装前に決める |

### 6-7. バージョン整合

- `package.json`（root / `apps/web` / `apps/worker` / `packages/sdk` / `packages/mcp-server`）を `0.24.0` に揃える
- `apps/worker/src/routes/capabilities.ts` の `HARNESS_VERSION` を `0.12.0` → `0.24.0`（現在ずれている）
- `FEATURES` に新機能キーを追加
- `admin-version.test.ts` `capabilities.test.ts` が固定値を持っている場合は更新

---

## 7. 実装順序

依存関係が下から上に流れるので、この順に積む。**フェーズごとにPRを分ける。**

### フェーズ1：土台（他のすべてが乗る）

1. `098_folders_and_fields.sql`〜`102_ops_and_flags.sql` の5件を作成し、ローカルD1で適用確認
2. `packages/db/src/` にヘルパを追加（`folders.ts` `friend-fields.ts` `support-marks.ts` `saved-searches.ts` `media.ts` `common-vars.ts` `site-tracking.ts` `funnels.ts` `login-audit.ts`）
3. `@line-crm/db` から export
4. バージョンを 0.24.0 に統一、`capabilities.ts` を更新

**完了条件**：`pnpm -r build` と `pnpm test:scripts` が通り、既存データに対して全マイグレーションが当たる。

### フェーズ2：友だち情報欄の一本線

**ここが v0.24.0 の核。** 4機能が繋がって初めて意味が出る。

5. `friend-fields.ts` ルート（一覧・追加・更新・削除・値の読み書き・一括）
6. `forms.ts` に「登録先」を追加し、回答時に `friend_field_values` へ書く
7. `ec-integrations.ts` に EC → 情報欄の同期を追加（`ec_is_master` を尊重）
8. テンプレートの差し込みエンジンに `friend_fields` を解決させる
9. 画面：`/tags?tab=fields`、`/tags/fields/new`、`/friends/[id]`

**完了条件**：フォームに回答 → 情報欄に入る → 友だち詳細に出る → テンプレートで差し込める、が一気通貫で動く。

### フェーズ3：一覧・作成画面の穴埋め

10. 対応マーク・保存した検索・汎用フォルダのAPIと画面
11. §2-2 B の28画面（APIはあるので画面だけ）
12. 旧ルート9本のリダイレクト設定
13. §5-3 の行き止まりチェックのテストを追加

**完了条件**：V2の85画面すべてにルートが存在し、行き止まりチェックが通る。

### フェーズ4：コンテンツと分析

14. メディアライブラリ（R2連携・使用箇所スキャンのCron）
15. 共通情報（日付切り替えのCron）
16. サイトスクリプト（収集エンドポイント・埋め込みJS・レート制限）
17. アクセス解析／クロス集計／ファネル／URLクリックの4タブ

**完了条件**：`/analytics` の5タブと `/contents` の2タブが実データで動く。

### フェーズ5：仕上げ

18. 配信前チェック（`POST /api/broadcasts/preflight`）
19. カルーセル編集とバリデーション
20. 自動応答の優先順位・メッセージ種別・友だち条件
21. 機能設定（`/settings`）とサイドバーの並び替え
22. ログイン履歴・二要素認証
23. `route-guard-coverage.test.ts` に新規ルートを全部登録

**完了条件**：§1 の達成条件5つがすべて満たされる。

---

## 8. 受け入れ条件（DoD）

| # | 条件 | 確認方法 |
|---|---|---|
| 1 | V2の85画面すべてにルートがある | §5-3 のテスト1 |
| 2 | 行き止まりがゼロ | §5-3 のテスト2 |
| 3 | 旧ルート9本が308で新ルートへ飛ぶ | §5-3 のテスト3 |
| 4 | 更新系APIすべてに `requireRole` が付いている | `route-guard-coverage.test.ts` |
| 5 | 外部API停止時に管理画面が500を返さない | 各外部サービスをモックで落として E2E |
| 6 | 一斉配信が二重送信しない | `broadcasts-idempotency.test.ts` を拡張 |
| 7 | マイグレーションが既存データに当たる | 本番相当のダンプへ dry-run |
| 8 | `pnpm -r build` / `typecheck` / `test` が全部通る | CI |
| 9 | 1440px と 1920px で主要一覧に横スクロールが出ない | `docs/admin-ui-design-guidelines.md` の基準 |
| 10 | バージョン表記が全パッケージで 0.24.0 | `grep -r '"version"'` と `capabilities.ts` |

---

## 9. 関連ドキュメント

| 文書 | 内容 |
|---|---|
| `docs/v1-to-v2-inventory.md` | V1→V2の棚卸し、統合の由来、レスポンシブ方針 |
| `docs/lstep-feature-parity-matrix.md` | Lステップ全32機能とV2の対応 |
| `docs/lstep-parity-verification.md` | LINE APIで実現できること/できないことの裏取り |
| `docs/lstep-behavior-research.md` | シナリオ・リッチメニュー・カルーセルの実挙動 |
| `docs/lstep-gap-analysis.md` | 画面ごとの差分と実装判断 |
| `docs/admin-ui-design-guidelines.md` | 管理画面のレイアウト基準 |
| `docs/line-account-migration-options.md` | 400店舗の移行（v0.24.0のスコープ外） |
