# LIFF1：全板の最初の点検

最初の開き方表は2026-10-13 23:49 JST。結果の集計 2026-10-14 01:08 JST。作業枝 `codex/kenta-match-liff-1013`。

つかんだ型：上と下の帯・カードと選ぶ欄・状態の開き方を分ける。速くなったか：初回のため比較なし。機械撮影は平均4.9秒/板で、準備・順番待ち・目視・記録の時間を含まない。一番うまくいっていない事：ウェビナーの共用画面で装飾が足りず、暗い地の文字が読みにくい。

今の進捗を全体像から整理するとこれ：全34行を確認し、32状態を開いた。31板は絵と原寸で比較できた。製品コードの修正は0。これは初回の重さを知るための分類で、B-260の全機能検証・正式な合格判定ではない。

| 初回分類 | 枚数 |
|---|---:|
| そのまま良い（表示の下読み） | 1 |
| 小さい違い | 23 |
| 大きい違い | 7 |
| 対象状態を開けない | 2 |
| 写しが無い（別枠） | 1 |
| 合計 | 34 |

## 分母を数え直した結果

`LANE-LIFF.json` の34 IDは `TARGETS.json` のapp=liffの34 IDと完全一致。`RULE-EXCLUSIONS.json` とのIDの共通部分は0なので、適用後も34。指定の28との差6を、自分の判断で除外していない。司令塔が28枚に対応する除外IDを確定する必要がある。API待ちと書かれているYvTJ3は、現在の本線に画面とAPIがあり、実際に開けた。合格率は計算しない。

## 測った版・幅・画像

- コードは開始時本線 `9613559dcbdf279b69a13db7a840345550a1a59d`。計測前のfresh-checkは本線の遅れ0、写しは今のPenと同じ（2026-10-13 18:17）。サーバのversion.jsonは無いので、3670の所有プロセスとcwdを確認した。最後の取得済み本線も同じSHA。
- 原寸は各板の絵の幅375／414に合わせ、時刻の帯を引いた高さを使う。通常の帯は44で375×768／414×852。来店スタンプ5板（jQRsr・V2HU7・xe8ga・h2HKh・etLd8）の帯は48なので375×764。管理画面の1440・1152・1920は使わない。sAnyyは写しが無く、実装だけを暫定375×768で撮った。
- 左右の閲覧用画像は `sbs/<板>.png`。外枠330×690・内側310×670・黒い島96×28（cfVyjの値）・LINEの上の帯を含む。左右の原寸画像を同じ縮尺で表示する。縮小した画像で位置の点は出さない。
- `sbs/<板>-native.png` は同じ幅の原寸の左右。`sbs/<板>-narrow.png` と `raw/<板>-phone*.png` は追加の内幅310での見張り。追加310の画像を375/414の絵との同幅比較へ混ぜない。
- 33板にHTMLと文字座標の写しがある。sAnyyだけ両方無い。全34板に左右画像を残し、写し無し・対象状態未再現はその理由を表示する。
- 位置の点はpencil-textsと実装の文字を近い相手へ対応し、±4pxを参考にした。読み込み中など対応文字が少ない場合や未取得は合否に使わない。欠測はnull。

## 最初に司令塔が見る板

1. [RpW2h](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/RpW2h.png)：参加済みの状態では視聴画面が開く。チャットの文字が暗く、CTA・送信・入力の面の装飾が不足。Worker共用UIを読むLIFF側のCSSの接続・生成範囲を優先して確かめる。試験動画はダミーのため映像の再生を合格に数えない。実装のLINEの上帯は要件どおりに保ち、絵に無い帯はPen側の更新候補へ。
2. [KRppA](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/KRppA.png)：通知の文言を24px角の通知用ボタンへ入れ、縦に崩れて次の案内へ重なった。機能を消さず、長い操作の役目に合う共通のボタンで直す。
3. [y1bs9A](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/y1bs9A.png)：原寸375でも操作2つが途中で折れ、追加310は3〜4行。待ちをやめる・順番・ほかのイベントへの入口も絵と違う。APIと画面の接続を確認する。
4. [jQRsr](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/jQRsr.png)：四角いマス・茶色のカード・条件カードで大きく違う。茶色は共有の既定色と見本設定の結果なので、絵に寄せて緑へ固定しない。角丸変数と、新しい条件表示を残した絵との対応が要確認。

## 違いを原因ごとに束ねる

| 束 | 対象・原因 | 次に直す場所／保つ機能 |
|---|---|---|
| 共用UIの装飾不足 | RpW2h。参加前の門では見えなかった問題 | LIFF入口・CSSの読込と生成範囲。登録済み本人の条件・送信・動画の進み方は変えない |
| 短い操作の幅・役目 | KRppAの通知2つ、y1bs9Aの操作2つ。追加310ではYvTJ3・確認ボタン・送信後の題も改行候補 | apps/liffのButtonと呼出しの役目。通知・日時変更・取消を残す |
| 下の固定帯 | 予約・結果・履歴・イベントなどで白い浮いた枠、影、左右の内側、戻るの段が違う | components/ui/BottomBar.tsxの共通の出し方。スクロールして末尾へ届くことと操作を保つ |
| カード・入力・段間 | メニュー、担当、確認、フォームのカード高・段間・影・任意札の差 | UI/Card、MenuList・StaffList・Confirm、forms/controlsと共通の値。長い値の全文titleと必須検証を保持 |
| ページと窓の違い | BjcuBは全画面と下から出る窓。ADutgは手順を残すかの状態差 | 司令塔が絵との対応を決める。実装の役に立つ手順や席を取る操作を消さない |
| 試験用の開く口 | XafWh/B5SbFは書類の質問無し。S3uBlは使い道・振込先・明細が404。他にcustomer-look・last-bookingの見本不足 | 本線のAPI契約に合う試験用の状態を整える。絵へ合わせる件数・名前・値の作り込みはしない |
| 写しと分母 | sAnyyの写し無し、34と28の対応無し | 司令塔が写しと除外IDを確定。Pen・合格台帳はこの組で変えない |

## 全板の最初の表

URLと操作の順番・時計・API状態は [OPEN-HOW.tsv](liff1-open-how-1013.tsv)。ここは初回分類と崩れ・絵との大きな違い。機械の生の候補は [MEASUREMENTS.tsv](liff1-measurements-1013.tsv)。

| 板 | 原寸幅 | 対象状態／比較 | 分類 | 崩れ・目視 | 絵との違い |
|---|---:|---|---|---|---|
| [jQRsr](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/jQRsr.png) | 375 | 開ける／計測済み | 大きい違い | 条件が増えて縦に長い。初期表示は固定帯が特典の下を隠す。末尾の再確認を残した。 | 茶色のカード・四角いマス・条件カードの追加。茶色は共有の既定値と見本設定の差なので緑へ固定しない。マスの角丸変数と見せ方を要確認。 |
| [aLU3r](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/aLU3r.png) | 375 | 開ける／計測済み | 小さい違い | 原寸の崩れ候補0。追加310で本文が折れるが、説明の自然な改行。 | 下の固定帯が浮いた白いカードになり、影・左右の余白が違う。本文・戻る操作は出る。 |
| [ADutg](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/ADutg.png) | 375 | 開ける／計測済み | 大きい違い | 横はみ出し0。空きなしと次の週／担当を選び直すが可視。 | 実装には手順・日時の題・選んだメニュー・表示切替が残る。絵は空き無しの案内だけ。使える手順を削らず絵との状態の対応を判断する。 |
| [AcTHQ](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/AcTHQ.png) | 375 | 開ける／計測済み | 小さい違い | 横はみ出し・文字切れ・操作重なりの候補0。 | 骨格の角丸・間隔と光の動きに小差。光の動きは既存の決まり。遅延中の店名未取得を欠けに数えない。 |
| [B8rCt](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/B8rCt.png) | 375 | 開ける／計測済み | 小さい違い | 原寸の候補0。310では固定帯と未スクロールの入力が重なる候補あり。末尾確認あり。 | 選ぶ欄の高さ・角丸・丸の形・任意札・段間で差。原寸は同じ入力と選択状態が出る。 |
| [BjcuB](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/BjcuB.png) | 375 | 開ける／計測済み | 大きい違い | 原寸の崩れ候補0。大きい違いは全体の構成。 | 絵は全画面の案内。実装は灰色の背景と下から出る案内の窓。席を取る／見送るは出る。ページか窓かを司令塔が判断する。 |
| [EscPA](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/EscPA.png) | 375 | 開ける／計測済み | 小さい違い | 310の日付は省略表示で全文titleあり。本文の折返しは保持。 | カードの影・備考欄の高さ・任意札・字数表示・下の固定帯と戻るで差。 |
| [IruGD](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/IruGD.png) | 375 | 開ける／計測済み | 小さい違い | 原寸の候補0。310の分類横送りと、名前・説明の省略(title)を記録。 | 選択中の分類が黒い札。メニューのカード高・段間・影・下の固定帯が違う。 |
| [M2p63S](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/M2p63S.png) | 375 | 開ける／計測済み | 小さい違い | 原寸の操作重なり候補2は満席の無効時刻と通知の鈴。別操作の衝突と混同しない。 | 切替・日付の高さと段間、固定帯の余白に差。満席の鈴は追加された機能なので消さない。 |
| [RpW2h](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/RpW2h.png) | 375 | 開ける／計測済み | 大きい違い | 動画は既存ダミーURLを遮断。映像の再生は未検証。原寸と310の文字・背景・操作の計算済み色を保存。 | 参加済みの見本で視聴画面へ到達。チャット文字が暗い地に沈む。CTAの緑の面・コメント欄・送信ボタンの装飾が不足。共用Worker画面のCSS読込・生成範囲を優先調査する。 |
| [S3uBl](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/S3uBl.png) | 375 | 開ける／計測済み | 大きい違い | 見本APIの使い道・振込先・明細が404。部分測定。310のリンク省略は全文titleあり。 | 紹介の名前と操作が縦に分かれ、追加の使い道・振込先・案件で長い。追加機能は消さない。 |
| [VU6Xi](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/VU6Xi.png) | 375 | 開ける／計測済み | 小さい違い | 原寸の崩れ候補0。310では日付が折れる。 | 内容カードの影と、下の固定帯の浮いた枠・余白に差。受付済みの表示は出る。 |
| [YvTJ3](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/YvTJ3.png) | 375 | 開ける／計測済み | 小さい違い | 310で「キャンセルする」が2行。履歴の変更／取消は今回操作していない。 | 実装とAPIは存在。名簿のAPI待ち表記は古い。切替・カード高・札・操作の余白と文言が違う。 |
| [aNZKe](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/aNZKe.png) | 375 | 開ける／計測済み | 小さい違い | 310の題が最後の「た」だけ改行。原寸375では1行。 | 下の固定帯の余白・境界と影に差。予約の日付の違いは見本データ。 |
| [biNP5](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/biNP5.png) | 375 | 開ける／計測済み | 小さい違い | 原寸と310の横はみ出し・切れ・操作重なり・短文改行の候補0。 | 担当カードの高さ・段間・影と下の固定帯が違う。指名なしの選択は可視。 |
| [g9osGN](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/g9osGN.png) | 375 | 開ける／計測済み | 小さい違い | 310の長い入力名が末尾だけ改行。原寸では収まる。 | 実際に13:00を選んだ状態で撮り直した。日付は名簿の時計を保つ。任意札・前のページ・プライバシー文と段間に差。 |
| [gLReL](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/gLReL.png) | 375 | 開ける／計測済み | 小さい違い | 310の日付・料金は全文title付きの省略。主ボタンは「する」が2行目。 | カード影・ご要望の高さ・字数・下の固定帯に差。取消期限は実装の定義を保持する。 |
| [gVjiC](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/gVjiC.png) | 375 | 開ける／計測済み | 小さい違い | 原寸と310の崩れ候補0。待ちへの入口が可視。 | 見本画像と色はデータ差。下の固定帯の白いカード、選択枠・案内位置・影に差。絵は10時選択と待ちボタンが混在しており状態の対応を要確認。 |
| [k3aJKU](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/k3aJKU.png) | 375 | 開ける／計測済み | 小さい違い | 310初期の操作重なり候補21はカレンダーと固定帯。末尾では0。原寸末尾の上帯との重なりも候補として保持。 | 表示切替・カレンダーの段間と、固定帯に差。空きの点と満席は見本データなので寄せない。 |
| [qVdiX](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/qVdiX.png) | 375 | 開ける／計測済み | 小さい違い | 原寸と310の横はみ出し・切れ・操作重なり・短文改行の候補0。 | 結果カードの影・固定帯の余白と、待ちを取り消す文言が違う。待ち状態と取り消す入口は出る。 |
| [uZqMA](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/uZqMA.png) | 414 | 開ける／計測済み | 小さい違い | 追加310ではgLReLと同じ省略・主ボタンの改行。絵との比較は414の同じ幅で行う。 | 414の確認。共通の確認カード・入力・下の帯の差。原寸撮影は正常。比較画像の描画待ち不足は出し直した。 |
| [wPfqW](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/wPfqW.png) | 414 | 開ける／計測済み | 小さい違い | 追加310ではB8rCtと同じ固定帯の候補。原寸414で横はみ出し0。 | 414のフォーム。表紙高・選ぶ欄の高さ・任意札・段間が違う。 |
| [xvtSz](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/xvtSz.png) | 414 | 開ける／計測済み | 小さい違い | 通知の鈴と無効時刻の重なり候補2。追加310は共通の週表示。 | 414の週表示。M2p63Sと同じ切替・時刻・下の固定帯の差。 |
| [y1bs9A](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/y1bs9A.png) | 375 | 開ける／計測済み | 大きい違い | 短い操作の途中改行が375で2、310で2。機能の入口の欠けを見た目のために削って解決しない。 | 375でも「時間を変える」「キャンセルする」が2行、310で3〜4行。待ちの順番・やめる入口・ほかのイベントへの入口が絵と違う。受け口と接続を要確認。 |
| [zz9R3](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/zz9R3.png) | 375 | 開ける／計測済み | そのまま良い | 原寸と追加310の横はみ出し・切れ・操作重なり・短文改行の候補0。再読込後の動きは未検証。 | 失敗の中央の案内・再読込・上の帯が原寸で合う。初回表示の下読みのみ。 |
| [KRppA](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/KRppA.png) | 375 | 開ける／計測済み | 大きい違い | 375・310とも通知文2つが4行に崩れる。ボタン同士の矩形検査は0でも文字の漏れは目視で確認。 | 満席に対する長い通知の文言を24px角の通知ボタンへ入れ、縦に崩れて次の文へ重なる。系列店とコースは出る。値と枠を共通の役目で直す。 |
| [V2HU7](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/V2HU7.png) | 375 | 開ける／計測済み | 小さい違い | 4桁の入力が可視。店員の操作を本物へ送っていない。 | 上の帯の店名はデータ差。特典カード・案内・入力・下の固定帯の余白と影に差。 |
| [xe8ga](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/xe8ga.png) | 375 | 開ける／計測済み | 小さい違い | 日時・店名はデータ差。QAの使用済み応答だけを使用。 | 使用済みの表示・利用情報は出る。下の戻るの枠と余白、影に差。 |
| [h2HKh](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/h2HKh.png) | 375 | 開ける／計測済み | 小さい違い | 未選択からの紙写真のアップロード・申請は今回していない。列車34が扱う試験は触らない。 | 写真を選ぶ前の状態。絵の「撮り直す」と実装の「写真を撮る」は状態の対応を要確認。数の初期値はデータ。入力と下帯の形に差。 |
| [etLd8](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/etLd8.png) | 375 | 開ける／計測済み | 小さい違い | 写真URLは本人認証の取得口の形を使う。実画像の取得なし。 | 確認待ちの本人の見本を返して到達。時刻・個数の値は保持。時計印・状態札・戻るの枠に差。 |
| [sAnyy](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/sAnyy.png) | 未取得（実装暫定375） | 実装のみ／写し無し | 写しが無い | 実装の原寸と310を撮影・矩形点検。受付・変更取消への入口が可視。 | QAの任意電話を空のまま予約して受付完了を開ける。HTMLと文字座標が無いので絵との比較はできない。 |
| [B3oGt3](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/B3oGt3.png) | 375 | 開ける／計測済み | 小さい違い | 原寸と310の横はみ出し・切れ・操作重なり・短文改行の候補0。任意連絡先の開閉は別の状態。 | 確認画面は開ける。連絡先は折り畳みなので、初期表示へ電話入力を要求しない。滞在時間の括弧が二重、カードと固定帯の余白に小差。 |
| [XafWh](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/XafWh.png) | 375 | 未再現／対象未計測 | 開けない | 別のフォームを対象画面として測らない。画面内の数は対象外null。 | URLは開くが本人確認書類の質問が無く、来店アンケートが返る。試験データ不足。 |
| [B5SbF](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LIFF1/sbs/B5SbF.png) | 375 | 未再現／対象未計測 | 開けない | 本物の書類・アップロード・送信はしない。対象の数はnull。 | 書類送信後を作る質問・添付応答がQA見本にない。試験データ不足。 |

## 検査の意味と限界

横はみ出しは文書のscrollWidthと文字のRange、切れはクリップする親、折返しは短い見出し・操作、重なりは操作同士の矩形を採った。原寸と310の初期表示・末尾を別に残した。ただしこの機械だけで全崩れ0とは言わない。

- KRppAの文字漏れはボタン同士の矩形の重なりでは見逃した。目視で確定した。RpW2hの暗い文字・面の不足も目視で見つかった。
- M2p63S/xvtSzの無効な時刻と通知の鈴、固定帯・sticky上帯の下へスクロールした要素は生の重なり候補に含む。押せる操作2つの衝突と同じ欠陥へ数えない。
- title付きの名前・URL・日付の省略は、安全な省略として別に記録。長い説明の自然な改行と、操作の途中改行は分ける。
- 全34板の原寸と追加310の画像を目視した。機械の候補・例外・APIの応答を保存。未処理の画面例外は0だが、見本APIの404や意図した失敗500は残る。
- VITE_LIFF_QA=1の既存の偽LINEが全34板で読み込まれた。APIは127.0.0.1:8798の見本。ブラウザから外へはフォントのみ許し、LINE・動画・外部遷移への要求は遮断した。予約・特典利用・回答完了はQA応答だけ。本物のLINEログイン・送信・決済・書類アップロードは0。
- コードを変えていないので、全単体試験・LIFF本番ビルド・回帰試験は今回行っていない。pnpm install、共有パッケージのビルド、計測用コードの構文・読込、対象の状態と実描画を確認した。予約変更・取消・紙カードの実送信・失敗からの再試行は次の機能点検へ。

## 開き方の外れと、つかんだ型

最初の撮影で席予約の電話を閉じた折り畳み内へfillしようとして止まった。電話は任意なので初期の確認と確定の開き方では空のまま進めた。確認の初期表示へ電話の可視を要求しない。ウェビナーの題が見えるだけでは視聴画面ではなかった。既存の試験と同じ参加登録済みの返事と、コメント入力が実際に見えることを確認した。フォーム2ページ目は時刻の選択が抜けていたので、UIで13:00を選び、日付のデータは変えなかった。最初の外れはattempt-1へ保持。

計測ライブラリのCommonJS読込と、比較画像の画像描画待ちは計測側の問題として修正した。最終の比較画像は保存済みPNGを軽い合成で並べ、原寸67面の完全な画素一致と、スマホ枠の表示域67面の投影一致を確認した。UIの欠陥へ数えていない。比較の主画像は原寸を左右同じ縮尺、追加310は別画像。

次のタスクはこれ：まずRpW2hの共用CSSとKRppA/y1bs9Aの操作幅を直し、同じ部品を使う仲間をまとめて再点検する。その前に変更する共通部品をPATTERNS-INへ予約する。書類の試験用入口・sAnyyの写し・28枚の除外IDは司令塔へ渡す。下の帯・カード・入力の小差は共通の値で束ね、予約・取消・待ち・スタンプ・フォームの動きの試験を保って進める。

コミットまで。push・PR・合格台帳・Pen・migration・DB更新・配備は行わない。

初回結果表は2026-10-14 01:08 JSTに保存。合成・完全性の検証はVALIDATION.json。実行済みの開き方の正本はOPENINGS-MEASURED.json。次回用の台本に変化があっても実行済みの開き方へ混ぜない。

## 再現の起動

既存の撮影サーバーはこの作業ツリーの3670、偽APIは8798。止めたあとに起動する場合は、doctor合格→pnpm install --frozen-lockfile→共有パッケージのビルド（heavy.shで包む）の順。偽APIは `QA_MOCK_PORT=8798 node apps/liff/scripts/qa-mock.mjs`。LIFFは `VITE_LIFF_QA=1 VITE_DEFAULT_LIFF_ID=qa VITE_API_BASE=http://127.0.0.1:8798 pnpm --filter liff dev --port 3670 --strictPort --host 127.0.0.1`。

次の撮影は先にLIFF1を同じmatch2内の別の回のフォルダへ複製して、最初の証拠を保持する。複製側のcapture.mjsをheavy.shで包んで実行し、撮る前のfresh-checkを通す。実行済みの開く条件はOPENINGS-MEASURED.json。画像の合成はcompose.py、数の抽出はcount.py。

画像と再現台本は指定のLIFF1に保存。Gitには文字の表・観察の値・撮影版と画像のSHAを残す。
