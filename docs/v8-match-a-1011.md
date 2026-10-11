# 見た目合わせ（a）2026-10-11

## 今の進捗

- 作業場所：`~/lh-work/lh-pages-matcha`。ブランチ：`codex/kenta-match-a-1011`。
- 開始版：`fc073798f0638d54f82d7977ecde3747800847c1`（列車18）。本線の取り込みなし。doctor 合格。
- 地図613板から担当152板を抽出。21板は既存の測定除外指定。残る131板を全件測定し、撮影条件を補った25板を再測定（26回）。
- 共通部品の修正と検証を完了。個別の機能はまだ90%到達を確認していない。目視による合格は司令塔のみ。
- push・PR・D1・配備は実施していない。

## 測定の条件

- 基準は10-11固定HTMLとPencilの文字座標。幅は各板に記載された1440または1152。窓だけの板・まとめ板・未再現の状態は全画面の候補に数えない。
- 書き出しで消えたURLの手順指定・窓のクリック・閲覧権限は、同じ板ID・同じ名前の既存撮影条件と実装を照合し、撮影用の写しだけに補った。正本の地図・絵・座標・閾値は変更していない。
- 撮影用の写し：`~/lh-work/design/v8/overlay/pages-matcha/capture-map-1011.json`。撮影前後の版とクリーン状態をmeasure.shが確認する。
- 初回の証拠：`~/lh-work/design/v8/overlay/baseline-matcha-1011/`。以後の重ね絵：`~/lh-work/design/v8/overlay/pages-matcha/`。
- 実行：`MEASURE_MAP=~/lh-work/design/v8/overlay/pages-matcha/capture-map-1011.json zsh ~/lh-work/tools/hq/measure.sh matcha <板ID,…>`。共通の3枠のうち1枠、開発サーバーとPlaywrightは各1つ。
- 全試験は測定サーバーを止めて実行する。試験自身がNext devとPlaywrightを起動するため、同時実行で.nextを壊した回は採用せず、同じ版で撮り直した。HOW-TO-90.mdに追記済み。

## 板ごとの一致率（前→後）

率は同じ文字の位置±4px。見つからない文字数・状態も別に確認する。「—」は成功率を作っていない。後はコミット後に同じ条件で測った値だけ記入する。

| 板ID | 幅 | route | 前 | 後 | 状態 |
|---|---:|---|---:|---:|---|
| SDrMu | 1100 | / | — | 未測定 | 撮影未取得 |
| Ptr2u | 880 | /webinars/edit | — | 未測定 | 撮影未取得 |
| A0pDt | 1440 | /auto-replies/edit | 18% | 未測定 | 初回測定済み |
| A8jzaQ | 1440 | /broadcasts | — | 未測定 | 測定除外 |
| ADjK8 | 1440 | /friends | 14% | 未測定 | 初回測定済み |
| ARuZ4 | 1440 | /scenarios/detail | 65% | 未測定 | 初回測定済み |
| Al4Ek | 1440 | /scenarios/detail | 61% | 未測定 | 初回測定済み |
| AqDWN | 1440 | /tags/searches/edit | 14% | 未測定 | 初回測定済み |
| BeNtj | 1440 | /broadcasts/reserved | 33% | 未測定 | 初回測定済み |
| BxGhV | 1440 | /scenarios | — | 未測定 | 測定除外 |
| C0lfUP | 1440 | /friend-add-settings | 75% | 未測定 | 初回測定済み |
| CRtK8 | 1440 | /broadcasts/reserved | — | 未測定 | 測定除外 |
| CYJ0L | 1440 | /friends | — | 未測定 | 測定除外 |
| E7iAYs | 1440 | /webinars | 13% | 未測定 | 初回測定済み |
| F3X1Mo | 1440 | /broadcasts/detail | 11% | 未測定 | 初回測定済み |
| FU2aU | 1440 | /broadcasts/new | — | 未測定 | 測定除外 |
| G4GejG | 1440 | /auto-replies | 55% | 未測定 | 初回測定済み |
| G8i4xP | 1440 | /auto-replies | — | 未測定 | 測定除外 |
| G9C4Uw | 1152 | /friends/identity-candidates | 5% | 未測定 | 初回測定済み |
| GobMd | 1440 | /tags/fields/migrate | 18% | 未測定 | 初回測定済み |
| Guoye | 1440 | /auto-replies/edit | 9% | 未測定 | 初回測定済み |
| Hn9eE | 1440 | /friends/detail | 24% | 未測定 | 初回測定済み |
| I1E7Bt | 1440 | /tags | 13% | 未測定 | 初回測定済み |
| IIesG | 1440 | /auto-replies | 32% | 未測定 | 初回測定済み |
| IWnYX | 1440 | /tags | 13% | 未測定 | 初回測定済み |
| Iffil | 1152 | /reminders | 49% | 未測定 | 初回測定済み |
| IjVpM | 1440 | /tags/folders/new | 12% | 未測定 | 状態未再現・参考値 |
| JCDRm | 1440 | /friends/detail | 3% | 未測定 | 初回測定済み |
| K7HWG | 1440 | /auto-replies/edit | 22% | 未測定 | 初回測定済み |
| L48eY | 1440 | /friends/migrations | 11% | 未測定 | 状態未再現・参考値 |
| LEwkJ | 1440 | /friend-add-settings | 74% | 未測定 | 初回測定済み |
| LPOe7 | 1440 | /webinars/new | 13% | 未測定 | 初回測定済み |
| M0393 | 1440 | /chats | — | 未測定 | 測定除外 |
| MRhef | 1440 | /friend-add-settings | 77% | 未測定 | 状態未再現・参考値 |
| MyJP7 | 1440 | /friends | 20% | 未測定 | 初回測定済み |
| N43uVX | 1440 | /friend-add-settings/runs/detail | 19% | 未測定 | 状態未再現・参考値 |
| NtCE3 | 1440 | /broadcasts | 25% | 未測定 | 初回測定済み |
| OPGU2 | 1440 | /scenarios/detail | 60% | 未測定 | 初回測定済み |
| Omqd4 | 1440 | /webinars | 15% | 未測定 | 初回測定済み |
| P20kYU | 1152 | /friend-add-settings | 43% | 未測定 | 初回測定済み |
| P6vbxn | 1440 | /broadcasts | 14% | 未測定 | 初回測定済み |
| PMLkX | 1440 | /scenarios/detail | 61% | 未測定 | 初回測定済み |
| Q0Jrk | 1440 | /webinars | 6% | 未測定 | 初回測定済み |
| Q28Gb | 1440 | /broadcasts/detail | 32% | 未測定 | 初回測定済み |
| Q5F2QE | 1440 | /friends/detail | — | 未測定 | 測定除外 |
| Q5lOCc | 1440 | /auto-replies | 37% | 未測定 | 初回測定済み |
| Qat9s | 1440 | /tags/edit | 8% | 未測定 | 初回測定済み |
| R83uvQ | - | /scenarios | 0% | 未測定 | 状態未再現・参考値 |
| REIxB | 1440 | /friend-add-settings/runs | 1% | 未測定 | 初回測定済み |
| RrYYJ | 1440 | /reminders | — | 未測定 | 測定除外 |
| RwVo5 | 1440 | /reminders | 0% | 未測定 | 初回測定済み |
| SXCb3 | 1440 | /friends | — | 未測定 | 測定除外 |
| SkY9V | 1440 | /reminders | 30% | 未測定 | 初回測定済み |
| T0nis | 1440 | /reminders/new | 27% | 未測定 | 初回測定済み |
| T9gblG | 1440 | /friends/migrations | 8% | 未測定 | 初回測定済み |
| U0aKD | 1440 | /tags | — | 未測定 | 測定除外 |
| U5rxyH | 1152 | /scenarios/first-step | 8% | 未測定 | 初回測定済み |
| U8Xm3X | 1440 | /friend-add-settings/publish | 4% | 未測定 | 状態未再現・参考値 |
| UGrd2 | 1440 | /auto-replies/edit | 16% | 未測定 | 初回測定済み |
| UyUMw | 1440 | /webinars | 44% | 未測定 | 初回測定済み |
| V4LjH | 1440 | /auto-replies/edit | — | 未測定 | 撮影未取得 |
| V6xAo | 1440 | /scenarios/first-step | 6% | 未測定 | 初回測定済み |
| VE1u5 | 1440 | /reminders/new | 13% | 未測定 | 初回測定済み |
| VWNaA | 1440 | /webinars | 3% | 未測定 | 初回測定済み |
| VXZ6T | 1440 | /webinars | 40% | 未測定 | 初回測定済み |
| VsSyu | 1440 | /reminders | 31% | 未測定 | 初回測定済み |
| WPrd5 | 1152 | /auto-replies | 40% | 未測定 | 初回測定済み |
| WQmep | 1440 | / | 29% | 未測定 | 初回測定済み |
| X0QrW0 | 1440 | /scenarios | 33% | 未測定 | 初回測定済み |
| X4STXS | 1440 | /scenarios/results | 7% | 未測定 | 初回測定済み |
| XCUNf | 1440 | /webinars/new | 7% | 未測定 | 状態未再現・参考値 |
| XJUqs | 1440 | /auto-replies/edit | 6% | 未測定 | 状態未再現・参考値 |
| Xr6eu | 1440 | /broadcasts | — | 未測定 | 測定除外 |
| YChR6 | 1440 | /reminders/new | 18% | 未測定 | 初回測定済み |
| Z0jHp | 1440 | /friends/migrations | 8% | 未測定 | 状態未再現・参考値 |
| Z2LIUx | 1152 | /auto-replies/edit | 18% | 未測定 | 初回測定済み |
| Z6Hx5o | 1440 | /broadcasts/new | 0% | 未測定 | 状態未再現・参考値 |
| a5C1p | 1440 | /reminders | 35% | 未測定 | 初回測定済み |
| aPeD8 | 1152 | /tags | 17% | 未測定 | 初回測定済み |
| al47K | 1440 | /friend-add-settings | 7% | 未測定 | 初回測定済み |
| apLqS | 1440 | /reminders | 36% | 未測定 | 初回測定済み |
| axFrW | 1440 | /scenarios | 34% | 未測定 | 初回測定済み |
| bIdqV | 1440 | /broadcasts | — | 未測定 | 測定除外 |
| cFo2p | 1440 | /friend-add-settings | 74% | 未測定 | 初回測定済み |
| cdZBf | 1440 | /broadcasts/reserved | 4% | 未測定 | 初回測定済み |
| cgiGB | 1440 | /broadcasts/detail | 29% | 未測定 | 初回測定済み |
| d9xoI | 1440 | /tags/new | 5% | 未測定 | 初回測定済み |
| dK1aE | 1440 | /broadcasts/detail | — | 未測定 | 測定除外 |
| dnzqC | 1440 | /scenarios/new | 6% | 未測定 | 初回測定済み |
| e0FD1J | 1440 | /friend-add-settings/publish | 20% | 未測定 | 状態未再現・参考値 |
| eAQ3t | 1440 | /webinars | — | 未測定 | 測定除外 |
| eovoG | 1440 | /chats | 25% | 未測定 | 初回測定済み |
| f63Jza | 1440 | /broadcasts/new | 14% | 未測定 | 状態未再現・参考値 |
| fcg2D | 1440 | /friends/identity-candidates | 3% | 未測定 | 初回測定済み |
| fkGUR | 1440 | /tags | 5% | 未測定 | 初回測定済み |
| h5rm8t | 1440 | /friend-add-settings | 7% | 未測定 | 初回測定済み |
| h8uNW | 1440 | /friend-add-settings | 10% | 未測定 | 初回測定済み |
| hjNpJ | 1440 | /reminders/new | 15% | 未測定 | 状態未再現・参考値 |
| hn6Y8 | 1440 | /friends/identity-candidates | 5% | 未測定 | 初回測定済み |
| i1nThZ | 1440 | /friend-add-settings | 9% | 未測定 | 初回測定済み |
| i8F12 | 1440 | /auto-replies | — | 未測定 | 撮影未取得 |
| iN6np | 1440 | /broadcasts/new | 14% | 未測定 | 初回測定済み |
| j7PP04 | 1440 | /webinars/new | 16% | 未測定 | 初回測定済み |
| jiNg0 | 1440 | /webinars | 31% | 未測定 | 初回測定済み |
| jjFNi | 1152 | /broadcasts | 45% | 未測定 | 初回測定済み |
| k32cn | 1440 | /reminders/edit | 11% | 未測定 | 初回測定済み |
| kFz4b | 1440 | /friend-add-settings | — | 未測定 | 測定除外 |
| kz2B6 | 1440 | /scenarios/detail | 64% | 未測定 | 初回測定済み |
| l5V9a | 1440 | /broadcasts | 37% | 未測定 | 初回測定済み |
| loVfW | 1440 | /reminders/detail | 15% | 未測定 | 初回測定済み |
| ltAaq | 1440 | /reminders/new | 18% | 未測定 | 状態未再現・参考値 |
| mcOqK | 1440 | / | — | 未測定 | 測定除外 |
| nF4ts | 1440 | /friends | 3% | 未測定 | 初回測定済み |
| nMSiE | 1440 | /scenarios/detail | 73% | 未測定 | 初回測定済み |
| nWmLg | 1440 | /auto-replies/runs | 2% | 未測定 | 初回測定済み |
| p15At | 1152 | /friends/identity-candidates | 16% | 未測定 | 初回測定済み |
| p5YuP | 1440 | /reminders/new | 15% | 未測定 | 初回測定済み |
| pNiUk | 1440 | /broadcasts/detail | 24% | 未測定 | 初回測定済み |
| pvimJ | 1440 | /webinars | 5% | 未測定 | 初回測定済み |
| q5gbcM | 1440 | /tags | 14% | 未測定 | 初回測定済み |
| r1l0bT | 1152 | /reminders/new | 6% | 未測定 | 初回測定済み |
| rbAig | 1440 | /reminders/detail | 10% | 未測定 | 初回測定済み |
| rfhIf | 1440 | /auto-replies/edit | 16% | 未測定 | 初回測定済み |
| sFwWf | 1440 | /friend-add-settings | — | 未測定 | 撮影未取得 |
| tPm3e | 1440 | /broadcasts/detail | — | 未測定 | 測定除外 |
| u8sKN | 1440 | /auto-replies | — | 未測定 | 撮影未取得 |
| uBMuB | 1152 | /webinars | 38% | 未測定 | 初回測定済み |
| uE9gf | 1440 | /auto-replies | 35% | 未測定 | 初回測定済み |
| uNsEy | 1440 | /webinars | 12% | 未測定 | 初回測定済み |
| ulq9Y | 1440 | /tags/marks/edit | 13% | 未測定 | 初回測定済み |
| v7GV2 | 1440 | /chats | — | 未測定 | 測定除外 |
| vKDj5 | 1440 | /tags | 16% | 未測定 | 初回測定済み |
| w9zY5 | 1440 | /tags/fields/edit | 25% | 未測定 | 初回測定済み |
| wDzkc | 1440 | /friend-add-settings | 25% | 未測定 | 初回測定済み |
| wfHIE | 1440 | /broadcasts/detail | — | 未測定 | 測定除外 |
| wjfLe | 1152 | /scenarios | 38% | 未測定 | 初回測定済み |
| x6QsVz | 1440 | /friends | 25% | 未測定 | 初回測定済み |
| xHpkS | 1152 | /friend-add-settings | 38% | 未測定 | 初回測定済み |
| xn95q | 1440 | /tags/edit | 10% | 未測定 | 初回測定済み |
| ywJ5H | 1440 | /friends | — | 未測定 | 測定除外 |
| z2dgw | 1440 | /webinars | 5% | 未測定 | 初回測定済み |
| Ct7aA | - | /chats | 0% | 未測定 | 部分の板・参考値 |
| cu3vm | - | /scenarios/new | 5% | 未測定 | 部分の板・参考値 |
| GBTyR | - | /chats | 25% | 未測定 | 部分の板・参考値 |
| aZ8li | 1440 | /friends | 3% | 未測定 | 初回測定済み |
| lwWLu | 1440 | /friends | 3% | 未測定 | 初回測定済み |
| ENfsi | - | /friends | 17% | 未測定 | 状態未再現・参考値 |
| fmToi | 1440 | /friends | 4% | 未測定 | 状態未再現・参考値 |
| y2n1z | 1152 | /friends | 4% | 未測定 | 状態未再現・参考値 |
| vX3wQ | 1440 | /friends/detail | 6% | 未測定 | 初回測定済み |
| e5uuD0 | - | /chats | 25% | 未測定 | 状態未再現・参考値 |
| K1DlHi | - | /friends/detail | 0% | 未測定 | 部分の板・参考値 |

## 原因の分類

| 分類 | 確認した原因 | 対応 |
|---|---|---|
| 型・共通部品の値 | 選択中の太字を400で上書き、古い黒指定、古いラジオ18px指定 | 通常・選択を分け、B-203/B-211の共通値へ整理 |
| 型・共通部品の値 | 補足の円をHelpTipとSectionHeaderの両方で描画 | HelpTipだけが円を持つ |
| 画面の並び・余白 | タグのタブを共通36pxから30pxへ上書き | 画面側の高さ・下余白の上書きを削除 |
| 見本データ・状態 | 編集手順のURL消失、窓を開く前の行メニュー操作の抜け | 撮影用の写しだけ補い、初回から再測定 |
| 絵に無い物・コードに無い物 | 個別画面の項目・窓の差 | 個別照合中。機能が必要なら機能待ちへ分ける |

## 直した共通部品

- タブ、切り替え、絞り込みの札、ページ送り、ラジオ、選ぶカード、チェックのカード、リンク、最近の動きの行、削除ボタン、表の見出し、数の帯、段の見出し、フォルダの列。
- フォルダの行の余白は上下8・左右12。表の見出しは固定版の左右24へそろえる。表の外側とセル間の余白は分け、一覧内のセルを一律24へ広げる変更は右端の新規崩れを生んだため撤回。画面ごとの上書きは足していない。
- B-211の切り替え用の緑をページ内タブへ誤って当てていた全体の指定から、role="tab"を外す。タブはB-180の黒い文字・下線を共通部品で保つ。
- 表の名前はシナリオ・一斉配信の既存指定も黒700へ。行の開き方や操作は変更しない。
- 設計の見張りは、選択中のチェックカードを通常のcardだけで測っていた指定をcard＋checkedへ修正。通常1px／選択2pxを別々に読む回帰試験を追加。閾値・固定した値・動きの試験は変更しない。
- 本ビルドで503項目すべて一致、未許可0を確認し、設計の一時許可25件を削除。他の一時許可・期限・見張りは変更していない。
- 古い見た目を固定していた試験を更新：一斉配信の名前500→700、数の帯の題13→12、選択札の黒→緑。チェックカードの消えた規則の例外を削除。補足の円の古いCSSクラス参照も外し、設計負債の基準は増やしていない。保存・送信・権限などの動きの試験は残した。

## 機能待ち・撮影待ち

| 板 | 状態 | 次に確認すること |
|---|---|---|
| fmToi・y2n1z | 撮影手順待ち | 列のチェックを外す操作を再現。実装済みの表示列変更を撮る。APIが無いとは扱わない |
| ENfsi・e5uuD0・GBTyr・Ct7aA・cu3vm・K1DlHi | 部分の板／まとめ板 | 全画面と混ぜて候補へ数えない。部分の照合方法を確認 |
| SDrMu・Ptr2u | 撮影未取得 | 道具が受け付けない幅の部分板。幅を1440へ偽装しない |
| V4LjH | 状態未取得 | 有効化前の確認を完了する。確認の動きを弱めず撮影条件を直す |
| i8F12・u8sKN | 撮影手順を補正・再測定待ち | フォルダの「…」ではなく「予約変更のお問い合わせ」の操作を指定 |
| sFwWf | 撮影手順待ち | 対象行と部分板の照合条件を確認 |
| その他 | APIが無い機能はまだ確定していない | 古い板名の「API待ち」だけで判断せず、現行APIを確認 |

## 絵とオーナーの決まりの食い違い（変更しない）

| 対象 | 固定した絵 | 現行の決まり／見張り |
|---|---|---|
| I1E7Bt・Iffil・IjVpM・SkY9V・VsSyu・a5C1p・aPeD8・apLqS・fkGUR・q5gbcM | 表の行52px | B-178の一覧見張りは60px。B-217で正の骨組みは更新されたが、見張りの高さは60pxのまま |
| タグ一覧 | 状態の列なし | B-217確定は「状態は列」。列を消す判断は司令塔 |
| ダッシュボードのグラフ／表 | 選択が白地 | B-211は全部の切り替えに薄い緑を要求。白へ戻さない |
| 自動応答の集計期間 | 過去28日 | B-160は過去30日。APIの28日集計を見た目だけ30日と表示しない |

## 検証

- 開始版の全Web試験：2,130ファイル、12,437テスト成功。負荷の影響で2ファイル6テスト失敗。測定サーバーを止め1ワーカーで2ファイル38テストを再実行し全成功。動きの試験は削除していない。
- 共通部品の変更後：関連7ファイル61テスト成功。持ち主の見張りは新規・未許可0。
- 型検査・ビルドはWebとその他の全パッケージで成功。設計照合503/503、ルールの値43項目と部品26組も一致。一時許可削除後にも未許可0。崩れの見張りの回帰試験19件成功。
- 変更後の全Web試験：2,130ファイル、12,438テスト成功、古い見た目の契約5件失敗。期待値・不要な例外・消したクラスの参照を直し、失敗した5ファイル41テストは全成功。スキップ1・todo1は元からの指定。
- その他の全試験：1,449ファイル・14,363テスト成功（Worker929ファイル・10,988テストを含む）。ルートのスクリプト試験102ファイル・922テスト成功。最終の関連8ファイル56テスト、補足の表示の動き12テストも成功。
- 1152/1440/1920の担当10画面＋共通部品6例を実測。開始版と修正後はともにシナリオ一覧の右端10件のみ未許可。対象・件数・実寸を比較し、新規・悪化0。既存10件は消えていないので、見張り全体の完全成功とは扱わない。一覧の骨組みと共通部品の指摘は0。証拠：`~/lh-work/design/v8/overlay/pages-matcha/guards-common-1011/`。
- 型検査は最終ビルド後に順番に再実行して成功。ビルドとの同時実行で生成型を読めなかった回は採用していない。手順書に再発防止を追記。
- コミット後の全板再測定はこれから。修正中の代表板の84%などは、クリーンな版の候補に数えていない。

## 次のタスク

共通部品をコミットし、担当全板を測り直す。その後、友だち追加の配信一覧から機能ごとの直しへ進む。既存のシナリオ右端10件と絵との食い違いは表に残す。
