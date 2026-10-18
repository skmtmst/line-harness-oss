# サロン（美容室・ネイル・エステ・整体）のダッシュボードとアナリティクス調査（2026-10-15）

- 調べ方：公開ページ（製品紹介・ヘルプ・公式ブログ・プレスリリース・レビュー・比較記事）だけ。ログイン・申し込み・送信・フォーム入力はしていない。
- 前回（`../style-dashboards/RESEARCH-1014.md` の「1. サロン」）で確かめたダッシュボードの物は繰り返さず、**足りなかった物だけ**を A に足した。
- 調べた 14 社：SALON BOARD、リザービア、STORES 予約、minimo、Square 予約、Fresha、Vagaro、Boulevard、Phorest、Zenoti、Mangomint、Timely、LINE ビューティープラス（LINE 公式アカウントの美容向け）、（参考）Slick・SalonIQ・Shortcuts は定義の照合にだけ使い、社数には入れない。
- 「何社」＝**公開ページで確かめられた社数 / 調べた社数（14）**。0 や少ない数でも「無い」とは限らない（書いていないだけのことが多い）。
- **限界**：日本の製品（SALON BOARD・リザービア・minimo）は分析画面の中身をほぼ公開していない。リザービア・minimo は分析の中身を 1 つも確かめられなかった。Boulevard・Phorest は自社ブログと第三者の要約しか読めず、ヘルプの正確な定義は未確認。一部の出典は検索結果の要約から読んだ（その旨を出典欄に書いた）。
- おすすめ度：◎＝最初の版に入れる／○＝次に入れる／△＝余裕があれば・合わない

---

## A. ダッシュボード（前回に足す物）

| 区分 | 要素 | 何社 | musubo | 出典 |
|---|---|---|---|---|
| 上の数 | 平均単価（客単価） | 3/14（LINE ビューティープラス・Mangomint・Zenoti） | ◎ | S8, S3, S6 |
| 上の数 | 来店時の次回予約率（帰る前に次を入れた割合） | 4/14（LINE ビューティープラス〔施術後 3 時間以内〕・Square〔24 時間以内〕・Mangomint〔pre-bookings〕・Zenoti） | ◎ | S8, S4, S3, S6 |
| 上の数 | 来店区分の内訳（新規・リピート・しばらくぶり） | 3/14（LINE ビューティープラス・Fresha・SALON BOARD） | ◎ | S8, S1, S7 |
| 横カード | 今後 7 日の売上見込み | 2/14（Fresha・Mangomint〔future forecasts〕） | ○ | S1, S3 |
| 横カード | 来店周期を外れたお客さま（失客しかけ）の人数と、そのまま呼び戻し配信 | 2/14（Zenoti〔lapsed-client → 自動の呼び戻し〕・LINE ビューティープラス〔最終来店から一定期間で自動配信〕） | ◎ | S6, S19 |
| 横カード | 予約経路の割合（LINE・ホットペッパー・電話・店頭…） | 1/14（LINE ビューティープラス） | ◎ | S8 |
| 工夫 | 担当者が自分の数字だけをスマホで見る | 1/14（Zenoti） | ○ | S6 |
| 工夫 | 同業の平均と比べる（ベンチマーク） | 1/14（Zenoti） | △ | S6 |

**推論：** 前回の「今日の予約・売上・新規/再来」に、**次回予約率** と **失客しかけの人数** を足すのが効く。どちらも「次にやること」（声かけ・配信）に直結し、LINE を持つ musubo は押したらそのまま配信へ進める。根拠：S6 の Zenoti は「数字を出すだけでなく呼び戻しを自動で始める」と書き、S19 の LINE 公式資料も最終来店日からの自動配信を売りにしている。

---

## B. アナリティクス（分析・レポート）

### B-1. レポートの種類（タブ）

| 区分 | 要素 | 何社 | musubo | 出典 |
|---|---|---|---|---|
| タブ | 売上（期間・メニュー・スタッフ別） | 6/14（Fresha・Mangomint・Square・SALON BOARD・Zenoti・Boulevard） | △（musubo は会計を持たない。予約から出す「見込み売上」なら ◎） | S2, S3, S4, S7, S6, S10 |
| タブ | スタッフの実績（予約数・稼働率・指名率・再来率） | 6/14（Fresha・Mangomint・Square・SALON BOARD・Zenoti・Phorest） | ◎ | S1, S3b, S4, S7, S6, S11 |
| タブ | お客さま（新規/再来・リピート・来店周期・優良客） | 6/14（Fresha・Mangomint・Timely・SALON BOARD・STORES 予約〔性別・年代〕・LINE ビューティープラス） | ◎ | S2, S3, S5, S7, S9, S8 |
| タブ | 予約経路 | 1/14（LINE ビューティープラス） | ◎ | S8 |
| タブ | キャンセル・無断キャンセル | 2/14（Mangomint〔appointment cancellations〕・Zenoti） | ◎ | S3, S6 |
| タブ | 給与・歩合・チップ | 3/14（Fresha・Mangomint・Vagaro〔前回 S3〕） | △ | S2, S3 |
| タブ | 在庫・物販 | 2/14（Fresha・Mangomint） | △ | S2, S3 |

### B-2. 主な数字と定義（各社の定義をそのまま並べる）

| 指標 | 各社の定義 | 何社 | musubo | 出典 |
|---|---|---|---|---|
| 再来率（リピート率） | SALON BOARD：前回来店から 6 か月以内に再来したらリピート。区分は新規・再来・固定・リターン、サロン単位とスタッフ単位で出せる／Square：期間の前 1 年に来店があった客 ÷ 期間内の客／Mangomint：初回から 90 日・180 日以内に戻った客の割合（スタッフ別）／Timely：**未来の予約がある**客を「残っている」と数える。1 人は 1 回だけ数える／LINE ビューティープラス：前回来店が 180 日以内の予約を「リピート来店」 | 5/14 | ◎ | S7, S4, S3, S5, S8 |
| 次回予約率（pre-book・rebook） | LINE ビューティープラス：施術後 3 時間以内に次の予約が入った割合／Square：施術の終わりから 24 時間以内に次の予約を入れた来店 ÷ 全来店／Zenoti：会計の時に次を入れた客の割合 | 3/14（＋Mangomint は名前だけ） | ◎ | S8, S4, S6, S3 |
| 稼働率 | Square：予約された時間 ÷ 働ける時間／Mangomint：同じ考え方、働ける時間の外で入れた予約も数えるので 100% を超えることがある／Zenoti：施術した時間 ÷ 働ける時間（業界の中央値 56%） | 4/14（＋Fresha は occupancy と書くだけ） | ◎ | S4, S3b, S6, S1 |
| 指名率 | Mangomint：スタッフが指名された回数と、そのスタッフの全予約に対する割合 | 1/14 | ◎ | S3b |
| 平均単価 | LINE ビューティープラス：見込み売上 ÷ 来店数／Zenoti：1 来店あたりの支払い | 2/14 | ◎ | S8, S6 |
| 来店周期 | SALON BOARD：分析で「来店サイクル」を見られる／Zenoti：客がどれくらいの間隔で戻るか（理容は 2〜5 週） | 2/14 | ◎ | S7, S6 |
| 新規の 2 回目来店率 | Zenoti：新規のうち 2 回目に来た割合／（参考）SalonIQ：新規を 12 週で追う | 1/14 | ◎ | S6, S15 |
| 失客率 | SALON BOARD：月ごとの来店区分と失客率（2016 年の発表。判定の期間は未確認） | 1/14 | ○ | S7 |
| 無断キャンセル率・キャンセル率 | Zenoti：キャンセル率の業界の目安 4%（理容） | 1/14 | ◎ | S6 |
| カルテ共有率 | LINE ビューティープラス：来店予約のうちカルテを共有した割合 | 1/14 | △ | S8 |

**大事な気づき：** 同じ「再来率」でも、期間（90 日・180 日・6 か月・1 年）と数え方（人か予約か、同じ担当に限るか）が会社ごとにバラバラ。Timely は「定義が違うので別の画面の数字と合わない」とヘルプで注意している（S5）。SALON BOARD 系も「別の担当での来店を再来に含むか」の設定がある（S22）。

### B-3. 切り口・比べ方・書き出し

| 区分 | 要素 | 何社 | musubo | 出典 |
|---|---|---|---|---|
| 切り口 | 期間 | 6/14（Square〔最大 1 年〕・Fresha・Mangomint・LINE ビューティープラス〔過去 7 日など〕・SALON BOARD・Timely） | ◎ | S4, S2, S3, S8, S7, S5 |
| 切り口 | スタッフ | 7/14（Square・Mangomint・Timely・SALON BOARD・LINE ビューティープラス・Fresha・STORES 予約） | ◎ | S4, S3, S5, S7, S8, S1, S9 |
| 切り口 | メニュー（サービス） | 3/14（Square・Timely・Zenoti〔service mix〕） | ◎ | S4, S5, S6 |
| 切り口 | 店舗 | 3/14（Square・Phorest・Boulevard） | ○ | S4, S11, S10 |
| 切り口 | 新規 / 再来 | 4/14（Fresha・Timely・LINE ビューティープラス・SALON BOARD） | ◎ | S1, S5, S8, S7 |
| 切り口 | 予約経路 | 2/14（LINE ビューティープラス・Fresha〔新規の流入元〕） | ◎ | S8, S1 |
| 比べ方 | 前年比 | 2/14（SALON BOARD〔店舗全体の昨年対比〕・Boulevard〔年の比較を勧める〕） | ◎ | S7, S10 |
| 比べ方 | 前週・前期比 | 1/14（前回調べ：Square の先週同曜日比） | ◎ | 前回 S4 |
| 比べ方 | 同業平均 | 1/14（Zenoti） | △ | S6 |
| 書き出し | PDF・CSV・Excel | 1/14（Fresha） | ○（CSV だけ ◎） | S2 |
| 書き出し | 定期メール | 0/14（確かめられず） | △ | 未確認 |
| その他 | 1 日 1 回更新と明記 | 1/14（LINE ビューティープラス） | ◎（更新時刻を画面に書く） | S8 |

---

## C. 使いやすさの推論

| 区分 | 声 | 出典 | 推論：何があれば使いやすいか |
|---|---|---|---|
| 困りごと | Phorest の利用者：「レポートが分かりにくい。特に再来の報告」 | S12 | 推論：**指標の横に「？」で定義（期間・数え方）を必ず出す**。B-2 のとおり定義が会社ごとに違い、利用者は何を数えたか分からない。 |
| 困りごと | Fresha の利用者：「2 つのレポートからデータを取り出さないといけない」 | S13 | 推論：再来率・次回予約率・稼働率を**スタッフごとに 1 つの表**に並べる（Square の「チームの実績」が 3 つを 1 画面に置いているのと同じ形、S4）。 |
| 困りごと | Vagaro の利用者：「レポートをもっと好みに合わせたい」 | S14 | 推論：自由な作り込みより、**期間・スタッフ・メニュー・新規/再来の 4 つの絞り込み**で足りる形にする。作り込みは musubo の運用者には重い。 |
| 困りごと | Timely のヘルプ：「この報告と別の報告は数え方が違うので数字が合わない」 | S5 | 推論：**同じ言葉は 1 つの定義だけ**にし、画面ごとに数え方を変えない。 |
| 評価 | Zenoti の利用者：「事業の数字を一目で見渡せる」 | S6 | 推論：上の数は 4〜6 個。Boulevard も「数を絞った KPI」を勧める（S10）。 |
| 評価 | Slick（参考）：週ごとの次回予約率のグラフで「低い日」を見つけて指導に使う | S21 | 推論：次回予約率は**日・週ごとの棒**で、低い日が目で分かる形がよい。 |
| 評価 | Zenoti：失客しかけを見つけたら呼び戻しの配信を自動で始める | S6 | 推論：数字の下に**「この人たちに LINE を送る」**ボタン。数字だけの画面は行動につながらない。 |

---

## D. LINE との組み合わせ

| 区分 | 要素 | 何社 / 根拠 | musubo | 出典 |
|---|---|---|---|---|
| 数える物 | LINE からの予約数と割合（リッチメニュー・配信・ホームページ・Instagram・Google の内訳まで） | LINE ビューティープラスが「予約経路分析」で経路別の予約数・割合・見込み売上・来店数を出す | ◎ | S8 |
| 数える物 | 配信のあとの予約 | LINE の美容事例：配信のあと 3〜4 日は予約が入りやすい（店の感想、数値の検証なし） | ◎（「配信から 7 日以内の予約」で数える） | S19 |
| 数える物 | 問い合わせの LINE 比率 | LINE の事例（整体）：問い合わせの 8 割が LINE（店の感想） | ○ | S19 |
| リマインド | 予約忘れの多さ | 1,000 人の調査で 18.8% が予約を忘れた経験あり、美容室と歯科で多い（ツールを売る会社の調査） | ◎ | S16 |
| リマインド | 無断キャンセルが減る量 | **サロンの数字は確かめられず（未確認）**。医療の研究では SMS のリマインドで無断の割合が下がった（小さな診療所の試行で 38.6%→25.5%、ほかに 11.4%→7.4%）。「30% 減」などの数字はツール会社の記事で根拠が無い | ◎（効果は自分の店の前後で測る） | S17 |
| 呼び戻し | 最終来店から一定期間で自動配信・空き枠を知らせる | LINE ビューティープラスの資料 | ◎ | S19 |

**推論：** musubo の強みは「どの LINE の動きから予約が来たか」を自分で数えられること。①予約経路（LINE の中の内訳）、②リマインドを送った予約と送らなかった予約の無断キャンセル率の比べ、③呼び戻し配信を送った人の 30/60/90 日以内の再来率、の 3 つは他社が数えにくく、musubo なら出せる。根拠：S8 は経路ごとに予約フォームを分けないと数えられないと注意しており、musubo は予約も配信も自分で持っているので分けなくても数えられる。

---

## まとめ 1：musubo のダッシュボードに入れる物（◎）

前回の ◎（今日の予約・売上〔見込み〕・新規/再来・スタッフ×時間の台帳・承認待ち・キャンセル待ちの動き・空き枠を押して予約・夜の間の予約まとめ）に、次を足す。

1. **見込み売上と平均単価**（予約のメニュー料金から。会計は持たないので「見込み」と書く）
2. **次回予約率**（帰る前に次を入れた割合。定義は「施術の終わりから 24 時間以内」を推す：Square と同じで分かりやすい）
3. **来店区分の内訳**（新規・リピート・しばらくぶり）
4. **失客しかけの人数**（いつもの周期を過ぎた人）＋「LINE を送る」ボタン
5. **予約経路の割合**（LINE が何割か。LINE の中はリッチメニュー・配信・その他）
6. **データの更新時刻**（例：「今日 6:00 更新」）

## まとめ 2：アナリティクスのタブ案（サロン）

全部のタブに共通：期間（今日・7 日・30 日・月・任意、前期比・前年比の切り替え）、スタッフ、メニュー、新規/再来の絞り込み。CSV 書き出し。各数字に「？」で定義。

| タブ名 | 中の数字 | グラフ | 切り口 |
|---|---|---|---|
| 概要 | 予約数・来店数・見込み売上・平均単価・次回予約率・無断キャンセル率 | 日ごとの来店数の棒＋前期の線 | 期間 |
| お客さま | 新規の 2 回目来店率・再来率（90 日／180 日）・固定客化率（3 回目まで来た割合、S18）・来店周期の中央値・失客しかけの人数 | 新規→2 回目→3 回目の段の図、月ごとの来店区分の積み上げ棒 | 期間・スタッフ・メニュー・初回の経路 |
| スタッフ | 予約数・稼働率・指名率・次回予約率・再来率・見込み売上 | スタッフを行にした表（並べ替え）、選んだ人の週ごとの次回予約率の棒 | 期間・メニュー |
| メニュー | メニュー別の予約数・見込み売上・次の来店までの日数・そのメニューの再来率 | 横棒（多い順） | 期間・スタッフ・新規/再来 |
| 予約経路と LINE | 経路別の予約数・割合・来店数、配信ごとの「7 日以内の予約」、リマインドあり／なしの無断キャンセル率、呼び戻し配信の再来率 | 経路の積み上げ棒（週ごと）、配信の一覧表 | 期間・経路・配信 |
| キャンセル | キャンセル数・無断キャンセル数と率・直前キャンセル（24 時間以内）・キャンセル待ちから埋まった数 | 曜日×時間の表（多い所が濃い） | 期間・スタッフ・メニュー |

---

## 出典

- S1 Fresha 実績の画面（チーム・お客さま・マーケットプレイスの 3 つの要約、7 日の売上予測）：https://www.fresha.com/help-center/knowledge-base/reports/100652-access-your-performance-insights
- S2 Fresha レポートの全体（売上・チーム・お客さま・お金の 4 区分、44 種類、PDF・CSV・XLSX）：https://www.fresha.com/help-center/knowledge-base/reports/614-reporting-and-analytics-overview
- S3 Mangomint レポート（BI・再来 90/180 日・給与・売上・キャンセル）：https://www.mangomint.com/features/reporting ／ S3b 予約の BI レポート（稼働率・指名の回数と割合）：https://www.mangomint.com/learn/business-intelligence-appointments-report/ （S3b は検索結果の要約から読んだ）
- S4 Square 予約のチーム実績（再来・次回予約・稼働率の定義、絞り込み）：https://squareup.com/help/us/en/article/7904-square-appointments-reporting
- S5 Timely 再来の報告（未来の予約がある客を数える・人で数える）：https://help.gettimely.com/hc/en-gb/articles/1500002268142-Introduction-Client-retention ／ https://help.gettimely.com/article/674-how-to-measure-client-retention （ヘルプ本体は 403 で開けず、検索結果の要約から読んだ）
- S6 Zenoti サロン・理容の指標ガイド（稼働率の中央値 56%・キャンセル率 4%・失客の自動呼び戻し・担当者のスマホ）：https://www.zenoti.com/thecheckin/salon-and-barbershop-metrics-guide
- S7 SALON BOARD 機能一覧（昨年対比・リピート状況・来店サイクル・優良顧客）：https://salonboard.com/function/ （取得が時間切れ、検索結果の要約から読んだ）／ 2016 年の発表（リピート分析・失客率）：https://oldrelease.recruit-holdings.co.jp/newsroom/recruit-lifestyle/news/beauty/nw18005_20160526/ ／ 正規代理店の解説（6 か月以内・新規/再来/固定/リターン・スタッフ単位）：https://www.t-c.co.jp/hotpepper/blog/576.html
- S8 LINE ビューティープラスの分析（ダッシュボードの 8 指標と予約経路分析）：https://www.lycbiz.com/jp/manual/OfficialAccountBeauty/insight
- S9 STORES 予約 分析機能（予約数・稼働率・顧客・スタッフ・回数券/月謝）：https://ecnomikata.com/ecnews/37302/
- S10 Boulevard ブログ（数を絞った KPI・月ごと・年の比較）：https://www.joinblvd.com/blog/salon-analytics-software （検索結果の要約から読んだ）
- S11 Phorest の KPI ガイド（再来・次回予約・平均単価・物販比率・稼働率）：https://www.salontoday.com/whitepapers/5-essential-hair-beauty-industry-kpis-and-how-to-master-them ／ 機能紹介：https://us.fitgap.com/products/phorest-salon-software
- S12 Phorest のレビュー（再来の報告が分かりにくい）：https://www.getapp.com.au/reviews/101061/phorest-salon-software
- S13 Fresha のレビュー（2 つのレポートから取り出す）：https://www.capterra.com/p/142138/Shedul-com/reviews/
- S14 Vagaro のレビュー（レポートをもっと好みに）：https://www.capterra.com/p/153752/Vagaro/reviews/
- S15 （参考）SalonIQ のダッシュボード（新規を 12 週で追う）：https://faq.saloniq.com/knowledge/what-are-dashboards
- S16 予約忘れの調査（18.8%）：https://linestep.jp/2024/01/16/booking-cancel/
- S17 リマインドの研究（医療）：https://pmc.ncbi.nlm.nih.gov/articles/PMC9258479 ／ https://bmjopenquality.bmj.com/content/11/3/e001805 ／ https://scholars.fhsu.edu/theses/3312 （検索結果の要約から読んだ）
- S18 固定客化（3 回来店で固定客、3 回目までの来店率の平均 30%）：https://www.jfc.go.jp/n/service/pdf/keiei_advice_131120.pdf ／ 失客の判定は店ごとに 3 か月〜1 年：https://www.freee.co.jp/kb/kb-kaigyou/lost-customer/
- S19 LINE 公式の美容事例（配信のあと 3〜4 日・問い合わせの 8 割）：https://www.lycbiz.com/jp/service/line-official-account/case-study/beauty ／ 予約のコラム：https://www.lycbiz.com/jp/column/line-official-account/marketing/salon-reservation/
- S20 リザービア（LINE・アプリで予約、分析の中身は未確認）：https://saas.imitsu.jp/cate-reservation/service/2807
- S21 （参考）Slick 週ごとの次回予約率：https://help.getslick.com/en/articles/2703105-salon-reporting-dashboard
- S22 （参考）サロンコネクトのリピート分析（新規/再来/固定/リターン〔7 か月〕・別担当を含むかの設定）：https://faq.salonconnect.jp/?p=489
- 前回 S4 Square ホームのウィジェット（先週同曜日比）：`../style-dashboards/RESEARCH-1014.md` の出典 S4
