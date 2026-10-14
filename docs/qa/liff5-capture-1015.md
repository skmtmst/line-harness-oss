# LIFF5：再判定11板の最新375幅撮影（2026-10-15）

つかんだ型：原寸375の同幅・同縮尺の左右と、混在した状態の別撮影。速さの改善は未証明（撮影枠待ち約35分）。撮影自体は12板58秒＋待ち状態5秒。いま一番うまくいっていない事はgVjiCの写しの状態混在。

## 今の進捗を全体像から整理するとこれ

LANE-LIFF.jsonを数え直して重複なし34板、RULE-EXCLUSIONS.jsonとの重複0。正式合格はPASSED-V8FREEZE.tsvの21板のまま。再判定11板の左右を今回新規撮影し、合否は司令塔へ渡す。合格・候補の自己加算0。

|区分|板数|
|---|---:|
|正式合格|21|
|修正済み・今回撮影して再判定へ|11|
|状態判断：gVjiC（通常申込と待ちの2状態を撮影）|1|
|別判定：kxmnZ（対応表sAnyy、今回は撮影対象外）|1|
|合計|34|

## 撮影版と幅

撮影HEADは`1e519ace0327ebf39b8c02e7fca6b8ba09fd9336`、本線は`d12a5a3565d7b79e22ea2a1180d1c1d251768719`。取り込み漏れ0。撮影は2026-10-15 03:00:48〜03:01:49 JST。全13状態が同じ実装の指紋で、撮影前後のapps/liffのファイル指紋も一致した。今回の製品コードの変更は0。

原寸の絵と実装は全板375幅。414版の名前が残るwPfqW/uZqMAも今回は両側375幅へ統一した。時刻帯を除いた同じ高さで撮り、同じ縮尺で330×690のスマホ枠・黒い島・LINEの帯を付けた。高さは元の板のままなので板同士で違う。スマホ枠の画像と、縮小していない375原寸の画像を分けた。

画像は指定されたGit外の`~/lh-work/design/v8/review/LIFF-1015/`へ保存した。各板のURL・開く操作・状態・撮影時刻・写し/画像のSHA256・実寸の生値は同所の`MANIFEST.json`・`BOARDS.tsv`・`data/`。このリポジトリにも[liff5-capture-1015.json](liff5-capture-1015.json)を残す。

## 11板の左右

|板|スマホ枠の左右|375原寸の左右|
|---|---|---|
|XafWh|[画像](/Users/kentakenta/lh-work/design/v8/review/LIFF-1015/sbs/XafWh.png)|[原寸](/Users/kentakenta/lh-work/design/v8/review/LIFF-1015/sbs/XafWh-native.png)|
|B5SbF|[画像](/Users/kentakenta/lh-work/design/v8/review/LIFF-1015/sbs/B5SbF.png)|[原寸](/Users/kentakenta/lh-work/design/v8/review/LIFF-1015/sbs/B5SbF-native.png)|
|B8rCt|[画像](/Users/kentakenta/lh-work/design/v8/review/LIFF-1015/sbs/B8rCt.png)|[原寸](/Users/kentakenta/lh-work/design/v8/review/LIFF-1015/sbs/B8rCt-native.png)|
|wPfqW|[画像](/Users/kentakenta/lh-work/design/v8/review/LIFF-1015/sbs/wPfqW.png)|[原寸](/Users/kentakenta/lh-work/design/v8/review/LIFF-1015/sbs/wPfqW-native.png)|
|gLReL|[画像](/Users/kentakenta/lh-work/design/v8/review/LIFF-1015/sbs/gLReL.png)|[原寸](/Users/kentakenta/lh-work/design/v8/review/LIFF-1015/sbs/gLReL-native.png)|
|uZqMA|[画像](/Users/kentakenta/lh-work/design/v8/review/LIFF-1015/sbs/uZqMA.png)|[原寸](/Users/kentakenta/lh-work/design/v8/review/LIFF-1015/sbs/uZqMA-native.png)|
|EscPA|[画像](/Users/kentakenta/lh-work/design/v8/review/LIFF-1015/sbs/EscPA.png)|[原寸](/Users/kentakenta/lh-work/design/v8/review/LIFF-1015/sbs/EscPA-native.png)|
|KRppA|[画像](/Users/kentakenta/lh-work/design/v8/review/LIFF-1015/sbs/KRppA.png)|[原寸](/Users/kentakenta/lh-work/design/v8/review/LIFF-1015/sbs/KRppA-native.png)|
|etLd8|[画像](/Users/kentakenta/lh-work/design/v8/review/LIFF-1015/sbs/etLd8.png)|[原寸](/Users/kentakenta/lh-work/design/v8/review/LIFF-1015/sbs/etLd8-native.png)|
|RpW2h|[画像](/Users/kentakenta/lh-work/design/v8/review/LIFF-1015/sbs/RpW2h.png)|[原寸](/Users/kentakenta/lh-work/design/v8/review/LIFF-1015/sbs/RpW2h-native.png)|
|S3uBl|[画像](/Users/kentakenta/lh-work/design/v8/review/LIFF-1015/sbs/S3uBl.png)|[原寸](/Users/kentakenta/lh-work/design/v8/review/LIFF-1015/sbs/S3uBl-native.png)|

## gVjiC：単一の状態には特定できない

1. 写しの上側：`html/gVjiC.html` の「枠 10:00〜11:00」は緑 #03873a、11:00〜12:00は白。選択中は10時の空き枠（残り2）。
2. 写しの下側：11:00〜12:00の満席・2人待ちの案内と「キャンセル待ちで申し込む」。上の選択と別の回なので、単一の状態には特定できない。
3. 要件 `docs/v8-requirements/v8-liff.md` §2と既存の選択処理を保ち、10時の通常申込と11時のキャンセル待ちを別撮影する。主板をどちらにするかは司令塔判断。

[10時の通常申込](/Users/kentakenta/lh-work/design/v8/review/LIFF-1015/sbs/gVjiC.png)／[11時のキャンセル待ち](/Users/kentakenta/lh-work/design/v8/review/LIFF-1015/event-wait/sbs/gVjiC.png)。状態を照合したHTMLとTSVは同所の`reference/`に保存。照合したHTMLの指紋と、実際に撮影した写しの指紋は一致する。

## 確認結果と残した差

- doctor合格、pnpm install --frozen-lockfile成功。LIFF型検査成功。新しい製品変更はなく、前回の関連試験結果を今回実行したとは数えない。
- heavy.shで順番待ちし、撮影前にfresh-check.shを今回の12板へ適用して通過。本線遅れ0・写し確認OK。version.jsonがないため、撮影サーバーと偽APIのPID/cwdがこの作業場所に属することをlsofで確認した。
- 全13状態が開けた。全12板の原寸幅375、絵と実装の寸法一致、撮影前後の実装同一を確認。ページ例外0。全13状態の上部/末尾で横越え・文字のはみ出し・短文の折り返し検出0。既存の形と色の検査は8板で成功。
- B5SbF：上部/末尾とも重なり検出2。写真を選ぶ面と、右上に置いた削除×の操作領域の重なり（24×24）が各面に1件。画像で×が右上にあることを確認。検出値は0へ置き換えず保存した。
- S3uBl：上部の切れ検出2は、紹介リンクの省略表示（全文titleあり）。末尾の重なり検出1は、固定の上帯の閉じると、上へ送られた振込先登録ボタンの領域。末尾の実画像もraw/S3uBl-bottom.pngへ残した。許可や検出器は変更していない。
- 書類2板は形と削除×を確認できたが、試験用の1ページのフォームなので、題・進捗帯・次へ/送信と絵に差がある。試験用PNGの見た目も書類の絵へ作り込まず、そのまま残した。
- 予約/確認の戻る操作、マイルの使い道・振込先・明細など実装に在る機能を残した。今回の撮影でそれらの機能試験を再実行したとは数えない。ウェビナーは参加済みの試験状態で、ダミーの動画URLなので再生は未検証。絵にある再生印/視聴人数と、実装の上帯/文字数表示などの差も画像へ残している。
- 最初のcurl接続失敗はサーバーの準備待ち中の1回。両サーバーがHTTP成功してから撮影した。待機中は夜2枠（通常組1枠）だったが、開始時には上位側のMODEがnight3へ更新されていた。この組では枠数・条件・他者のPIDを変更していない。

全試験・新ビルドは今回実行していない。前回の実装の検証と今回の撮影結果は区別する。本物のLINEログイン・送信・決済、Pen、合格台帳、migration、DB更新、配備、push/PRは操作していない。

## 次のタスクはこれ

司令塔が11板の左右を直接判定する。先にgVjiCの主板を10時の通常申込か11時の待ちか決め、絵の選択と下の操作を同じ回へそろえる。書類2板とウェビナーの残る差も、今回の同幅画像で判定する。コミットまでで止める。
