# はじめの設定の動き（BEHAVIOR.md）

対象：`app/getting-started/page.tsx`（今の画面）から写して `getting-started.tsx` を一から書いた。板 `xuJ7D`。

## 入口
- `app/getting-started/page.tsx`：`data-theme="v8"` のときだけこの画面を出す（`useSettingsTheme`）。v7 側は触らない。
- 枠：設定の型（`SettingsPage`）＋白い板の中の「設定の中のメニュー」（`SettingsInnerNav inline`）。中身の幅は `../sa-frame.module.css`。

## 受け付ける URL と指定
- なし（今の画面と同じ）。

## 読み込み（API）
- `api.gettingStarted.get(accountId, 'v8')` の段を正本にする（状態・権限・行き先）。
- 口に段2（初期セット）が無いときは、機能設定の実物（`loadFeatureSettings`）の版で足す。403 は「権限がありません」、失敗は「確かめられません」。
- 機能設定の保存の合図（`FEATURE_SETTINGS_UPDATED_EVENT`）で読み直す。
- 判定は `steps.ts`（`app/getting-started/getting-started-view.ts` の写し）。直すときは両方。

## 見せ方
- 進み具合の帯（`n / 6 済み`＋棒）。棒は `<progress>`（style の直書きをしない）。
- 6段：済みは緑の丸と「済み」の札、まだは番号の丸と行き先のボタン、押せない段は理由の文字。
- 下の2枚：いま止まっている理由（止まっている段・権限で進めない段・確かめられない段。無ければ出さない）／気をつけること。

## 失敗
- 読み込みの失敗は `ListState` の error（再試行つき）。読み込み中は loading。

## 今の画面から変わったところ
- 2段目の言葉の空き（「チャネル ID」「自分の LINE」）を絵に合わせた。判定は同じ。
