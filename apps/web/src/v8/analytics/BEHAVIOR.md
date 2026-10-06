# 分析（V8）の動き

入口：`app/analytics/page.tsx`（V8 のときだけ `src/v8/analytics/analytics.tsx`、それ以外は今の画面 `AnalyticsInner`）。
まだ一から作り直していない見かたは、入口が今の中身を `renderLegacy` で渡し、新しい枠の中にそのまま出す（機能を落とさない）。

| 見かた | 絵 | 新しい画面 |
|---|---|---|
| 友だちの増減 | `ws9wt`・1152 `eEhYU`・閲覧のみ `L4Uov` | `friends.tsx` |
| 配信の反応 | `yvOtn` | `reactions.tsx` |
| 経路と成果 | `PFe9c` | `routes.tsx` |
| 成果地点ごとのレポート | `AzrZq` | `conversion-report.tsx`（経路と成果の数の帯・道具の段を共有） |
| URLクリック | `iK4cQ` | `url-clicks.tsx` |
| ファネル・クロス分析・使われ方・保存した分析 | `DkRDE`・`u5CuB8`・`N8ZrUl`・`bglah` | 今の中身（`renderLegacy`） |

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
