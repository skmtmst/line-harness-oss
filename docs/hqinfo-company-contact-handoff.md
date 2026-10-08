# 統括の会社と連絡先（hqinfo）引き継ぎ

オーナー承認：2026-10-08 夜。担当の専用作業場所で実装し、コミットまで。push・PR・D1適用・配備は未実施。

## 機能とAPI

- `GET/PATCH /api/tenants/me/company-contact`。所属する統括だけを対象にし、オーナー・管理者だけが読み書きする。閲覧のみの管理者によるPATCHは403。通常の `GET /api/tenants/me` は名前だけのまま。
- 正式な会社名は表示用の統括名と別。保存時に必須6項目、郵便番号・電話・メールの形式を検査する。任意の建物・請求書宛名は空ならNULL。
- 既存の `company_settings_version` をrevisionとして再利用。SQLでも期待する版を比較し、競合は409。変更済みの値と入力を守る。同じ内容の保存を再送しても版と監査は増えない。監査に会社名・連絡先本文は複製しない。
- 住所検索は既存の `GET /api/postal-code/search?code=`。複数候補と手入力済みの住所は選択してから入れる。検索失敗・未登録・古い返信で入力を消さない。
- V8画面だけに追加。V7とPencilは変更していない。通常メンバー・閲覧のみの画面に新カードと保存・検索ボタンは出さない。

## migration

`614_tenant_company_contact.sql`。最新originの最大610、公開PR #1647の611・#1657の612、オーナーが予約した613を確認して614を使用。

`tenants`へ以下の8つのNULL可TEXT欄を追加。DEFAULTなし。表の作り直しなし。既存行はすべてNULL。

`legal_company_name` / `company_postal_code` / `company_address` / `company_building` / `company_phone` / `contact_name` / `contact_email` / `invoice_addressee`

bootstrapを再生成済み。D1へは適用していない。司令塔はpush直前にも採番を再確認する。

## 見た目の確認

| 板 | 名前 | 前 | 後 | 判定 |
|---|---|---|---|---|
| K7HYu | 統括の情報 | 100% | 100% | 旧座標11文字の結果。新カードは参照が未更新のため未判定 |

`~/lh-work/design/v8/html/K7HYu.html` と `pencil-texts/K7HYu.tsv` は会社・連絡先を足す前のまま。Pencil本体のxbgs0にはオーナーの新カードがある。新カードの90%判定は、司令塔が書き出しを更新して再測定する必要がある。全体の合格とは報告していない。

既存の参照HTMLと座標TSVにも左設定列・カード左端の差がある。上部のユーザー・ログアウト位置は共通の外側の差として残した。新カードはPencil本体を読み、カード20の余白・12の間、郵便番号180、電話＋担当者、メール＋請求書宛名の並びで実装。既存共通部品の見た目は変えていない。

画像：`~/lh-work/design/v8/overlay/pages-hqinfo/K7HYu-impl.png`・`-design.png`・`-overlay.png`。

実装単独の撮影：`/tmp/hqinfo-1152.png`・`/tmp/hqinfo-1440.png`・`/tmp/hqinfo-1920.png`。3幅ともdocument幅とviewport幅が一致、入力欄・ボタン・formの右端超過0、ブラウザ実行エラー0。1152と1440を目で見て文字の切れ・重なりがないことも確認した。自分の測定サーバーは停止済み。

## 検証

検証した開発基準SHA：`fde2122a22b454b7bb6545514dd9e463d2cb0016`。

- 開始前doctor：合格。LINE作業場所・親EC作業場所のクリーン確認済み。親側の変更なし。
- DB実SQL：1件成功。API・権限・必須・競合・再送・既存の統括名・住所検索・OpenAPI：93件成功。Web統括画面・共通入力・V8境界・CSS予算：338件成功。合計432件。
- 故障注入5件を検出：SQLの宛名欄を抜く／APIのGET権限を外す／会社名の必須検査を外す／画面から保存口を呼ばない／保存失敗で入力を消す。いずれも意図した検査で失敗し、元の実装へ戻して最終試験が成功。
- Web・Worker・DB・sharedの型検査成功。Web・Workerビルド成功。`verify:design` は456件一致で合格。migration安全検査510件成功、bootstrap一致、変更箇所のESLintと差分検査も成功。

試験ログは `/tmp/hqinfo-{db,api,web}-final.log`、故障注入は `/tmp/hqinfo-mutation-{0,1,2,3,4}.log`。ビルドは `/tmp/hqinfo-{web,worker}-build.log`。

## 変更ファイル

- `packages/db/migrations/614_tenant_company_contact.sql`
- `packages/db/bootstrap.sql`
- `packages/db/bootstrap-meta.json`
- `packages/db/src/tenant-company-contact.ts`
- `packages/db/src/index.ts`
- `packages/db/test/tenant-company-contact-migration.test.ts`
- `packages/shared/src/tenant-company-contact.ts`
- `packages/shared/src/index.ts`
- `apps/worker/src/routes/tenants.ts`
- `apps/worker/src/routes/tenant-company-contact.test.ts`
- `apps/worker/src/routes/tenant-company-contact-openapi.ts`
- `apps/worker/src/routes/openapi.ts`
- `apps/worker/src/routes/openapi-coverage.test.ts`
- `apps/web/src/lib/api.ts`
- `apps/web/src/v8/hq/settings.tsx`
- `apps/web/src/v8/hq/company-contact.tsx`
- `apps/web/src/v8/hq/company-contact.test.tsx`
- `apps/web/src/v8/hq/BEHAVIOR.md`
- `apps/web/src/components/shared/settings-form-card.tsx`
- `apps/web/src/components/shared/settings-form-card.module.css`
- `apps/web/src/components/shared/form-controls.tsx`
- `scripts/visual-qa/mock-api.mjs`
- `docs/release-log/drafts/hqinfo-company-contact.md`
- この引き継ぎ書

## 司令塔の次の作業

Pencilの参照書き出しを更新し、新カードの左右比較・90%判定を行う。採番を再確認してpush・PRを作る。更新履歴の下書きを `unreleased/<PR番号>-kenta-hq-company-contact.md` へ移し、実際のPR番号を足す。その後、承認済みmigrationのD1適用と配備を司令塔の手順で行う。
