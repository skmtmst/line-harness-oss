# mainB 2周目の引き継ぎ（2026-10-09）

今の進捗を全体像から整理するとこれ：指定79枚を測定し、左右で比較した。通常の画面・小窓66枚のうち59枚が座標表で90%以上。残り7枚と、まとめ板・外枠・説明板13枚を合格扱いにしていない。担当5機能の19の入口はV8だけを描く。作業はコミットまでで、push・PR・DB更新・配備はしていない。

次のタスクはこれ：司令塔が下記の正本の食い違いを整理し、停止理由・経路別複製のAPI不足を確認する。その後、同じmainBで再測定して目視合格を記録する。現状を「79枚すべて合格」として列車へ載せない。

## 90%未満で残った通常板と理由

| 板 | 最後の% | 残った理由 |
|---|---:|---|
| OPGU2 | 60 | Penの任意の停止理由欄に保存先がない。見せかけの入力欄や空白で下のボタンを移していない。 |
| SkY9V | 71 | 本線の見本APIが正しく日時順で返すようになった。Penは18:00の行が13:00の行より先にあり、表とメニューのyがデータの並びでずれる。 |
| Iffil | 75 | 同じ日時順の食い違い（1152）。 |
| apLqS | 82 | 同じ日時順の食い違い。 |
| a5C1p | 82 | 同じ日時順の食い違い（閲覧のみ）。 |
| VsSyu | 82 | 同じ日時順の食い違い（小窓の背景）。削除対象の名前による折り返しも違う。 |
| dnzqC | 88 | 採用済みG-5の2人・2方式の図と、この板の旧い1つの図が食い違う。「作ったあとは変えられません」は共通の説明に移っている。旧図へ戻していない。 |

リマインダは本物のAPIの並びを変えたり、見本APIの並びを逆にしたりして採点を上げていない。列車3の取り込み前は順に99/98/98/98/98%だったが、当時の見本APIは日時順を守っていなかったため、その数字を最後の結果に採用していない。

## 正本どうしの食い違いと目視の限界

HTMLとTSVには本文の35〜36pxの縦位置の差がある。例えばA0pDt「1. どのメッセージに反応するか」はTSVのy=237、HTMLのy=273。題・説明の最新の座標に合わせると、HTMLの古い頭の高さとの違いが残る。一覧の表の列名にも、TSVとHTMLでxが48〜72px違うものがある。配信詳細の右欄にも約48pxの差がある。このため、以下の90%以上は座標表への一致であって、HTMLとの目視合格を意味しない。

データの名前・人数・日時・行数・本文や写真の有無、権限で操作を隠す違いは許容差として分けた。左メニューにはHTMLだけにある受信数・ウェビナー・自分の勤務などの外側の違いも残る。Pen・HTML・TSV・測る道具は変更していない。PASSED.tsvには記録していない。

## 板ごとの結果

直す前は最初の測定値。3枚は開始前の値がなく「未記録」。小窓のOKは窓内の比較を指し、背景の正本の食い違いは残る。まとめ板・外枠・説明板の0/5%を通常画面の失敗率や合格率に混ぜない。

| 板ID | 名前 | 直す前% | 直した後% | 左右で見比べた結果 |
|---|---|---:|---:|---|
| ARuZ4 | シナリオ配信 編集（停止中） V8 | 100 | 100 | 残った違い：HTML/TSV「1」dx=-0, dy=35px |
| Al4Ek | シナリオ配信 複製のダイアログ V8 | 100 | 100 | OK（窓内。背景の本文位置・見本データ・外側は差あり） |
| BxGhV | ★V8 シナリオ配信 一覧の状態 | 0 | 0 | 残った違い：複数の状態を横に並べた説明板。単一画面と比較不可 |
| O5tUeE | 権限なし（その機能に入れない）V8 | 80 | 100 | OK（権限の帯。役割・外側の表示は見本差） |
| OPGU2 | シナリオ配信 止める確認（小窓） V8 | 60 | 60 | 残った違い：停止理由の入力欄がない（API不足） |
| PMLkX | シナリオ配信 編集（稼働中） V8 | 100 | 100 | 残った違い：HTML/TSV「1」dx=-0, dy=35px |
| U5rxyH | シナリオ 作る②（1152）V8 | 57 | 100 | 残った違い：HTML/TSV「この1通目を誰に送るか」dx=0, dy=36px |
| V6xAo | シナリオ配信 作る②（1通目を設定） V8 | 93 | 98 | 残った違い：HTML/TSV「この1通目を誰に送るか」dx=0, dy=36px |
| X0QrW0 | シナリオ配信 一覧（閲覧のみ）V8 | 97 | 97 | 残った違い：HTML/TSV「購読中 / 読み終えた」dx=72, dy=12px |
| X4STXS | シナリオ配信 配信結果 V8 | 97 | 97 | 残った違い：HTML/TSV「始まった」dx=0, dy=36px |
| axFrW | シナリオ配信 一覧 V8 | 99 | 99 | 残った違い：HTML/TSV「購読中 / 読み終えた」dx=72, dy=12px |
| dnzqC | シナリオ配信 作る①（シナリオ情報・配信方式） V8 | 24 | 88 | 残った違い：旧図と採用済みG-5の図が食い違う |
| kz2B6 | シナリオ配信 編集（競合）V8 | 100 | 100 | 残った違い：外側のメニュー・見本データ。本文の切れ・重なりなし |
| nMSiE | シナリオ配信 編集（配信を始めた直後） V8 | 100 | 100 | 残った違い：HTML/TSV「配信を始めました。予約中の 116 人へ、条件を」dx=0, dy=36px |
| wjfLe | シナリオ 一覧（1152）V8 | 100 | 100 | 残った違い：HTML/TSV「購読中 / 読み終えた」dx=48, dy=12px |
| A8jzaQ | 一覧の状態 | 0 | 0 | 残った違い：複数の状態を横に並べた説明板。単一画面と比較不可 |
| BeNtj | 一斉配信 予約を取り消す（確かめ）V8 | 100 | 100 | OK（窓内。背景の本文位置・見本データ・外側は差あり） |
| CRtK8 | 欄 予約した後 | 0 | 0 | 残った違い：外枠付きの板。中の cdZBf を別測定 |
| EML2F | 欄 一覧 | 5 | 5 | 残った違い：外枠付きの板。中の l5V9a を別測定 |
| F3X1Mo | 詳細（送った後） | 89 | 100 | 残った違い：HTML/TSV「ブロック」dx=-36, dy=3px |
| NtCE3 | 一斉配信 一覧（閲覧のみ）V8 | 97 | 97 | 残った違い：HTML/TSV「5件」dx=24, dy=28px |
| P6vbxn | 一斉配信 かんたんに送る（小窓 640）V8 | 100 | 100 | OK（窓内。背景の本文位置・見本データ・外側は差あり） |
| Q28Gb | 一斉配信 詳細（競合）V8 | 86 | 97 | 残った違い：HTML/TSV「配信した設定」dx=-48, dy=4px |
| Xr6eu | 一斉配信・自動応答 作るボタンの分け方 V8 | 0 | 0 | 残った違い：部品の説明板。文字の測定対象0・撮影の切り抜きにメニューが入らない |
| bIdqV | 欄 一覧の状態 | 0 | 0 | 残った違い：複数の状態を横に並べた説明板。単一画面と比較不可 |
| cdZBf | 予約した後 | 96 | 96 | 残った違い：HTML/TSV「一斉配信を予約しました」dx=0, dy=36px |
| cgiGB | 詳細（下書き） | 14 | 97 | 残った違い：HTML/TSV「配信した設定」dx=-48, dy=4px |
| dK1aE | 欄 詳細（下書き） | 3 | 0 | 残った違い：外枠付きの板。中の cgiGB を別測定 |
| jjFNi | 一覧（1152） | 100 | 100 | 残った違い：外側のメニュー・見本データ。本文の切れ・重なりなし |
| l5V9a | 一覧 | 96 | 96 | 残った違い：HTML/TSV「5件」dx=24, dy=28px |
| pNiUk | 詳細（承認待ち） | 90 | 100 | 残った違い：HTML/TSV「差し戻す」dx=-47, dy=2px |
| rfdmA | 欄 一覧（1152） | 5 | 5 | 残った違い：外枠付きの板。中の jjFNi を別測定 |
| tPm3e | 欄 詳細（送った後） | 0 | 0 | 残った違い：外枠付きの板。中の F3X1Mo を別測定 |
| wfHIE | 欄 詳細（承認待ち） | 0 | 0 | 残った違い：外枠付きの板。中の pNiUk を別測定 |
| Iffil | リマインダ 一覧（1152）V8 | 98 | 75 | 残った違い：日時順の表とPenの行順が違う。本文位置もHTML/TSVで違う |
| RrYYJ | ★V8 リマインダ 状態 | 0 | 0 | 残った違い：複数の状態を横に並べた説明板。単一画面と比較不可 |
| RwVo5 | リマインダ 一時停止ダイアログ V8 | 98 | 98 | OK（窓内。背景の本文位置・見本データ・外側は差あり） |
| SkY9V | リマインダ 行の「…」を開いた V8 | 99 | 71 | 残った違い：日時順の表とPenの行順が違う。本文位置もHTML/TSVで違う |
| T0nis | リマインダ 作る④ 配信予定 V8 | 100 | 100 | 残った違い：HTML/TSV「これから送る予定」dx=0, dy=36px |
| VE1u5 | リマインダ 作る① 基本設定 V8 | 100 | 100 | 残った違い：HTML/TSV「名前とフォルダ」dx=0, dy=36px |
| VsSyu | リマインダ 削除ダイアログ V8 | 97 | 82 | 残った違い：日時順の表とPenの行順が違う。本文位置もHTML/TSVで違う |
| YChR6 | リマインダ 作る② 対象者と止める条件 V8 | 98 | 98 | 残った違い：HTML/TSV「予約日時が入っている友だちに送ります」dx=0, dy=35px |
| a5C1p | リマインダ 一覧（閲覧のみ）V8 | 98 | 82 | 残った違い：日時順の表とPenの行順が違う。本文位置もHTML/TSVで違う |
| apLqS | リマインダ 一覧 V8 | 98 | 82 | 残った違い：日時順の表とPenの行順が違う。本文位置もHTML/TSVで違う |
| hjNpJ | リマインダ 作る 完了（有効にした） V8 | 100 | 100 | 残った違い：HTML/TSV「「予約前日のご案内」を有効にしました」dx=0, dy=36px |
| k32cn | リマインダ 編集（競合）V8 | 91 | 91 | 残った違い：HTML/TSV「マサトさんが 14:02 にリマインダ「予約前日」dx=0, dy=36px |
| loVfW | リマインダ 登録者を管理 V8 | 100 | 100 | 残った違い：HTML/TSV「基準日を変えると、まだ送っていない通知だけ新しい」dx=0, dy=36px |
| r1l0bT | リマインダ 作る③（1152）V8 | 100 | 100 | 残った違い：HTML/TSV「通知」dx=0, dy=36px |
| rbAig | リマインダ 詳細（概要） V8 | 100 | 100 | 残った違い：HTML/TSV「送れなかった通知が 2通あります」dx=0, dy=36px |
| A0pDt | 自動応答 作る② どんなときに動くか V8 | 86 | 99 | 残った違い：HTML/TSV「1. どのメッセージに反応するか」dx=0, dy=36px |
| G8i4xP | ★V8 自動応答 一覧の状態 | 未記録 | 0 | 残った違い：複数の状態を横に並べた説明板。単一画面と比較不可 |
| Guoye | 自動応答 作る④ 優先順位 V8 | 94 | 98 | 残った違い：HTML/TSV「動く順番」dx=0, dy=36px |
| IIesG | 自動応答 行の「…」を開いた V8 | 70 | 100 | 残った違い：HTML/TSV「返すもの」dx=72, dy=12px |
| K7HWG | 自動応答 作る① 基本設定 V8 | 72 | 94 | 残った違い：HTML/TSV「名前とフォルダ」dx=0, dy=36px |
| Q5lOCc | 自動応答 一覧（閲覧のみ）V8 | 100 | 100 | 残った違い：HTML/TSV「返すもの」dx=72, dy=12px |
| UGrd2 | 自動応答 編集（競合）V8 | 72 | 99 | 残った違い：HTML/TSV「マサトさんが 14:02 にルール「予約の日程変」dx=0, dy=36px |
| V4LjH | 自動応答 作る 完了（有効にした） V8 | 80 | 100 | 残った違い：HTML/TSV「「予約の日程変更」を有効にしました」dx=0, dy=36px |
| WPrd5 | 自動応答 一覧（1152）V8 | 100 | 100 | 残った違い：HTML/TSV「返すもの」dx=48, dy=12px |
| XJUqs | 自動応答 作る⑤ 確認 V8 | 100 | 100 | 残った違い：HTML/TSV「設定の確認」dx=0, dy=36px |
| Z2LIUx | 自動応答 作る②（1152）V8 | 48 | 93 | 残った違い：HTML/TSV「1. どのメッセージに反応するか」dx=0, dy=36px |
| i8F12 | 自動応答 止めるダイアログ V8 | 未記録 | 100 | OK（窓内。背景の本文位置・見本データ・外側は差あり） |
| nWmLg | 自動応答 実行結果 V8 | 96 | 96 | 残った違い：HTML/TSV「今月当たった」dx=0, dy=36px |
| rfhIf | 自動応答 作る③ 何を返すか V8 | 61 | 96 | 残った違い：HTML/TSV「この画面で書く」dx=0, dy=35px |
| u8sKN | 自動応答 削除ダイアログ V8 | 未記録 | 95 | OK（窓内。背景の本文位置・見本データ・外側は差あり） |
| uE9gf | 自動応答 一覧 V8 | 100 | 100 | 残った違い：HTML/TSV「返すもの」dx=72, dy=12px |
| C0lfUP | 友だち追加時の配信 受け皿の「…」を開いた V8 | 95 | 95 | 残った違い：HTML/TSV「最初に送るもの」dx=72, dy=12px |
| LEwkJ | 友だち追加時の配信 一覧（閲覧のみ）V8 | 94 | 94 | 残った違い：HTML/TSV「最初に送るもの」dx=72, dy=12px |
| N43uVX | 友だち追加時の配信 実行の詳細（失敗あり） V8 | 90 | 100 | 残った違い：HTML/TSV「3つ目の処理を完了できませんでした」dx=0, dy=36px |
| P20kYU | 友だち追加時 一覧（1152）V8 | 100 | 100 | 残った違い：HTML/TSV「最初に送るもの」dx=48, dy=12px |
| REIxB | 友だち追加時の配信 実行結果 V8 | 0 | 93 | 残った違い：HTML/TSV「直近28日の友だち追加」dx=0, dy=36px |
| U8Xm3X | 友だち追加時の配信 作る⑤ 確認 V8 | 100 | 100 | 残った違い：HTML/TSV「設定の確認」dx=0, dy=36px |
| al47K | 友だち追加時の配信 作る③ 初回案内 V8 | 75 | 98 | 残った違い：HTML/TSV「この画面で書く」dx=0, dy=35px |
| cFo2p | 友だち追加時の配信 受け皿は止められない（案内） V8 | 95 | 98 | OK（窓内。背景の本文位置・見本データ・外側は差あり） |
| e0FD1J | 友だち追加時の配信 作る 完了（有効にした） V8 | 100 | 100 | 残った違い：HTML/TSV「「秋フェアの初回案内」を有効にしました」dx=0, dy=36px |
| h5rm8t | 友だち追加時の配信 編集（競合）V8 | 76 | 98 | 残った違い：HTML/TSV「マサトさんが 14:02 に初回案内「店頭QRの」dx=0, dy=36px |
| h8uNW | 友だち追加時の配信 作る② 流入リンク V8 | 91 | 91 | 残った違い：HTML/TSV「どの流入リンクから来た人に送るか」dx=0, dy=36px |
| kFz4b | ★V8 友だち追加時の配信 状態 | 0 | 0 | 残った違い：複数の状態を横に並べた説明板。単一画面と比較不可 |
| wDzkc | 友だち追加時の配信 作る① 基本設定 V8 | 97 | 97 | 残った違い：HTML/TSV「名前とフォルダ」dx=0, dy=36px |
| xHpkS | 友だち追加時 作る②（1152）V8 | 94 | 100 | 残った違い：HTML/TSV「どの流入リンクから来た人に送るか」dx=0, dy=36px |

## 撮れない板・比較対象にできない板

- まとめ板：BxGhV・A8jzaQ・bIdqV・RrYYJ・G8i4xP・kFz4b。空・絞り込み0件・読み込み中などを横に並べた説明板。通常の一覧を撮っただけでは状態別の合格を判定できない。
- 外枠付き：CRtK8→cdZBf、EML2F→l5V9a、dK1aE→cgiGB、rfdmA→jjFNi、tPm3e→F3X1Mo、wfHIE→pNiUk。外枠の座標は実画面と異なる。中の6枚はそれぞれ90%以上。
- Xr6eu：作るボタンの部品説明板。TSVの測定対象0。撮影の状態を指定しても参照の切り抜きが頭の行だけになり、ドロップダウンを比較できない。API不足による未表示とは扱わない。
- 完了・競合・失敗・閲覧のみの通常板は、見本APIで状態を出し直して撮影した。名前・人数などを実装の固定値にしていない。

## 共通部品の代表4枚

| 板 | 変更前 | 最後 | 結果 |
|---|---:|---:|---|
| WQmep | 46 | 46 | 既存のずれを維持。今回の指定外。 |
| x6QsVz | 98 | 98 | 低下なし。 |
| I1E7Bt | 99 | 99 | 低下なし。 |
| LRc93 | 5 | 5 | 既存のずれを維持。今回の指定外。 |

Dialog・Field・LinePreview・Noticeの変更は指定する画面だけに効く口を足した。ActionMenuは明示のanchorRefがある場合に不要な空のアンカーを置かなくした。代表板の低い値を今回の修正で合格したとは扱わない。

## APIが要るもの

- シナリオを止める任意の理由の保存先（OPGU2）。入力だけして捨てる実装は追加していない。
- 友だち追加時の配信を別の経路用に複製する受け口。Rule APIに複製の口がないため試験1件はTODO。従来の設定APIによる別機能の複製で埋めていない。
- 作成者・更新した担当者、保存前の当たり件数など、APIが返さない値は今回も固定値で埋めていない。

## 変更と検証

入力不足を欄の赤枠・理由1行・focus/scrollへ移し、保存失敗の帯との重複を外した。本線の追加したより広い入力チェックも残した。自動応答の読み込みで入力が消える再描画を防ぎ、停止・複製の再試行には同じ確認キーを使う。行のメニュー、入力欄、完了の窓、競合の帯、注意帯、プレビュー、数の帯と配信の進みの寸法を共通部品・型の値へ寄せた。

担当5機能の19の入口から旧V7の枝を削除した。使われない旧V7のCSSは5ファイル削除。共通部品のV7の枝とテーマの仕組み、別担当の画面は削除していない。残る旧ファイルにはAPIの組み立てなど参照される部分があるため、未使用と確認できないものをまとめて消していない。

見た目だけを固定した試験3ファイル（broadcasts-list-fit、broadcast-search-row、friend-add-runs-overflow）を削除。旧V7へ分岐する試験を外し、動作試験はV8へ移した。旧文言・class・板IDを一字一句固定するassertionを整理した。空欄で保存しない・絞り込み0件・読み込み失敗・停止で残る履歴・予約の再集計・競合時の読み直しなど、動作を説明するケースはV8の参照と言葉で残した。操作・API・確認キー・権限・再試行を確かめるReact/API試験も残している。

- 型検査：合格（共有パッケージを本線から組み直した後）。
- ビルド：合格。既存のlint警告あり。
- 設計値検査：456/456一致、不一致0、合格。
- CSSの直書き・色・直接値・トークン衝突と、修正した戻り先の契約：28件合格。基準の引き上げなし。
- 担当5機能と触った共通部品・型の動作試験：2,190件合格・失敗0件・API待ちTODO 1件（352ファイル）。
- 差分検査：合格。
- 自分の測定サーバーmainBは停止。他の担当のサーバーは停止していない。

## 本線の取り込み・競合

開始時の本線は ec03047312b7240dfb8c6ac6b60acd77a86747b3。検証前に最新を取得し、列車3の64096e969cをmergeで取り込んだ。rebase・stash・forceはしていない。共通部品は本線の最新を土台にして、今回の指定用の口を重ねた。

競合を解いた11ファイル：wizard-v8.tsx・wizard-v8.module.css、friend-add-settings/editor-v8.react.test.tsx、shared/dialog.tsx・dialog.module.css・line-preview.module.css、templates/page-templates.module.css、v8/auto-replies/list.tsx、v8/friend-add-runs/runs.module.css、v8/friend-add/editor.tsx・list.tsx。本線の入力チェック、狭い画面の条件編集、フォルダの表示、連続した窓を残した。未取得の人数を0に置き換えない扱いも残した。

## コミットと証拠

- cebe58ecfe：画面と入力の案内を合わせる。
- 2c792cbe23：担当機能のV7分岐を外し、動作試験の参照をV8へ移す。
- df70d8505a：列車3を取り込み、競合解消・検証後の寸法と試験の修正を含む。

79枚の撮影は列車3取り込み後の作業ツリーで行い、最後の修正対象と共通部品の代表4枚を再撮影した。撮影JSONのshaは測定道具のリポジトリのHEAD（9f55cb66…）であり、画面コードのSHAではない。画面コードの版は上記コミットとmeasure.shの「測った版／未コミット変更数」で確認する。HTML/TSVの35〜36px差の証拠も、該当JSONのreference.textsとTSVにある。

測定結果：`~/lh-work/design/v8/overlay/pages-mainB/<板>-delta.md`、`-impl.png`、`-design.png`、`-overlay.png`。画面ごとの%と左右の確認結果は上の表が引き継ぎ用の記録。測定のための写しの対応表は作業場所の`.measure/mainB-map.json`。道具・正本の対応表は変更していない。

今回の差分には本線から取り込んだWorker・DB・LIFFなども見えるが、mainBがそれらを独自に変更したものではない。本線との差分で確認する。PR・反映履歴の採番は司令塔の工程（この担当はpush・PRをしないため番号未採番）。

## 本線との差分のファイル

- `apps/web/src/app/auto-replies/auto-replies-mid-contract.test.ts`
- `apps/web/src/app/auto-replies/auto-replies-row-actions.react.test.tsx`
- `apps/web/src/app/auto-replies/auto-replies-v6-contract.test.ts`
- `apps/web/src/app/auto-replies/auto-replies-viewer-gating.react.test.tsx`
- `apps/web/src/app/auto-replies/auto-reply-delete-confirm-contract.test.ts`
- `apps/web/src/app/auto-replies/auto-reply-draft-contract.test.ts`
- `apps/web/src/app/auto-replies/auto-reply-hits-unavailable-contract.test.ts`
- `apps/web/src/app/auto-replies/auto-reply-stop-search-contract.test.ts`
- `apps/web/src/app/auto-replies/auto-reply-words-contract.test.ts`
- `apps/web/src/app/auto-replies/edit/auto-reply-edit-steps.test.tsx`
- `apps/web/src/app/auto-replies/edit/edit-viewer-gating.react.test.tsx`
- `apps/web/src/app/auto-replies/edit/page.r528-contract.test.ts`
- `apps/web/src/app/auto-replies/edit/page.r528-faithful-rerender.react.test.tsx`
- `apps/web/src/app/auto-replies/edit/page.tsx`
- `apps/web/src/app/auto-replies/edit/wizard-v8.module.css`
- `apps/web/src/app/auto-replies/edit/wizard-v8.tsx`
- `apps/web/src/app/auto-replies/page.tsx`
- `apps/web/src/app/auto-replies/publish/page.tsx`
- `apps/web/src/app/auto-replies/publish/publish-m26c.react.test.tsx`
- `apps/web/src/app/auto-replies/publish/u098-recovery-contract.test.ts`
- `apps/web/src/app/auto-replies/runs/auto-reply-runs-retry.test.tsx`
- `apps/web/src/app/auto-replies/runs/auto-reply-runs-v6-contract.test.ts`
- `apps/web/src/app/auto-replies/runs/auto-reply-runs.module.css`
- `apps/web/src/app/auto-replies/runs/page.tsx`
- `apps/web/src/app/auto-replies/runs/runs-stale-guard-r529.test.tsx`
- `apps/web/src/app/auto-replies/runs/runs-viewer-gating.react.test.tsx`
- `apps/web/src/app/broadcasts/broadcast-delete-confirm-contract.test.ts`
- `apps/web/src/app/broadcasts/broadcast-empty-filtered-contract.test.ts`
- `apps/web/src/app/broadcasts/broadcast-list-states-contract.test.ts`
- `apps/web/src/app/broadcasts/broadcast-resume-menu-contract.test.ts`
- `apps/web/src/app/broadcasts/broadcast-saved-view-contract.test.ts`
- `apps/web/src/app/broadcasts/broadcast-search-row-contract.test.ts`
- `apps/web/src/app/broadcasts/broadcast-v8-rest-contract.test.ts`
- `apps/web/src/app/broadcasts/broadcasts-issue634-loading-retry.test.tsx`
- `apps/web/src/app/broadcasts/broadcasts-list-columns-contract.test.ts`
- `apps/web/src/app/broadcasts/broadcasts-list-fit-contract.test.ts`
- `apps/web/src/app/broadcasts/detail/broadcast-detail-draft-resume-preview.test.tsx`
- `apps/web/src/app/broadcasts/detail/broadcast-detail-v6-contract.test.ts`
- `apps/web/src/app/broadcasts/detail/page.tsx`
- `apps/web/src/app/broadcasts/page.tsx`
- `apps/web/src/app/broadcasts/reserved/broadcast-reserved-contract.test.ts`
- `apps/web/src/app/broadcasts/reserved/page.tsx`
- `apps/web/src/app/broadcasts/reserved/reserved-complete-contract.test.ts`
- `apps/web/src/app/broadcasts/reserved/reserved-missing.test.tsx`
- `apps/web/src/app/broadcasts/reserved/reserved-no-id.test.tsx`
- `apps/web/src/app/friend-add-settings/editor-v8.react.test.tsx`
- `apps/web/src/app/friend-add-settings/friend-add-list-v8.react.test.tsx`
- `apps/web/src/app/friend-add-settings/friend-add-settings-v6-contract.test.ts`
- `apps/web/src/app/friend-add-settings/friend-add-summary-period-react.test.tsx`
- `apps/web/src/app/friend-add-settings/page.tsx`
- `apps/web/src/app/friend-add-settings/publish/page.tsx`
- `apps/web/src/app/friend-add-settings/publish/publish-screen-contract.test.ts`
- `apps/web/src/app/friend-add-settings/publish/publish.module.css`
- `apps/web/src/app/friend-add-settings/runs/detail/detail-v8.react.test.tsx`
- `apps/web/src/app/friend-add-settings/runs/detail/friend-add-run-detail-react.test.tsx`
- `apps/web/src/app/friend-add-settings/runs/detail/page.tsx`
- `apps/web/src/app/friend-add-settings/runs/detail/run-detail-failure-react.test.tsx`
- `apps/web/src/app/friend-add-settings/runs/detail/run-detail-shape.test.tsx`
- `apps/web/src/app/friend-add-settings/runs/friend-add-runs-contract.test.ts`
- `apps/web/src/app/friend-add-settings/runs/friend-add-runs-overflow-contract.test.ts`
- `apps/web/src/app/friend-add-settings/runs/friend-add-runs-redaction-react.test.tsx`
- `apps/web/src/app/friend-add-settings/runs/page.tsx`
- `apps/web/src/app/friend-add-settings/runs/runs-list-failure-react.test.tsx`
- `apps/web/src/app/friend-add-settings/runs/runs-v8.react.test.tsx`
- `apps/web/src/app/friend-add-settings/u972-table-scroll.test.ts`
- `apps/web/src/app/globals.css`
- `apps/web/src/app/reminders/detail/page.tsx`
- `apps/web/src/app/reminders/detail/registrants-panel.react.test.tsx`
- `apps/web/src/app/reminders/detail/reminder-detail-facts.react.test.tsx`
- `apps/web/src/app/reminders/detail/reminder-runs-v6-contract.test.ts`
- `apps/web/src/app/reminders/edit/page.tsx`
- `apps/web/src/app/reminders/new/new-v8.tsx`
- `apps/web/src/app/reminders/new/page.module.css`
- `apps/web/src/app/reminders/new/page.tsx`
- `apps/web/src/app/reminders/new/reminder-new-trigger.react.test.tsx`
- `apps/web/src/app/scenarios/detail/page.tsx`
- `apps/web/src/app/scenarios/detail/scenario-detail-v8-contract.test.ts`
- `apps/web/src/app/scenarios/first-step/first-step-audit.test.tsx`
- `apps/web/src/app/scenarios/first-step/first-step-empty-save-contract.test.ts`
- `apps/web/src/app/scenarios/first-step/first-step.module.css`
- `apps/web/src/app/scenarios/first-step/page.tsx`
- `apps/web/src/app/scenarios/first-step/scenario-first-step-v6-contract.test.ts`
- `apps/web/src/app/scenarios/mode/page.tsx`
- `apps/web/src/app/scenarios/mode/scenario-mode-load-retry-contract.test.ts`
- `apps/web/src/app/scenarios/mode/scenario-mode-name-error-focus.test.tsx`
- `apps/web/src/app/scenarios/mode/scenario-mode-v6-contract.test.ts`
- `apps/web/src/app/scenarios/new/page.tsx`
- `apps/web/src/app/scenarios/new/redirect-contract.test.tsx`
- `apps/web/src/app/scenarios/results/csv-button-contract.test.ts`
- `apps/web/src/app/scenarios/results/page.tsx`
- `apps/web/src/app/scenarios/results/scenario-friend-plan-contract.test.ts`
- `apps/web/src/app/scenarios/results/scenario-next-delivery-contract.test.ts`
- `apps/web/src/app/scenarios/results/scenario-results-v6-contract.test.ts`
- `apps/web/src/app/scenarios/results/scenario-results.module.css`
- `apps/web/src/components/shared/action-menu.tsx`
- `apps/web/src/components/shared/confirm-dialog.tsx`
- `apps/web/src/components/shared/control-dimensions-contract.test.ts`
- `apps/web/src/components/shared/dialog.module.css`
- `apps/web/src/components/shared/dialog.tsx`
- `apps/web/src/components/shared/folder-panel-heading-contract.test.ts`
- `apps/web/src/components/shared/folder-rail-owner-contract.test.ts`
- `apps/web/src/components/shared/form-controls.module.css`
- `apps/web/src/components/shared/form-controls.tsx`
- `apps/web/src/components/shared/insert-text-field.module.css`
- `apps/web/src/components/shared/line-preview.module.css`
- `apps/web/src/components/shared/line-preview.tsx`
- `apps/web/src/components/shared/notice.module.css`
- `apps/web/src/components/shared/notice.tsx`
- `apps/web/src/components/templates/page-frame.tsx`
- `apps/web/src/components/templates/page-templates.module.css`
- `apps/web/src/v8/auto-replies/list.tsx`
- `apps/web/src/v8/broadcast-detail/detail.module.css`
- `apps/web/src/v8/broadcast-detail/detail.tsx`
- `apps/web/src/v8/friend-add-runs/detail.tsx`
- `apps/web/src/v8/friend-add-runs/runs.tsx`
- `apps/web/src/v8/friend-add/list.tsx`
- `apps/web/src/v8/no-permission/no-permission.module.css`
- `apps/web/src/v8/reminders/basics-form.tsx`
- `apps/web/src/v8/reminders/detail.tsx`
- `apps/web/src/v8/reminders/edit.module.css`
- `apps/web/src/v8/scenario-first-step/first-step.module.css`
- `apps/web/src/v8/scenario-first-step/first-step.tsx`
- `apps/web/src/v8/scenarios/create.tsx`
- `docs/v8-mainB-round2-2026-10-09.md`
