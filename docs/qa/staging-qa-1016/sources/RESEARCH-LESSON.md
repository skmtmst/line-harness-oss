# 教室・レッスン（ヨガ・フィットネス・習い事・塾・スクール）のダッシュボードとアナリティクス調査（2026-10-15）

- 調べ方：公開ページ（製品紹介・ヘルプ・公式ブログ・プレスリリース・レビュー・比較記事）だけ。ログイン・申し込み・送信・フォーム入力はしていない。
- 前回（`../style-dashboards/RESEARCH-1014.md` の「4. 教室・レッスン」）で確かめたダッシュボードの物は繰り返さず、**足りなかった物だけ**を A に足した。
- 調べた 11 社：hacomono、STORES 予約（旧 Coubic）、RESERVA、Mindbody、ABC Glofox、Wodify、Pike13、TeamUp、ClassPass（事業者向け）、Zen Planner、Jackrabbit Class。
- 「何社」＝**公開ページで確かめられた社数 / 調べた社数（11）**。少ない数でも「無い」とは限らない（書いていないだけのことが多い）。
- **限界**：RESERVA は「顧客分析」「ダッシュボード」という名前しか確かめられず中身は未確認。Zen Planner は公式の報告の一覧が見つからず、利用者の声だけ。hacomono のヘルプは 403 で開けず、報道記事で補った。塾・スクール専用の製品（Jackrabbit 以外）は今回は調べていない。一部の出典は検索結果の要約から読んだ（出典欄に書いた）。
- おすすめ度：◎＝最初の版に入れる／○＝次に入れる／△＝余裕があれば・合わない

---

## A. ダッシュボード（前回に足す物）

| 区分 | 要素 | 何社 | musubo | 出典 |
|---|---|---|---|---|
| 横カード | 出欠を付け忘れたクラス（直近 7 日） | 1/11（Pike13） | ◎ | L7 |
| 横カード | 退会しそうな会員（予測） | 5/11（Glofox〔16 以上の材料：在籍期間・平均支払い・最後の来館からの日数など〕・Mindbody〔Clients at Risk〕・Wodify〔Retain〕・TeamUp〔離れかけの印〕・hacomono〔前回〕） | ◎ | L3, L1, L9, L10, L4 |
| 横カード | 回数券・会員の期限切れが近い人（28 日以内） | 2/11（Pike13・Glofox〔前回〕） | ◎ | L7 |
| 横カード | 支払いの済んでいない受講（直近 7 日） | 2/11（Pike13・Glofox〔支払い失敗・未収〕） | △（musubo は決済を持たない） | L7, L2 |
| 横カード | 会員の増減（入会 − 退会） | 1/11（Glofox〔net member movement〕） | ◎ | L2 |
| 横カード | 週ごとの要約（よく出た所・気をつける所） | 1/11（Mindbody〔AI の週次要約、メールでも届く〕） | ○ | L1 |
| 工夫 | 板を押すと中の一覧（人の名前）まで開く | 2/11（Pike13・hacomono〔前回〕） | ◎ | L7, L4 |
| 工夫 | 直接の予約と外部サイト経由を分けて埋まり具合を見る | 1/11（ClassPass〔クラス種別×時間〕） | ◎（LINE と それ以外 に読み替え） | L11 |
| 工夫 | 数字がいつ更新されたか（数分〜24 時間）を書く | 1/11（Mindbody） | ◎ | L1 |

**推論：** 教室はサロンより「人の出入り（入会・退会）」が主役。前回の「売上・会員数・継続率・新規入会」に、**会員の増減** と **退会しそうな人** を足し、どちらも押したら名前の一覧へ、さらに「LINE を送る」へ進める形がよい。根拠：退会の予測は 11 社中 5 社と多く、Pike13・hacomono は「押すと一覧へ」を売りにしている。

---

## B. アナリティクス（分析・レポート）

### B-1. レポートの種類（タブ）

| 区分 | 要素 | 何社 | musubo | 出典 |
|---|---|---|---|---|
| タブ | 出席（来館・初回・予約・キャンセル・無断欠席） | 6/11（Mindbody・Glofox・TeamUp・Pike13〔受講の報告〕・Wodify・Jackrabbit） | ◎ | L1, L2, L10, L7, L9, L8 |
| タブ | クラスの埋まり（定員に対して） | 5/11（Mindbody・Glofox〔クラスごとの予約・出席・定員〕・ClassPass・STORES 予約〔稼働率〕・Wodify〔人気クラス〕） | ◎ | L1, L2, L11, L6, L9 |
| タブ | 会員（入会・退会・増減・期限切れ・退会理由） | 5/11（Glofox・hacomono・Mindbody・TeamUp・Jackrabbit〔やめた履歴〕） | ◎ | L2, L3, L4, L1, L10, L8 |
| タブ | 体験・見込み客から入会 | 3/11（Glofox〔lead conversion・流入元〕・TeamUp〔申し込み・初回〕・hacomono〔予定〕） | ◎ | L2, L10, L4 |
| タブ | 講師・スタッフ | 4/11（Glofox〔講師の実績・クラスの成績〕・Jackrabbit〔講師ごとの継続とやめた人〕・STORES 予約・Mindbody〔スタッフで絞る〕） | ◎ | L2, L8, L6, L1 |
| タブ | 売上（会費・回数券・月謝） | 5/11（Mindbody・Glofox・hacomono・STORES 予約〔回数券/月謝〕・Pike13） | ○（musubo は決済を持たない。契約の数で代える） | L1, L2, L4, L6, L7 |
| タブ | 属性（年齢・性別・入会経路） | 2/11（hacomono・STORES 予約） | ○ | L4, L6 |
| タブ | 給与 | 2/11（Mindbody・Glofox） | △ | L1, L2 |

### B-2. 主な数字と定義

| 指標 | 各社の定義・書き方 | 何社 | musubo | 出典 |
|---|---|---|---|---|
| 定員充足率（埋まり具合） | Mindbody：定員をどれだけ使ったか（class fill rate）。ピークと閑散で比べる／ClassPass：クラス種別×時間で、直接・外部・両方に分けて／STORES 予約：予約ページごとの稼働率 | 3/11 | ◎ | L1, L11, L6 |
| 出席率（予約に対する出席） | Mindbody：予約と実際の出席を比べる。来館は**チェックインした時**に数える（予約した時ではない） | 1/11 | ◎ | L1 |
| 無断欠席・直前キャンセル | Mindbody・Glofox・TeamUp が別々に数える | 3/11 | ◎ | L1, L2, L10 |
| 継続率・退会率（チャーン） | hacomono：プランの継続率を時系列で／Glofox：attrition（退会）の割合と会員の増減／Mindbody：「新規の伸びと継続」だけで、退会率の言葉は無い／Wodify：プラン別の退会 | 4/11 | ◎ | L4, L2, L1, L9 |
| 体験→入会の転換率 | Glofox：見込み客の転換率・流入元ごと／（参考）Gleantap：入会した体験者 ÷ 始めた体験者 ×100、目安 30〜50%／（参考）Gymdesk：武道の 17.5 万件で 73%、半分は 10 日以内に入会 | 1/11（＋参考 2） | ◎ | L2, L17 |
| 出席の頻度 | Wodify：会員は平均で月 8 回、6 割は月 10 回以下 | 1/11 | ○ | L9 |
| 退会理由 | Glofox：退会理由を会員ごとに、傾向も | 1/11 | ◎ | L3 |
| 退会した人の一覧 | Glofox：期限切れ・退会した会員を書き出して呼び戻しに使う／Jackrabbit：前の期にいて今の期にいない人 | 2/11 | ◎ | L3, L8 |
| 平均単価 | Mindbody：1 来館・1 販売あたり | 1/11 | △ | L1 |
| LTV（生涯の価値） | Wodify：AI に「LTV」「退会を 20% 減らしたら来月の売上は」と聞ける | 1/11 | △（決済が無いので出しにくい） | L9 |
| キャンセル待ち | Jackrabbit：待っている人が多い＝クラスを増やす合図 | 1/11 | ◎ | L8 |

### B-3. 切り口・比べ方・書き出し

| 区分 | 要素 | 何社 | musubo | 出典 |
|---|---|---|---|---|
| 切り口 | 期間 | 4/11（Mindbody・Jackrabbit・Pike13〔12 か月の推移〕・hacomono） | ◎ | L1, L8, L7, L4 |
| 切り口 | クラス（種別・時間帯） | 4/11（ClassPass・Glofox・Wodify・Mindbody〔ピーク/閑散〕） | ◎ | L11, L2, L9, L1 |
| 切り口 | 講師 | 3/11（Jackrabbit・Glofox・Mindbody） | ◎ | L8, L2, L1 |
| 切り口 | 会員種別・プラン | 2/11（Wodify〔プラン別の退会〕・hacomono〔プランの継続率〕） | ◎ | L9, L4 |
| 切り口 | 入会経路・流入元 | 2/11（hacomono・Glofox） | ◎ | L4, L2 |
| 切り口 | 店舗 | 2/11（Mindbody・Glofox） | ○ | L1, L2 |
| 比べ方 | 期どうし（学期・シーズン） | 1/11（Jackrabbit：期で比べる。日付の範囲だけでは「戻らなかった人」を出せない） | ○（習い事・塾向け） | L8 |
| 比べ方 | 前の期間と比べる | 0/11 確かめられず。Mindbody の利用者が「すべての報告に前期比を」と求めている | ◎ | L14 |
| 比べ方 | 同業平均 | 1/11（Mindbody〔11 万店の匿名データ〕） | △ | L1 |
| 書き出し | CSV・PDF・Excel | 2/11（Mindbody〔CSV が主〕・Glofox〔行ごとの書き出し〕） | ◎（CSV） | L1, L2 |
| 書き出し | 定期メール | 1/11（Mindbody の週次要約だけ） | ○ | L1 |
| 書き出し | BI・API | 3/11（Mindbody・Glofox・RESERVA） | △ | L1, L2, L13 |

---

## C. 使いやすさの推論

| 区分 | 声 | 出典 | 推論：何があれば使いやすいか |
|---|---|---|---|
| 困りごと | Mindbody：「決まった報告しか無い」「報告を信用できず毎回確かめる」「分かりにくい」「すべてに前期比を」「機能が多すぎて重い」 | L14 | 推論：**数は少なく、定義を「？」で出し、全部の数字に前期比**。信用されるには、数字を押すと元の人の一覧が出て自分で数え直せること（Pike13・hacomono の形）。 |
| 困りごと | Mindbody のヘルプ：「ダッシュボードと詳しい報告の数字は、絞り込みや更新の時間で合わないことがある」 | L1 | 推論：**更新時刻を書く**、ダッシュボードと分析で**同じ計算を使う**。 |
| 困りごと | Glofox：報告の不具合・制限、書き出しがほぼできない（競合ブログの引用なので割り引く） | L15 | 推論：CSV の書き出しは最初から入れる。 |
| 困りごと | hacomono：基本の実績分析はあるが、もっと深い分析を（レビュー 1 件・本文が途中まで） | L16 | 推論：深さより「どの会員に何をするか」まで行ける形で補う。 |
| 評価 | TeamUp の利用者：週ごとの出席の報告と「離れかけ」の手順で、来なくなった人に声をかける／出席の少ない人を引き出せて継続に役立つ | L10 | 推論：**「最近来ていない人」一覧**（例：14 日来ていない会員）を固定の入口にする。 |
| 評価 | Jackrabbit のブログ：新しい期の 7〜10 日前に、まだ申し込んでいない家族の一覧を出して先生が声をかける | L8 | 推論：習い事・塾は**「次の期の継続申し込みがまだの人」**が最も効く一覧。 |
| 評価 | Mindbody：ヘルプの吹き出し（マウスを乗せると説明）でよくなった | L14 | 推論：「？」の説明は効く（サロンと同じ結論）。 |

---

## D. LINE との組み合わせ

| 区分 | 要素 | 何社 / 根拠 | musubo | 出典 |
|---|---|---|---|---|
| 配信 | 来館・予約・購買のデータで絞って LINE を送る（例：来る回数が落ちた会員に再来を促す）。即時・予約・繰り返し | hacomono（有料の追加、1 店舗 月 12,000 円〔税抜〕） | ◎（musubo は標準で持てる） | L5 |
| 呼び戻し | 退会・期限切れの人を書き出して呼び戻す | Glofox | ◎（書き出さずに LINE へ直接） | L3 |
| 休講・キャンセル | LINE で休講の行き違いを防ぎ、キャンセルが出たら参加者を募る | STUDIO TRIVE（LINE 公式の事例、数値なし） | ◎ | L18 |
| 体験→入会 | 体験のあとの追いかけ | **LINE での数値は未確認**。（参考）Gymdesk：ソフトが追いかけると 85%、店主が手で追うと 71% が入会（武道） | ◎ | L17 |
| 経路 | 直接と外部の予約を分けて見る | ClassPass（直接・ClassPass・両方） | ◎（LINE・それ以外） | L11 |
| リマインド | 無断欠席が減る量 | 教室での数値は**未確認**（サロンの調べと同じく医療の研究だけ。`RESEARCH-SALON.md` の S17） | ◎（前後で測る） | — |

**推論：** 教室で musubo が他社より出せるのは、①体験の申し込み（LINE）→体験に来た→入会、の段ごとの割合、②「最近来ていない人」に送った LINE のあとに来館した割合、③休講・空きの知らせからの予約数、の 3 つ。根拠：hacomono は LINE 配信を有料の追加で出しており、Glofox は書き出して別の道具で呼び戻す形。musubo は数字と配信が同じ場所にあるので、押してすぐ送れて、送った結果もそのまま数えられる。

---

## まとめ 1：musubo のダッシュボードに入れる物（◎）

前回の ◎（売上〔契約〕・会員数・継続率・新規入会・クラス予定に予約数とキャンセル待ちを重ねる・空き ○△×・予約の少ないクラス・期限が近い会員・退会リスク・会員をクラスに予約・グラフを押すと会員一覧）に、次を足す。

1. **会員の増減**（今月の入会 − 退会）
2. **最近来ていない人**（例：14 日）と **退会しそうな人** の人数 → 一覧 →「LINE を送る」
3. **出欠を付け忘れたクラス**（直近 7 日）
4. **体験の流れ**（体験の申し込み → 来た → 入会、今月の数）
5. **今週のクラスの埋まり**（クラス種別×曜日・時間、LINE からの予約とそれ以外を分けて）
6. **データの更新時刻**

## まとめ 2：アナリティクスのタブ案（教室）

全部のタブに共通：期間（週・月・任意、前期比・前年比の切り替え）、クラス種別、講師、会員種別（プラン）の絞り込み。CSV 書き出し。各数字に「？」で定義。数字を押すと人の一覧へ。

| タブ名 | 中の数字 | グラフ | 切り口 |
|---|---|---|---|
| 概要 | 在籍会員数・入会・退会・増減・継続率・出席数・定員充足率 | 月ごとの入会と退会の棒（上下）＋在籍の線 | 期間 |
| 出席とクラス | 出席数・出席率（予約に対する）・無断欠席・直前キャンセル・定員充足率・キャンセル待ちの人数 | 曜日×時間の表（埋まりの濃さ）、クラス別の横棒 | 期間・クラス種別・講師・予約経路（LINE/それ以外） |
| 会員（継続と退会） | 継続率（1・3・6 か月）・退会率・退会理由・最近来ていない人・期限が近い人・月の平均出席回数 | 入会した月ごとの継続の表（何か月残ったか）、退会理由の横棒 | プラン・入会経路・年齢/性別 |
| 体験と入会 | 体験の申し込み・体験に来た割合・入会の割合・入会までの日数 | 段の図（申し込み → 来た → 入会） | 期間・経路（LINE の配信・リッチメニュー・紹介など）・クラス種別 |
| 講師 | 担当クラス数・出席数・定員充足率・担当した体験の入会率・担当会員の継続率 | 講師を行にした表 | 期間・クラス種別 |
| LINE の効果 | 配信ごとの「7 日以内の予約・来館」、呼び戻しを送った人の再来館率、リマインドあり/なしの無断欠席率、休講・空きの知らせからの予約数 | 配信の一覧表、週ごとの LINE 経由予約の棒 | 期間・配信・会員種別 |
| 期ごと（習い事・塾向け、○） | 前の期にいて今の期に申し込んでいない人・期ごとの在籍数 | 期どうしの表 | 期・クラス・講師 |

---

## 出典

- L1 Mindbody 報告と分析（出席・埋まり・新規と継続・平均単価・絞り込み・CSV/PDF/Excel・同業比較・週次の AI 要約・更新の時間）：https://www.mindbodyonline.com/business/reporting
- L2 ABC Glofox 報告（売上・会員〔転換・新規・増減・期限・退会・予測〕・講師・無断欠席・流入元・行ごとの書き出し）：https://www.glofox.com/features/reporting/
- L3 Glofox ブログ（Members at Risk の材料・退会した人の書き出し・退会理由）：https://www.glofox.com/blog/data-tracking-software/ ／ 2024 年の新機能：https://glofox.com/blog/the-abc-glofox-2024-innovations-report （検索結果の要約から読んだ）
- L4 hacomono insight（売上・契約者数・継続率・年齢/性別/入会経路・押すと会員へ・体験の分析は予定）：https://www.commercepick.com/archives/73435 ／ ヘルプ（403 で開けず）：https://help.hacomono.jp/hc/ja/articles/5018595260702
- L5 hacomono の LINE 配信（絞り込み・即時/予約/繰り返し・月 12,000 円）：https://prtimes.jp/main/html/rd/p/000000191.000021418.html （検索結果の要約から読んだ）
- L6 STORES 予約 分析機能（予約ページごとの予約数と稼働率・性別年代・回数券/月謝・スタッフ）：https://ecnomikata.com/ecnews/37302/
- L7 Pike13 Insights（押すと一覧・28 日以内の期限・出欠の付け忘れ・未払い）：https://help.pike13.com/hc/en-us/articles/360029874991-Pike13-Insights ／ 12 か月の推移：https://learn.pike13.com/blog/new-premium-reporting-dashboard-shows-impact-from-covid-19-closures （検索結果の要約から読んだ）
- L8 Jackrabbit（受講の詳しい報告・講師ごとの継続とやめた理由・期の比較・キャンセル待ち）：https://help.jackrabbitclass.com/help/enrollment-detail-report ／ https://www.jackrabbitclass.com/blog/the-eleventh-day-of-jackrabbit-christmas-are-you-using-the-drop-history-report ／ https://help.jackrabbitclass.com/help/rc-guide-year-end-reporting （検索結果の要約から読んだ）
- L9 Wodify（自分で作る報告・人気クラス・退会の予測・月 8 回・AI に LTV を聞く）：https://wodify.com/know-your-numbers ／ https://www.wodify.com/blog/how-custom-reports-propel-your-gyms-business-decisions ／ https://www.wodify.com/blog/behind-the-numbers-why-11-is-the-magic-number-for-attendance-frequency ／ https://help.wodify.com/hc/en-us/articles/41441026643991-Ask-Wodify-AI （検索結果の要約から読んだ）
- L10 TeamUp（転換・継続・離れかけ・利用者の声）：https://athletechnews.com/what-34-million-bookings-reveal-about-retention-in-fitness/ ／ https://schedule.studio.onepeloton.com/resources/testimonial-video-raise-the-bar-fitness ／ https://www.g2.com/survey_responses/teamup-review-4437934 （報告の機能ページは 404、検索結果の要約から読んだ）
- L11 ClassPass Class Insights（クラス種別×時間・直接/ClassPass で分ける）：https://classpass.com/partners/blog/introducing-class-insights ／ https://www.mindbodyonline.com/business/education/blog/how-classpass-works-for-businesses
- L12 Zen Planner（会員の分析、報告の一覧は未確認）：https://daxko.com/news/introducing-the-new-zen-planner-software-to-transform-member-management-and-engagement-in-boutique-fitness-businesses ／ https://capterra.com/p/134351/Zen-Planner/reviews/?page=3
- L13 RESERVA（顧客分析・ダッシュボードの名前・BI 用の API）：https://saas.imitsu.jp/cate-reservation/service/2735/integration ／ https://prtimes.jp/main/html/rd/p/000000324.000049555.html
- L14 Mindbody のレビュー（決まった報告だけ・信用できない・前期比を・ヘルプの吹き出し）：https://www.capterra.com/p/40229/mindbody/reviews/
- L15 Glofox のレビュー（報告の制限・書き出し。競合のブログなので割り引く）：https://vibefam.com/what-glofox-users-actually-say-on-capterra-2026/ ／ https://g2.com/products/abc-glofox/reviews
- L16 hacomono のレビュー（ITreview 1 件）：https://www.itreview.jp/products/hacomono/reviews
- L17 体験→入会の定義と目安：https://gleantap.com/glossary/trial-conversion-rate/ ／ https://gymdesk.com/gym-benchmark-report
- L18 STUDIO TRIVE（LINE 公式の事例）：https://www.lycbiz.com/jp/case-study/line-official-account/studiotrive/
