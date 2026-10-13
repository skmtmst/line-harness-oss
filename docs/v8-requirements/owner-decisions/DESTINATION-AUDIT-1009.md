# 行き先と触り方のばらつき（2026-10-09・オーナー「遷移先などはできる限りデザインや触り方は統一」）

読むだけの点検。直すのは別の担当（画面＝Codex、絵＝Claude）。数は文字の検索＋読んだ結果で「目安」。

## 0. 調べた範囲

- コード：`~/lh-work/lh-train-12/apps/web/src`（調べ始め 0151577820、終わりに f941231a78 へ進んでいた）。page.tsx から import をたどって実際に読まれる **792 本**（`src/v8/` 526 本＋`*-v8.tsx`＋v8 の分岐を持たない page.tsx＋そこから読まれる `components/<機能>/` 113 本）。`if (theme === 'v8') return …` で v8 を返す page.tsx の本体（v7）と、読まれない古い `*-v8.tsx`（例：`app/webinars/list-v8.tsx`・`app/conversions/conversion-points-v8.tsx` は V8 では出ない）は外した。
- お客さまの画面：`apps/liff/src` の 46 本。
- 決まり：`~/lh-work/lh-pages-rulesdoc/docs/v8-design-rules.md`（870aed51d1）の §2・§5・§6.8・§6.10〜§6.12・§6.17・§6.19。
- Pen：`~/lh-work/design/v8/html/*.html` 647 枚の板の名前と、中の窓・引き出しの名前と幅。
- 一覧の画面は 124 個、行うことを足す所 41、中の項目を開く所 51、作った物を選ぶ所 約290 を拾った。

## 1. 操作の種類（24）と、今の行き先の数

同じ操作なのに行き先が2つ以上ある＝**「ばらばら」**。24 のうち **22 がばらばら**（揃っているのはタブとヘルプの「？」だけ。ヘルプも一部ずれ）。

| # | 操作の種類 | 今の行き先（件数） | ばらばら |
|---|---|---|---|
| 1 | 一覧の行を開く | 詳細パネル 行全体 12（URL に残る 7・残らない 5）／名前だけで詳細パネル 3／名前 Link で別ページ・行は何もしない 17／行全体で router.push 4／名前ボタンで router.push 2／窓 8／引き出し 2／同じ URL で画面ごと差し替え 4／その場で広がる・左右 13／見かけ上何もしない 1／**何もしない 約57** | ◎ 11通り |
| 2 | 作る | 別ページ 28／窓 22／メニューで作り方を選ぶ 2（一斉配信は窓・別ページ・その場のフォームの3つ）／種類を選ぶ窓→別ページ 1／下書きを作って編集へ 1／同じ URL で差し替え 5／その場で行を足す 6／別の画面へ誘導 3 | ◎ 8通り |
| 3 | 編集する | 別ページ 27／窓 21／引き出し 1／同じ URL で差し替え 4／その場 7（＋名前だけその場 10） | ◎ 5通り |
| 4 | 複製する（21 画面） | その場で増える＋知らせ 9（トースト 4・Notice/帯 5）／知らせなし 2／確かめ・名前を聞いてから別ページ 4（ConfirmDialog 2・窓 1・**詳細パネル** 1）／確かめなしで別ページ 4／写して作る 2。呼び名 7 種 | ◎ 5通り |
| 5 | 削除・アーカイブ・止める | ConfirmDialog 32 画面／自作の確かめ 14／確かめなし＋「元に戻す」7（全部条件つき）／確かめなし（保存まで下書き）6／確かめなし・すぐ反映 2 | ◎ 5通り |
| 6 | 作った物を選ぶ | 共通の選ぶ窓 79／自作の窓 5（＋メディア 10 は別）／プルダウン 156／下に広がる・札・メニュー 27／ID・名前を打つ 12 | ◎ 5通り |
| 7 | 行うこと（アクション）を足す | 入口だけで 12 通り（文字ボタン→メニュー 3・種類ボタンの並び 2・既定で足して後でプルダウン 7・窓の中の札 3・引き出しの中の格子 2・その場の足す行 1 ほか）。中身の行き先：窓 10・下に広がる 9・引き出し 2・その場 約19・別ページ 1。**B-169 どおり 0 か所** | ◎ |
| 8 | 中の項目（ブロック・面・カード・通・段・質問）の設定を開く | 選んだ物の設定が下に出る 4／その場で行が開く 3／下に広がる 5／いつも開いた欄 15／窓 14／引き出し 1／段・タブ・別ページ 7 | ◎ 7通り |
| 9 | オン・オフ・止める・再開 | Toggle ですぐ 約7／確かめの窓 約19／保存で確定 約47。同じ「まとめて止める」が窓（600）・確かめなしに分かれる | ○ |
| 10 | プレビュー（LINE での見え方） | 右の欄に常に 約37／狭いと：窓 8・**確かめの窓** 3・詳細パネル 2・浮く欄 2・引き出し 2・**消えて見られない** 2／窓だけ 5／別ページ 2／新しいタブ 9 | ◎ |
| 11 | テスト送信 | 確かめの窓 16／**すぐ送る** 7／自前の窓 2／その場の小箱 1／別ページ 1 | ◎ |
| 12 | 配る・送る・公開する | ConfirmDialog 約26／幅つき Dialog 約8（480〜860）／**確かめなし** 約13／窓の中で完結 4／手順の画面・別ページ 4 | ◎ |
| 13 | 外へ（新しいタブ） | 新しいタブ 約42（rel が3通り）／**↗ の印なのに同じタブ 約61**（ActionMenu の external は印だけで router.push）／同じタブで外へ 約9 | ◎ |
| 14 | ヘルプ | HelpTip「？」87／説明の窓 2／その場で開く（details・Disclosure）約10 | △ |
| 15 | 戻る・閉じる | パンくず＋キャンセル（正）／ページの中の「← 〇〇へ」約33／帯・本文の「一覧へ戻る」約28／ActionMenu の中の「一覧へ戻る」1 | ◎（決まり B-143 違反が残る） |
| 16 | 絞り込み | 札（FilterChip）約120／作った物の絞り込みがプルダウン（タグ・シナリオ・担当者・店舗・アカウント・ランク）約12／「よく使う絞り込み」が Select 10・ActionMenu 5・自前ポップオーバー 1 | ○ |
| 17 | 並び | 道具の段の Select 約14／押すと入れ替わるボタン 2／窓の中 2／ポップオーバーの中 1 | ○ |
| 18 | 表示項目 | ポップオーバー 1／自前の重ね（role=dialog）1 | ○ |
| 19 | CSV | その場でダウンロード 約37／別ページ 2／自前の窓 1／確かめの窓（理由）2／API へ直リンク 1 | ○ |
| 20 | まとめて操作 | BulkBar 7・**自前の帯** 4。先：窓 7（560・600・640）／確かめの窓 6／**すぐ効く** 3 | ○ |
| 21 | 版の履歴 | 引き出し 1／窓 1／ページの中の欄 2／別ページ 2／表示の切り替え 1 | ◎ 5通り |
| 22 | 違いを比べる（ぶつかり） | 窓 12／確かめの窓 5／**版の履歴の引き出し** 1／その場 2／**一覧へ移る** 2 | ◎ |
| 23 | 詳しく見る（記録・明細の1件） | 別ページ 約20／詳細パネル 約17／窓 約12／引き出し 5／**ConfirmDialog を中身表示に流用** 1／画面ごと差し替え 5 | ◎ |
| 24 | フォルダの操作 | FolderEditorDialog 系 約30（正）／**詳細パネル**（フォルダへ移す・複製 forms）1／自前の窓 1／別ページの上の窓 1 | △ |
| — | タブ | `?tab=`＋`router.replace`（§5・B-158 の 3） | 揃っている |

窓の幅も割れている：Dialog・ConfirmDialog の幅が決まりの4段（480／560／720／960）から外れるもの **66 件**（400・420・440・500・520・540・580・600・620・640・680・800・840・860・1060）。720 は1件、960 は 0 件。Drawer は 13 件中 9 件が 480／540 以外（560・620・640・660・1160）。自前の窓（Dialog を使わない）は 448〜1120 の約20 個。Pen の窓も 400・420・500・520・600・620・640・680・800・840・860・1060 と割れている。

## 2. おすすめの行き先の表（管理画面）

1行1操作。既存の決まり（B-143・B-155・B-157・B-158・B-160・B-163〜B-165・B-169）と合わせた。決まりが無かった所は【新】、既存と食い違って判断が要る所は【判断】（§6 に理由）。

### 2-1. 共通の触り方（全部の面）

| 面 | 幅・位置 | 頭 | 下の帯 | 開き方 | 閉じ方 | Esc | 外を押す | 入力途中で閉じる |
|---|---|---|---|---|---|---|---|---|
| 詳細パネル `DetailPanel` | 右に 360・一覧は左に見えたまま | 題＋「前・次」＋× | 行の主な操作（編集する・…） | 行を押す | ×・Esc・同じ行をもう一度 | 閉じる | **閉じない**（ほかの行を押すとその行に替わる） | — |
| 引き出し `Drawer` | 右から 480（読む・少し直す）／540（並べ替え・編集の道具）。例外：配信を作る 1160 | 題＋×（枠付き 36） | キャンセル・主の操作を中央 | ボタン | ×・Esc・キャンセル | 閉じる | 閉じる | 「入力を破棄しますか？」 |
| 窓 `Dialog` | 真ん中・480（確かめ・小さい入力）／560（入力・見え方）／720（手順・比べる・取り込み）／960（種類を選ぶ）。選ぶ窓だけ 640【判断】 | 題＋× | 右寄せ：［キャンセル］［主］ | ボタン | ×・Esc・キャンセル | 閉じる | 閉じる | 「入力を破棄しますか？」 |
| 確かめの窓 `ConfirmDialog` | 480【判断】（説明が長い・相手の一覧を出すときだけ 560） | 題は全角「？」で終える | ［キャンセル］［〜する］（危ない操作は赤） | ボタン | キャンセル・Esc | 閉じる（= キャンセル） | 閉じない | — |
| メニュー `ActionMenu` | ボタンの下 | — | — | 「…」・▾ | 項目を押す・Esc・外 | 閉じる | 閉じる | — |
| ポップオーバー（絞り込み・表示項目） | 札・ボタンの下 | — | ［クリア］［決める］ | 札を押す | Esc・外 | 閉じる | 閉じる（変更は捨てる） | — |
| 選ぶ窓 `EntityPickerDialog`／`EntityMultiPickerDialog` | 640【判断】・左にフォルダ（よく使う／すべて／フォルダ／未分類）・上に「〜で探す」・行に中身の見本 | 題＋［＋ 作る］＋× | 選んだ数＋［キャンセル］［選ぶ（n件）］ | 欄の「〇〇を選ぶ」副ボタン／「変える」 | 同上 | 閉じる | 閉じる | 選んだ物があれば破棄確認 |
| 別ページ | 型（作る・詳細） | パンくず | 下に追従の帯（キャンセル・保存を中央、削除は左端） | Link（新しいタブで開ける） | パンくず・キャンセル・ブラウザの戻る | — | — | `useUnsavedGuard` |

- URL に残す物：詳細パネルの行（`?<物>=id`、`router.replace`）・タブ（`?tab=`）・手順（`?step=`）・検索・絞り込み・並び・ページ（B-157 の 5）。窓・引き出し・メニューは URL に残さない（戻るで開き直さない）。ただし選んだ行の詳細パネルは戻ると開いたまま。
- 窓の中から窓を開かない（窓→窓は1段まで。確かめの窓だけは窓の上に重ねてよい）【新】。

### 2-2. 操作ごとの行き先（おすすめ）

| # | 操作 | 行き先（例外は条件つき） | 押す所・言葉 |
|---|---|---|---|
| 1 | 一覧の行を開く | **行全体 → 詳細パネル 360**（`?<物>=id`）。名前は Link で詳細・編集ページ（Ctrl/⌘ で新しいタブ）。詳細パネルの無い一覧（行の中身＝そのまま詳細ページの物）は**行全体を Link**。見る中身が無い行（設定の行・記録の1行で中身が全部見えている）は**押せない形**（乗せた地を出さない・`Tr interactive` を外す） | 行のどこでも同じ（B-157 の 4） |
| 2 | 作る | **中身・見え方・手順がある物＝別ページ（作る型）**。欄が 4 つまでで見え方の無い小さい物（フォルダ・休業日・特典・倍率・設備・卓・トークン など）＝**窓 560**。作り方が2〜3通り＝作るボタンを▾付きにして**メニュー**→各行き先。種類が4つ以上で説明が要る＝**種類を選ぶ窓 960**【判断】。作ったら一覧に戻して行を光らせる（続けて設定が要る物だけ次の手順へ＝B-157 の 7） | 「〇〇を作る」（フォルダの列の上） |
| 3 | 編集する | **作るのと同じ箱**（作るが別ページなら別ページ、窓なら窓）。名前だけは詳細パネルの中でその場で直せる。引き出しを編集に使うのは「一覧を見ながら直す並べ替え・表示の道具」（ダッシュボード編集 540）だけ【判断】 | 詳細パネルの［編集する］・行の「…」→「編集する」 |
| 4 | 複製する | **その場で「〇〇のコピー」を元の行の下に下書きで足し、光らせ＋トースト「複製しました」**。確かめ・名前を聞く窓は出さない。続けて設定が要る物（配信・シナリオ・回答フォーム・オートメーション）は、複製してからその編集ページへ移る【判断】 | 行の「…」→「複製する」（言葉は1つ） |
| 5 | 削除・アーカイブ・止める | **ConfirmDialog 1つ**（1件もまとめても・使用中の物は使われている所を本文に出す）。「元に戻す」は使わない（B-157 の 2・B-160 の ①）。名前を打たせるのはアカウント・共通変数だけ。作る画面の中の「保存まで下書き」の行（節目・CTA・枠・コメント）を消すのは確かめなしでよい（保存で確定するため） | 行の「…」の最後に赤で |
| 6 | 作った物を選ぶ | **選ぶ窓**（1つ＝`EntityPickerDialog`・複数＝`EntityMultiPickerDialog`・配るアカウント＝`HqAccountPickerDialog`）。欄は `EntityPickerSummary`（「〇〇を選ぶ」副ボタン→選んだ後は見本・名前（札）＋「変える」）。プルダウンは数の決まった 7 個までだけ（B-155・B-163・B-165）。画像・動画は `MediaPickerDialog`（B-158 の 9） | 欄の副ボタン |
| 7 | 行うことを足す | **［＋ 行うことを足す］副ボタン → 種類のメニュー（ActionMenu）→ 選ぶ物は選ぶ窓・テキストはその場の欄 → 行（印・種類・中身・つまみ・「…」）**。足した行を直す＝行を押すとその行がその場で開く（1度に1つ）。窓・引き出し・下に広がる文字ボタンにしない（B-169）。部品は1つ（`InlineActionRowsV8` を正に寄せる案） | 欄の副ボタン |
| 8 | 中の項目の設定を開く | **その場で開く（1度に1つ）**：一覧の項目（ブロック・通・段・質問・選択肢・すること）は行を押すとその行がカードに開く。画像の上で選ぶ物（面・カード）は**選んだ物の設定を一覧の下に出す**（`TapAreaEditor` の形）。詳しい設定は同じカードの中の `Disclosure`。**窓にしない**【判断】 | 行・面を押す |
| 9 | オン・オフ | その場で効く＝`Toggle`（すぐ反映・失敗で戻して知らせる）。保存で効く＝`Checkbox`（B-158 の 14）。お客さまに届く物を始める・止める＝`ConfirmDialog`（1件もまとめても同じ。B-160 の ⑨） | 行・詳細パネルのトグル |
| 10 | プレビュー | 作る・編集＝**右の欄に常に**（`LinePreview`）。白い板が 1100 未満で畳んだら、頭の［見え方］副ボタン→**窓 560**。一覧＝詳細パネルの中。お客さまの本物の画面＝新しいタブ ↗ | ［見え方］ |
| 11 | テスト送信 | **窓 480**（送る相手＝自分・テスト用の相手を選ぶ→［送る］）→ トースト。押してすぐ送らない【新】 | ［テスト送信］副ボタン |
| 12 | 配る・送る・公開する・予約する | 主ボタン → **ConfirmDialog 480**（だれに・いつ・何件の要約）。手順の最後の段でも同じ。統括の「配る」＝**窓 720**（配る先を選ぶ＋件数＋結果を同じ窓で）【判断】 | 下の帯の主ボタン |
| 13 | 外へ | **新しいタブ・↗・`rel="noreferrer"`** を部品（`Button`・`TextLink`・`ActionMenu` の external）が付ける（B-158 の 12）。中のページへの移動には ↗ を付けない | — |
| 14 | ヘルプ | `HelpTip`「？」の吹き出し。長い手引きは外の手引き（新しいタブ）。説明の窓・`<details>` の説明はやめる | 題の横の「？」 |
| 15 | 戻る・閉じる | ページ＝パンくずと下の帯の［キャンセル］だけ（B-143）。面＝×・Esc（§2-1） | — |
| 16 | 絞り込み | 道具の段の札 → **ポップオーバー**（数の決まった物）／**選ぶ窓**（作った物＝店舗・タグ・シナリオ・担当者・アカウント。B-164）。URL に残す。「よく使う絞り込み」は札の1つ（ポップオーバー） | 道具の段の札 |
| 17 | 並び | 道具の段の「並び」`Select` 1つ（B-157 の 12） | 道具の段 |
| 18 | 表示項目 | 道具の段の右の［表示項目］→ ポップオーバー（チェック）【新】 | 道具の段 |
| 19 | CSV | 書き出す＝その場でダウンロード（「CSVで書き出す」B-158 の 7）。理由が要る物だけ ConfirmDialog 480。取り込む＝**窓 720**（手順：ファイル→確かめ→結果）【新】 | 道具の段・「…」 |
| 20 | まとめて操作 | `BulkBar` → 操作を選ぶ → 確かめ（ConfirmDialog 480、中身を入れる操作は窓 560）→ 結果はトースト（B-157 の 14） | 下から出る白いバー |
| 21 | 版の履歴 | **引き出し 480**（版の一覧）→ 比べる＝窓 720・戻す＝ConfirmDialog【新】 | 頭・「…」の［版の履歴］ |
| 22 | 違いを比べる（ぶつかり） | `SaveConflictBand` → `SaveConflictCompareDialog` **窓 720**（B-157 の 9） | 帯の［違いを比べる］ |
| 23 | 詳しく見る（記録・明細の1件） | 一覧の行から＝**詳細パネル 360**。詳細ページの中の小さい明細（成果・点数の変化・やり取りの中身）＝**窓 560**（読むだけ）。ConfirmDialog を見せるだけに使わない【新】 | 行・［中身を見る］ |
| 24 | フォルダの操作 | `ManagedFolderPanel` の中の `FolderEditorDialog`（追加・名前と色）／`ConfirmDialog`（削除）（B-143）。フォルダへ移す＝窓 480（フォルダを選ぶ） | フォルダの列の「…」・下の「フォルダを追加」 |

## 3. 表に外れる所（件数の多い順）

「コード」＝画面だけ直す。「Pen も」＝絵も違う形で描いてある（先に絵を直す）。板 ID は分かる物だけ。

### 3-1. 作った物をプルダウン・打つ欄で選ぶ（約200 か所・コードだけ。Pen は B-163 で 87 枚に「選んだもの（B-163 窓で選ぶ）」済み）
- 今→表：プルダウン・Combobox・MultiSelect・札・ID 入力 → 選ぶ窓＋`EntityPickerSummary`
- 件数（選ぶ物ごと・C プルダウン／D 広がる・札／E 打つ）：タグ 24/3/2、担当者・ログインユーザー 17/3/0、アカウント 20/4/0、シナリオ 11/0/1、友だち情報欄 11/3/1、テンプレート 7/2/1、予約スタッフ 7/0/0、流入経路・計測リンク 7/0/1、対応マーク 6/1/0、店舗 5/0/0、卓・コース 5/2/0、回答フォーム 4/0/2、リマインダ 4/0/0、共通アクション 4/0/0。
- 大物（1つ直すと広く効く）：
  - `components/shared/condition-builder.tsx:467`（タグ＝札）・`:682`（マーク＝札）・`:711`（情報欄＝Select）・`:739/:752`（シナリオ＝Select）・`:771`（**回答フォームの ID を打つ**）— 20 か所以上の画面に出る。
  - `components/scenarios/action-editor.tsx:1070`（行うことのタグ＝札）・`:1094`・`:1131`・`:1199`（Select）。
  - `components/forms/action-editor.tsx:91/:117/:133/:169/:182`（全部 Select）。
  - `components/broadcasts/broadcast-form.tsx:2343/:2361/:2419/:2438/:2515`（Combobox・Select）、`:2441-2485`（テンプレートを画面の中のパネルで選ぶ）。
  - `v8/automations/create/create.tsx:2633-2637`（**回答フォーム・計測リンク・予約メニュー・イベントを ID で打つ**）、`v8/webinar-edit/notifications.tsx:428`（**タグ・シナリオ・テンプレート・Webhook・リッチメニューを名前・ID で打つ**）。
  - `v8/form-edit/after-tab.tsx:164`（回答したときに付けるタグ＝Select。B-169 で「行うこと」のタグにまとめる）。
  - `components/rich-menus/area-properties.tsx:596`（タグ＝MultiSelect）、`v8/account-new/register.tsx:538`（タグ＝TagToggle）、`v8/booking-staff/staff-new.tsx:400`（予約メニュー＝チェックの並び）、`app/analytics/reports/new/page.tsx:1099/:1118`（保存した分析・宛先＝下に広がるチェック）。
- 絞り込みで作った物をプルダウン（B-164 違反・約12）：`v8/friends/list/list.tsx:597`（タグ）・`:603`（担当者）・`:606`（シナリオ）、`app/chats/page.tsx:2972`、`components/chats/inbox-filter-panel.tsx:122`、`app/booking/bookings/page.tsx:1106`、`v8/restaurant/common-a/frame.tsx:141`・`google/google.tsx:128`・`booking-kit/shell.tsx:213`（店舗）、`app/users/users-v8.tsx:170`・`v8/friends/merged/merged.tsx:171`（アカウント）、`v8/nen-members/list.tsx:139`・`v8/nen-pets/list.tsx:106`。
- 部品そのもの：`EntityPickerDialog` は `SelectionDialog` の既定 'wide'（`--tpl-bcpick-width` 1640×1000）、複数は 760（`entity-picker.tsx:148`・`:310`、`globals.css:2741/2763`）。正の形（受信箱の「テンプレートを選ぶ」）は部品ではなく `v8/inbox-chat/template-picker-view.tsx:71`（Dialog 640）。**部品を 640 の形に直してから各画面を移す**。

### 3-2. 一覧の行を押しても何もしない・行き先が違う（約90 画面・コードだけ）
- 何もしない 約57：`v8/automations/list.tsx:500`、`v8/settings/accounts/accounts.tsx:250`（`Tr interactive` なのに onClick なし）、`v8/inflow-links/list.tsx:707`（同）、`components/staff/login-audit.tsx:248`（同）、`app/booking/staff/page.tsx:223`（同）、`v8/mileage/rewards.tsx:689`、`v8/mileage/earning-rules.tsx:809`、`v8/hq/members.tsx:250`、`v8/hq/home.tsx:559`、`v8/webhooks/outgoing.tsx:592`・`api-tokens.tsx:544`・`interactions.tsx:353`・`sheets.tsx:477`、`v8/settings/line-notifications/screen.tsx:1360`、`v8/restaurant/menu/menu.tsx:163` ほか。→ 押せる行は詳細パネル、押す中身の無い行は押せない形に。
- 名前だけ押せる 20（行全体にする）：回答フォーム `v8/forms/list.tsx:1224`、イベント `v8/events/list.tsx:501`、友だち `v8/friends/list/list.tsx:788`、友だち追加 `v8/friend-add/list.tsx:724`、統括の一括配信 `v8/hq-broadcasts/list.tsx:315` ほか。
- 詳細パネルを URL に残さない 5：一斉配信 `v8/broadcasts/list.tsx:242`、自動応答 `v8/auto-replies/list.tsx:285`、シナリオ `v8/scenarios/list.tsx:185`、ウェビナー `v8/webinars/list.tsx:409`、リマインダ（useState）。→ `useDetailPanelUrl`。
- 行全体で router.push（新しいタブ不可）：リッチメニュー `v8/rich-menus/list.tsx:1035-1050`、マイル残高 `v8/mileage/balances.tsx:456`・履歴 `history.tsx:346`、通知センター `v8/notifications/list.tsx:151`、共通アクション `v8/automations/common-actions.tsx:327`（`<a>` だが preventDefault で Ctrl/⌘ も効かない）、予約メニュー `v8/booking-menus/tabs/menus-tab.tsx:307`。
- 名前で窓・引き出し（詳細パネルに寄せる）：紹介の約束 `v8/affiliates/offers.tsx:484`、成果の承認 `approvals.tsx:459`、支払い `payment.tsx:380`、紹介者 `affiliators.tsx:616`（引き出し 620・Pen `tnTn9`）、紹介の成果 `report.tsx:302`、スコアのルール `app/mileage/score-rules/page.tsx:518`。
- 同じ URL で画面ごと差し替え（別ページにする）：`v8/hq-templates/console.tsx:637`、`v8/settings/staff/staff.tsx:1061`、`v8/friends/merged/merged.tsx:251`、`v8/settings/line-notifications/screen.tsx:1367`、`v8/friend-add/list.tsx:547/754`（`?view=`）。
- 説明と動きが違う：`v8/auto-replies/list.tsx:1615`・`v8/scenarios/list.tsx:1216`（「行を押すと編集」と書くが詳細パネル）。

### 3-3. 戻る口の置き方（約61 か所・コード。Pen は 10-08 に 150 か所消し済み）
- ページの中の「← 〇〇へ」約33：`v8/affiliate-offer-new/create.tsx:251`（:55 に「無くした」とあるのに残る）、`v8/auto-replies/runs.tsx:404`、`v8/common-vars-edit/edit.tsx:1086`・`new.tsx:430`、`v8/form-edit/edit.tsx:913/917`、`v8/form-responses/responses.tsx:452`、`v8/rich-menus/connections.tsx:195`、`v8/scenario-first-step/first-step.tsx:567`、`v8/scenarios/create.tsx:365`・`results.tsx:430`、`v8/tag-edit/search-edit.tsx:881`・`edit-form.tsx:238`、`v8/tags/create.tsx:194`・`field-editor.tsx:254`・`field-migrate.tsx:465`・`mark-editor.tsx:399`、`v8/reminders/edit.tsx:534`・`ui.tsx:68`、`app/auto-replies/edit/wizard-v8.tsx:1244/1506`、`app/reminders/new/new-v8.tsx:320`、`app/rich-menus/new/create-v8.tsx:1732`、`v8/webinar-edit/chrome.tsx:17`、`v8/hq-templates/detail.tsx:180`、`v8/ops/knowledge-article.tsx:106`、`v8/settings/sb-frame/settings-screen.tsx:64`、`app/nen-campaigns/edit/campaign-editor-v8.tsx:291` ほか。
- 帯・本文の「一覧へ戻る」約28：`v8/events/create.tsx:221`、`v8/webhooks/create.tsx:302`、`v8/conversions/create.tsx:525`、`v8/friend-add/editor.tsx:727`、`v8/friend-add-publish/publish.tsx:385`、`v8/nen-campaigns/edit.tsx:395`・`column-new.tsx:115`、`v8/templates/carousel.tsx:365`・`question-new.tsx:229`、`v8/tags/mark-editor.tsx:440`、`v8/reminders/edit.tsx:1852`、`v8/booking-staff/shifts.tsx:333/1001/1011` ほか（できた画面・読めない画面の「一覧へ」は除いてよい）。`v8/friend-detail/detail.tsx:118` は「…」の中に「友だち一覧へ戻る」。

### 3-4. ↗ の印なのに同じタブ（約61・コード＝部品1か所）
- `components/shared/action-menu.tsx:215-216`：`external` は印だけで中身は router.push。使っている所：`v8/broadcasts/list.tsx:697/698/708/715`、`v8/forms/list.tsx:897/909`、`v8/templates/list.tsx:803`、`v8/tags/tags-tab.tsx:479/480`、`v8/mileage/*`、`v8/nen-members/list.tsx:255-260`、`v8/friend-detail/detail.tsx:113-117`、`v8/friend-detail/*-tab.tsx:13`（「〜を見る ↗」5つ）ほか。→ external＝本当に新しいタブ（部品が開く）にし、中のページへの移動からは external を外す。
- rel が3通り（noreferrer／noopener noreferrer／なし `app/rich-menus/edit/page.tsx:1243`）。同じタブで外へ：`v8/webinar-edit/video.tsx` と `app/webinars/edit/video-v8.tsx:563/566`（片方だけ target なし）。

### 3-5. 行うことを足す（41 か所・**Pen も**）
- 入口が文字だけのボタンの並び：回答フォーム `v8/form-edit/after-tab.tsx:147-157`→窓 `:173`（Pen `XXFT4`・統括 `scJcP` も同じ形＝絵も直す）、カルーセルの「動きを実行する」窓の中 `v8/templates/carousel.tsx:634-645`（`InlineActionList` の「＋ 種類名」並び）。
- 文字ボタン1つ→メニュー→下に広がる（B-169 に一番近い・部品の正にする候補）：`components/auto-replies/inline-action-rows-v8.tsx:141-146`（自動応答 `wizard-v8.tsx:2142`・クーポン `asset.tsx:574`・リサーチ `:705`）。直す点：副ボタンにする・タグを選ぶ窓にする（今はチップ `action-editor.tsx:1070-1085`）・**テンプレート／リマインダ／イベントの候補を渡していない不具合**（`inline-action-rows-v8.tsx:126-134`）。
- 窓の中の札：シナリオ `components/scenarios/action-editor.tsx:864-889`（`v8/scenario-detail/detail.tsx:2005-2024/2685/3379`。窓→窓 `:2565-2572`）。
- 引き出しの中の格子：タグ連動 `v8/tag-edit/edit-form.tsx:289-336`→`components/friend-fields/tag-editor-v4.tsx:146-275`（**足した後は直せない**）、統括 `v8/hq-templates/tag-editor.tsx:77`（Pen `gSsPR`）。
- その場の足す行（並べ替え・直すなし）：友だち追加 `v8/friend-add/editor.tsx:1412-1488`。
- 既定で足して後でプルダウン：`components/forms/action-editor.tsx:203-205`、`components/automations/common-action-editor.tsx`、`v8/automations/create/create.tsx:2705-2756`（窓。つまみなし）、`v8/automations/common-action-new.tsx:300-345`、`v8/webinar-edit/notifications.tsx:372/433`（窓・ID を打つ）。
- 別ページへのリンク：一斉配信「＋ アクションを追加する」`components/broadcasts/broadcast-form.tsx:2512`（/common-actions へ）。
- 足す入口なし（絵にはある）：`v8/webhooks/incoming.tsx:674-694`。
- 押したらの「あわせて行うこと」が固定欄：`components/rich-menus/area-properties.tsx:573-629`（Pen `l3NXyz` の採用形に）。

### 3-6. 中の項目の設定を窓・引き出しで開く（約15・**Pen も確かめる**）
- 回答フォームのブロック「詳しい設定」窓 `v8/form-edit/content-tab.tsx:261/281`（その中の選択肢の表がさらに下に広がる `components/forms/choice-table.tsx:206-219`＝3段の奥）、ページの名前 `content-tab.tsx:166`。
- オートメーションの「すること」窓 `v8/automations/create/create.tsx:2714-2780`。
- 質問テンプレートの「押されたら」窓 `v8/templates/question-new.tsx:345-369`（押した選択肢に絞られない）。
- カルーセル「押されたときの動き」窓 `v8/templates/carousel.tsx:634`。
- シナリオの行うこと窓 `v8/scenario-detail/detail.tsx:3379`。
- 来店スタンプの特典・倍率 `v8/visit-stamps/dialogs.tsx:52/106`、成果地点の使う場所 `v8/conversions/create.tsx:505/763`、流入リンクの設定 `v8/inflow-links/detail.tsx:576`（窓 840）。
- 逆に「いつも開いた欄」で長くなる所：リサーチの質問 `v8/template-edit/asset.tsx:601-697`、イベントの質問 `v8/events/create.tsx:419-463`（足した後に直せない）、共通アクション `components/automations/common-action-editor.tsx:92-149`。

### 3-7. 窓・引き出しの幅（約75・**Pen も**）
- 4段の外の Dialog 66：400 `v8/dashboard/dashboard-editor.tsx:424`／420 `v8/inbox-chat/schedule-dialog.tsx:74`／440 `v8/friend-detail/dialogs.tsx:122`／500 `v8/webhooks/sheets.tsx:515`・`v8/webinars/list.tsx:229`／520 ×15（`components/friends/schedule-dialog.tsx:122`＝Pen `MyJP7`、`v8/affiliates/payment-dialogs.tsx:72/189`＝`usDpO`・`CVz5d`、`v8/hq/account-dialogs.tsx:256/329`＝`D6ljr`・`HFsO9`、`v8/nen-members/ranks.tsx:403`＝`dEv6G` ほか）／540 ×5／580 ×2／600 ×13（`v8/mileage/adjust-dialog.tsx:263`＝`M8zhjL`、`v8/mileage/score.tsx:1064`＝`R8NNi`、`v8/restaurant/closures/closure-dialog.tsx:176`＝`nVvXy`、`components/accounts/account-ordering.tsx:294`＝`a7lUk`、`v8/auto-replies/list.tsx:1642/1702` ほか）／620 ×5（`v8/hq/member-dialog.tsx:171/333`＝`BHEl9`・`M4jS9`、`v8/hq-templates/folder-distribution-dialog.tsx:27`＝`JSirC`）／640 ×10（`v8/broadcasts/quick-send.tsx:246`＝`P6vbxn`、`v8/affiliates/bulk-op.tsx:45`＝`hadfk`、`v8/form-edit/edit.tsx:996`＝`Z9wXm`、`v8/forms/list.tsx:1569`＝`GVizd`、`v8/nen-posts/policy-history.tsx:94`＝`N1br7`、`v8/template-detail/detail.tsx:509/553` ほか）／680 ×2／800 ×5（`app/chats/page.tsx:4047`・`size="large"`）／840 1／860 1（`saved-distribution-dialog.tsx:27`＝`d8CL4g`）／1060 1（`v8/templates/list.tsx:1338`＝`RHvRP`）。
- Drawer 9：660 既定（`v8/booking-menus/menu-version-history.tsx:116`、`v8/nen-health/summary.tsx:63`＝`BVuYh` 600、`v8/nen-campaigns/list.tsx:463/529/546`）、560（`order-drawer.tsx:207`＝`nAesv`）、620（`v8/affiliates/drawer.tsx:468`＝`tnTn9`）、640/660（`tag-editor-v4.tsx:191`）。
- 自前の窓 約20（Dialog を使わない）：`components/scenarios/scenario-dialogs.tsx:58`（1120/768）、`components/chats/template-picker.tsx:420`（920・v7 側か要確認）、`components/dashboard/qr-dialog.tsx:303`（820）、`v8/affiliates/dialogs.tsx:301`（800）、`components/accounts/account-edit-modal.tsx`・`media-upload-dialog.tsx:211`（672）、`v8/reminders/sheet-dialog.tsx:66`・`v8/rich-menus/blocked-dialog.tsx:58`（600）、`components/friend-fields/mark-list.tsx:113`、`components/friend-fields/tags-page-v4.tsx:461/508`、`v8/booking-menus/staff-edit-dialog.tsx:82`、`components/events/event-form.tsx:1106/1231`、`components/friends/advanced-search-dialog.tsx:455`、`components/chats/inbox-filter-panel.tsx:94`、`v8/hq-banners/frame.tsx`（BannerDialogFrame）ほか。
- Pen の窓も同じ割れ方（400 `components-ZBjxY`・420 `Ptr2u`・500 `VXZ6T`・520 `B24oNg`/`I0w2e`/`FK5m7`・600 `Al4Ek`/`Hhl9M`/`RwVo5`/`VsSyu`/`cFo2p`/`M8zhjL`/`R8NNi`/`BVuYh`・620 `BHEl9`/`W2GYgL`・640 `GVizd`/`N1br7`/`V6JFnd`/`Z0g3si`/`Z9wXm`/`M0393`・680 `DA0Ag`・800 `CYJ0L`・840 `R9XUMr`・860 `MLgjO`・1060 `RHvRP`）。幅の決まりの板は `GxpYg`「窓とパネルの幅」。

### 3-8. 削除・止めるの確かめがそろわない（約29・コードだけ。Pen は B-160 で済み）
- 自作の確かめ 14：タグ `components/friend-fields/tags-page-v4.tsx:461/508`、マーク `mark-list.tsx:112`、リマインダ `v8/reminders/sheet-dialog.tsx`、紹介者 `v8/affiliates/dialogs.tsx:103`、ランク `v8/nen-members/ranks.tsx:403`、自動応答 `v8/auto-replies/list.tsx:1702`、テンプレート `v8/templates/list.tsx:1409`、回答フォーム `v8/forms/list.tsx:1569`、共通情報 `v8/common-vars/list.tsx:1490`、登録メディア `v8/contents/list.tsx:1326/1463`、共通アクション `v8/automations/common-actions.tsx:428`、飲食メニュー `v8/restaurant/menu/menu.tsx:192/274`、予約台帳、成果地点（表の下の小窓 `v8/conversions/list.tsx:943`）。
- 「元に戻す」7：`v8/tags/tags-tab.tsx:501-514`、リマインダ（下書き）、`v8/broadcasts/list.tsx:512-528`、`v8/auto-replies/list.tsx:395-410`、`v8/scenarios/list.tsx:407-428`、`v8/templates/list.tsx:628-645`、`v8/forms/list.tsx:498-523`。止めるで同じ形：`v8/booking-menus/tabs/menus-tab.tsx:101-118`、`v8/webhooks/outgoing.tsx:214-224`。
- 確かめなし・すぐ反映：`v8/affiliates/offers.tsx:520`（公開を止める）、`v8/inflow-links/list.tsx:361`（受付を止める）。

### 3-9. 配る・送る・公開・テスト送信の確かめ（約22・コード。一部 Pen）
- 公開に確かめなし 約13：`v8/template-edit/rich.tsx:443`・`asset.tsx:453`（message は `:684` で確かめあり）、`v8/events/create.tsx:239`（編集 `app/events/edit/page.tsx:271` は確かめあり）、`app/rich-menus/new/create-v8.tsx:1784`、`v8/conversions/list.tsx:787/931`、`v8/affiliates/offers.tsx:520`、`v8/reminders/edit.tsx:1712`、`v8/friend-add-publish/publish.tsx:373`、`app/auto-replies/edit/wizard-v8.tsx:1082`、`v8/webinar-edit/review.tsx:131`。
- 公開の窓の形が2つ：ConfirmDialog 560（carousel・question）と Dialog 640（`v8/form-edit/edit.tsx:996`＝`Z9wXm`、`v8/template-detail/detail.tsx:509`）、580（`v8/line-notifications/operator-edit.tsx:671`）、600（`v8/ops/announcements.tsx:440`・`ops/support.tsx:568`）。
- 「予約して送る」が 420（`v8/inbox-chat/schedule-dialog.tsx:74`）と 520（`components/friends/schedule-dialog.tsx:122`）。
- 統括の「配る」が手順の画面に替わる（`v8/hq-templates/console.tsx:712`・`v8/tags/fields-tab.tsx:285`・`marks-tab.tsx:270`）と窓 620／860。
- テスト送信をすぐ送る 7：`v8/broadcast-detail/detail.tsx:290`・`reserved.tsx:157`（作るは確かめあり `broadcast-form.tsx:2961`）、`v8/settings/line-notifications/operator-tab.tsx:223`、`v8/nen-campaigns/edit.tsx:360`・`list.tsx:351/471/664`、`app/auto-replies/edit/wizard-v8.tsx:2332`。別ページへ：`v8/friend-add/list.tsx:477`。自前の窓：`v8/scenario-detail/detail.tsx:2361`（768）。

### 3-10. 作る・編集・複製の行き先（約25・コード。複製は Pen `Al4Ek`）
- 一斉配信の作るボタンが3通り（窓・別ページ・**一覧の上に開くフォーム** `v8/broadcasts/list.tsx:1216-1226/1342`）。→ メニューは残し、「テンプレートから」は別ページへ。
- 種類を選ぶ窓 1060（`v8/templates/list.tsx:1338`＝`RHvRP`）。
- 編集だけ窓（作るは別ページ）：流入リンク `v8/inflow-links/list.tsx:802`（`EditRouteDialog`）、成果地点 `v8/conversions/list.tsx:1264`、ログインユーザー `v8/settings/staff/staff.tsx:1165`。
- 引き出しで編集：紹介者 `v8/affiliates/drawer.tsx:468`。
- 複製で名前を聞く・確かめる：シナリオ窓 `v8/scenarios/list.tsx:1369`（Pen `Al4Ek` 600）、**回答フォームは詳細パネルで名前を聞く** `v8/forms/list.tsx:1428`（フォルダへ移すも詳細パネル `:1396`）、リマインダ・リッチメニュー ConfirmDialog（`app/reminders/list-v8.tsx:1259`・`v8/rich-menus/list.tsx:1391`）、自動応答・テンプレート ConfirmDialog のあとその場（`v8/auto-replies/list.tsx:1797`・`v8/templates/list.tsx:1586`）。呼び名 7 種（「複製」「複製する」「複製して作る」「複製して保存」「複製（下書きで作る）」「複製して下書きを作る」「元に新しく作る」）。

### 3-11. プレビューの狭い幅（約11・コード）
- 窓ではない：確かめの窓で見せる `v8/friend-add/editor.tsx:790`・`v8/friend-add-publish/publish.tsx:460`・`v8/scenario-first-step/first-step.tsx:817`、詳細パネル `v8/reminders/edit.tsx:1343`・`app/reminders/new/new-v8.tsx:385`、浮く欄 `components/broadcasts/broadcast-form.tsx:2193`・`v8/hq-broadcasts/create.tsx:1118`、引き出し `v8/nen-campaigns/edit.tsx:560`・`column-new.tsx:329`。
- **見る手段が消える**：`v8/templates/carousel.tsx:419`・`question-new.tsx:253`（`edit.module.css:123` で 1100 未満に隠れ、切り替えボタンなし）。
- 申込ページの見本が窓（`v8/events/application-preview.tsx:58`）と別ページ（`app/events/edit/page.tsx:344`→`/events/preview`）。

### 3-12. 版の履歴・違いを比べる（約12・コード。Pen `N1br7`）
- 版の履歴：引き出し 660 `v8/booking-menus/menu-version-history.tsx:116`／窓 640 `v8/nen-posts/policy-history.tsx:94`（`N1br7`）／ページの中 `v8/template-detail/detail.tsx:454`・`v8/hq-templates/detail.tsx:302`／別ページ `v8/automations/versions.tsx:264`・`v8/mileage/earning-rules.tsx:771`。
- 比べる：確かめの窓で比べる 5（`v8/template-edit/message.tsx:666`、`v8/reminders/edit.tsx:670`、`v8/friend-add/editor.tsx:800`、`v8/tag-edit/edit.tsx:258`、`v8/settings/features/screen.tsx:541`）、版の履歴が開く `v8/booking-menus/menu-form.tsx:802`、**一覧へ移る** `v8/conversions/create.tsx:517`・`v8/mileage/earning-rule-new/create.tsx:258`、680 `v8/inflow-links/new/create.tsx:598`。

### 3-13. まとめて操作・絞り込みの小物（約15・コード）
- 自前の帯：`app/reminders/list-v8.tsx:1092`、`v8/auto-replies/list.tsx:1409`、`v8/scenarios/list.tsx:1025`（すぐ効く）、`v8/templates/list.tsx:1251`。
- 「よく使う絞り込み」の形が3通り（Select 10・ActionMenu 5 `v8/templates/list.tsx:980` ほか・自前ポップオーバー `v8/inflow-links/list.tsx:560`）。並び順が入れ替えボタン `v8/broadcasts/list.tsx:921`・`v8/hq-broadcasts/list.tsx:265`、窓の中 `components/friends/advanced-search-dialog.tsx:765`（段の欄 `list.tsx:677` と二重）。
- 表示項目が自前の重ね：`components/chats/friend-info-sidebar.tsx:1549`。

### 3-14. 詳しく見る・フォルダ（約8・コード）
- ConfirmDialog を中身の表示に流用：`v8/settings/line-notifications/runs-tab.tsx:265`。
- 同じ一覧で行は詳細パネル・メニューの「見る」は別ページ：`v8/broadcasts/list.tsx:697`、`v8/events/list.tsx:255`、`v8/common-vars/list.tsx:753`。
- フォルダへ移す・複製を詳細パネルで：`v8/forms/list.tsx:1396/1428`。フォルダ追加の自前の窓：`v8/inflow-links/genre-dialog.tsx:61`。

## 4. お客さまの画面（LIFF）

### 4-1. 今
| 操作 | 今の行き先 | ばらばら |
|---|---|---|
| 手順を進む | 下の帯の主ボタン（全部） | 揃っている |
| 手順を戻る | 主ボタンの下の小さい文字「← 〇〇を選び直す」（`pages/Booking.tsx:201`・`components/DateTimePicker.tsx:709`・`components/Confirm.tsx:130`）／帯の外に置く（`pages/seat/SeatConfirm.tsx:155`）／「← 戻る」で履歴を戻る（`pages/EventConfirm.tsx:150/303`）／文字ボタン「戻る」（`pages/VisitStamps.tsx:383`）／副ボタン「カードに戻る」（`VisitStamps.tsx:232/431`） | ◎ 4通り |
| 手順の持ち方 | 画面の中の状態だけ（予約 `Booking.tsx` の setStep・席 `SeatReserve.tsx` の setView・スタンプ `VisitStamps.tsx` の setView）／路で持つ（イベント `/events/:id/confirm`・`/done`） | ◎（端末の戻るの効き方が違う） |
| 閉じる | 上の帯の ×（`ui/LiffHeader.tsx:48`）・終わりの画面の主ボタン「閉じる」（closeWindow） | 揃っている |
| 確かめ（取り消す） | 共通の `ui/ConfirmDialog`（`BookingHistory.tsx:265/282`・`EventBookings.tsx:347/365`・`EventDone.tsx:152`・`SeatReserve.tsx:475`） | 揃っている |
| 下から出る面 | 自作が2つ：`components/WaitlistSheet.tsx:119`（つまみ付き）・`components/WaitlistOfferSheet.tsx:22`（つまみなし）。どちらも Esc・フォーカスの扱いなし | ○ |
| 空きが出た案内 | 予約・席＝予約画面の上の下から出る面（`Booking.tsx:108`）／イベント＝全画面（`EventWaitlistOffer.tsx`・`App.tsx:32`・Pen `BjcuB`） | ◎ |
| 支払いへ | 同じ画面で移る（`components/Done.tsx:46` の location.href）／LINE の外のブラウザ（`components/BookingPayment.tsx:101` の openWindow external）＋新しいタブのリンク（`:176`） | ◎ |
| 外へ | 新しいタブ（`Event.tsx:202`・`Form.tsx:1070/1082`・`ui/PrivacyNote.tsx:21`）／LINE の外のブラウザ（`Webinar.tsx:285`）／同じ画面（`Affiliate.tsx:369/457`） | ◎ 3通り |
| ヘルプ | `HelpTip` の吹き出し（`Affiliate.tsx:480`） | 揃っている |
| 選ぶ（メニュー・担当・日時・席） | その画面のカードを押す（緑の枠） | 揃っている |

### 4-2. おすすめ（LIFF）
| 操作 | 行き先・触り方 |
|---|---|
| 手順を進む | 下の帯の主ボタン（幅いっぱい・48）。Pen `sxNO5` のとおり |
| 手順を戻る | 主ボタンの下の小さい文字「← 〇〇を選び直す」1つ（帯の中）。文字ボタン・副ボタンの「戻る」はやめる |
| 手順の持ち方 | URL に `?step=` で持ち、端末の戻る＝1つ前の手順【判断】 |
| 閉じる | 上の帯の ×・終わりの画面の主ボタン「閉じる」 |
| 確かめ | `ui/ConfirmDialog`（真ん中） |
| 下から出る面 | 共通の部品1つにする（つまみ・Esc・フォーカスを戻す）。キャンセル待ちの登録・空きが出た案内を同じ部品で |
| 空きが出た案内 | 予約・席・イベントで同じ形（下から出る面）【判断】 |
| 支払い・外のサイト | 1つの関数で：LINE の中なら `liff.openWindow({ external: true })`、外なら新しいタブ |
| LIFF の中の別の画面 | 同じ画面で移る |

LIFF で表に外れる所：手順を戻る 4（`SeatConfirm.tsx:155`・`EventConfirm.tsx:303`・`VisitStamps.tsx:383`・`:232/:431`）、手順の持ち方 3（`Booking.tsx`・`SeatReserve.tsx`・`VisitStamps.tsx`）、下から出る面 2、空きが出た案内 1、支払い 1（`Done.tsx:46`）、外へ 2（`Affiliate.tsx:369/457`）。Pen：`BjcuB`（イベントの空きが出た＝全画面）を直すかは【判断】と一緒に。

## 5. ついでに見つけた不具合の候補（行き先の点検の外・確かめてから直す）
1. 統括の属性の行を押すと URL だけ変わり何も開かない：`v8/tags/marks-tab.tsx:533`・`fields-tab.tsx:561`（`open={!host && …}`）。
2. 自動応答・クーポン・リサーチ・カルーセルの「行うこと」で、テンプレート送信・リマインダ・イベントの対象を選べない（候補を渡していない）：`components/auto-replies/inline-action-rows-v8.tsx:126-134`、`inline-action-list.tsx:25-96`。カルーセルは担当者通知も。
3. カルーセル・質問テンプレートは 1100 未満で見え方を見る手段が無くなる：`v8/templates/carousel.tsx:419`・`question-new.tsx:253`。
4. 予約の詳細の窓 `app/booking/bookings/booking-detail-v8.tsx:74` は開く道が無い（`page.tsx:915` の detailId が null のまま）。
5. タグ連動のアクションは足した後に直せない：`v8/tag-edit/edit-form.tsx:316-327`。
6. 共通アクションの名前リンクが Ctrl/⌘ でも新しいタブにならない：`v8/automations/common-actions.tsx:327`。
7. ID・名前を打たせる欄：`v8/automations/create/create.tsx:2633-2637`、`components/shared/condition-builder.tsx:771`、`v8/webinar-edit/notifications.tsx:428`。

## 6. オーナーの判断が要るもの
1. **選ぶ窓の幅**：B-165 は「受信箱のテンプレートを選ぶ（640）が正」、B-158 の 8 は「窓は 480／560／720／960 の4段」。おすすめ＝**640 を選ぶ窓だけの例外として段に足す**（Pen `EpTBB`・`WjFWW`・`M0393`・`GxpYg` がすでに 640）。
2. **編集の箱**：B-158 の 8 は「編集＝Drawer 480／540」だが、今は窓 21・引き出し 1。おすすめ＝**作るのと同じ箱（別ページか窓）**にし、引き出しは「一覧の横で読む・少し直す面（版の履歴・注文・明細・ダッシュボード編集）」に限る（B-158 の 8 の言い方を直す）。
3. **複製**：おすすめ＝**その場で下書きを足す（確かめ・名前を聞かない）**。続けて設定が要る物だけ編集ページへ。Pen `Al4Ek`（シナリオの複製の窓）を直す。
4. **中の項目の設定を窓で開かない**：おすすめ＝**その場で開く（1度に1つ）＋詳しい設定は同じカードの中で開く**。回答フォームのブロック・オートメーションのすること・カルーセル・質問テンプレート・シナリオの行うことの窓（約8）が対象で、変更が大きい。Pen の該当板も直す。
5. **確かめの窓の既定の幅**：今は部品の既定が 560（194 か所）。おすすめ＝**480**（部品1か所の変更。長い説明・相手の一覧を出す窓だけ 560）。
6. **種類を選んで作る**：3つまで＝作るボタンのメニュー、4つ以上＝窓 960。Pen `RHvRP`（1060・G-2 採用）・`R9XUMr`（840）を 960 にそろえてよいか。
7. **統括の「配る」**：今は手順の画面に替わる所と窓（620・860）がある。おすすめ＝**窓 720 に1つ**（選ぶ・件数・結果を同じ窓で）。Pen `JSirC`・`d8CL4g`・`MLgjO`・`W2GYgL` を直す。
8. **↗ の意味**：おすすめ＝**↗＝新しいタブだけ**。中のページへの移動（約61）から ↗ を外す。
9. **LIFF の手順を URL に残すか**と、**イベントの空きが出た案内を下から出る面にそろえるか**（Pen `BjcuB`）。

## 7. 直す順のおすすめ（部品から）
1. 部品：`EntityPickerDialog` を 640 の形に／`ConfirmDialog` の既定幅／`ActionMenu` の external を新しいタブに／`DetailPanel` を `useDetailPanelUrl` 必須に／LIFF の下から出る面の部品。
2. 共通の部品の中の選ぶ欄：`condition-builder`・`scenarios/action-editor`・`forms/action-editor`・`broadcast-form`（1つ直すと 20 画面以上に効く）。
3. 「行うこと」の部品を1つにして 41 か所を置き換え（Pen `XXFT4`・`scJcP`・`gSsPR` を先に）。
4. 一覧の行の動き（何もしない 57・名前だけ 20・URL に残さない 5）。
5. 窓の幅 66＋引き出し 9（Pen と同時）。
6. 戻る口 61・確かめ 29・公開とテスト送信 22・そのほか。
