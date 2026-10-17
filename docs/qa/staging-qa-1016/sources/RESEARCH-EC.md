# EC（ネットショップ）のダッシュボードとアナリティクス調査（2026-10-15）

- 調べ方：公開ページ（製品紹介・ヘルプ・公式ブログ・プレスリリース・アプリストア説明・レビュー・比較記事）だけ。ログイン・申し込み・送信・フォーム入力はしていない。
- 前回（`../style-dashboards/RESEARCH-1014.md` の「3. EC」）で確かめたダッシュボードの物（売上・注文件数・対応待ちの注文・売上ランキング・在庫切れなど）は繰り返さず、**足りなかった物だけ**を A に足した。
- 調べた 10 社：Shopify、BASE、STORES（ネットショップ・STORES データ分析）、カラーミーショップ、makeshop、EC-CUBE、楽天 RMS、Klaviyo、Google アナリティクス 4（GA4）、CRM PLUS on LINE（Shopify の LINE 連携アプリ。D のために足した）。
- 「何社」＝**公開ページで確かめられた社数 / 調べた社数（10）**。少ない数でも「無い」とは限らない（書いていないだけのことが多い）。
- **限界**：Shopify はヘルプに定義まで書いてあり一番確かめられた。BASE・STORES ネットショップ・カラーミーの本体は、分析画面の中身を公開ページで説明しておらず、外部ツール（GA4・アプリ）の説明しか取れなかった。楽天 RMS の公式ページは 403 で本文を読めず、**EC 専門メディアの記事と検索結果の要約から読んだ**。makeshop の分析（MakeRepeater）は 2014 年の記事で、今も同じかは未確認。EC-CUBE は前回どおり親リポジトリのテンプレート（読み取りのみ）を正とし、`eccube/app/Plugin` に売上集計のプラグインは見つからなかった。
- おすすめ度：◎＝最初の版に入れる／○＝次に入れる／△＝余裕があれば・合わない（musubo は店そのものではなく、**EC の注文データを LINE とつなぐ側**。だから「LINE で動かせる数」を高く付けた）

---

## A. ダッシュボード（前回に足す物）

| 区分 | 要素 | 何社 | musubo | 出典 |
|---|---|---|---|---|
| 上の数 | 平均注文額（客単価） | 3/10（Shopify〔AOV〕・楽天 RMS〔客単価〕・カラーミー＋DeeBoard〔注文単価〕） | ◎ | E6, E16, E13b |
| 上の数 | 新規客 / リピート客 | 2/10（Shopify〔New vs returning〕・Klaviyo） | ◎ | E4, E17 |
| 上の数 | 目標と進み具合（数ごとに目標を置ける） | 1/10（Shopify〔metric targets〕） | ○ | E2 |
| 上の数 | LINE 連携した人の数の推移・LINE 経由の売上 | 1/10（CRM PLUS on LINE） | ◎ | E20 |
| 横カード | 自動で出る気づき（いつもと違う動き） | 1/10（Shopify〔automatically generated insights〕） | ○ | E2 |
| 横カード | 異常のお知らせ（自分で決めた見張りに引っかかったら知らせる） | 1/10（Klaviyo〔custom monitors with alerts〕） | ○ | E17 |
| 工夫 | 数のカードを足す・消す・並べ替える・大きさを変える・見出しで区切る | 1/10（Shopify） | △（最初は固定の並びで十分） | E2 |
| 工夫 | 約 1 分で更新 | 1/10（Shopify） | ○ | E2 |
| 工夫 | 売れたらすぐスマホに通知 | 1/10（BASE アプリ） | ○ | E14 |

**推論：** 前回の「売上・注文件数・対応待ち」に、**新規/リピートの内訳**と **LINE 経由の売上** を足すのが musubo らしい。根拠：Shopify・Klaviyo はどちらも新規とリピートを分けて見せ（E4, E17）、LINE 連携アプリは LINE 経由の売上をダッシュボードの主役にしている（E20）。

---

## B. アナリティクス（分析・レポート）

### B-1. レポートの種類（タブ）

| 区分 | 要素 | 何社 | musubo | 出典 |
|---|---|---|---|---|
| タブ | 売上（期間・商品・販路・店舗） | 5/10（Shopify・EC-CUBE〔今日・昨日・今月、週/月/年〕・STORES データ分析〔店舗・商品・販路・従業員〕・makeshop〔売上ランキング〕・楽天 RMS） | ○（EC 側に既にあるので、musubo は LINE 経由の分だけで良い） | E3, E10, E15, E12, E16 |
| タブ | お客さま（新規/リピート・コホート・RFM） | 4/10（Shopify〔コホート・RFM・予測〕・Klaviyo〔RFM〕・makeshop〔MakeRepeater の 10 区分〕・STORES データ分析〔会員分析〕） | ◎ | E4, E17, E12b, E15 |
| タブ | 集客（流入元・キャンペーン・広告） | 4/10（Shopify〔チャネル別・キャンペーン別〕・楽天 RMS〔アクセスの経路〕・GA4・カラーミー＋DeeBoard〔流入・検索語〕） | ○ | E6, E16, E19, E13b |
| タブ | 行動（購入までの漏斗・カゴ落ち・検索） | 3/10（Shopify〔購入率の内訳・検索〕・GA4〔購入までの経路〕・カラーミー＋DeeBoard〔カート追加率〕） | ◎（カゴ落ちは LINE で拾える） | E5, E19, E13b |
| タブ | 配信の効果（メール・LINE・SMS） | 4/10（Klaviyo・楽天 RMS〔R-Mail の開封率・経由の転換率〕・CRM PLUS on LINE・Shopify〔回復メールのレポート〕） | ◎ | E18, E16, E20, E8b |
| タブ | 商品（売れ筋・閲覧は多いがカートに入らない商品） | 3/10（makeshop〔ランキング〕・カラーミー＋DeeBoard〔閲覧数とカート追加の散布図〕・GA4〔アイテム〕） | ○ | E12, E13b, E19 |
| タブ | 在庫・利益・財務・不正 | 1/10（Shopify） | △ | E3 |
| タブ | ネットと実店舗をまとめて見る | 2/10（STORES データ分析・Shopify〔Retail sales〕） | △ | E15, E3 |
| タブ | 同業との比べ（ベンチマーク） | 2/10（Klaviyo・楽天 RMS〔同じジャンルの上位と比べる〕） | △ | E17, E16 |

### B-2. 主な数字・切り口・比べ方

| 区分 | 要素 | 何社 | musubo | 出典 |
|---|---|---|---|---|
| 切り口 | 時間の単位（時・日・週・月・四半期・年・時間帯・曜日・月） | 1/10（Shopify） | ◎（日・週・月と曜日・時間帯） | E4 |
| 切り口 | 初回購入の月でまとめた組（コホート） | 2/10（Shopify・Klaviyo〔獲得とリテンション〕） | ○ | E4, E17 |
| 切り口 | 地域（最後の配送先） | 1/10（Shopify） | △ | E4 |
| 切り口 | 端末（PC・スマホ・アプリ） | 2/10（Shopify・楽天 RMS） | △ | E5, E16 |
| 切り口 | 流入元・キャンペーン・UTM | 3/10（Shopify・GA4・楽天 RMS） | ◎（LINE の配信ごとに印を付ける） | E6, E19, E16 |
| 切り口 | 年代・性別 | 2/10（EC-CUBE〔利用者の声〕・楽天 RMS〔顧客属性〕） | ○ | E11, E16 |
| 比べ方 | 前の期間と比べる | 1/10（Shopify） | ◎ | E2 |
| 比べ方 | 前年の同じ時期と比べる | 0/10（Shopify は標準で出せず、外部アプリが必要という店主の声） | ◎（無いと困るという声がある） | E9 |
| 比べ方 | 目標 | 1/10（Shopify） | ○ | E2 |
| 比べ方 | 売上を「アクセス人数 × 転換率 × 客単価」に分けて、どこが弱いかを見る | 1/10（楽天 RMS） | ◎（考え方として。LINE 版は「届いた数×押した率×買った率×単価」） | E16 |
| 書き出し | CSV | 3/10（Shopify〔1,000 行を超えたら書き出し〕・Klaviyo・BASE〔管理画面から書き出して外で集計〕） | ◎ | E7, E17, E14c |
| 書き出し | 決まった時刻にメール | 0/10（Shopify は標準に無く外部アプリ） | ○ | E9 |
| 書き出し | PDF | 0/10（Shopify の外部アプリのみ） | △ | E9 |
| 帰属 | 何をきっかけの売上とみなすか選べる（最後のクリック・最初のクリック・全部・均等割り） | 2/10（Shopify〔5 方式〕・Klaviyo〔期間を変えられる〕） | ○（最初は 1 方式に固定し、定義を「？」に書く） | E6, E18 |
| 予測 | 予測の支出・優良客になりそうな人 | 2/10（Shopify〔predicted spend tier・24 か月以上で予測〕・Klaviyo〔次の購入の予測〕） | △ | E4, E17 |

### B-3. よく使われる指標の定義

| 指標 | 定義（出典の書き方） | 出典 |
|---|---|---|
| 購入率（コンバージョン率） | 購入に至った訪問（セッション）の割合。Shopify の訪問は 30 分動きがないと区切る | E5, E6 |
| カートに入れた訪問 / 決済に進んだ訪問 | カートに商品を入れた訪問の数 / 決済の画面で何か操作（キー入力やクリック）があった訪問の数 | E5 |
| 漏斗の各段の率 | その段の訪問 ÷ 全訪問。順番どおりに進んだ人だけ数える「閉じた漏斗」と、どこからでも数える「開いた漏斗」がある | E5 |
| カゴ落ち率 | 1 −（購入 ÷ カート追加）。海外の平均は約 70%（Baymard）、日本の調査では 62.9%（2025、特定ツールの利用店のみ） | E21 |
| カゴ落ちの数え方 | Shopify はメールアドレス入力後 10 分以上たって未完了のものを「放棄された決済」とする（第三者の説明。公式は未確認） | E8b |
| 平均注文額（AOV） | 売上 ÷ 注文数 | E6 |
| 転換率（楽天） | 購入者数 ÷ アクセス人数。アクセス人数は 30 分以内の同じ人を 1 回と数える | E16 |
| リピート客 | 2 回以上買った人（Shopify の Returning customers）。**期間内の人数**と**初回の組ごとの再購入率**は別物なので混ぜない | E4, E22 |
| リテンション率（コホート） | 初回の組のうち、ある期間にまた買った人の割合 | E4, E22 |
| RFM | 最後に買ってからの日数（R）・回数（F）・金額（M）を 1〜5 点にし、Shopify は 11 の組（これから・新規・有望・活発・最優良・常連・要注意・危ない・以前は常連・失いかけ・休眠）に分ける | E4 |
| LTV（生涯価値） | 1 人が付き合いの間に使う金額。Shopify はコホートの「1 人あたり支出」の予測（24 か月以上のデータが要る）として出す。**一般的な計算式の公式説明は未確認** | E4 |
| 配信からの売上（Klaviyo） | メール・SMS を開く/押してから 5 日以内の購入（既定。変えられる）。最後に触れたものだけに数える | E18 |
| 配信からの売上（CRM PLUS on LINE） | 配信から直接の購入に加え、配信後 1 週間以内にその商品を買ったか・リッチメニューから買ったかを「間接の貢献」として数える | E20 |
| ROAS・CPA・CAC | 広告費あたりの売上・1 件獲得の費用・1 人獲得の費用（費用データがないと「—」） | E6 |

---

## C. 使いやすさの推論

| 区分 | 要素 | 何社 | musubo | 出典 |
|---|---|---|---|---|
| 評価 | 管理画面が分かりやすく、自分たちで直せる | 1/10（BASE の利用者） | — | E14d |
| 評価 | 期間別・商品別・年代別に売上を出せて、定期の報告書づくりが楽 | 1/10（EC-CUBE の利用者） | ◎ | E11 |
| 評価 | RFM や顧客ランクの推移がすぐ見られる | 1/10（makeshop の利用者） | ○ | E12b |
| 不満 | 顧客分析は細かいが使いこなせない | 1/10（makeshop の利用者） | — | E12b |
| 不満 | 分析の数が実際の注文数と合わない（決済完了の数が注文より少ない・購入率がおかしい） | 1/10（Shopify のコミュニティ。Shopify も遅れを認めた） | — | E8 |
| 不満 | 前年比を週ごとに自動で届けてほしいが標準ではできない | 1/10（Shopify のコミュニティ） | — | E9 |
| 不満 | 管理画面が分かれていて数字を行き来するのに時間がかかる | 1/10（ネットショップ全般の解説） | — | E15b |
| 不満 | 本体で足りず GA4・外部アプリ・書き出しで補っている | 3/10（BASE・カラーミー・Shopify） | — | E14, E13b, E9 |

**推論（何があれば使いやすいか）：**

1. **「分析」より「次にやること」を先に出す**。根拠：makeshop の利用者は「細かいが使いこなせない」（E12b）。Shopify の RFM は「失いかけ」「危ない」など**名前の付いた組**で出し、そのまま一覧と配信の対象にできる（E4）。musubo は組を押したら LINE 配信の対象になる形にする。
2. **数の定義と数え方を「？」に書き、注文の実数とずれる理由を書く**。根拠：Shopify の分析はブラウザ側の記録で数えるため注文数と合わず、店主の不満と問い合わせが多い（E8）。musubo は EC の注文データ（サーバー側）から数えるので「注文の実数と一致する」と言える。
3. **前の期間・前年の同じ時期の両方と比べられる**。根拠：Shopify は前期比はあるが、前年比の自動報告は外部アプリ頼みで不満が出ている（E9）。
4. **1 画面で LINE と EC の数がつながる**。根拠：管理画面が分かれていると行き来に時間がかかる（E15b）。STORES がネットと店舗の売上を 1 か所にまとめたのも同じ理由（E15）。
5. **「リピート率」は 2 種類をはっきり分ける**（期間中のリピート客の割合／初回の組の再購入率）。根拠：同じ言葉で別の数を出して混乱する例がある（E22）。

---

## D. LINE との組み合わせ

| 区分 | 要素 | 何社 | musubo | 出典 |
|---|---|---|---|---|
| つながり | LINE とショップの会員をつないだ人の数（ID 連携数）の推移 | 1/10（CRM PLUS on LINE） | ◎ | E20 |
| 配信 | 配信ごとの通数・LINE 経由の売上・購入率 | 1/10（CRM PLUS on LINE） | ◎ | E20 |
| 配信 | 自動配信（閲覧した商品・カゴ落ち・決済落ち・再入荷）の開封率・クリック率 | 1/10（CRM PLUS on LINE、2025 年 6 月から） | ◎ | E20b |
| 配信 | カートに入れただけの人にも LINE でお知らせ（決済の画面まで来なくても） | 1/10（CRM PLUS on LINE） | ◎ | E20c |
| 配信 | 間接の貢献（配信後 1 週間以内の購入・リッチメニューからの購入） | 1/10（CRM PLUS on LINE。LINE 経由の売上の 7 割になる例もあるとベンダーは言う） | ◎（直接と間接を分けて出す） | E20 |
| 比較 | メール配信の開封率・経由の転換率（LINE ではないが同じ形） | 2/10（楽天 RMS〔R-Mail〕・Klaviyo） | ◎（同じ表の形で LINE 版を作る） | E16, E18 |

**LINE と組み合わせたときに見たい数字（推論）：**

- **友だちのうちショップ会員とつながった割合**。根拠：カゴ落ちの LINE 配信は「つながった人」にしか送れない（E20c）。この割合が全部の天井になる。
- **配信 → 開封 → クリック → 購入**の 4 段と、**直接/間接**を分けた LINE 経由の売上。根拠：CRM PLUS on LINE はこの順で数を出し（E20, E20b）、Klaviyo も「何日以内を配信の手柄とするか」を決めている（E18）。musubo は日数を固定して「？」に書く。
- **カゴ落ちの LINE で取り戻した注文数・金額**。根拠：日本のカゴ落ち率は 6 割強（E21）で、取り戻した額がいちばん分かりやすい成果。
- **LINE からの初回購入者の 2 回目購入率**（コホート）。根拠：Shopify・Klaviyo がコホートと RFM を中心に置く（E4, E17）。LINE は 2 回目を促す配信に向く。
- **クーポンの利用数・利用額**。**未確認**：公開ページで LINE クーポンの利用数を EC の分析に出している例は確かめられなかった（推論：クーポンコードを EC の注文と照らせば数えられる）。

---

## まとめ 1：musubo のダッシュボードに入れる物（◎）

- **上の数 4 つ**：①LINE 経由の売上（直接＋間接、前期比）②LINE 経由の注文件数と平均注文額 ③新規/リピートの内訳 ④取り戻せるもの（今日のカゴ落ち件数・金額）。
- **メイン**：対応待ちの注文（発送待ち・入金待ちを種類別の件数で。前回から継続）。押すと一覧→「発送を LINE で知らせる」。
- **横カード**：つながった人の数の推移（友だちのうち会員と連携した割合）／動いている自動配信（カゴ落ち・再入荷）の今週の成果／RFM の「失いかけ」「危ない」の人数（押すと配信の対象に）。
- **数の定義と「何時点か」**を「？」と見出しの横に。EC の注文データから数えるので注文の実数と合うことを書く。
- 開店前（未連携）は数の代わりに「ショップとつなぐ」「LINE ログインを置く」などのはじめにやること。

## まとめ 2：アナリティクスのタブ案（EC）

| タブ名 | 中の数字 | グラフ | 切り口 |
|---|---|---|---|
| LINE 経由の売上 | 売上（直接・間接）・注文数・平均注文額・前期比・前年比 | 日別の積み上げ棒（直接/間接）＋前年の線 | 期間（日・週・月）・曜日・時間帯・配信ごと |
| 配信の効果 | 配信数・開封率・クリック率・購入率・売上・1 通あたり売上 | 配信ごとの表＋4 段の漏斗 | 配信の種類（一斉・自動〔カゴ落ち・閲覧・再入荷〕）・期間・対象の絞り込み |
| カゴ落ち | カゴ落ち件数・金額・カゴ落ち率・LINE で取り戻した件数と金額 | 段ごとの漏斗（カート→決済→購入） | 期間・商品・つながった人/つながっていない人 |
| お客さま | 新規/リピート・リピート率（2 種類を分ける）・初回の月ごとの再購入率・RFM の組ごとの人数 | コホートの表（色の濃さ）・RFM の組の表 | 初回購入の月・初回の流入（LINE/それ以外）・年代・性別 |
| つながり | 友だち数・会員と連携した数と割合・連携の経路 | 推移の線 | 期間・連携の経路（リッチメニュー・購入後の案内など） |
| 商品 | LINE 経由で売れた商品・配信で押されたが買われなかった商品 | 上位の横棒 | 期間・配信ごと |

- 書き出し：各タブで CSV（◎）。週ごとの自動メール（前期比・前年比つき）は ○。PDF は △。
- 帰属（何を配信の手柄にするか）は最初は 1 方式に固定し、日数とともに「？」に書く。選べるようにするのは ○。
- 在庫・利益・財務・不正は EC 側にあるので作らない。

---

## 出典

- E1 Shopify Home（前回の出典）：https://help.shopify.com/en/manual/shopify-admin/shopify-home
- E2 Shopify 分析の概要ダッシュボード（約 1 分で更新・前期比・カードの追加/並べ替え・自動の気づき・目標）：https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/overview-dashboard
- E3 Shopify 既定のレポートの区分（集客・行動・お客さま・財務・不正・在庫・マーケティング・注文・利益・店舗販売・売上）：https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports
- E4 Shopify お客さまのレポート（新規/リピート・コホート・予測・RFM の 11 組）：https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/customers-reports
- E5 Shopify 行動のレポート（購入率の内訳・漏斗・検索・定義）：https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/behaviour-reports
- E6 Shopify マーケティングのレポート（チャネル・キャンペーン・帰属 5 方式・ROAS/CPA/CAC）：https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/marketing-reports
- E7 Shopify レポートの種類（1,000 行まで表示・書き出し）：https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types
- E8 Shopify 分析の数が合わないという声：https://community.shopify.com/t/inaccurate-checkouts-completed-data-awful-support-from-shopify/417258 ／ https://community.shopify.com/t/conversion-rate-incorrect-vs-actual-orders/108966 ／ 原因の説明（ベンダーのブログ）：https://www.stormly.com/blog/shopify-analytics-reconcile-numbers ／ E8b カゴ落ちの数え方・回復メールのレポート（第三者の説明、検索結果の要約から読んだ）：https://www.ringly.io/blog/shopify-abandoned-cart-report
- E9 Shopify 前年比の自動報告は標準でできない（コミュニティ）：https://community.shopify.com/t/automated-reporting/403533
- E10 EC-CUBE 4 管理画面ホーム（親リポジトリ `nen-petfood-eccube` のテンプレート `eccube/src/Eccube/Resource/template/admin/index.twig`。読み取りのみ。`eccube/app/Plugin` に売上集計のプラグインは見つからなかった）
- E11 EC-CUBE 利用者のレビュー（期間別・商品別・年代別）：https://www.itreview.jp/products/ec-cube/reviews/63975 ／ RFM のプラグイン（Amplitude）：https://www.commercepick.com/?p=31952
- E12 makeshop 管理画面の刷新（前回の出典）：https://ecnomikata.com/ecnews/38573 ／ E12b MakeRepeater（10 区分・5 種類のレポート、2014 年）と利用者の声：https://netshop.impress.co.jp/node/667 ／ https://www.itreview.jp/products/makeshop/reviews/157863
- E13 カラーミー AI エージェント（前回の出典）：https://netshop.impress.co.jp/n/2026/04/30/16000 ／ E13b DeeBoard for EC（GA4 から収益・注文数・注文単価・カート追加率、閲覧とカート追加の散布図）：https://ecnomikata.com/ecnews/38090/
- E14 BASE（GA4 連携・アプリのダッシュボードと売れたら通知）：https://ecnomikata.com/ecnews/39119/ ／ https://apps.apple.com/jp/app/id959836736 ／ E14c 管理画面から書き出して外で集計：https://www.sukeneko.com/press/pdf/press_20141112.pdf （検索結果の要約から読んだ）／ E14d 利用者の声：https://boxil.jp/service/148/reviews/63049/ （検索結果の要約から読んだ）
- E15 STORES データ分析（店舗・商品・販路・顧客・従業員、会員分析は有料）：https://ecnomikata.com/ecnews/45502/ ／ https://xexeq.jp/blogs/media/topics30077 ／ E15b ダッシュボードを 1 画面にまとめる解説：https://library.libecity.com/articles/01KEVQC7NGMG4JNHXWR4HGQKFB （検索結果の要約から読んだ）
- E16 楽天 RMS のデータ分析（アクセス人数×転換率×客単価、R-Mail の開封率・経由の転換率、顧客属性）※公式は 403 のため記事と検索結果の要約から読んだ：https://www.rakuten.co.jp/ec/environment/service/analysis/ ／ https://netshop.impress.co.jp/node/8513 ／ https://ecnomikata.com/ecnews/39174/
- E17 Klaviyo の分析（RFM・獲得とリテンション・ベンチマーク・見張りとお知らせ・CSV）：https://www.klaviyo.com/features/customer-analytics ／ https://www.klaviyo.com/solutions/analytics
- E18 Klaviyo の配信の成果の数え方（既定 5 日・最後に触れたもの）：https://help.klaviyo.com/hc/en-us/articles/115005248128
- E19 GA4 の e コマース（収益化のレポート・購入までの経路・アイテムの指標）：https://developers.google.com/analytics/devguides/collection/ga4/ecommerce?hl=ja ／ https://webtan.impress.co.jp/e/2024/09/27/47732
- E20 CRM PLUS on LINE のダッシュボード（ID 連携数・配信通数・LINE 経由の売上・購入率・間接の貢献）：https://www.commercepick.com/archives/38545 ／ E20b 自動配信の開封率・クリック率（2025 年 6 月）：https://www.commercepick.com/?p=67352 ／ E20c カートに入れただけの人へのお知らせ：https://www.commercepick.com/archives/36784
- E21 カゴ落ち率（Baymard 70.19%）：https://baymard.com/lists/cart-abandonment-rate ／ 日本の調査 62.9%（2025）※検索結果の要約から読んだ：https://netshop.impress.co.jp/n/2026/02/27/15656
- E22 コホートとリピート率の違い：https://www.shopify.com/ie/blog/cohort-retention-analysis ／ https://www.tresl.co/segments-faq/what-is-repeat-on-the-customer-cohort-page-how-is-it-defined
