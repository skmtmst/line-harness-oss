# 決まりと絵の食い違いの点検（2026-10-09 夜・読むだけの点検）

点検した人：司令塔の作業役（Claude）。リポジトリ・Pen は変えていない（書き出したのはこのファイルだけ）。
見たもの：`V8-INTRO-CHECKLIST.md`（B-1〜B-158）、`review/` の WORDING・POLISH・PATTERN・BEHAVIOR・UNRULED・PEN-UPDATE（すべて -1009）、`~/lh-work/lh-train-11`（`codex/kenta-train-11-10092100`・クリーン）の `docs/`・`AGENTS.md`・`apps/web`、`design/v8/html/`（642 本）・`pencil-texts/`（629 本）、`lh-spacing/scripts/visual-qa-stable/v8-design-map.json`（14:31 現地＝16:31 JST の版）。
Pen は `get_app_state` だけ見た（開いているのは V8-B.pen）。変数の読み出しは落ちる危険があるのでやめ、値は html の書き出しから推定した（左メニュー・トップバー・スマホの中・LIFF は数から外した。トップバーは別に書いた）。
**担当の書き方**：Pen＝Pen の作業役／文書＝司令塔／コード＝Codex／オーナー＝オーナーの判断。

---

## 1. 決まりどうしのぶつかり（24 件）

| # | 見つけたこと（場所） | 担当 | おすすめの直し方 |
|---|---|---|---|
| 1-1 | **「元に戻す」をどこまでやめるか**が決まりの中で割れている。B-157 #2 は「消す」だけ「元に戻すは使わない」、#3 は「オン/オフはすぐ反映＋失敗で戻す」と書くが、Pen は知らせの部品 Q6cQB から「元に戻す」を**全部**消した（PEN-UPDATE X）。一方 B-26（CHECKLIST:47・受信箱の右の欄「元に戻す付きの知らせ 成功4秒・元に戻す5秒」）は ☐ のまま残り、絵 AnbVR の説明文にも「元に戻す」「成功は 4 秒、元に戻す付きは 5 秒」が残る。コードは toast.test.tsx:65・95-142（5秒・⌘Z）、再開の「元に戻す」（scenario-ux-delivery.react.test.tsx:89、reminder-ux-delivery.react.test.tsx:100、auto-reply-ux-delivery.react.test.tsx:110）、templates/list.test.tsx:154（窓なしで外す→元に戻す） | オーナー | 「元に戻すは全部やめる（知らせの部品から口ごと外す）」か「消す以外（再開・まとめて再開・受信箱の右の欄）は残す」かを決める。決めたら B-26 の行を「B-157 で置き換え」と書き換え（文書）、Pen の Q6cQB の扱いを合わせる |
| 1-2 | **線の色が2つ**：B-149 区切りの線＝黒7%（#1d1d1f12）、B-137（CHECKLIST:201）カードの線＝黒8%（Pen は $border-soft #1d1d1f14 を 378 板で使用）、B-145② 確かめの窓の線も $border-soft。ほとんど同じ灰が2つある | オーナー | 1つ（7%）にそろえるか、「区切り＝7%・カードと窓の外枠＝8%」と決まりの板 vfssS/GxpYg に2行で明記する |
| 1-3 | **カードの影の値**：B-137 の本文（CHECKLIST:201）が古い影「0 1px 2px 12%・0 3px 8px 9%」のまま。B-148 案A（0 1px 1px 16%・0 2px 4px 8%）が正 | 文書 | B-137 の行に「影は B-148 で置き換え・数のカードは B-153 で置き換え」と足す |
| 1-4 | **主ボタンの角丸**：POLISH #9「ボタン・欄・メニューの行 10（主ボタンは 8）」。副ボタン 10・主ボタン 8 が並ぶと角がそろわない（下の帯の［キャンセル］10 と［保存する］8） | オーナー | 主ボタンだけ 8 で良いか確認。良ければ「並ぶボタンで角丸が違ってよい」を決まりに明記 |
| 1-5 | **主ボタンの高さ**：B-151（CHECKLIST:232）「高さ32」だが、Pen R は部品 doYdE を「高さ 36 のまま」、32 はフォルダの列の［作る］（faSbC）だけ。html でも［作る］が 32 の板 64・36 の板 20（状態の見本帳 A8jzaQ・BxGhV・U0aKD・susGP ほか） | オーナー（決まりの読み） | 「32 は一覧の作るボタンだけ、ほかの主ボタンは 36」と B-151 に書き足す。見本帳 20 板の［作る］を 32 に（Pen） |
| 1-6 | **表の行の左右の余白**：POLISH #3 / PEN S「横の余白 16」 vs B-34（CHECKLIST:55）「行の左右 16→24」。html の「表（今の作りの列）」の行は 9px 24px（73 板）、コードは --tpl-row-pad-side 24・--tpl-thead-pad-side 24（globals.css:1204,1221） | オーナー | 24 に統一するのがおすすめ（実装・絵の多数・B-34 が 24）。POLISH #3 を直す |
| 1-7 | **表の見出しの地**：POLISH #3 #f7f8fa、Pen は #fafafc を 329 板（#f7f8fa は 162 板）、コードは --color-table-head #fafafb（globals.css:420）。3つの値 | Pen＋コード | #f7f8fa に統一。Pen の #fafafc を置き換え、コードの --color-table-head を #f7f8fa |
| 1-8 | **乗せた時の地**：POLISH #7「乗せる＝黒4%」 vs #3「表の行に乗せると #1d1d1f05（2%）」 | オーナー | 表の行も 4% にそろえるか、「表の行だけ 2%」と明記 |
| 1-9 | **太字の決まりと札**：POLISH #2「太字は題・数字・名前の列だけ」 vs #4「状態の札 12/600」、v8-design-rules.md:32「選んだ行は太字」、PEN W「選んだ後 名前 13/600」 | 文書 | POLISH #2 の例外に「札・選んだ行・ボタン」を足す |
| 1-10 | **角丸の段と骨組み**：POLISH #8 骨組み「角丸 5」 vs #9 の段（6/8/10/12/16/999）。コードの骨組みは 4（skeleton の .row [data-skeleton]） | 文書＋コード | 骨組みも 6 に（#8 を直す）。Pen jr5Nl も 6 |
| 1-11 | **余白の段の外の値が決まりの中に残る**：B-31「ボタンの下は必ず 18」、PATTERN-AUDIT 末尾「箱の余白 20・欄の間 6・帯の余白 10px 14px」、B-145④「欄の高さ 36」は段外ではないが、POLISH #1 は 8/12/16/24 だけ | 文書 | B-31 の 18→16、PATTERN-AUDIT の「値の揺れ」を POLISH の値で書き直す |
| 1-12 | **ページの説明文**：B-158 #2「説明は ？ へ」・PEN Y で 429 か所を ？ へ。ところが B-97（CHECKLIST:155）は「説明 12→13 約110枚」、B-58（:79）と v8-design-rules.md:38「手順は題と説明のすぐ下」、page-header.tsx:52 は description を必須 | 文書 | B-97・B-58 の「説明」を「？」に読み替える注を足す。v8-design-rules.md:38 を「題のすぐ下」に |
| 1-13 | **ページの題を本文に置くか**：v8-design-rules.md:61「画面名は共通のトップバーだけ。本文に画面のタイトルを置かない」 vs B-93（:151）「ページの題 22/700 全画面で統一」・POLISH #2・CI の title-audit（required-pr-gate.yml:647） | 文書 | v8-design-rules.md §5 の1行目を消すか「題は型の頭（22/700）で1つだけ」に書き換え |
| 1-14 | **右のパネルの幅**：B-158 #8「詳細 360・編集 480/540・窓 480/560/720/960」 vs B-94（:152）受信箱の右の欄 320、PEN-UPDATE「nen の右の欄 380」（B-145④）、コードの作成の引き出し --tpl-msg-composer-drawer-w 1160px・side 380（globals.css の v8 ブロック） | オーナー | 受信箱の右の欄（常設の列）と詳細パネルは別の型として 320 を残す、nen 380→360、引き出し 1160 は「大きな窓 960」に入るか判断 |
| 1-15 | **日時の欄の高さ**：v8-design-rules.md:40「時刻の欄は日付の欄と並ぶとき高さ40」 vs B-145④・PEN「日時の欄 36」 | 文書 | 36 に統一し v8-design-rules.md:40 を直す |
| 1-16 | **「〜する」で終える決まりと他の決まりの言葉**：WORDING #3 に対し、B-157 #11「もう一度読み込む」、B-158 #7「CSVで書き出す」、PEN W の［変える］、B-46［入る］、B-52［配る］、v8-feature-additions.md:86［止める］ | オーナー | 「目的語・副詞が付くものは動詞のまま可」と明記するか、［変える］→［変更する］・［配る］→［配る］のまま例外、などを一覧で決める |
| 1-17 | **閲覧のみ・権限の頼む先**：WORDING #7「…管理者に頼んでください」（統括は「統括の管理者」）、B-158 #6「店はオーナーか管理者に頼んでください」、PEN M の l5SRfT「統括に頼んでください」 | オーナー | 帯と 403 の文で頼む先を同じ言葉に（おすすめ：店＝「オーナーか管理者」、統括＝「統括の管理者」）。WORDING #7 を直す |
| 1-18 | **「店舗」と「アカウント」**：B-158 #17「呼び方は店舗」 vs WORDING #8「LINE公式アカウントを選んでください」・統括の「アカウント一覧」「［入る］」（B-46・JKjsE）。PEN Y も「アカウントは見分けられないので残した」 | オーナー | 「店舗＝お店、アカウント＝LINE公式アカウント」の使い分けを表にする（統括のカード一覧はどちらか） |
| 1-19 | **空の値**：B-158 #13「まだ設定していない＝未設定、0件＝なし」 vs B-75（:97）「既定値なしは『なし』」 | 文書 | B-75 を「未設定」に読み替える注 |
| 1-20 | **自動保存**：B-157 #16「手で保存・長い物だけ下書きの自動保存」 vs B-26 と絵 AnbVR「メモは書くのをやめて1秒で自動で保存」 | オーナー | 受信箱のメモを例外にするか決める |
| 1-21 | **コピーと保存のボタン**：B-157 #13「コピーしました 1.5 秒」・#6「保存できた＝トースト」 vs 提案F の絵 pFtOv（B-11）「1.6 秒」「ボタンの中に ✓保存しました 1.2 秒」 | 文書 | B-11 の行に「B-157 で置き換え（1.5 秒・保存はトースト）」と足す |
| 1-22 | **切り替えのしかた**：B-124（:186）「V8 に固定・切り替えの仕組みを外す」 vs 確認表 C-1（:113）「変数を戻せば v7 に戻る」・C-6・D-1、AGENTS.md:118、v8-design-rules.md:6、apps/web/src/v8/README.md「入口」「切り替えの日に困らないために」、HOW-TO-90.md:74,101、v8-switch.md:12,24,28 | 文書（AGENTS.md・v8-switch.md はリポジトリ） | B-124 に合わせて C・D 節と各文書の「v7 に戻す」「1週間後に消す」を書き換え |
| 1-23 | **合格の幅**：A-1（:13）「1440・1280」 vs v8-design-rules.md §3・AGENTS.md「1440 と 1152」 | 文書 | 合格の撮影は 1440・1152、1280 は「開いて崩れを見る」と分けて A-1 を直す |
| 1-24 | **古い行の残り**：B-10「タグの星の元に戻す」は B-121 で星ごと消えた。B-72（✕ 不採用「線と箱を減らす」）は B-149/B-153 で実質採用された形になった | 文書 | 両行に「B-121／B-149・B-153 で置き換え」と注 |

## 2. 要件定義とのぶつかり（17 件）

| # | 要件の場所（file:line） | 新しい決まり | 担当 | おすすめ |
|---|---|---|---|---|
| 2-1 | docs/v6-requirements/v6-00-glossary.md:54 「この30日」を使い「直近30日／過去30日」は使わない。試験 apps/web/src/app/glossary-contract.test.ts:100-104 が「過去30日」を落とす。:101 に WEB-025/073 の「直近30日」決定 | B-158 #5「過去7日／過去30日／過去90日」 | オーナー→文書・コード | どちらの言い方にするか決める。決めたら用語表・試験・決まりの板を同時に直す（今のまま B-158 を入れると必須の試験が落ちる） |
| 2-2 | v6-01-dashboard-requirements-draft.md:78「今日／過去7日／過去28日」、glossary:56「28日は本当に28日で数えている」 | B-158 #5（30・90 日、今日なし） | オーナー | ダッシュボードとコンバージョンの集計窓を 28→30 に変えるか、期間の部品に例外を作る |
| 2-3 | glossary:72-77 §5「本当に0＝`0件`」「取得失敗＝読み込めませんでした＋再読み込み」「操作する権限がありません」、master-index:125「ラベルは 未取得／取得失敗／権限不足／未接続」、v8-design-rules.md:66「`—` と `0件` を混ぜない」 | B-158 #13「0件＝なし」、B-157 #11「もう一度読み込む」、B-158 #6 頼む先の文 | 文書 | 用語表 §5 を新しい言葉に書き換え（「0件」と「なし」の使い分け、押し口は「もう一度読み込む」） |
| 2-4 | v6-06-broadcast-requirements-draft.md:129「予約済み」・:134,287「送信完了」 | B-158 #1 予約中／送信済み | 文書 | 要件の状態の名前を表の言葉へ |
| 2-5 | v6-05-scenario-delivery-requirements-draft.md:103,352「公開中」・:353「停止中」・:354「保管」・:118,247,357「一時停止」 | B-158 #1（シナリオは「公開するもの」か「自動で動くもの」か未分類。Pen Y は「稼働中→有効」に） | オーナー | シナリオ・自動応答・リマインダを「有効／停止中」か「公開中／停止中」のどちらに入れるかを表に足す。「保管」→アーカイブ |
| 2-6 | v6-10-webinar-requirements-draft.md:177,186,222「公開・一時停止・archive」、v7-unbuilt-features-confirmed.md:269「下書き・公開中・終了・中止・一時停止」 | B-158 #1（一時停止は使わない） | オーナー | ウェビナーの「終了・中止」を表に足すか決め、一時停止→停止中 |
| 2-7 | v6-14:240・v6-15:261・v6-04:514「アーカイブ済み」 | B-158 #1「アーカイブ」 | 文書 | 要件を「アーカイブ」に |
| 2-8 | v6-25-automation-requirements-draft.md:139「止める／動かすは確認ダイアログを経て反映」 | B-157 #3「すぐ反映。お客さまに影響する止めるだけ確認窓」（動かすは確認なし） | オーナー | オートメーションの「動かす」の確認を外すか決める |
| 2-9 | v6-13-response-form-requirements-draft.md:182「新規作成は下書きを作りそのIDへ遷移」、v6-25:277「これで作る→下書き→25-1-A へ遷移」 | B-157 #7「作ったら一覧に戻して光らせる（シナリオ・配信だけ次の手順へ）」 | 文書 | B-157 #7 の例外に回答フォーム・オートメーションのひな形を足す（作ったあと中身を作る物） |
| 2-10 | v6-25:215,288,407「閲覧のみは『操作する権限がありません』」 | WORDING #7 閲覧のみの帯の文 | 文書 | 要件の文を帯の文へ |
| 2-11 | v6-34-onboarding-guidance-requirements-draft.md:247「管理者に依頼」、v6-25:360「オーナーまたは管理者の権限が必要」 | B-158 #6「オーナーか管理者に頼んでください」 | 文書 | 言い方を1つに |
| 2-12 | v6-11-template-requirements-draft.md:136「`下書きに保存`」 | WORDING #3「下書きを保存」 | 文書 | 要件の言葉を直す |
| 2-13 | v6-03-friends-requirements-draft.md:565「行クリックだけにせず、名前をリンクにする」、v6-01:264「行クリック：既読にして遷移」 | B-157 #4「行のどこでも同じ動き・Link で新しいタブ可」 | — | ぶつからない（両方満たせる）。確認のため記録 |
| 2-14 | master-index.md:144-160 §5-2「白文字の緑は $accent-deep。新しい色トークンは作らない」 | B-151 縁 #06612f（新色）、POLISH #4 の札の色（#16a34a・#f97316・#ef4444・#2563eb・#94a3b8 とその濃い色）＝新色 | オーナー | §5-2 の「新しい色を作らない」を V8 で解くことを決め、要件に追記（文書） |
| 2-15 | docs/v8-requirements/v8-switch.md:12,14,24,28,32-37（v7 に戻せる・1週間後に消す） | B-124 V8 固定 | 文書 | v8-switch.md を B-124 の3段（固定→機能ごと→掃除）に書き換え |
| 2-16 | v8-feature-additions.md:86「［止める］」 | WORDING #3（〜する）・B-158 #1（停止） | 文書 | ［停止する］か例外かを 1-16 と一緒に決める |
| 2-17 | v8-liff.md:17「知らせ（トースト）は白地」 | B-146 補足「言葉の決まりは LIFF にも」、B-157 は管理画面向け | — | ぶつからない。LIFF に B-157 のどれを当てるか（自動保存・確認窓）は未定 → オーナー |

## 3. Pen の値とコードの変数（html 書き出しから推定・20 件）

数は「使っている板の数」。Pen の値は 白い板の中（左メニュー・トップバー・スマホ・LIFF を除く）。

| # | 種類 | Pen（よく使う値・板数） | コード（globals.css） | 判定 | 担当・直し方 |
|---|---|---|---|---|---|
| 3-1 | 区切りの線 | #1d1d1f12（549 板） | --color-hairline #dadde2（:124、v8 の上書きなし）。表の行は --shadow-row-line＝--color-divider #eceef1（:418,676） | **違う** | コード：v8 で --color-hairline を #1d1d1f12、行の線も hairline に（B-149） |
| 3-2 | カードの縁 | #1d1d1f14（378 板） | --card-edge 0.08・--color-border-soft #1d1d1f14（:500,685） | 一致 | （1-2 の判断次第） |
| 3-3 | 欄・副ボタン・検索・札の枠 | #1d1d1f1f（520 板） | --color-control-border #c9ced6（:682）。同じ値は --color-controls-swatch-line #1d1d1f1f（色の見本用）だけ | **変数なし** | コード：--color-field-border #1d1d1f1f を足す（チェック・ラジオは control-border のまま＝Pen Q と同じ） |
| 3-4 | 欄の影 | 0 1px 2px #1d1d1f0f（520 板） | なし | **変数なし** | コード：--shadow-field を足す |
| 3-5 | カードの影 | 0 1px 1px #1d1d1f29, 0 2px 4px #1d1d1f14（492 板） | --card-shadow（:501）一致。ただし --shadow-card（:377・古い Beautiful shadows）も残り、design-parts.json の tokens が古い値で見張っている | 一致（古い変数あり） | コード：--shadow-card を --card-shadow に寄せるか消す |
| 3-6 | 主ボタン | 縁 #06612f 1px（450 板）・影＝カードの影・角丸 8 | 縁の変数なし。--shadow-controls-primary は古い緑の影＋白い光（:673）。--radius-control 10（:679） | **違う／変数なし** | コード：--color-accent-edge #06612f・--radius-button-primary 8 を足し、--shadow-controls-primary を案3に |
| 3-7 | 表の見出しの地 | #fafafc（329 板）／#f7f8fa（162 板） | --color-table-head #fafafb（:420）、--color-slot-bg #f7f8fa | **3値** | 1-7 のとおり #f7f8fa |
| 3-8 | 乗せる・押す | #1d1d1f0a／#1d1d1f14（決まりの板 FK5m7） | --color-track #1d1d1f0a（名前が違う）。乗せる・押すの変数なし | **変数なし** | コード：--color-hover・--color-press を足す |
| 3-9 | キーボードの輪 | 2px #2563eb | 変数なし | **変数なし** | コード：--focus-ring を足す |
| 3-10 | 状態の札の色 | 緑 #16a34a（251 板）・灰 #94a3b8（184）・橙 #f97316（91）・赤 #ef4444（70）・青 #2563eb（62）＋各 1a | --color-status-info #175cd3・danger #e5484d・warn #f5c56b/#a15c00、--color-support-*（:138-144,595-）| **違う** | オーナー（2-14）→コード：札用の5色の変数 |
| 3-11 | 案内の帯 | 帯/案内 ThDed の地 #e9f1ff（帯 23・174 板） | --color-status-info-soft #e9f1ff | 一致。ただし POLISH #4 の案内＝#2563eb1a と Pen の中で食い違う | Pen：帯/案内の地を #2563eb1a にするか #e9f1ff を決まりに書くか決める（3-10 と一緒） |
| 3-12 | 角丸 | 10（576 板）・8（572）・12（497）・16（556）・999 | --radius-control 10・panel 16・card 12・pill 9999・select-menu 12/行 8 | 一致 | — |
| 3-13 | 角丸（段の外） | 9（272 板・数のマスの印）・7（トップバーのアカウントの印・512 板）・5（骨組み 102）・4（104）・3（41）・11（15）・14（8） | --radius-tile 9・tile-sm 7・mini 6・icon 3・large 18 | 段の外が両方に残る | Pen：数のマスの印 9→8 か 10、トップバーの印 7→6。コード：--radius-large 18・tile 9・tile-sm 7 を段へ |
| 3-14 | 本文の文字 | 13（590 板） | --text-body 14（:291） | **違う** | コード：v8 で --text-body 13（size-scale-contract が 14 を見張る→6 節） |
| 3-15 | 段の題 | 15（294 板） | 15 の共通の変数なし（--text-lead 16） | **変数なし** | コード：--text-section 15 |
| 3-16 | 段の外の文字 | 10（514 板＝トップバーの通知の数とアカウントの小さい字）・18（75）・17（85）・14（65）・20（47、OTP を除くと約 38）・16（28）・9（10） | --text-nano 10・heading 18・title 20 | 段の外が両方に残る | Pen：トップバー（部品の外側）と手描きの題 18/17 を段へ。コード：--text-nano を消す |
| 3-17 | すき間（段の外） | gap 10（563 板）・6（548＝パンくずと板の頭）・5（175＝絞り込みの札）・3（275）・14（108）・20（39）、padding 7px 12px（フォルダの列の行 86 板） | --tpl-section-pad 20・section-gap 14・field-gap-basic 6・page-pad-block 10（:1162,1314,1363） | 段の外が両方に残る | Pen：部品（パンくず・板の頭・絞り込みの札・フォルダの列の行）の中の値を段へ。コード：--tpl-* を段へ |
| 3-18 | 骨組み | #1d1d1f0f・角丸 5 | --color-shell-gray・角丸 4（skeleton の CSS） | **違う** | 1-10 と一緒に 6 へ |
| 3-19 | トップバー（全板共通） | 枠 #dadde2（アカウント切り替え・通知・33 板で直書き）、通知の数 #e5484d・10px、印の角丸 7 | — | Pen の古い値 | Pen：トップバーを新しい線（#1d1d1f12）と段へ。PEN S は「白い板の中だけ」直したので外側が残った |
| 3-20 | 部品の html の書き出しが古い | faSbC.html（15:08 現地＝17:08 JST、R の前）に古い主ボタン、StFE7・dLffh・iBuZH・Fa8ED は 10-08 のまま | — | 古い | Pen：部品の html を出し直す（コードの見張りが部品の html を読むなら必須） |

- 地図に入っていない板 46 枚の html が P〜S（17:30 JST 以降）の前のまま：統括のリッチメニュー（gobhu・egdGx・K0gu1・gQabc）、LIFF の新しい板（jQRsr・V2HU7・xe8ga・h2HKh・etLd8・glL3g・km8EG・sAnyy）、SDrMu、404（Nx5dz・aLU3r）、Ptr2u ほか。egdGx には古い副ボタンの枠 #dadde2 が残る。→ Pen：出し直し。

## 4. 板の状態の抜け（地図の 156 の入口・推定）

推定のしかた：地図の板を入口（route）ごとにまとめ、板の名前と座標表の文字で探した（入力を破棄／入力してください・文字以内・誤り／最新を読み込む・違いを比べる／閲覧のみ／まだ〜ありません・条件に合う／読み込めませんでした・もう一度読み込む／骨の層／光）。`kind` の 閲覧のみ・競合 も数えた。

**全体で絵が1枚も無い状態**
- 「入力を破棄しますか？」の窓：決まりの板（vfssS・GxpYg）にだけある。画面の板は 0。
- 作ったあと一覧で光った行：決まりの板にだけある。画面の板は 0。

**入口ごとの抜けの数**（作る・編集 57 入口／一覧・詳細 99 入口）

| 種類 | 抜けている状態 | 入口の数 |
|---|---|---|
| 作る・編集 | 離れる確認（破棄の窓） | 54 |
| 作る・編集 | 欄の赤表示 | 53（描いてあるのは fBSdY・自動応答・友だち追加時の配信・マイル・テンプレート一覧の一部だけ） |
| 作る・編集 | 閲覧のみ | 49 |
| 作る・編集 | ぶつかりの帯 | 38 |
| 一覧・詳細 | 光った行 | 101（作る画面がある一覧に限ると約 25） |
| 一覧・詳細 | 骨組み（読み込み） | 85 |
| 一覧・詳細 | 失敗（もう一度読み込む） | 85 |
| 一覧・詳細 | 空 | 78 |
| 一覧・詳細 | 閲覧のみ | 77 |

**作る・編集で正解の絵が無い状態（主な入口）**

| 入口 | 板 | 抜け |
|---|---|---|
| /broadcasts/new（FU2aU はまとめ板） | f63Jza | 離れる確認・欄の赤・ぶつかり・閲覧のみ |
| /hq/broadcasts/new | p17Qku（古い提案の板） | 全部。正の板 BBRDb・EpTBB・WjFWW は地図の外 |
| /hq/templates | X4JcOf・i0Ao0R・Ni0V8 | 離れる確認・欄の赤・ぶつかり・閲覧のみ |
| /hq/friend-attributes | MFgPZ・gSsPR・xqr1Q | 同上 |
| /rich-menus/new・/rich-menus/edit | JeINq・Z0uO6 ほか | 離れる確認・欄の赤（・閲覧のみ） |
| /templates/carousel・/templates/edit・/templates/questions/new | J60utH・fBSdY・EFV8l ほか | 離れる確認（carousel は欄の赤あり） |
| /scenarios/new・/scenarios/detail・/scenarios/first-step | dnzqC・ARuZ4 ほか | 離れる確認・閲覧のみ（・ぶつかり） |
| /reminders/new・/reminders/edit | T0nis ほか・k32cn | 離れる確認・欄の赤・閲覧のみ |
| /tags/new・/tags/edit・/tags/fields/edit・/tags/marks/edit・/tags/searches/edit・/tags/folders/new | d9xoI・Qat9s・w9zY5・ulq9Y・AqDWN・IjVpM | 離れる確認・欄の赤・閲覧のみ（多くはぶつかりも） |
| /form-submissions/edit | ITBAB ほか 8 枚 | 離れる確認・欄の赤・閲覧のみ |
| /webinars/new・/events/new・/webhooks/new・/conversions/new・/inflow-links/new・/automations/new・/affiliates/new・/affiliate-offers/new・/mileage/earning-rules/new・/booking/menus/new・/booking/staff/new・/staff/new・/pools/new・/common-actions/new・/contents/vars/new・/contents/vars/edit・/analytics/reports/new・/line-notifications/operator/new・/nen-campaigns/edit・/nen-campaigns/columns/new・/ops/tenants・/hq/banners/project・/restaurant-test/google（投稿を作る・返信の下書き） | — | 離れる確認・欄の赤・閲覧のみ（多くはぶつかりも） |

**一覧で正解の絵が無い状態（主な入口）**：/hq（17 板あるが空・失敗・骨組み・閲覧のみ・光った行が無い）、/hq/members・/hq/rich-menus・/hq/form-submissions・/hq/billing・/hq/support、/chats（空・失敗・骨組み・閲覧のみ）、/friends/detail、/broadcasts/detail・/broadcasts/reserved、/events、/nen-campaigns・/nen/pets・/nen/health、/notifications、/ops の 12 入口、/restaurant-test の 14 入口、/settings の 4 入口、/webhooks?tab=incoming・sheets、/visit-stamps。
状態の見本帳がある機能（友だち・友だち属性・テンプレート・リッチメニュー・シナリオ・自動応答・リマインダ・共通情報・回答フォーム・友だち追加時の配信・予約設定・成果地点・アフィリエイト・Webhook・ウェビナー）は空・失敗・骨組みがそろう。ただし見本帳は MEASURE-EXCLUDE で測る対象から外れているので、照合は目だけ。
- 選ぶ窓（B-155）：正解の絵は f63Jza（テンプレート）・rE0ML（回答フォーム）と統括の EpTBB・WjFWW だけ。タグ・シナリオ・クーポン・アカウント・予約メニュー・リッチメニューを選ぶ窓の開いた絵は無い（欄の形だけ PEN W で 38 板）。

全入口の表（入口・種類・板の数・抜け・板）は作業の控え `scratchpad/rc/states2.txt` の形で再現できる（必要なら司令塔が足す）。

| 担当 | おすすめ |
|---|---|
| Pen | 「破棄の窓」「欄の赤」「ぶつかりの帯」「光った行」は機能ごとに描かず、**型の状態の板を1組**（作る型・一覧型）だけ描いて地図に足し、「全部の作る・編集はこの型に従う」と決まりの板に書く。機能ごとの板は、型と見た目が違う所（統括の配る窓・受信箱）だけ |
| 文書 | 見比べ（B-144）の合格条件に「型の状態の板と同じ見た目か」を足す |

## 5. 部品を使わず手で描いたところ（推定・多い順）

推定のしかた：html の中で、部品の名前（ボタン/主・ボタン/副・選ぶ欄・検索・状態の札・数のマス・表の行 など）の外にある「主ボタンの見た目（緑の地・高さ32/36/40）」「欄・副ボタンの見た目（#1d1d1f1f の枠・高さ32/36/40）」「状態の札の見た目（999・色の10%の地）」「数のマスの名前で縦並び」「行の名前で線あり」を数えた。**インスタンスの名前を変えている部品も手描きに数えている可能性がある**（html には部品の元が出ないため）。確定は Pen の作業役 M が ref で見る。

合計：442 板・欄や副ボタンの見た目 2,042 か所・状態の札 413・主ボタン 407・数のマス 43・表の行 7。

| 順 | 板 | 名前 | 手描きらしい数（内訳） |
|---|---|---|---|
| 1 | eGrSP | 採用 提案 E（地図外） | 51（欄 35・主 10・札 6） |
| 2 | M0393 | ★P4 受信箱（まとめ板） | 40（欄 33・主 7） |
| 3 | ywJ5H | ★P1 友だち一覧（まとめ板） | 29（欄 14・札 12・主 3） |
| 4 | yRPxl | 予約設定 受付枠 | 29（欄 28・主 1） |
| 5 | QX56l | 採用 G-8 来店スタンプの QR（地図外） | 25 |
| 6 | VFxWU | 予約設定 受付枠（1152） | 24 |
| 7 | Fkv3w | 統括 テンプレート リサーチを作る（地図外） | 20 |
| 8 | EsYo4 | テンプレート リサーチを作る | 20 |
| 9 | RHvRP | 採用 G-2 リッチビデオ（地図外） | 19 |
| 10 | n7gSKU | 採用 修正案 C（地図外） | 16 |
| 11 | nWmLg・REIxB・Q5le3 | 自動応答 実行結果・友だち追加時の配信 実行結果・流入と計測 詳細 | 各 16（同じ形の手描き＝同じ型の中身） |
| 12 | x6QsVz・XIzkJ・Iffil・WPrd5・L7zA7C・nF4ts | 一覧（1152・閲覧のみ） | 各 14〜15（道具の段の欄と状態の札） |
| 13 | AqDWN | 友だち属性 保存した検索の編集 | 15 |
| 14 | SkY9V・IIesG・uE9gf・a5C1p | リマインダ・自動応答の一覧 | 13〜14（状態の札 7） |
| 15 | M8zhjL・R6kIG | マイル | 14 |
| 16 | xxKtW | 共通情報 削除ダイアログ | 13 |
| 17 | GKgRk・IY3nx | G-9 カルーセル・統括 質問を作る（地図外） | 13 |

- 目立つ型：一覧の道具の段（よく使う絞り込み・並び・表示件数を手描きの欄で）と、表の中の状態の札（「札 有効」「札 停止中」などの名前の手描き）。どちらも部品（道具の1段 c4n9Kr・状態の札 5 種）がある。
- 担当：Pen（M）が上から順に ref で確かめ、部品に置き換え。コード（Codex）は B-143 の洗い出しと同じ型（道具の段・状態の札）から。

## 6. 見比べの地図と見張り

### 6-1 地図（v8-design-map.json・16:31 JST の版・535 板）

| # | 見つけたこと | 担当 | おすすめ |
|---|---|---|---|
| 6-1-1 | DIHFx から消した提案の板（wlndp・w4QGc・cPFSm・GK6t7・d4E3o・lsMjq・BCR1d・bl9lG・kyzSO・WWlE7・RCZhA・Z7vd2・Wmch0・K6Ot7O・YPzmo・dJZ7Q・QMJBg ほか）は**地図に無い**（良い） | — | — |
| 6-1-2 | 古い提案の板が地図に残る：aSmph（提案E-4）・p17Qku（提案E-9 統括の一括配信を作る＝BBRDb で置き換え済み B-37）・xOXuY（提案E-9 ⑤ kind 部品）・w4SBbv（提案 E-7 来店スタンプ＝G-8 で置き換え） | 司令塔 | 地図から外し、置き換え先を入れる |
| 6-1-3 | 今日足した板：xqr1Q・fBSdY・Ni0V8・f63Jza・rE0ML は地図に入っている。ただし rE0ML の名前が古い（地図「送るテンプレート」・絵「回答フォームを選ぶ」） | 司令塔 | 名前を直す |
| 6-1-4 | 決まりの板 vfssS・GxpYg は地図に無い（良い）。ただし **sxNO5「LIFFの決まり」が地図にあり LIFF 28 枚に数えられている**（kind 決まり）。まとめ板 9 枚（BOj1a・CYJ0L・FU2aU・If9Mh・M0393・Q5F2QE・acRIl・mcOqK・ywJ5H）と kind 部品 2 枚（xOXuY・v7GV2）も地図にある | 司令塔 | 決まり・まとめ板・部品を測る対象から外す（分母も直す） |
| 6-1-5 | **MEASURE-EXCLUDE.tsv をどの道具も読んでいない**（measure.sh は `--map` だけ。tools/hq と lh-spacing/scripts に参照なし）。見本帳を外したつもりでも測られる | 司令塔 | measure.sh か v8-overlay.mjs で読む、または地図に `exclude` を書く。vfssS・GxpYg・sxNO5・FK5m7・まとめ板も足す |
| 6-1-6 | 正本なのに地図に無い板 98 枚（html はある）。主なもの：統括の一括配信（BBRDb・EpTBB・WjFWW・U4Eep0・M2tJM・pIHp3・GKgRk）、統括のテンプレート（C3qMCz・Fkv3w・HfK0O・IY3nx・SDSsr・g8d6ai・pQ4fH）、統括のリッチメニュー G-10（VIij4・cmRZc・UgZPJ・ME78d・BVSbe・gobhu・egdGx・K0gu1・gQabc）、統括の回答フォーム（u5MM7・scJcP・xRPdo・N4T9mO）、コンバージョン（JXq9G・UUQ7T・V1RQfI・c7grKU・r9qd7r）、店の一斉配信③ G-9（iN6np・Z6Hx5o）、状態 SDrMu（B-4）、404（Nx5dz・aLU3r）、ウェビナー Ptr2u、回答フォーム cJwtF、予約 GcyTr・R8tlbw・O2Z8u、**LIFF の新しい板 8 枚**（来店スタンプ jQRsr・V2HU7・xe8ga・h2HKh・etLd8、席の予約 glL3g・km8EG・sAnyy）。PEN-UPDATE は「地図の板 V8 311・V8-B 271」と書くが JSON は 535 | 司令塔 | Pen の地図（V8 311・V8-B 271）から JSON を作り直す。LIFF の分母 28 も数え直す |
| 6-1-7 | 「採用」「提案」の記録の板（A9uRGq・AnbVR・pFtOv・gkCV8・Y7rsjF・RqYwI・YCOoR・OVCot・q1xNMz ほか）は地図に無い（良い）。ただし説明文に古い決まり（元に戻す 5 秒・1.6 秒・✓保存しました）が残る | 文書 | 1-1・1-21 の注で足りる |

### 6-2 見張り・契約試験で新しい決まりとぶつかる決め打ち

| # | file:line | 決め打ち | ぶつかる決まり | 担当 |
|---|---|---|---|---|
| 6-2-1 | apps/web/scripts/verify-design-values.mjs:332-351（V8_MEASURE）＋ apps/web/design/v8-part-values.json（10-01 の写し）。**必須の門** .github/workflows/required-pr-gate.yml:527 | 部品の実寸を 10-01 の値で比べる：doYdE 角丸 10・縁なし・pad 14／状態の札 mpVfY pad [2,8] gap 5（V8_MEASURE に入っている）／Pp3nS pad [16,20]・四方の線／hNXm7 空の表示 枠 1（B-90 は枠なし）／q3DPdz・Q6cQB の pad 14 | B-151・B-152（1・4・9）・B-149・B-90 | コード：部品を直す PR で v8-part-values.json を Pen から写し直す（写さないと mpVfY・CugIm・clV5c などで落ちる） |
| 6-2-2 | apps/web/design/design-parts.json の tokens（--color-hairline #dadde2・--shadow-card・--radius-panel 12・--text-body 14・--text-nano 10）を同じ門が「ビルド後の CSS」で見る | v7 の値を守る見張り | B-124（V8 固定）・B-149・POLISH 2/9 | コード：v8 固定に合わせ tokens を V8 の値へ（または v7 の見張りを外す） |
| 6-2-3 | apps/web/src/lib/size-scale-contract.test.tsx:69-71,80,82,96,101-102,175 | text-nano 10・text-body 14・radius-control 8・radius-panel 12・text-heading 18・radius-large 18 | POLISH #2・#9 | コード |
| 6-2-4 | apps/web/src/app/theme-switch-contract.test.ts:19-36 | 既定は v7・v8 ブロックに radius-control 10／panel 16 | B-124、B-151（主 8） | コード（v8lock と一緒に） |
| 6-2-5 | apps/web/src/app/v8-control-border-contract.test.ts:24 | `--color-control-border: #c9ced6` | B-150（欄の枠 黒12%） | コード：control-border はチェック用に残し、欄は新しい変数（3-3）。試験は残してよいが「欄は control-border」と読む試験があれば直す |
| 6-2-6 | apps/web/src/components/shared/v8-table-row-line-contract.test.ts:21-22 | 行の線は `--shadow-row-line: inset 0 -1px 0 var(--color-divider)` | B-149（線は hairline 1 本） | コード |
| 6-2-7 | apps/web/src/app/issue-673-visual-quality-contract.test.tsx:29 | `--card-edge: rgba(29,29,31,0.08)` | 1-2 で 7% にそろえるなら落ちる | コード（判断のあと） |
| 6-2-8 | apps/web/src/components/shared/toast.test.tsx:65-142 | 「元に戻す」5 秒・⌘Z で元に戻す | B-157 #2・#3（1-1） | コード（判断のあと） |
| 6-2-9 | scenario-ux-delivery.react.test.tsx:89-107、reminder-ux-delivery.react.test.tsx:100-115、auto-reply-ux-delivery.react.test.tsx:110-156、templates/list.test.tsx:154-160、booking/menus/settings-optimistic.react.test.tsx:167、booking/menus/staff/assign-v8-ux.react.test.tsx:107-129（✓保存しました＋元に戻す）、tags/ux-tags-optimistic.test.ts:20-23 | 再開・外す・保存のあとの「元に戻す」 | B-157 #2・#3・#6 | コード（判断のあと。動きの試験なので消さず書き換え） |
| 6-2-10 | apps/web/src/app/glossary-contract.test.ts:100-104 | 「過去30日」「直近30日」を落とす | B-158 #5 | オーナー（2-1）→コード |
| 6-2-11 | apps/web/src/components/templates/page-templates-head-contract.test.ts:13,59-69 と components/shared/page-header.tsx:52,84 | 頭の説明 13/19 を必須・compact の題 20 | B-158 #2（説明は ？）・B-93（題は 22 だけ） | コード |
| 6-2-12 | 「もう一度試す」を含む試験 92 本・「稼働中」62 本・「一時停止」68 本・「'消す'」21 本・「'直す'」10 本・「'やめる'」4 本 | 古い言葉を文字で固定 | B-157 #11・B-158 #1・B-146 | コード（rules2・behavior の中で一緒に。言葉の試験は表の言葉に書き換え） |
| 6-2-13 | scripts/visual-qa/title-audit.mjs:47（必須の門 required-pr-gate.yml:647） | 題 22/700/32 | B-93 と一致。ぶつかるのは v8-design-rules.md:61（1-13）と 6-2-11 の compact 20 | 文書 |
| 6-2-14 | apps/web/scripts/v8-guard/v7-pixel-diff.mjs（required-pr-gate.yml:670 は continue-on-error） | v7 の画素 | B-124 で意味が無い。止めないので落ちはしない | コード（B-124 ③ の掃除で外す） |

---

## オーナーの判断が要るもの（短く）

1. 「元に戻す」は全部やめるか、消す以外（再開・受信箱の右の欄）は残すか（1-1・6-2-8/9）
2. 線の灰を 7% 1つにするか、カード・窓の外枠だけ 8% で残すか（1-2）
3. 主ボタンの角丸 8・高さ（32 は作るボタンだけか）（1-4・1-5）
4. 表の行の左右の余白 16 か 24 か（1-6）。乗せた時の地 2% か 4% か（1-8）
5. 右のパネル・窓の幅の例外（受信箱 320・nen 380・作成の引き出し 1160）（1-14）
6. ボタンの言葉の例外（［変える］［配る］［入る］［止める］「もう一度読み込む」「CSVで書き出す」）（1-16・2-16）
7. 閲覧のみ・403 の頼む先の言葉（1-17）と「店舗／アカウント」の使い分け（1-18）
8. 受信箱のメモの自動保存を残すか（1-20）
9. 期間の言い方「過去30日」か「この30日」か、ダッシュボードとコンバージョンの 28 日をどうするか（2-1・2-2）
10. シナリオ・自動応答・リマインダ・ウェビナーの状態の言葉の分類（2-5・2-6）
11. オートメーションの［動かす］の確認窓を外すか（2-8）
12. 札の5色・主ボタンの縁 #06612f で「新しい色を作らない」（要件 §5-2）を解くか（2-14・3-10）

## すぐ直すべき上位 5 つ

1. **見張りの写しを Pen に合わせる**（6-2-1・6-2-2）：verify:design は必須の門。Codex が look/polish を入れた途端に v8-part-values.json・design-parts.json の古い値で落ちるか、古い値に合わせて戻される。部品を直す PR で写しを Pen から作り直す。
2. **地図を作り直し、測らない板を本当に外す**（6-1-2・6-1-4・6-1-5・6-1-6）：統括・G-9・G-10・コンバージョン・LIFF の 98 枚が地図の外、古い提案 4 枚と決まり・まとめ板が地図の中、MEASURE-EXCLUDE は誰も読んでいない。B-119 の測り直しの前に必須。
3. **「元に戻す」の判断**（1-1）：Pen は部品から消し、確認表 B-26 とコードと試験 10 本以上は残している。Codex の behavior-1009 が始まる前に決める。
4. **線・枠・主ボタンの変数を先に足す**（3-1・3-3・3-4・3-6・3-8・3-9）：--color-hairline の v8 値、欄の枠と影、主ボタンの縁と角丸、乗せる・押す・輪。画面ごとの直書きを防ぐため、Codex の look の最初に入れる。
5. **言葉の決まりと用語表・要件のぶつかりを解く**（2-1・2-3・1-16・1-17）：glossary-contract.test.ts が「過去30日」で落ちる、用語表 §5 と B-158 #13 が逆。rules2-1009 の前に用語表を正本として直す。
