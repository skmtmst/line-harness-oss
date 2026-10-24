# 04 会社とロゴ（company branding）

大学生向けひとこと: 会社名・ログイン画面の名前・ロゴを保存し、ログイン前に正しい会社の看板を出す設計です。

## 目的

- 会社名・ログイン画面表示名・ロゴの保存。ログイン前に会社を見分けてロゴを出す口。未設定時は汎用musubo看板。
- 会社名・ログイン表示名・LINEアカウント名の3つを別の意味にする（監査03-04必須条件1）。

## Pencil実ID・画面呼出箇所

- Pencil: `uAWb7`・`BOj1a`。
- 画面: 会社設定画面（保存）、ログイン画面（看板表示）、管理画面の会社名表示。musubo表示は不変。

## 既存コード/SHAと行根拠（base `4639c6e`・監査03-04取込）

- 会社の正本: `tenants` は1企業1行。初期schemaはname/statusのみ、logo/表示名専用列なし（`migrations/176_tenant_foundation.sql:1–16`）。
- 自会社名GET/PATCH: `routes/tenants.ts:157–181`（staff tenantId基準。owner/admin。空欄・100文字上限）。
- ログイン前brand: `routes/brand.ts:26–47`（先頭active→先頭。tenant条件なし。これをtenant resolverに使わない）。
- brand名の意味: LINE表示名優先、運用nameはfallback。会社名ではない（`routes/brand.ts:19–24,45–46`）。
- 公開経路の壁: brandはauth skip、tenantScopeはstaffなしでnext（`middleware/auth.ts:516`、`middleware/tenant-scope.ts:21–24`、`middleware/tenant-public-boundary.ts:17–52`）。
- 管理media upload: `routes/contents.ts:448–507,580–668`（MIME・容量・署名・寸法検査）。
- 現画像形式: PNG/JPEG/GIF/WebP。SVGは許可外（`routes/contents.ts:182–198,217–240`）。
- 公開media: `/media/:id/content` は能力URL（`routes/contents.ts:1099–1145`）。会社ロゴ専用契約ではない。

## 現在/提案の区別

- 現在: `brand.ts` の `getLineAccounts` 先頭選択はtenant未指定。これをtenant resolverとして使わない（確定）。
- 提案: 会社識別は検証済み登録ホスト／保存した一意の公開slug→公開brandレコード。任意query tenant_id・未検証Forwarded・先頭account・内部tenantIdの任意GET・staff不在のDEFAULT_TENANT_IDを識別に使わない。

## field具体化：companyNameとloginDisplayName

- 別fieldとする（既存 `tenant.name` PATCHの再利用はしない）。現行tenants.nameは会社名であり、brand.tsの「本番/テスト」という説明はLINEアカウントのnameについてである。今回の提案ではログイン前に出す公開会社名をdisplay_nameへ別保存し、既存の会社名APIは維持する（公開看板を無言で既存値から作らない）。この公開名の分離は提案であり既存仕様という主張ではない。
- 候補544の列: `display_name`（会社名・公開）、`login_display_name`（ログイン画面の名前・公開）、`logo_asset_id`（tenant所有ロゴ資産の参照・非公開ID）、`brand_slug`（公開識別子・一意）、`revision`（CAS用整数版）。
- tenant所有モデル: 新規 `tenant_logo_assets` 表（tenant_id・r2_key・形式・寸法・容量・scan状態。正方形・512px以上・1MB上限をCHECK）。既存mediaはaccount紐付き・tenant所有列なしのため流用しない。実体は既存R2置き場を再利用する。
- 空欄・100文字上限の契約は既存 `tenants.ts:157–181` に合わせる。

## ロゴupload契約（具体）

- 形式: 正方形・512px以上・1MB上限。保存mimeはPNGのみ（正本のPNG/SVGに合わせ、JPEG/WebPへ勝手に拡大しない）。API受付はPNG/SVGのみ。
- SVGの扱い（Pencil要件あり・無言削除しない。設計選択待ち）:
  - 案1（有力）: SVGは保存時に安全検証＋隔離rasterizationを通し、元SVGは保存せず安全PNG生成で保持する。公開・保存はPNGのみ。
  - 案2: 未提供として設計差に記録し、Pencil・司令塔へ返す。
  - 任意外部URL・data:/javascriptスキーム・未検証SVGの直接埋め込み・サーバーfetchはしない。
- 会社資産口（提案・新規。すべてowner/admin＋非readOnly＋自tenant guard。`tenant_logo_assets` 行を作る）:
  - `POST /api/company/assets`（upload。MIME・容量・署名・寸法検査）。
  - `POST /api/company/assets/:id/scan`（検査確定。scan結果はserver検査のみが書き込む。clientのclean指定不可。pending/blocked/deletedは公開不可）。
  - `POST /api/company/assets/:id/commit-logo`（logo参照切替。DB失敗時は旧参照維持。自tenant資産のみ。trigger `trg_tenants_logo_same_tenant` またはserver同scope検査で他tenant採用を拒否）。
- exact path決定: 公開看板 `GET /api/public/company-brand/:slug`、会社保存 `PATCH /api/company/branding`。
- assetsのupload/scan/commitは全てowner/admin・effectiveReadOnly=false・自tenant限定。scanはサーバー検査処理を起動するだけで、clientがcleanを指定することは不可。検査済みclean資産だけ採用できる。
- flag OFF時は汎用musubo看板にする。旧global先頭LINE brandへのfallbackは禁止（他社看板漏れになる）。

## method/path/input/output/error JSON例（提案）

公開看板GET `GET /api/public/company-brand/:slug`（認証なし。公開DTOのみ）:

```json
{"success": true, "data": {"displayName": "然", "loginDisplayName": "然 ログイン", "logoUrl": "https://.../logo-v3.png", "fallbackGlyph": "然"}}
```

`PATCH /api/company/branding`（提案・owner/admin・readOnly=false・tenant active）:

```json
{"displayName": "然", "loginDisplayName": "然 ログイン", "logoAssetId": "la-1", "expectedRevision": 4}
```

- 公開DTOはdisplayName・loginDisplayName・安全logo URL・fallbackGlyphのみ。staff名・email・権限・channel ID・token・tenant/account一覧・契約状況を返さない。
- fallback: 未設定時は汎用musubo看板（会社名先頭1文字の箱は表示名がある場合のみ。空名・Unicode結合文字の扱いを契約に含める）。
- R2 upload→検証→DB参照切替の順。DB失敗時は旧参照維持（R2とD1は同一transactionではない）。未採用uploadのTTL回収・他用途使用中の削除防止・logo使用先の登録を設計。
- cache keyに公開slug＋revision。会社A/Bの混入防止。既存brand max-age 300の流用禁止。

## 権限表

| 操作 | readOnly | owner | admin | staff |
|---|---|---|---|---|
| 公開看板GET | 許可（認証なし） | 許可 | 許可 | 許可 |
| 会社名・ロゴ保存PATCH | 403 | 許可 | 許可 | 403 |

## 二重送信/再試行・片成功/補償

- 保存に `expectedRevision`（02と同約束。0行→409）。
- R2成功・D1失敗の片成功は旧参照維持＋未採用upload回収。再送は同キーで既存参照を返す。

## 監査PII防止

- 公開レスポンス・ログ・URLに秘密値・アカウント一覧・個人情報を出さない。会社列挙・存在状態の余分な漏洩なし（未知/停止/保管会社は汎用看板＋ログイン可否を明記）。

## テスト合格条件（監査03-04の将来試験より）

- A/B会社・未知slug・不正Host・停止/保管・LINEなし会社・未認証/readOnly/staff更新拒否。
- 他tenant mediaId・偽MIME・SVG・外部URL・scan pending・削除/差替え失敗。
- 会社名CAS競合・cache A/B混入・未設定/空白名。
- flag OFFで汎用musubo看板（他社brandが出ないこと）。

## feature flag名/既定off/有効化ゲート

- 提案旗名 `v8_company_branding`（proposed）。既定off。tenant設定on＋DB候補544・共通編集receipt候補547反映済みでのみ保存受付。off時は汎用musubo看板にする（旧global先頭LINE brandへのfallbackはしない。他社看板漏れ防止）。未確定のPencil・SVG選択はblocked保持。

## DB

- 必要。候補544（tenantsに表示名・ログイン表示名・ロゴ資産参照・slug・revision列＋新規 `tenant_logo_assets` 表＋自tenant trigger。新規のみ。既存name/status不変）: `migration-drafts/544_company_branding.sql`（＋rollback）。
