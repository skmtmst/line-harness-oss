# 投稿（写真の審査・V8）の動き

入口：`app/nen-members/page.tsx`（`src/v8/nen-posts/review.tsx` を出す）。
今までの画面 `app/nen-members/photo-review-v8.tsx` と試験は消さずに残す（本番の切り替えの日にまとめて消す）。
絵：写真の審査 `TkA4D`・閲覧のみ `Jn95h`・採用 `cniyw`・この写真を見送る `ujcar`・版の履歴 `N1br7`・公式サイト掲載 `SyQA1`。

## 受け付ける URL と指定（今と同じ）
- `?tab=photos&status=pending_review`（ダッシュボードの「写真審査」から）。`status` は `pending`・`adopted`・`rejected`（`approved`・`returned` なども同じ意味で読む）
- `?tab=publications`：公式サイト掲載の札
- `?view=detail&photo=<写真ID>`：1枚ずつ大きく見る
- `?q=<言葉>`：飼い主・ペット名で絞る（100字まで）
- 札・詳細・検索を変えると URL へ書き戻す（戻る・再読込で同じ場所に戻る）

## 保存先（今と同じ）
- 選んだ写真：`sessionStorage` の `nen-photo-review:selection:<アカウントID>`

## 呼ぶ口（今と同じ）
- 一覧：`GET /api/nen-members/photos?accountId&limit=200&offset&q`（200枚ずつ。「さらに読み込む」で続き）
- 数の帯：`api.nenMembers.photoReviewMetrics`・報酬の決まり `photoRewardPolicyVersions`・掲載 `photoPublications`
- 権限：`api.staff.me`（owner・admin だけ審査できる。ほかは閲覧のみ）
- 審査：`reviewPhoto`（採用・見送り。見送りは理由・補足・もう一度お願い・次の投稿は人が見る）、まとめて `bulkReviewPhotos`、通知の再送 `retryPhotoReviewNotification`
- 掲載：`photo`→`publishPhoto`、掲載先から外す `withdrawPhotoPublication`、使う場所 `updatePhotoPublicationPlacements`、並び順 `photoPublicationOrder`・`savePhotoPublicationOrder`
- 版の履歴：`createPhotoRewardPolicyVersion`（使い始めを入れると予約）・`revertPhotoRewardPolicyVersion`
- 1枚ずつ：`photoAssetStatus`・`photoDerivatives`・`savePhotoRotation`・`processPhotoAssets`・`photoPointRetry`・`photoPointReconcile`・原本の保存（再認証のあと1回だけ）

## 今の画面と違うところ（見せ方だけ）
- 枠・見出し・札・数の帯は型（ListPage・KpiBand・KpiCard）で作る。札の名前と件数は「審査待ち 3」の1つの文字
- 数の帯の右上の「…」は、その数の由来を title で見せる（押しても何も変えない）
- 写真のカードは絵どおり（名前・日付・「〇〇さん・EC-番号」・「ひとこと」・見送る／採用する）。採用は幅276のカード
- 右の棚の「見送り理由の内訳（今月）」は、0件でも3つの理由を並べる（暗い・人の顔・ほかのお店）
- 報酬の決まりの「公式サイトに載ったら」は、いま使っている版の掲載の追加マイル（無ければ「—」、0 は「なし」）
- 見送る窓の「この人の次の投稿は、必ず人が見る」は、「もう一度 送ってもらえるようお願いする」と同じ行の右（絵に無いので行を増やさない）。届く文章は2行で切り、全文は title
- 版の履歴の日時は「9/20 10:00」の短い形（全文は title）、内容は「採用 100・公式サイト掲載 さらに 200」（掲載の追加が0なら「なし」）。保存の主ボタンは「版を保存する」、使い始めを入れると「版を予約する」
- 閲覧のみの人：タブの下に「閲覧のみで見ています」の帯。押せない操作（見送る・採用する・選ぶ・まとめて・公式サイトに出す・LINE通知を再送・掲載先から外す・並び順・使う場所・向きの保存・作り直し・マイルの手続き・新しい版を作る・この版に戻す）は置かない。カードのボタンの場所だけ空けて並びをそろえる
