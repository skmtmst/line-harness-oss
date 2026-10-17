# 面談・相談（人材紹介・士業・保険・内見・コンサル・カウンセリング）のダッシュボードとアナリティクス調査（2026-10-15）

- 調べ方：公開ページ（製品紹介・ヘルプ・公式ブログ・コミュニティ・比較／レビュー記事）だけ。ログイン・申し込み・送信・フォーム入力はしていない。
- 前回（`../style-dashboards/RESEARCH-1014.md` の §2）に**足す**形で書く。前回の C1〜C7 の内容は繰り返さず、出典番号は続きの **C8〜** を使う（前回分を引くときは「前回 C1」と書く）。
- 調べた 13 社：TimeRex、Spir、Calendly、jicoo、HubSpot（Meetings・セールスのレポート）、YouCanBook.me（YCBM）、Chili Piper、SavvyCal、Acuity Scheduling、HERP Hire、Zoho Bookings、Salesforce Scheduler、＋参考に Cal.com（Insights の説明がいちばん細かかったので足した。分母には入れない）。
- **限界**：日本の製品（TimeRex・Spir・jicoo・HERP）は分析画面の中身を公開ページで説明していない。TimeRex は「Google アナリティクス連携で計測する」と案内しており、単体の分析画面は確認できず。SavvyCal・Salesforce Scheduler は標準の分析画面が公開資料で確認できず（外部 BI に流す前提）。Acuity は CSV 書き出しだけ確認。
- 「何社」＝**公開ページで確かめた社数 / 調べた 12 社**。0 は「無い」ではなく「書いていない」かもしれない。
- おすすめ度：◎＝最初の版に入れる／○＝次に入れる／△＝余裕があれば・合わない

---

## A. ダッシュボード（毎日最初に見る画面）— 前回への追加分

| 区分 | 要素 | 何社 | musubo | 出典 |
|---|---|---|---|---|
| 上の数 | 今日〜今後の予約件数（未来の期間を選ぶと「予定数」に切り替わり、実施・評価の欄は隠れる） | 1/12（Cal.com は参考） | ◎ | C8 |
| 上の数 | 状態別の件数（予定・実施・無断欠席・取消）を1つのカードに | 2/12（Zoho・YCBM） | ◎ | C9, C10 |
| 上の数 | 前の期間との比較（各カードに増減） | 0/12（Cal.com のみ確認、参考） | ◎ | C8 |
| メイン | 予約の一覧を状態つきで（状態をその場で変える・絞り込み・書き出し） | 2/12（Zoho〔My Bookings〕・Calendly〔前回 C2〕） | ◎ | C9 |
| メイン | 日・週・月の切り替えカレンダー（担当カレンダーを選ぶ） | 1/12（Zoho） | ○ | C9 |
| 横カード | 予約ページごとの「見られた数→予約数→予約率」 | 1/12（HubSpot） | ◎ | C11 |
| 横カード | よく使われた予約ページ上位 5 | 1/12（YCBM） | ○ | C10 |
| 横カード | 顧客ごとの面談履歴・売上 | 1/12（Zoho〔顧客ダッシュボード〕） | ○（友だち詳細に寄せる） | C9 |
| 1クリック | 開始時刻を過ぎた予約に「無断欠席にする」（取り消しも可） | 1/12（Calendly） | ◎ | C12 |
| 1クリック | 無断欠席の人へ「もう一度予約してください」を自動で送る | 1/12（Calendly Workflows） | ◎（LINE で送る） | C12 |
| 工夫 | 予約の「入った日」と「面談の日」のどちらで数えるかを選べる | 0/12（Cal.com のみ、参考） | ○ | C8 |
| 工夫 | 取消・変更の理由を上位 10 で集計 | 0/12（Cal.com のみ、参考） | ○ | C8 |

推論：面談業種の「毎朝の画面」は、①今日の面談（時系列）②**開始を過ぎたのに結果が付いていない面談**（＝無断欠席か実施かを付ける仕事）③予約の入り（予約ページ別）の3つで足りる。根拠：Calendly が無断欠席の印を「開始後にだけ出す」作り（C12）、HubSpot は結果が付かないと「実施」に数えられない（C11）ため、結果付けが滞ると全部の率が狂う。

## B. アナリティクス（分析・レポート）

### B-1. レポートの種類（タブ）

| 区分 | 要素 | 何社 | musubo | 出典 |
|---|---|---|---|---|
| タブ | 件数の推移（作成・実施・変更・取消） | 3/12（Calendly・YCBM・Zoho） | ◎ | 前回 C1, C10, C9 |
| タブ | 状態別（予定・実施・無断欠席・取消・変更） | 3/12（Zoho・YCBM・Calendly〔CSV で〕） | ◎ | C9, C10, C12 |
| タブ | 担当者別（件数・実施数・売上、多い順／少ない順） | 3/12（Zoho・Calendly・HubSpot〔自作レポート〕） | ◎ | C9, 前回 C1, C13 |
| タブ | 面談の種類別（予約ページ・メニュー別） | 4/12（Zoho・Calendly・YCBM・HubSpot） | ◎ | C9, 前回 C1, C10, C11 |
| タブ | 人気の曜日・時間帯 | 1/12（Calendly） | ○ | 前回 C1 |
| タブ | 所要時間の分布 | 1/12（Calendly） | △ | 前回 C1 |
| タブ | 振り分けフォーム（ルーティング）→予約の転換 | 2/12（Calendly・Chili Piper） | ○ | 前回 C1, C14 |
| タブ | 売上（種類別・担当者別） | 1/12（Zoho） | △（musubo は決済を中心にしない） | C9 |
| タブ | 時間の使い方（集中時間／細切れ時間） | 1/12（jicoo 統計） | △ | C15 |
| タブ | 面談の満足度・評価 | 0/12（Cal.com のみ、参考） | ○（LINE アンケートで取れる） | C8 |
| タブ | 商談・成約へのつながり（パイプライン） | 0/12（Chili Piper は「要望中」） | ○ | C14 |

### B-2. 主な数字と定義

| 指標 | 定義（確かめた物） | 何社 | musubo | 出典 |
|---|---|---|---|---|
| 予約数 | 期間に入った予約の数。未来の期間は「確定した予約だけ（取消・却下を除く）」 | 4/12 | ◎ | 前回 C1, C10, C9, C8 |
| 実施数 | 実施済みの数。HubSpot は「結果＝実施」を記録した物だけ数える | 3/12 | ◎ | 前回 C1, C9, C11 |
| 無断欠席数／率 | 件数は Zoho・YCBM・Calendly（CSV）。**率をそのまま出す製品は確認できず**（Cal.com だけ「ホスト側・ゲスト側の無断欠席率」を分けて出す） | 3/12（件数） | ◎（率で出す） | C9, C10, C12, C8 |
| 無断欠席率の式 | 推論：無断欠席 ÷（予約 − 取消 − 日程変更）。外部 BI の解説が同じ式を勧めている（取消は分母から外す） | 0/12（公式定義なし） | ◎ | C16 |
| 取消数・日程変更数 | 期間内の取消／変更の件数。Cal.com は変更理由を「元の予約」の期間に数える | 3/12 | ◎ | 前回 C1, C10, C9 |
| 予約率（予約ページ） | 予約ページの閲覧のうち予約になった割合（HubSpot の公式定義） | 1/12 | ◎ | C11 |
| フォーム→予約の転換率 | フォーム送信のうち予約まで進んだ割合 | 1/12（Chili Piper） | ○ | C14 |
| 来た率（show rate） | 予約のうち実際に来た割合。Chili Piper が大きく売りにしている | 1/12 | ◎（実施率と同じ物として1つに） | C14 |
| リードタイム | 予約した日から面談日までの日数。公式の指標は確認できず、外部 BI が「欄として残せ」と勧める | 0/12 | ○ | C16 |
| 担当者の稼働 | Salesforce は「稼働の少ない担当に空きを多く見せる」配分に使う（レポートではない） | 0/12（レポートとしては） | ○ | C17 |

### B-3. 切り口・比べ方・書き出し

| 区分 | 要素 | 何社 | musubo | 出典 |
|---|---|---|---|---|
| 切り口 | 期間（今日・7・30・90 日・今月・今年・任意、未来も） | 3/12（Calendly〔最長1年〕・YCBM〔日・週・月・四半期〕・Zoho〔週・月〕） | ◎ | 前回 C1, C10, C9 |
| 切り口 | 担当者・チーム | 2/12（Calendly・Zoho） | ◎ | 前回 C1, C9 |
| 切り口 | 面談の種類（予約ページ） | 3/12 | ◎ | 前回 C1, C9, C10 |
| 切り口 | 会い方（オンライン／対面＝場所の種類） | 1/12（HubSpot の自作レポート「場所の種類」） | ◎（Meet／来店を分ける） | C11 |
| 切り口 | 流入元（どこから予約したか） | 1/12（HubSpot「会議の出どころ」・TimeRex〔GA 連携〕） | ◎（LINE の流入経路と結ぶ） | C13, C18 |
| 比べ方 | 前の期間との比較 | 0/12（Cal.com のみ、参考） | ◎ | C8 |
| 書き出し | CSV（予約データ／担当者データを選ぶ） | 4/12（Calendly・Acuity・Zoho・YCBM〔週・月の定期書き出し〕） | ◎ | 前回 C1, C19, C9, C10 |
| 権限 | 一般の担当者は自分の分だけ、管理者は全体 | 2/12（Calendly・Zoho〔管理者・マネージャー〕） | ◎ | 前回 C1, C9 |

## C. 使いやすさの推論（困りごと・評価）

| 困りごと／評価 | 根拠 | 推論：何があれば使いやすいか | musubo |
|---|---|---|---|
| 「予約した数」と「本当に実施した数」の差が見えず、手で数えている | HubSpot コミュニティで長年の要望。結果を付ける機能は後からベータで追加（C13） | 推論：面談の結果（実施・無断欠席・取消）を**一覧の行で1クリック**で付けられ、付け忘れを「結果待ち○件」として上に出す | ◎ |
| 無断欠席の「率」が出ず、CSV を書き出して自分で計算 | Calendly・YCBM とも件数・印はあるが率は出ない（C12, C10）。YCBM は Claude で CSV を分析する記事まで出している（C10b） | 推論：率を画面で出し、**式を「？」で明記**（取消を分母から外す） | ◎ |
| 分析が「予約率」止まりで成約まで追えない | Chili Piper 利用者が「入口の見栄えの数字」と批判、外で集計を作っている（C14） | 推論：面談後の段階（検討中・成約・見送り）を友だちのタグで付け、**予約→実施→成約**の3段の漏斗を出す | ○ |
| 分析が有料プラン限定 | Calendly 分析は Teams 以上の管理者、YCBM は Professional 以上、HubSpot の自作レポートは Pro 以上（前回 C1, C10, C11） | 推論：基本の数（予約・実施・無断欠席・取消）は全プランで見せると差別化になる | ○ |
| 予約ページの名前やブランドを変えると数字が消える | HubSpot：ブランド変更で分析がリセット（C11） | 推論：名前変更・複製でも履歴が続く作りにする（予約ページの ID で集計） | ○ |
| 日付の基準がぶれる | Cal.com は「予約の入った日」と「面談の日」を選ばせている（C8） | 推論：既定は「面談の日」、切り替えは小さく。見出しに基準を書く | ○ |
| 評価：無断欠席の印→再予約の案内が自動で出る | Calendly Workflows（C12） | 推論：musubo は LINE で即送れるので、ここが最も効く | ◎ |

## まとめ

### musubo のダッシュボードに入れる物（◎）

1. **上の数 4 つ**：今日の面談数／今週の予約数（前週比）／無断欠席率（30 日）／結果待ち（開始を過ぎて結果が付いていない件数）
2. **メイン**：今日の面談の時系列（会い方の印〔Meet／対面〕・LINE リマインド送信済みの印・Meet に入るボタン）
3. **横カード**：結果待ちの面談（行で「実施／無断欠席」を1クリック）、日程変更・取消の通知、予約ページ別の「閲覧→予約」
4. **1クリック**：無断欠席にする→LINE で再予約の案内を送る／予約 URL をコピー
5. **共通**：数を押すと絞り込み済みの一覧へ。一般の担当者は自分の分だけ。

### アナリティクスのタブ案（面談）

| タブ名 | 中の数字とグラフ | 切り口 |
|---|---|---|
| 概要 | 予約・実施・無断欠席・取消・変更の数（前期間比）＋状態別の積み上げ棒（日ごと） | 期間（過去・未来）、日付の基準（面談日／予約日） |
| 担当者 | 担当者ごとの予約数・実施数・無断欠席率、多い順／少ない順の表 | 期間、チーム、面談の種類 |
| 面談の種類 | 予約ページごとの閲覧→予約率、実施率、平均所要時間 | 期間、担当者、会い方（Meet／対面） |
| 流入と成果 | LINE の流入経路ごとの「友だち→予約→実施→成約」の漏斗 | 流入経路、タグ、期間 |
| 時間帯 | 曜日×時間の予約の多さ（ヒートマップ）、リードタイムの分布 | 期間、担当者 |
| 取消・欠席 | 取消・変更の理由上位、無断欠席の推移、リマインド有無での無断欠席率の差 | 期間、面談の種類 |

書き出しは各タブ右上の CSV。指標の式は「？」に書く。

---

## 出典（前回 C1〜C7 は `../style-dashboards/RESEARCH-1014.md`）

- C8 Cal.com Insights（参考）：https://cal.com/help/bookings/insights.md
- C9 Zoho Bookings レポートとダッシュボード：https://prezohoweb.zoho.com/bookings/features/reports-and-dashboards.html ／ https://www.zoho.com/bookings/features.html
- C10 YouCanBook.me 分析：https://youcanbook.me/product-updates/analytics ／ https://ycbm.capacity.com/article/689790/youcanbookme-analytics-beta ／ C10b https://youcanbook.me/blog/analyze-booking-data-with-claude ／ 定期書き出し https://youcanbook.me/product-updates/tag/bookings
- C11 HubSpot 会議の分析：https://knowledge.hubspot.com/meetings-tool/analyze-meetings
- C12 Calendly 無断欠席の印・書き出し・Workflows：https://calendly.com/help/how-to-mark-no-shows-for-meetings
- C13 HubSpot コミュニティ（実施数が見えない・結果のベータ・会議の出どころ）：https://community.hubspot.com/t5/HubSpot-Ideas/Meeting-Outcome/idc-p/29287 ／ https://community.hubspot.com/t5/Dashboards-Reporting/Report-meetings-that-were-booked-using-HS-meeting-links/td-p/1138995
- C14 Chili Piper（来た率・転換率・利用者の不満）：https://www.chilipiper.com/calendly ／ https://www.chilipiper.com/products/handoff ／ https://suggest.chilipiper.com/forums/943981-reporting/suggestions/49433417-reporting-on-pipeline-generation ／ https://suggest.chilipiper.com/feature-requests/p/associate-chili-piper-meetings-with-pipeline-created-and-display-pipeline-impact
- C15 jicoo 統計機能：https://www.jicoo.com/news/stats-feature-beta-has-been-released
- C16 無断欠席率の式・リードタイム（外部 BI の解説、推論の根拠）：https://www.metabase.com/metrics/no-show-rate ／ https://www.metabase.com/integrations/calendly
- C17 Salesforce Scheduler（稼働で配分・標準の空き枠レポートなし）：https://trailhead.salesforce.com/it/content/learn/modules/appointment-distribution-with-salesforce-scheduler/set-up-appointment-distribution ／ https://unofficialsf.com/report-available-appointment-slots-by-resource/
- C18 TimeRex（GA 連携で閲覧・流入・CV を計測）：https://help.timerex.net/en/articles/10000320-is-it-possible-to-measure-the-effectiveness-of-the-site-in-terms-of-number-of-pvs-inflow-sources-conversions-etc
- C19 Acuity 書き出し：https://help.acuityscheduling.com/hc/articles/16676916553485
- 未確認：Spir（分析機能の記載なし：https://www.itreview.jp/products/spir/profile）、HERP Hire（「レポート・分析機能」はあるが中身不明：https://www.aspicjapan.org/asu/service/9359）、SavvyCal（標準の分析画面の記載なし。外部連携のみ：https://posthog.com/docs/cdp/sources/savvycal）
