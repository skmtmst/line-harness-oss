# Googleビジネス（V8）の動き

入口：`app/restaurant-test/google/page.tsx`（V8 で出す。今までどおり完全切り替え）。
絵：口コミ `j0Wcg`・返信を作る `x9HIR`・投稿 `Cfed0`・投稿を作る `T1j2Sw`・パフォーマンス `SrmVs`・プロフィール `JUTGz`・設定 `CuHXG`。

## 受け付ける URL と指定（今の画面と同じ名前・同じ意味）
- `?tab=reviews|posts|performance|profile|settings`：タブ。未接続のときは設定に固定。
- `?tab=reviews&view=draft&id=<口コミ>`：返信を作る。id が無いときは一覧。
- `?tab=posts&view=new&kind=standard|event|offer`：投稿を作る（kind 既定は standard）。`view=edit&id=`：直す。`view=confirm&id=`：公開前の確認。
- `?tab=profile&view=hours|confirm|history|edit`：営業時間の変更・変更の確認・変更履歴・プロフィールの編集。**V8 の絵がまだ無いので入口の page.tsx が今の画面（google-business）で出す。**
- `?google=connected|reconnected|select_location|error:*`：Google からの戻り。1回だけ帯に出して URL から消す。

## 呼ぶ口（今の画面と同じ `restaurantGoogleApi`）
- 接続：`connection`（＋店舗を選ぶ欄のために `restaurantTestApi.snapshot` の店舗）。店舗を選ぶと、その店舗の LINE アカウントへ切り替える。
- 口コミ：`listReviews`（評価・状態・並び・検索 300ms・20件ずつ）、`syncReviews`（最終同期が古いと開いたとき1回）、`review`・`generateDraft(new|shorter|polite)`・`saveDraft`・`publishReply`（409 already_replied・502 の扱いも同じ）。
- 投稿：`posts`（状態・種類で絞る）・`syncPosts`・`cancelPost`・`removePost`（確認の小窓）・`post`・`createPost`・`savePost`・`publishPost`。画像は登録メディアから選ぶか、端末からアップロード（道具は入口が渡す。src/v8 から @/app を読まないため）。
- パフォーマンス：`performance(7|28|90)`（既定28日）。
- プロフィール：`profile`・`syncProfile`・`proposeHours`（今日を休みにする・今日は早く閉める → 変更の確認へ）。
- 設定：`connectStart`（Google の認可画面へ）・`selectLocation`・`disconnect`（確認の小窓）。

## 送れない設定・権限
- `writeEnabled` が false（検証環境）や公開の権限が無いときは、返信の「返信内容を確認」を置かない（帯の約束「送れない設定のときは送信ボタンを出しません」）。下書きの保存はできる。
- 接続を管理できない人には、接続・再接続・解除のボタンを置かない。

## 絵に合わせて変えた所
- 口コミの状態の絞り込みは「状態：すべて」が既定（今の画面は未返信）。同期は道具の段の右の印のボタン。
- 行のボタンは「下書きを作る」／「返信を見る」の2つ（今の画面は状態ごとに言い方が違った）。
- 投稿の一覧は1つの箱に行を並べ、操作は行の「…」（中身を見る／編集・Googleで表示・取り消す・Google から削除）。
- 投稿を作るは1列。種類は選ぶ欄、期間は「はじめ・おわり」の日時の欄（送る形は今と同じく日付と時刻に分ける）。特典のときボタンは付けられない（Google の決まり）ので押せない形。表示イメージの欄は絵に無いので置かない。
- パフォーマンスの推移の棒グラフは、数のマスの「…」→「表示数の推移を見る」で下に開く。料理の注文（API の `foodOrders`）は絵の「料理の写真の閲覧」の場所に出す（写真の閲覧数を返す口がまだ無い）。
- プロフィールの店舗情報は5行（店名・住所・電話・サイト・通常の営業時間）。特別営業時間・写真は「ほかの項目」で開く。カテゴリは返す口が無いので出さない。
- 設定の LINEアカウント・接続店舗・最終同期は、下の小さな行に出す。
- 日時は店舗の時刻（日本時間）で「9/30 21:40」の形。
