# マニュアルの正本表の動き（BEHAVIOR.md）

対象：`screen.tsx`（★V8 `cIdA2`）。写し元：`app/settings/manual-links/manual-links-v8.tsx`・`use-manual-links.ts`・`manual-link-view.ts`。

## 入口・URL
- `app/settings/manual-links/page.tsx`。`/settings/manual-links`（指定なし）。

## 読み込み（API）
- `api.staff.me()` と `GET /api/manual-links` を一緒に読む。失敗は「正本表を読み込めませんでした」＋読み直し（U071）。
- 見られる人：運営の代表（env-owner）・`manual.link.edit` を持つ人・オーナー。ほかは「この表は運営だけが見られます」。

## 操作
- 画面ID・画面名で探す、札「すべて」「開けない N」。
- いま全部を確かめる（`POST /api/manual-links/check` → 読み直し）。確かめる時刻（毎日 4:00）を横に出す。
- 行の「直す」／「決める」→ その行で URL を入れて「決める」（`PUT`、版つき）。409 は最新を読み直して編集中身を残す、403 は権限の文。
- 開けない・まだ決めていない行は薄い赤の地。表の下に「開けないリンクが N件あります…」。
