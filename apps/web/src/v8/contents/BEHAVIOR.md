# 登録メディア一覧（V8）の動き

入口：`app/contents/page.tsx`（V8 のときだけ `src/v8/contents/list.tsx`）。v7 の画面・試験は触らない。絵：`O7hUt7`。

`list.tsx` 以外（窓・口の計算）は、src/app/contents から**写した**もの（src/v8 は src/app を import しない決まり）。中身は同じなので、直すときは両方を直す：
`media-detail-dialog.tsx`・`media-upload-dialog.tsx`・`media-replacement-dialog.tsx`・`media-preview-overlay.tsx`・`file-scan-stopped-banner.tsx`・`media-quota-guidance.tsx`・`media-direct-upload.ts`・`media-delete-impact.ts`・`media-usage-display.ts`・`media-usage-references.ts`

## 受け付ける URL と指定（今と同じ）
- `/contents`、`/contents?id=<メディア>`（使用箇所の窓を開いた状態）

## 呼ぶ口（今と同じ）
- 一覧・数・容量・フォルダ・登録・名前の変更・フォルダへ移す・アーカイブ・削除・差し替え・ダウンロードは今の V8 と同じ（`list.tsx` の処理は写したまま）

## 権限（今と同じ）
- 登録と取得（ダウンロード）は担当者も使える。消す・移す・名前を変える・アーカイブ・フォルダの追加は管理者だけ。見るだけの人には見出しの下に閲覧のみの帯を出す

## 今の作りと違うところ
- 型（ListPage）にのせ、「メディアを登録する」はフォルダの列の上に置いた
- 札の名前の前にフォルダの色の丸（2026-10-07 オーナー）。種類は名前の下の行（「画像・1.2 MB」）。使っている数は「使用先：…」
- 絵の札は「画像」「どこでも使っていない」の2つ。ほかの種類（動画・音声・ファイル）・上限に近い・アーカイブ済み・並び順は「よく使う絞り込み」から選ぶ
- 容量の案内（残りの棒）は、80% を超えたとき・満杯・読めなかったときだけ出す（いつもは数の帯の「使っている容量」で見る）
- 数の帯のマスは押せない（同じ絞り込みは札と「よく使う絞り込み」にある）
