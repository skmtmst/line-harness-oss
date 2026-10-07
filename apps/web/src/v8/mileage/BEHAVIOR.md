# マイル（V8）の動き

入口：
- `app/mileage/page.tsx`：V8 のときだけ `src/v8/mileage/mileage.tsx`（それ以外は今の v7 の画面）。
- `app/mileage/rewards/edit/page.tsx`：`src/v8/mileage/reward-edit.tsx`（この入口はもとから V8 の画面だけを出している）。
- `app/mileage/friends/detail/page.tsx`：V8 のときだけ `src/v8/mileage/friend-detail.tsx`。

絵：たまる決めごと `OC0gy`・1152 `ZJIyl`・閲覧のみ `E2Any`・使い道 `S35pO`・友だちの残高 `CJlf4`・履歴 `oRbJi`・
行動スコア `IRPw8`・点数を手で直す `Nv7An`・点数の変化の明細 `R8NNi`・使い道を作る `L2Bzp`・友だちのマイル詳細 `R6kIG`・
状態の見本帳 `zaqP9`（見本帳なので画面としては測らない）。

写し元（古い V8 の器。消していない）：`app/mileage/mileage-v8.tsx`・`v8-*-tab.tsx`・`rewards/edit/v8-reward-edit.tsx`・
`friends/detail/v8-friend-detail.tsx`・`v8-mileage-adjust-dialog.tsx`。表示の言い換えは `display.ts`、使い道の入力の確かめは
`reward-form.ts` に写した（src/v8 は `@/app` を import できない）。

## 受け付ける URL と指定（今と同じ）
- `/mileage`：たまる決めごと。`?tab=rewards|balances|history|score` で各タブ。知らない値はたまる決めごと。
- `/mileage/rewards/edit`：新しく作る。`?id=<使い道>` で編集。
- `/mileage/friends/detail?id=<友だち>`：友だちのマイル詳細。`&adjust=1` で「増やす」の窓を開いて出る（増減できる人だけ）。

## 外枠（mileage.tsx・frame.tsx）
- 板の頭（題・説明・右の操作）・タブの段・閲覧のみの帯は5つのタブで同じ。数の帯・フォルダの列・道具の段・表は一覧の型（ListPage）の枠へ渡す。
- タブの名の横の件数（たまる決めごと・使い道・友だちの残高）は、開いていないタブも出す。入口で
  `earningRulesV6({limit:1})`・`rewards()`・`friendsV6({limit:1})` を1回ずつ呼ぶ（新しく足した読み）。開いているタブが読み直したら、その数で上書きする。
- 閲覧のみ（変える権限が無い人）：「閲覧のみで見ています」の帯を数の帯の上に出す。作る・編集・公開・止める・複製・削除・増減・並び替えの
  ボタンと「…」の項目は出さない（押せない形で残さない。2026-10-06 オーナー）。CSV・検索・絞り込み・明細を見るは使える。
- 1152 の板（幅 1280 以下）：フォルダの列を畳み、道具の段を2段（作る・フォルダ・探す → 札 … よく使う絞り込み・件数）。

## たまる決めごと（earning-rules.tsx）
- 呼ぶ口：`earningRulesV6`（100件ずつ全部）・`history`（この30日の合計）・`friendsV6`（残高の合計）。
- 操作：編集（`/mileage/earning-rules/edit?id=`）・テスト・止める／再開・公開して反映・複製（止めた状態で作る）・削除（未公開だけ）・
  この決めごとの履歴を見る（履歴のタブへ）・↑↓で並び替え→「並び順を保存する」（保存していない並びは離れる前に確かめる）・CSV。
- フォルダはきっかけの種類で分けた見え方（保存しない。今と同じ）。

## 使い道（rewards.tsx）
- 呼ぶ口：`rewards`・`/api/mileage/redemptions`（要対応の交換）。
- 行の「中身を見る」と「…」（編集・自分で交換をテスト・出すのを止める／また出す／出す・複製）。今は行に出ていた「止める」ボタンは「…」へ移した（行の右端は「…」の決まり）。
- 頭の CSV は見えている表の中身。要対応の交換（もう一度届ける）は表の下。
- 数の帯「渡せなかった」の2行目は、最初の要対応の交換の理由（無ければ使い道の名前）。

## 友だちの残高（balances.tsx）
- 呼ぶ口：`friendsV6`・`history`・`adjustmentApprovals`・`staff.me`（オーナーかどうか）。
- 承認待ちのマイル変更（差し戻す・承認する）は案内の帯のすぐ下。
- 行を押すと、その人のマイル詳細。行の「明細を見る」「増減」（増減は閲覧のみの人には出さない）。
- 動きが変わるところ：札で絞っていないときの2ページ目以降。今は口が返した頁をさらに手元で切っていて空になっていた。口が返した頁をそのまま出す。

## 履歴（history.tsx）
- 呼ぶ口：`history`（探す・種類・方法・期間・頁）・`confirmMileageEntry`・`voidMileageEntry`。
- 行を押すとその友だちのマイル詳細。行末は「確定する」／「取り消す」／「友だちを見る」＋「…」（「…」はすべての行に出す）。

## 行動スコア（score.tsx）
- 呼ぶ口：`actionScores.friends`・`rules`・`publishRules`・`stopRules`・`saveDraft`（外す）・`previewBands`・`adjust`・`scoring.friendScore`。
- 道具の段：友だちの名前で探す・「下がっている」の札・この分けかただと何人入るか・件数・この帯の人に送る・スコアのルールを作る。
- 帯で絞るのは数の帯の「この帯だけ見る」（もう一度押すと全部に戻る）と「よく使う絞り込み」（点数が低い順・下がり幅が大きい順・帯のみ）。
- できごとの決めごと（探す・足す点／引く点・公開中のルールを止める・外す・＋ できごとを足す）は表の下の開け閉めの段。閉じている間は描かない。
- この頁の行動スコアの CSV はページ送りの段。

## 使い道を作る（reward-edit.tsx）
- 呼ぶ口・確かめ・保存・公開・交換テスト・離れる前の確かめは今と同じ。
- 絵に無い欄（説明・交換したときの案内・交換後に使える日数・種類ごとの説明）は最後の「そのほか（任意）」の段。欄の説明は「？」へ。
- 「＋ 条件を足す」を押すと、交換できる人が「条件で絞る」になり条件の入れ物が開く。

## 友だちのマイル詳細（friend-detail.tsx・adjust-dialog.tsx）
- 呼ぶ口：`friends.get`・`friends.mileage`・`staff.me`・`friendsV6`・`history`・`confirmMileageEntry`・`voidMileageEntry`・`retryMileageNotification`。
- 手で増やす・減らす（`M8zhjL`）の窓は今と同じ約束（理由必須・追記だけ・二重反映しない・境界以上は別のオーナー承認・通知の再送）。

## 窓の幅と位置（共通の窓の designWidth・designTop で渡している）
- 点数を手で直す `Nv7An`：designWidth 560・designTop 184。
- 点数の変化の明細 `R8NNi`：designWidth 600・designTop 204。
