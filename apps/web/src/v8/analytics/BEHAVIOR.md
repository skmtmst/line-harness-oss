# 分析（V8）の動き

入口：`app/analytics/page.tsx`（V8 のときだけ `src/v8/analytics/analytics.tsx`、それ以外は今の画面 `AnalyticsInner`）。
ファネルの作る・編集フォーム（`FunnelForm`）と結果の保存欄（`SaveAnalysisAction`）だけは、入口が今の部品を `slots` で渡す（src/v8 から @/app を読めないため。フォームは絵の板の外の状態）。

| 見かた | 絵 | 新しい画面 |
|---|---|---|
| 友だちの増減 | `ws9wt`・1152 `eEhYU`・閲覧のみ `L4Uov` | `friends.tsx` |
| 配信の反応 | `yvOtn` | `reactions.tsx` |
| 経路と成果 | `PFe9c` | `routes.tsx` |
| 成果地点ごとのレポート | `AzrZq` | `conversion-report.tsx`（経路と成果の数の帯・道具の段を共有） |
| URLクリック | `iK4cQ` | `url-clicks.tsx` |
| ファネル | `DkRDE` | `funnel.tsx` |
| クロス分析 | `u5CuB8` | `cross.tsx` |
| 使われ方 | `N8ZrUl` | `usage.tsx` |
| 保存した分析 | `bglah` | `saved.tsx` |
| Search Console（`/search-console`） | `h1G4d` | `search-console.tsx`（入口は `app/search-console/page.tsx`） |

## 受け付ける URL と指定（今の画面と同じ）
- `/analytics?tab=friends|reactions|routes|usage|cross|funnel|url-clicks|saved`（知らない値・無しは友だちの増減）
- 旧キー `?tab=clicks` は URL クリックへ寄せる
- `/analytics?view=conversion-report` は成果地点ごとのレポート（タブは「経路と成果」が選ばれた形）
- `?tab=funnel&conversionPointId=…&conversionPointName=…` はファネル作成へ成果地点を渡す

## 呼ぶ口（今の画面と同じ）
- 役割：`api.staff.me()`（owner・admin だけ変える操作を出す）
- 友だちの増減：`api.analytics.friendsOverview(account, {from,to})`、右の列は `routesOverview`（概要の後に読む）
- 配信の反応：`reactionsOverview`、経路と成果：`routesOverview`、URLクリック：`urlClicksOverview(account, {from,to,limit:200,query})`（検索語は300ms待って API へ）
- 成果地点ごとのレポート：`api.conversions.definitionReport({from,to,lineAccountId})`、CSV は `api.conversions.exportDefinitions`
- 使われ方：`usageOverview`・`api.featureSettings.visibility`（使っている機能の数）
- 保存した分析：`api.analytics.saved.list`・`saved.snapshots`、定期レポート：`reportSchedules.list`・`setStatus`（版ずれは読み直してから知らせる・アカウント切替の世代で古い応答を捨てる）
- ファネル：`v6Funnels.list(includeInactive)`・`latestRun`・`run`・`get`（編集の下書き）・`setStatus`、対象者：`createResultAudience`
- クロス分析：`friendFields.list`・`runCross`・`crossResult`（待ち順の確認・打ち切り・再接続、run ID は sessionStorage `lh:analytics:cross-run:v1:<account>` に1日）・`createResultAudience`
- Search Console：`api.searchConsole.performance(7|28|90)`（403 は権限の案内、それ以外の失敗は読み直し）
- CSV の名前・列は今と同じ（`analytics-friends.csv`・`analytics-reactions.csv`・`analytics-routes.csv`・`analytics-url-clicks.csv`・`conversion-report.csv`）。板の頭の「CSV で書き出す」は開いている見かたの書き出し

## 今の画面と違うところ（見せ方だけ）
- 閲覧のみの人には「レポートを作る」を置かない（オーナー決定 2026-10-06）。タブの下に「閲覧のみで見ています」の帯
- 二段の切り替えの「見かた」に「成果地点ごとのレポート」「Search Console」を出さない（絵どおり。レポートは `?view=conversion-report`、Search Console は `/search-console` で開ける）
- 数の帯の各マスに「…」（CSV の書き出し）。「？」は出さない（絵どおり）。減った・ブロック率の説明は下の行の短い文へ
- 友だちの増減：棒は自前（上に増・下に減・配信／シナリオの日に点）。棒を押すとその日の数を下の注に出す（もう一度押すと消す）。集計期間・データ締切は題の「？」の中
- 友だちの増減の右の列「どこから増えたか」は人数の多い順に上位5件（全件は「流入と計測で詳しく見る」）。「減った友だち」はブロック・解除の合計（内訳は未取得）
- 表の補足（経路の参照コード・クリック、現在の友だち、保留・却下、友だち1人あたりの費用、URL の最初・最後に押された日時、押した人へのタグ・シナリオ、届いた人数）は行のセルの title（なぞると出る）。表は絵どおり1〜2段
- 配信の反応のシナリオの行は、対象の下に「送信 N通」
- URLクリックのページ送り（10・20・50件）は取得した URL が10件を超えるときだけ出す
- 成果地点ごとのレポート：行の「…」から 成果地点を開く・日ごとの表を見る（棒をその地点だけにする。「すべてに戻す」で戻る）
- 使われ方：集計期間の切り替えは表の下（「集計期間を変える」）。行は「中身を見る」と、未使用があるときだけ「…」（片づける）。最終利用は「9/30 19:00」の短い形
- 保存した分析：履歴は右の箱の表。「結果を見る」で、その時点の結果を窓で開く。「内容を変える」は元の分析（クロス分析・ファネル）を開く（条件は集計し直してから保存する）。履歴の表の3列目は集計状態（絵は定義版。写しごとの版番号を口が返さないため）
- 定期レポート：動いている行は「止める・しまう・…」、止めている行は「また送る・しまう・…」（内容を変えるは「…」の中）（動いている行の「また送る」は口が無いので置かない）
- ファネル：選んだ段の既定は、いちばん落ちる段の手前（そこで止まった人）。「対象者を開く」「この対象者へ配信を作成」は押した時に24時間の対象者を作り、その先へ進む。期間・再集計・定義の編集・停止・保管は「定義の操作と集計の詳細」、結果の保存は「この結果を保存する」、停止中のファネルは下の一覧
- クロス分析：開いただけでは集計しない（重い集計を待ち順に積まない）。「集計する」で受け付け、結果が出たら表を出す。よこの軸は流入経路・タグ・スコア帯・成果地点・予約状態・購入状態・友だち情報から選べる（たてとよこに同じ軸は不可）。期間は選ぶ欄（この7日・30日・90日）。選んだマスの既定はいちばん多い組み合わせ。列の合計は見出しの title と CSV（表には行の合計だけ）
- Search Console：見かたの注意は下の箱に常に出す（今は畳んでいた）。集計期間・最終更新は注の title。表は上位をそのまま（キーワード・ページ・デバイス別の3つを横に並べる）
