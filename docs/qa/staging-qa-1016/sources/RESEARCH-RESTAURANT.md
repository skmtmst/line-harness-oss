# 飲食店のダッシュボードとアナリティクス調査（2026-10-15）

- 調べ方：公開ページ（製品紹介・ヘルプ・公式ブログ・プレスリリース・レビュー・比較記事）だけ。ログイン・申し込み・送信・フォーム入力はしていない。
- 前回（`../style-dashboards/RESEARCH-1014.md` の「5. 参考：飲食店」）は予約台帳・席×時間・顧客台帳の 3 社だけだった。今回は**足りなかった物**を A に足し、B〜D を新しく調べた。
- 調べた 13 社：トレタ、TableCheck、レストランボード、エビソル（ebica）、Toast、OpenTable、Resy、SevenRooms、Square for Restaurants、Airレジ、ぐるなび（店舗向け）、食べログノート、LINE レストランオプション（LINE レストランプラス・飲食予約プラン。LINE ヤフー）。
- 「何社」＝**公開ページで確かめられた社数 / 調べた社数（13）**。少ない数でも「無い」とは限らない（書いていないだけのことが多い）。
- **限界**：日本の予約台帳（トレタ・レストランボード・ebica・食べログノート・ぐるなび）は、分析画面の中身をほぼ公開していない。ぐるなびは非公式の解説記事しか見つからず全部「未確認」。TableCheck のヘルプは 403 で本文を読めず、**検索結果の要約から読んだ**（出典欄に書いた）。OpenTable の分析は 2018 年の発表記事が中心で、今の画面名は変わっている可能性がある。海外（Toast・Resy）はヘルプで中身まで分かった。
- おすすめ度：◎＝最初の版に入れる／○＝次に入れる／△＝余裕があれば・合わない（musubo は会計・POS を持たないので、会計が前提の物は △ にした）

---

## A. ダッシュボード（前回に足す物）

| 区分 | 要素 | 何社 | musubo | 出典 |
|---|---|---|---|---|
| 上の数 | 今日・今週の来店人数（カバー数）と予約組数 | 4/13（Toast〔Guest Count〕・Resy〔Covers〕・Square〔Covers〕・TableCheck〔来店人数〕） | ◎ | R9, R16, R18, R5 |
| 上の数 | 前週・前年同週と比べた増減％（比べる相手を選べる） | 1/13（Toast〔前週・前年同週・2 年前同週〕） | ◎ | R9 |
| 上の数 | 売上（純売上） | 2/13（Toast・LINE レストランオプション） | △（会計を持たない。予約のコース金額から出す「見込み売上」なら ○） | R9, R22 |
| 上の数 | 人件費率 | 1/13（Toast） | △ | R9 |
| 上の数 | 新規・リピーター・常連の人数 | 2/13（LINE レストランオプション〔新規客数・リピーター数・常連数〕・Toast〔Guest Insights〕） | ◎ | R22, R11 |
| メイン | 今後 14 日の予約一覧（日時・名前・人数・席）＋「席が決まっていない予約」の警告 | 1/13（Toast〔毎日のメール〕） | ◎（ホームの「今日」とメールの両方に） | R12 |
| 横カード | 売れ筋 7 品（1 日平均の出数・前週比） | 1/13（Toast） | △（会計がない） | R9 |
| 横カード | 来店・売上・キャンセル・飛び込み・無断キャンセルの予測 | 1/13（TableCheck〔Forecasts〕） | ○ | R6 |
| 横カード | 常連・高額客を自動で印付け（タグ）し、無断キャンセル歴のある人にも印 | 1/13（OpenTable〔自動のゲストタグ・無断キャンセルの印〕） | ◎ | R14b |
| 1クリック | 数を押すと元のレポートへ（売上→売上レポート、人数→客のレポート） | 1/13（Toast） | ◎ | R9 |
| 工夫 | 1 時間ごとに更新と明記 | 1/13（Toast） | ○（「何時点の数か」を出す） | R9 |
| 工夫 | 毎朝のメールで同じ数を届ける | 2/13（Resy〔毎朝〕・Toast〔予約の毎日メール〕） | ○ | R16, R12 |

**推論：** 飲食のホームは「今日の来店人数（組・人）＋前週比」「今日の予約の一覧と席の未割り当て」「新規/常連の内訳」の 3 つで足りる。根拠：Toast の週次ダッシュボードは数を 4 つに絞り（R9）、Toast の毎日メールは「席が決まっていない予約」を警告として先頭に出す（R12）。どちらも「開店前に何をすべきか」に直結する。

---

## B. アナリティクス（分析・レポート）

### B-1. レポートの種類（タブ）

| 区分 | 要素 | 何社 | musubo | 出典 |
|---|---|---|---|---|
| タブ | 予約（件数・経路・人数・状態） | 5/13（Resy〔Reservations〕・Toast〔Bookings〕・TableCheck〔Online Providers・Channels〕・レストランボード〔予約経路・コースの集計〕・OpenTable〔Booking insights〕） | ◎ | R16, R12, R6, R7, R14 |
| タブ | 来店人数（カバー） | 3/13（Resy〔Covers〕・Square〔Section sales の Covers〕・TableCheck） | ◎ | R16, R18, R5 |
| タブ | キャンセル・無断キャンセル（誰が・いつ・なぜ） | 2/13（TableCheck〔No-Shows・Cancellations の 2 つ〕・SevenRooms〔キャンセル率・無断キャンセル率〕） | ◎ | R6, R17 |
| タブ | お客さま（新規・再来・離れた客・頻度） | 4/13（Toast〔Guest Insights〕・Resy〔Monthly Guestbook〕・LINE レストランオプション・SevenRooms〔再来率〕） | ◎ | R11, R16, R22, R17 |
| タブ | 時間（滞在時間・待ち時間・回転） | 3/13（Resy〔Timing〕・Toast〔Turn Time・見込みと実際の待ち時間〕・SevenRooms〔テーブル回転〕） | ○ | R16, R12, R17 |
| タブ | 席の埋まり（シフト・月ごとの稼働、前年比） | 1/13（OpenTable〔Shift occupancy〕） | ◎ | R14 |
| タブ | 曜日・時間帯（ヒートマップ） | 1/13（LINE レストランオプション） | ◎ | R22 |
| タブ | 評価・アンケート（平均評価・担当者別） | 3/13（Resy〔Ratings〕・トレタ〔カスタマーボイス〕・LINE レストランプラス〔アンケート結果〕） | ○ | R16, R3, R23 |
| タブ | 配信・販促の効果（配信からの来店・売上） | 4/13（Toast〔メール後 14 日の売上〕・SevenRooms〔メール→予約・人数・売上〕・LINE レストランプラス〔配信効果・費用対効果〕・TableCheck〔グルメサイトごとの集客と販促費〕） | ◎ | R13, R17, R23, R5 |
| タブ | 売上・メニュー（ABC 分析・原価率） | 4/13（Toast・Airレジ〔ABC 分析・原価率〕・LINE レストランオプション〔出数・粗利〕・Square） | △（会計を持たない） | R10, R19, R22, R18 |
| タブ | 店舗をまたいだ比較 | 3/13（Toast〔Location breakdown〕・TableCheck〔全店舗横断〕・SevenRooms〔店・グループ〕） | ○（統括アカウント） | R10, R5, R17 |
| タブ | 近くの店との比べ（ベンチマーク） | 1/13（OpenTable〔近隣 25 店以上の匿名平均〕） | △ | R14 |

### B-2. 主な数字・切り口・比べ方

| 区分 | 要素 | 何社 | musubo | 出典 |
|---|---|---|---|---|
| 切り口 | 予約経路（グルメサイト別・自社・電話・LINE） | 4/13（TableCheck・レストランボード・ebica〔経路ごとの売上〕・Toast〔Source〕） | ◎ | R5, R7, R8, R12 |
| 切り口 | 人数（組の大きさ） | 3/13（Toast〔Party Size〕・トレタ〔グループサイズ〕・TableCheck） | ◎ | R12, R2, R6 |
| 切り口 | 曜日・時間帯 | 3/13（トレタ〔曜日・時間帯〕・LINE レストランオプション・Toast〔hour of day〕） | ◎ | R2, R22, R9 |
| 切り口 | 担当スタッフ（サーバー） | 3/13（Toast〔server・employee〕・Resy〔担当者別評価〕・Square） | ○ | R10, R16, R18 |
| 切り口 | 客の来店回数・最終来店日・利用金額・客単価を掛け合わせる | 1/13（TableCheck） | ◎ | R5 |
| 切り口 | 席・エリア（カウンター・テラスなど） | 2/13（Square〔Section sales〕・Toast〔dining area〕） | ○ | R18, R12 |
| 比べ方 | 前週・前月・前年・同曜日 | 3/13（Toast・LINE レストランオプション〔前年比・前月比・同曜日比〕・OpenTable〔前年比〕） | ◎ | R9, R22, R14 |
| 比べ方 | 目標と達成率・差分 | 1/13（LINE レストランオプション） | ○ | R22 |
| 比べ方 | 祝日を平日・週末と分けて集計 | 1/13（LINE レストランオプション） | ○ | R22 |
| 書き出し | CSV | 4/13（Toast〔Bookings・Guests〕・Square・LINE レストランオプション・トレタスタンプ） | ◎ | R12, R18, R22, R1b |
| 書き出し | 決まった時刻にメールで届ける | 3/13（Resy〔配布先リスト・毎朝〕・Toast〔予約の毎日メール・Bookings をメール〕・OpenTable〔月次レポート〕） | ○ | R16, R12, R14 |
| 書き出し | PDF | 0/13 | 未確認 | — |
| 予測 | AI の来店予測・発注量の予測 | 2/13（TableCheck〔Forecasts・AI 予測〕・トレタ〔外食データクラウド〕） | △ | R5, R6, R2 |

### B-3. よく使われる指標の定義

| 指標 | 定義（出典の書き方） | 出典 |
|---|---|---|
| カバー（来店人数） | 来た人数。Toast の Guests report は**キャンセルと無断キャンセルを除いて**数える | R12 |
| 客単価 | 売上 ÷ 客数 | R22, R26 |
| 回転率 | 客数 ÷ 席数（1 席が営業時間中に何回使われたか）。**未確認**：公式の定義ページは見つからず一般的な説明のみ。売上＝客単価×席数×回転数 | R26 |
| 滞在時間（Turn Time） | 着席から退店までの時間。Toast は作成・着席・注文・会計・退店の時刻を持つ | R12 |
| 新規客 | その期間に初めて来た（注文した）人 | R11 |
| 再来客（Returning） | その期間に 2 回目以降で来た人 | R11 |
| 離れた客（Lapsed） | 期間の前 6 か月には来たが、期間中は来ていない人 | R11 |
| リテンション（再来率） | 期間中に戻ってきて再び注文した人の割合 | R11 |
| 戻るまでの日数・平均来店回数・頻度 | 再来までの時間、1 人あたりの注文回数 | R11 |
| 再来店客比・平均再来店間隔 | LINE レストランオプションの期間別分析にある（計算式は未記載） | R22 |
| 常連化の確率 | トレタの自社データでは 初回→2 回目 10.6%、2 回目→3 回目 32.3% | R1 |
| 無断キャンセル | 予約したが連絡なく来なかった（取り消しとは別に数える） | R6 |
| 配信からの売上 | Toast：メールを受け取ってから 14 日以内に注文し、そのメールアドレスで照合できた売上。**3 日後**に反映 | R13 |
| FL 比率 | （食材費＋人件費）÷ 売上 × 100。目安 55〜65% | R26 |

---

## C. 使いやすさの推論

| 区分 | 要素 | 何社 | musubo | 出典 |
|---|---|---|---|---|
| 評価 | 紙の台帳に近い感覚で、席×時間の埋まりが一目で分かる | 1/13（トレタ） | 既にある | R4 |
| 評価 | 店舗の数がどれだけ増えても同じ画面で慣れる（多店舗で人が行き来しても迷わない） | 1/13（OpenTable のレビュー） | ◎ | R15 |
| 不満 | 分析ツールの機能は限定的（比較サイトの評） | 1/13（トレタ） | — | R4 |
| 不満 | 数字が食い違うことがある | 1/13（OpenTable のレビュー） | — | R15 |
| 不満 | ほかの予約サービスとの連携が切れて二重入力になった | 1/13（OpenTable のレビュー） | — | R15 |
| 不満 | 顧客の一覧が「会員だけ」を数えていて、会員でない客が抜ける（利用者の報告） | 1/13（Toast のコミュニティ） | — | R11b |
| 不満 | 配信の成果が金額だけで、何組・何人来たかが出ない | 1/13（Toast〔公式に「件数は出ない」〕） | — | R13 |
| 不満 | 分析の反映が精算後の深夜（1〜7 時）で、当日は見られない | 1/13（LINE レストランオプション） | — | R22 |
| 不満 | ダッシュボードと分析画面で数の定義が一部違うと注記 | 1/13（LINE レストランオプション） | — | R22 |

**推論（何があれば使いやすいか）：**

1. **数の定義を画面の「？」に必ず書く**（何を含み・何を除くか）。根拠：OpenTable のレビューの「食い違い」（R15）、LINE レストランオプション自身が「ダッシュボードと分析で定義が違う」と注記（R22）、Toast の Guests report がわざわざ「キャンセル・無断キャンセルは除く」と書く（R12）。飲食は「予約した人数」と「来た人数」が違うので、ここが一番ずれる。
2. **配信の成果は「金額」だけでなく「何組・何人が来たか」で出す**。根拠：Toast は件数が出ないと公式に書いている（R13）。musubo は会計を持たないので、むしろ**予約と来店の件数で成果を出すのが本筋**。
3. **「何時点の数か」を出す**。根拠：Toast は 1 時間ごと（R9）、LINE レストランオプションは深夜反映（R22）。予約は即時に数えられるので、musubo は「いまの数」と言える。
4. **店舗を切り替えても同じ並び**。根拠：多店舗で人が行き来しても迷わないのが評価点（R15）。統括アカウントで効く。
5. **無断キャンセルは取り消しと別に数え、人に印を付ける**。根拠：TableCheck は No-Shows と Cancellations を別のダッシュボードにし（R6）、OpenTable は無断キャンセル歴の印を付けて事前確認に使う（R14b）。

---

## D. LINE との組み合わせ

| 区分 | 要素 | 何社 | musubo | 出典 |
|---|---|---|---|---|
| 予約 | LINE から入った予約の件数・効果（LINE 公式アカウントの管理画面で見る） | 1/13（LINE 飲食予約プラン） | ◎ | R24 |
| 予約 | LINE で予約→予約台帳にそのまま入る | 3/13（ebica〔LINE で予約〕・トレタ〔LINE ヤフーが子会社化し LINE 上で予約受付〕・LINE 飲食予約プラン） | 既にある | R8b, R25, R24 |
| 予約 | 予約の前日リマインドを LINE で自動送信（無断キャンセルを減らす） | 1/13（LINE 飲食予約プラン） | ◎ | R24 |
| 来店 | 来店回数で初来店・リピート・常連を見分けて表示 | 1/13（LINE レストランプラス〔POS・ハンディに来店回数〕） | ◎ | R23 |
| 配信 | 誰が・いつ・何を注文したかで配信を分ける | 1/13（LINE レストランプラス） | ○（注文データがあれば） | R23 |
| 配信 | 配信の効果・アンケート結果・施策ごとの費用対効果をまとめて見る | 1/13（LINE レストランプラス） | ◎ | R23 |
| 配信 | 誕生日・アンケート回答・タグで自動配信 | 1/13（LINE CRM オプション） | 既にある | R23 |
| 配信 | 来店回数で絞ってアンケートを送る（2〜3 回目の客だけ） | 1/13（トレタ カスタマーボイス） | ◎ | R3 |
| 会員 | デジタルのスタンプ（来店履歴を自動で取る・常連度を数で見る） | 1/13（トレタスタンプ） | ○（来店スタンプは提案 E で採用済み） | R1b |
| 注文 | モバイルオーダーからクーポン・ショップカードへの導線 | 1/13（LINE レストランプラス） | △ | R23 |

**LINE と組み合わせたときに見たい数字（推論）：**

- **友だちからの予約数・割合**（予約全体のうち LINE 経由）。根拠：飲食予約プランが「LINE 経由の予約の効果」を売りにしている（R24）。グルメサイトの手数料を減らせたかが店の関心事（SevenRooms の事例でも手数料の削減額を成果に挙げている、R17）。
- **配信 → 予約 → 来店**の 3 段の数（何通送って、何組が予約し、何組が来たか）。根拠：Toast は金額しか出せない弱点がある（R13）。musubo は予約を持つので件数で出せる。
- **リマインドを送った予約の無断キャンセル率 vs 送らなかった予約**。根拠：飲食予約プラン（R24）・Resy（SMS で無断キャンセル 3% 未満と主張、R16b）がリマインドを無断キャンセル対策として売る。
- **2 回目・3 回目に来た割合**（常連化の段ごと）。根拠：トレタの常連化曲線（R1）が 1→2 回目 10.6%、2→3 回目 32.3% と示し、「2〜3 回目を逃さない」ことを結論にしている。LINE の自動配信をこの段に当てると効く。
- **クーポン・スタンプの利用数**。**未確認**：公開ページで飲食向けにクーポン利用数を分析に出している例は確かめられなかった。

---

## まとめ 1：musubo のダッシュボードに入れる物（◎）

- **上の数 4 つ**：①今日の予約（組・人数）②今週の来店人数と前週比（比べる相手を選べる）③新規・リピート・常連の内訳 ④取りこぼし（キャンセル・無断キャンセル）。
- **メイン**：今日の予約一覧（時刻・名前・人数・席）。**席が決まっていない予約は先頭に警告**。席×時間の台帳へ 1 クリック。
- **横カード**：常連・要注意（無断キャンセル歴）の印が付いた今日の客／LINE から入った予約の数と割合／リマインドの送信状況。
- **すべての数は押すと元のレポートや絞り込み済みの一覧へ**。一覧から「この人たちに LINE を送る」まで 1 クリック。
- **「何時点の数か」**を見出しの横に出す。数の定義は「？」に。

## まとめ 2：アナリティクスのタブ案（飲食店）

| タブ名 | 中の数字 | グラフ | 切り口 |
|---|---|---|---|
| 予約 | 予約組数・人数・平均人数・前週/前年比 | 日別の棒（予約組数）＋前年の線 | 期間・予約経路（LINE・グルメサイト・電話・自社）・人数・コース・店舗 |
| 来店 | 来店人数（カバー）・来店率（予約のうち来た割合）・席の埋まり | 曜日×時間帯のヒートマップ | 期間・曜日・時間帯（祝日を分ける）・席/エリア・店舗 |
| 取りこぼし | キャンセル率・無断キャンセル率・直前キャンセル（何時間前か） | 経路別の積み上げ棒 | 経路・曜日・人数・リマインドの有無 |
| お客さま | 新規・再来・離れた客の人数／再来率／再来までの日数／2・3 回目に来た割合 | 段ごとの階段（1→2→3 回目） | 期間・初回の経路・来店回数・最終来店日 |
| 配信の効果 | 配信数・開封・予約数・来店数（何組・何人）・クーポン利用 | 配信ごとの表＋3 段の漏斗 | 配信ごと・期間・対象の絞り込み |
| 店舗の比較（統括のみ） | 上の主な数を店ごとに並べる | 店×指標の表 | 店舗・期間 |

- 書き出し：各タブで CSV。毎朝のメール（前日の数と今日の予約）は ○。
- 売上・メニューのタブは会計を持たないので作らない（POS 連携が入ったら ○）。

---

## 出典

- R1 トレタ 常連化曲線（初回→2 回目 10.6%・2→3 回目 32.3%）：https://codezine.jp/article/detail/11407?p=1 ／ R1b トレタスタンプ（来店履歴の自動取得・CSV）：https://pages.toreta.in/rs/052-UCE-052/images/toreta-stamp-guide.pdf
- R2 トレタ 外食データクラウド（エリア・客単価・曜日・時間帯・グループサイズで絞る）：https://corp.toreta.in/assets/2020/01/pdf/20190708.pdf ／ https://weekly.ascii.jp/elem/000/001/892/1892124/
- R3 トレタ カスタマーボイス（来店回数で絞るアンケート）：https://www.atpress.ne.jp/news/136904/print
- R4 トレタ 比較サイト（紙の台帳の感覚・分析は限定的）：https://www.onamae.com/business/product/231923/ ／ https://saas.imitsu.jp/cate-reservation/service/3698
- R5 TableCheck Insight（来店人数・予約経路・来店回数×最終来店日×利用金額×客単価・全店舗横断）：https://www.tablecheck.com/ja/join/features/analytics/ ／ https://www.tablecheck.com/ja/company/press/insight-launch/
- R6 TableCheck Insight の既定のダッシュボード（No-Shows・Cancellations・Forecasts・Online Providers・Channels・自由に作れる）※ヘルプは 403 のため**検索結果の要約から読んだ**：https://support-restaurants.tablecheck.com/hc/en-us/articles/900001797226-Preset-Dashboards ／ https://support-restaurants.tablecheck.com/hc/en-us/articles/900001696363-INSIGHT-Advanced-Analytics-Portal
- R7 レストランボード（予約経路・コースの集計、Airレジ連携）：https://saas.imitsu.jp/cate-reservation/service/2981 ／ https://www.businessinsider.jp/article/161254/
- R8 ebica（来店経路ごとの売上分析）：https://paymentnavi.com/?p=141831 ／ R8b ebica の LINE で予約連携：https://ecnomikata.com/pr/11817/
- R9 Toast 週次ダッシュボード（4 つの数・前週/前年同週・1 時間ごと更新・押すと元のレポート）：https://intercom.help/toast-central/en/articles/14728163-toast-reporting-dashboard-weekly-overview ／ https://support.toasttab.com/article/How-to-Use-the-Toast-Reporting-Dashboard
- R10 Toast 売上レポート（Sales summary・Breakdown・Location breakdown）：https://support.toasttab.com/article/Sales-Reports-Overview
- R11 Toast Guest Insights（新規・再来・離れた客・再来率・戻るまでの日数）：https://intercom.help/toast-central/en/articles/11563502-guest-insights-overview ／ R11b 会員だけを数えるという利用者の報告：https://community.toasttab.com/t5/restaurant-operations/return-guest-metric/m-p/9275 （検索結果の要約から読んだ）
- R12 Toast Tables のレポート（毎日の予約メール・Guests・Bookings、Turn Time・Source・Party Size）：https://intercom.help/toast-central/en/articles/14726171-toast-tables-reports
- R13 Toast メール配信の売上（14 日・3 日後に反映・件数は出ない）：https://support.toasttab.com/en/article/Viewing-Sales-Attributed-to-Toast-Marketing-Campaigns
- R14 OpenTable の分析（シフトの埋まり・予約の出どころ・月次レポート・前年比、2018 年）：https://table.skift.com/2018/05/15/opentable-adds-business-insights-to-restaurant-facing-guest-center ／ https://www.verdictfoodservice.com/news/online-reservation-service-opentable-launches-bi-solution-restaurants ／ R14b 自動のゲストタグ・プラン：https://www.opentable.ie/restaurant-solutions/plans/ ／ 無断キャンセルの印：https://curiocity.com/youll-now-get-locked-out-of-opentable-if-you-ghost-on-reservations-too-many-times/
- R15 OpenTable のレビュー（Capterra）：https://capterra.com/p/17313/OpenTable-for-Restaurants/
- R16 Resy Analytics（Home・Reservations・Covers・Ratings・Timing・Monthly Guestbook、毎朝メール）※本文が途中で切れたため**検索結果の要約から読んだ**：https://helpdesk.resy.com/en/articles/3108034-resy-analytics ／ R16b Resy の SMS 確認：https://customers.twilio.com/en-us/resy
- R17 SevenRooms（メール→予約・人数・売上、50 以上の指標、キャンセル・無断キャンセル率・再来率）：https://sevenrooms.com/crm-marketing-campaign/ ／ https://platform.softwareone.com/product/reporting-group-reporting/PCP-5478-9650 （販売店のページ）／ 事例：https://www.casestudies.com/company/sevenrooms/case-study/1c-andonis-cafe-bar-achieves-80x-roi-in-first-4-months
- R18 Square for Restaurants（Section sales の Covers・客単価・CSV）：https://squareup.com/help/au/article/6433 ／ https://community.squareup.com/t5/Square-for-Restaurants/Square-for-Restaurants-table-turnover-time-report/m-p/643602
- R19 Airレジ（ABC 分析・原価率）：https://www.inshokuten.com/foodist/article/4526
- R20 ぐるなび：店舗向けの分析は非公式の解説記事のみ → **全部未確認**
- R21 食べログノート（予約・席・顧客管理、TableCheck と席在庫連携。分析は未確認）：https://www.travelvoice.jp/20240912-156326 ／ https://www.tablecheck.com/ja/join/about-us/press/2024/20241022-tabelog-integration/
- R22 LINE レストランオプションの分析（期間別・曜日×時間帯・商品別、前年/前月/同曜日比、目標、新規/リピーター/常連、CSV、深夜反映）：https://www.lycbiz.com/jp/manual/OfficialAccountRestaurant/insight/
- R23 LINE レストランプラス・CRM オプション（来店回数で初来店/リピート/常連、配信効果・費用対効果）：https://www.lycbiz.com/jp/news/line-official-account/20260623/
- R24 LINE 飲食予約プラン（LINE で予約・リマインド・LINE 経由の効果）：https://www.lycbiz.com/jp/service/line-official-account/restaurant-reservation-plan/
- R25 LINE ヤフーがトレタを子会社化（LINE 上で予約・再来店促進・CRM）：https://www.travelvoice.jp/20260130-159175
- R26 飲食の指標（FL 比率・客単価×席数×回転数）：https://biz.moneyforward.com/restaurant/basic/2932/
