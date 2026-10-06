# 友だち（V8）の動き（BEHAVIOR.md）

対象：src/v8/friends の画面一式。v7 の画面（app/friends・app/duplicates・app/users・app/friends/migrations・app/accounts の UID移行）から動きを写し、見た目だけを Pencil ★V8 の絵どおりに一から書いた。

## 入口（V8 のときだけ。v7 は触らない）
- `/friends`（app/friends/page.tsx）→ `host.tsx`：`?tab=` で一覧・重複検出・統合ユーザーを出し分ける
- `/friends/identity-candidates`（page.tsx）→ `compare/compare.tsx`
- `/friends/migrations`（page.tsx）→ `migrations/page.tsx`：`?tab=uid` は UID移行、それ以外は CSV
- `/friends/detail` は今のまま（V8 の作り直しは未着手）

## 受け付ける URL と指定（今と同じ名前・同じ意味）
- `/friends`：`?tab=list|duplicates|merged`、`?q=`（探す言葉）、`?tag=`、`?savedSearch=`、`?audienceId=`、`?scoreMin=`・`?scoreMax=`・`?scoredOnly=1`
- `/friends?tab=merged&person=<id>`：統合ユーザーの詳細を開く（新しく足した。一覧の名前から開くのは今と同じ）
- `/friends/identity-candidates?id=<候補ID>`：その候補を最初に開く（無ければ未判定の先頭）
- `/friends/migrations?tab=uid&run=<移行ID>`：その履歴を開く（新しく足した。無ければ先頭の履歴）
- 今の入口 `/accounts?tab=migration` はそのまま使える。V8 のタブ「UID移行」は `/friends/migrations?tab=uid` へ行く

## 保存先（今と同じ）
- sessionStorage `lh_friends_list_state_v1:<アカウント>`：一覧の絞り込み・ページ（IDEA-03）
- localStorage `friends.visibleColumns`：表示項目
- 変えられるかの判定：役割はサーバ（`api.staff.me()`）、担当者の項目キーは `lh_staff_permissions`。手元の役割の保存値（`lh_staff_role`）は使わない

## 友だち一覧（list/、x6QsVz）
- API：`friends.list`（今と同じ引数）・`friendStats.get`・`tags.list`・`loadOperators`・`scenarios.list`・`supportMarks.list`（任意機能がオンのときだけ）・`savedSearches.detail`
- 古い応答（別アカウント・別ページ）は捨てる。読み直し中は表を薄めるだけで消さない
- 頭：表示中をCSVで書き出す（表示中のページ分・数式の守りつき）／友だちを取り込む（/friends/migrations。オーナー・管理者だけ。ほかの人は場所だけ空けて置かない）
- 閲覧のみ（役割が owner/admin でなく、友だち・受信箱の変更キーも無い人）は「閲覧のみで見ています」の帯
- 数の帯4つ：有効な友だち（前月との差）／ブロック・非表示／未対応（要確認）／今月の追加（前月との差）。各マスから受信箱へ
- 道具：探す（Enter で決定）・タグ・対応・担当者・シナリオ・詳細条件（窓）・保存した検索（任意機能）／未対応・注目のみ・件数・条件で配信を作成（引き継げる条件のときだけ）・表示項目・件数・並び
- 表の列：□・☆（注目）・友だち・対応/担当・シナリオ・最新のメッセージ・タグ・流入元・最終接触・「…」（トーク・詳細・対応状況・担当・タグ・注目・テンプレート・シナリオ・友だち情報・リマインダ）
- まとめて：2人以上選ぶと一括の帯（オーナー・管理者だけ「操作を選ぶ」）

## 統合ユーザー（merged/、ADjK8・Hn9eE）
- 一覧 API：`usersGrouped.list`（探す・UID連携・所属・複数アカウントのみ・ページ・件数）・`duplicates.stats`（統合ユーザーの数）・`lineAccounts.list`。CSV は条件に合う全件
- 1ページの件数を選べる（20・50・100、既定は今と同じ 50）
- 行の「…」：詳細を見る（UID で結び付いた行だけ）／登録アカウントを見る（行の下に開く）
- 詳細 API：`useMergedPerson`（配信に使うの切替・目的ごとの順位・使う値・解除。版の照合と 409 の読み直しつき）

## 重複検出（duplicates/、hn6Y8・G9C4Uw）と比べて決める（compare/、fcg2D・p15At）
- 一覧 API：`duplicates.stats`・`identityCandidates.list`（状態・探す・ページ）・再検出 `detectFriendDuplicates`
- 数4つ：重複の候補（未確認）／結び付けた／重なって届いた配信（配信実績の接続待ち。見積りは「？」）／根拠が足りない
- 頭の「表示中をCSVで書き出す」は表示中の候補をCSVにする（新しく足した）
- 比べて決める：`useIdentityReview('friend_duplicate')`。判定は下の帯の3つのボタンが「結び付けた人に使う値」の中の小窓を開く。理由は必須、結び付けるときは表の「使う値」と3つの確認がそろうまで押せない

## CSVで書き出す・取り込む（migrations/csv.tsx、T9gblG）
- `useFriendMigrations`（今と同じ）：書き出しを作る → 取り込みは「まず確認だけ」→ 内訳を見て反映。競合・エラーがあると反映できない
- 確認の結果は確認前も5区分の場所を出す（数は「—」）
- 頭の「表示中をCSVで書き出す」は履歴の表をCSVにする（新しく足した）
- オーナー・管理者でない人には書き出し・確認のボタンを置かず、理由の1行だけ出す

## UID移行（migrations/uid.tsx、Z0jHp・L48eY）
- `useUidMigration`（今と同じ：行ごとの判断・実行と切り戻しは確認窓の確定だけ・owner と作成者の決まり・結果不明のときの読み直し）
- 「要確認をまとめて結び付ける」：このページの要確認・未判断・移行先ありの行を1行ずつ結び付ける（まとめての口は無い。新しく足した）
- 新しい移行の登録は履歴の段の「新しい移行を登録」で開く（履歴が無いときは最初から出す）

## 失敗の扱い
- 一覧・候補・履歴が読めないときは、その場所に理由と「もう一度」。数の帯だけ失敗しても表は出す
- 権限不足（403）は再試行を出さず、権限の案内にする
