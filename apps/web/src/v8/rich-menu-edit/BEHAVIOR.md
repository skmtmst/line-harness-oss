# リッチメニューの編集・詳細の動き（BEHAVIOR.md）

板：作る③ 誰に出すか `OxEMM`・作る④ 公開 `F4gELj`・編集（競合）`r8dGXT`・公開した（公開の進み）`hKr8f`。

## 入口（app/rich-menus/edit/page.tsx の V8）
- `/rich-menus/edit?id=<ID>&step=<手順>`：作るのウィザード（`app/rich-menus/new/create-v8.tsx`）で直す。下書きを読み込んで手順①〜④の入力に入れ、すべての手順へ戻れる。`step` は作ると同じ `shape|buttons|audience|publish` と、今までの編集画面の `targeting`（→ audience）・`actions`（→ buttons）を受け付ける。読み込めない・見つからないときは TargetMissing。
- `/rich-menus/edit?id=<ID>`（手順の指定なし）：このフォルダの `detail.tsx`（hKr8f）。下書きは見せる物が無いので `?step=shape` へ送る。
- ウィザードは「合格した画面と同じファイルの続き」なので create-v8.tsx で続けた（README の決まり）。v7 の編集画面は触らない。

## 詳細（detail.tsx）
- 呼ぶ口：`richMenuGroups.get`・`publishProgress`（公開の進み）・`publishRuns`（履歴）・`reconcile(dryRun=true)`（開いたときに照らし合わせる）・`previewTargets`（出る人）・`tapStats`（今月押された）・`api.staff.me`（役割）。
- 操作：もう一度公開する（公開が途中で止まったとき・`publish`）・失敗だけやり直す（最新の失敗した公開・`retryPublishRun`・確かめの窓）・ずれを直す（`reconcile(dryRun=false)`・確かめの窓）・編集する（`?step=shape`）・切替のつながり・…（複製する＝`duplicate`→新しい下書きの手順①、LINEから取り下げる＝`unpublish`→一覧、削除する＝公開中は押せない＋理由）。
- 閲覧のみ（owner/admin 以外）：編集する・…・もう一度公開する・やり直す・ずれを直すを置かない（隠す）。閲覧のみの帯を出す。

## ウィザード（create-v8.tsx）で変えたところ
- 直すとき（`editGroupId`）に下書きを読み込む。読み込むまで中身を出さない。
- 公開前の確認の口が形の違う応答を返したとき、画面ごと落ちていた（`selfCheck` が無いと描画中に落ちる）。読めなかったものとして扱う。
- 作る③④の段：枠は内側の線（共通のカードの外側の線で 2px ずつ下へずれていた）・余白20・題と中身の間14。出す相手・いつ公開するかの選ぶカードに上の印。終わりを決めるは枠の箱（題とトグル／日時 に終わり、［戻す先］に戻す）。公開前の確認の行の間14・見直すは枠の無い押しボタン。右の「公開すると」から ページの行を外した（絵に無い）。公開するの印。
- 競合の帯（r8dGXT）は頭の説明の下（タグの編集と同じ形）。
- 作る②の「画像の上で面を選ぶ」を段の箱に入れた（絵の x=288）。
