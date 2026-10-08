# 友だち追加時の配信（V8）の動き

入口：`app/friend-add-settings/page.tsx`（V8 のときだけ `src/v8/friend-add/list.tsx`・`editor.tsx`、それ以外は今の v7 の画面）。
絵：一覧 `MRhef`・閲覧のみ `LEwkJ`・1152 `P20kYU`・受け皿の「…」`C0lfUP`・受け皿は止められない `cFo2p`・状態 `kFz4b`（見本帳）／
作る① `wDzkc`・② `h8uNW`（1152 `xHpkS`）・③ `al47K`・④ `i1nThZ`・⑤ `U8Xm3X`・編集の競合 `h5rm8t`。

## 受け付ける URL と指定（今と同じ）
- `/friend-add-settings`：一覧。`?kind=first_time|returning`（タブ）、`?delete=<id>`（その設定の削除の確かめを開く）
- `/friend-add-settings?view=new&step=<basic|routes|message|actions|preview>`：作る
- `/friend-add-settings?view=edit&id=<id>&step=…`：直す（下書きを保存すると作るから直すの URL へ置き換える）

## 呼ぶ口（今と同じ）
- 一覧：`api.friendAddRules.list(accountId, kind, { cursor, limit, q, folder, status })`（`folder` は `__uncategorized` で未分類）
- 並べ替え：`reorder(accountId, kind, ids)`（絞り込みなし・全件が見えているときだけ）
- 止める：`stop(accountId, id, version)`／削除：`archive(accountId, id)`／フォルダ：`createFolder(accountId, name, key)`
- 作る・直す：`get`・`list`（流入リンクを使っているほかの設定を出すため、直すときも読む）・`conflicts`・`createDraft`・`saveDraft`（冪等の鍵）・`validate`・`test`・`publish`
- 未保存の変更があるときの離脱は `useUnsavedGuard` で確かめる

## 今の V8 画面（app/friend-add-settings/list-v8.tsx・editor-v8.tsx）と違うところ
- 閲覧のみの人には、作る・フォルダを追加・編集・テスト・止める・削除・並べ替えのつまみ・保存・次へを出さない（押せない形でも置かない。オーナー 2026-10-06）。閲覧のみの帯と「実行結果を見る」は出す
- 編集の画面（`editor.tsx`）の閲覧のみ：文字の欄は読み取りだけで中身を見せる。だれに送るか・フォルダ・送るものの種類・送るタイミング・曜日・戻ってきた人の扱い・始めるシナリオなど選ぶ部品は置かず、選んでいる値を読み取りだけの欄に文字で見せる。流入リンクは選んでいるものの名前だけを並べる。差し込む・時間帯を足す/削除・条件を足す・二重送信のつまみは置かない
- 一覧の「最初に送るもの」の2行目は、シナリオ・タグを1行にまとめる（行の高さ 62 を保つ）
- 1152 では「直近7日」の列を出さず、道具は2段（作る・フォルダ・探す … 件数／状態の札）
- 作る②：選んだ流入リンクを上に並べる。ほかの有効な設定が使っているリンクには「いま「〇〇」（順番N）が動いています」
- 作る②の友だち条件は1行の言い方（タグの有無）で出し、「条件を足す」で組み立てを開く
- 1152 の作る②では、期間と友だち条件を「対象をしぼる（任意）」の小窓で見る・変える。小窓を閉じても変更を保ち、下書きの保存に含める
- 入力不足は上の帯に重ねず、名前・流入リンク・シナリオの欄を赤くし、理由を欄へ結び付け、最初の誤りへ focus と中央へのスクロールを行う。保存・次へ・先の手順を選ぶ操作でも確認する
- ページ内の戻るリンクは置かず、型の題・説明とパンくず・キャンセルを使う
- 下書きの保存が版の競合（409）になったら、頭の中に帯を出す：「違いを比べる」（最新の保存と項目ごとに並べる）・「最新を読み込んで続ける」
- 1152 の作る画面は、右の列の上に「LINEでの見え方を見る」（窓で開く）
