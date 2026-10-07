# プール管理の動き（BEHAVIOR.md）

対象：`app/pools/page.tsx`（今の画面）から写して `pools.tsx` を一から書いた。板 `u3iab3`。

## 入口
- `app/pools/page.tsx`：`data-theme="v8"` のときだけこの画面を出す（`useSettingsTheme`）。v7 側は触らない。

## 受け付ける URL と指定
- なし（今の画面と同じ）。

## 読み込み（API）
- 先に `isPoolsFeatureAvailable()`（multi_store_hierarchy が有効な場所が1つでもあるか）。無ければ口を呼ばず `FeatureDisabledScreen`（#703）。
- `api.pools.list()`・`api.lineAccounts.list()`。プールごとに `api.pools.accounts.list(poolId)`。

## 操作
- 「新規プール」：V8 の作る画面 `/pools/new`（板 `D0AOyx`）へ。
- 公開 URL コピー（`${API}/pool/${slug}`。失敗はカードの中に文字で）。
- カードの「…」→ 削除する（既定の main には出さない）。確認窓（取り消せないので赤）。二度押しは受けない。
- 所属アカウントの「外す」→ 確認窓（あとから入れ直せるので赤にしない）。
- 「＋ アカウントを追加」→ まだ入っていないアカウントのメニューから選ぶ（今は選ぶ部品だった）。
- 見るだけの人（`useStaffRole` が owner・admin 以外）には、新規・削除・外す・追加を出さない（2026-10-06 オーナー決定）。最後の守りはサーバ。

## 並び
- 既定のプール（main）を先頭に、あとは**作った順**（今の画面は名前順）。絵の並び（渋谷エリア → イベント用）に合わせた。

## 失敗
- 一覧の失敗は `ListState` の error（再試行つき）。所属アカウントの読み込み・追加の失敗はカードの中に文字と「読み直す」。

## 今の画面から変わったところ
- 新規は窓ではなく `/pools/new` へ移る。並びは作った順。追加は選ぶ部品からメニューへ。見るだけの人には変える操作を出さない。
