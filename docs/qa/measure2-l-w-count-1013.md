# L組6回目：W1〜W4と仲間1・2の提出

22枚を合格候補として提出する。1440・1152・1920の66場面でF1〜F10、崩れ、右端越え、画面例外、更新要求は0。合格台帳への追加と代表・抜き取りの判定は司令塔に渡す。

撮影・全検証のアプリ版は `3536de06748a06465bc9694a9dfb4217d7eae533`。最新本線 `4dee951add0778454715759fe3f992aa6f17927c` をmerge commitで取り込み、共通Buttonの本線fullWidthとL側の言葉の統一を両方保持した。型対応表は双方のID・信号・所有先を3方向で併合して49型を保持。列車31は取り込み時点で未統合。最後の文書コミットは撮影したアプリを変えない。

## 直した動きと形

- W1：送り先作成の画面専用 `width:100%` を外し、共通Buttonと道具の先頭の中身幅を使う。検査は先に故障対照を足し、リンクとnative selectを含む道具領域全体で2段超え・選ぶ欄だけの段・伸びた作成を数える。開始版のZSbFYは実測で既に2段だったため、3段を再現したとは報告しない。
- W2：紹介者には既存のフォルダ保存APIがあるため、共通フォルダ列・色・選択・行の移動窓へ接続。移動がAPIへ送られ、成功後に窓が閉じることも検証。マイルは所属を保存するAPIがないため、型が空の列と選ぶ欄を隠す。作成・きっかけ・公開状態・並び替え・履歴は保持する。
- W3：件数の字を共通書式へ。SelectとListToolbarは幅のスタイルでなく実際の役目を引き継ぐ。「7日」の期間、件数の10/20/50/100などの既存の選択肢を保持する。
- W4：回答フォームの管理者確認は共通副ボタン、アーカイブは印付きの共通絞り込み。モード切替・権限・URL・一覧の操作を保持する。
- 測定準備：閉じた窓の失敗文を本文と誤認する欠測を修正。見える失敗は引き続き測定を止める。実ブラウザの故障対照を追加した。

旧い空のフォルダ列や空白付きの件数だけを要求する試験は、新しい実際の形へ更新した。保存・失敗・権限・件数によるAPI引数の試験は削除していない。試験の上限、許可リスト、架空の見本データは追加していない。

## 数と判定の範囲

|対象|結果|
|---|---|
|仲間1：13枚、仲間2：9枚|66/66場面取得。修正前F3=9・F4=2・F5=3・F8=4、修正後は全型0|
|左右の画像|交換済みの写しから44枚再作成・確認。1152の写しがない6枚は参照1440と明記|
|合格済み本文|24記録・20種類の記録された幅で指摘・崩れ0。WQmepのF10は一覧ではないため対象外|
|タブを含む追加30枚|90場面のうち87取得。一覧84場面のF10は0、通常型3場面はF10対象外|
|追加の欠測|owaS3の3幅は型がなく欠測。0にせず終了1を保持|
|追加の対象外の指摘|g98F9・MuhWR・mIwA4・wTIej・YMVFD・nku0fのF1/F2/F5/F6を別表へ。対象2仲間の外なので画面を変更しない|

F1〜F10の表は実画面の数。条件付きの窓・未使用CSSも含むソース候補は別表に保持する。ソース候補全部を0とする検査ではない。今回の新規手書き・上書きは既存pattern-auditで未許可0、設計値も一時許可0・未許可0。

通常の型でも短い文字・未知値・崩れを測れる。F10は狭い一覧の形だけを担当し、作成・設定・受信箱の形は各組の既存検査と併用する。型のない画面は欠測として返す。色・言葉の自然さ・全機能の合格は機械の数だけでは決めない。

決まった言葉の点も22枚を同じアプリ版で再取得した。交換済みの写しに対する生の診断値をCANDIDATESへ記録し、b/c除外はしない。以前の除外済みの点と直接比較しない。B-260に従い、点を上げるために機能・データ・共通値を変えない。

## 検証

merge後の同じ版で重い検査を1つずつ実施。vitestは最大4 workers、`NEXT_PUBLIC_API_URL=http://127.0.0.1:8788`。

|検査|結果|
|---|---|
|Worker全体|976ファイル・11,600件成功|
|Web全体|2,184ファイル・12,958件成功、既存skip1/todo1|
|scripts全体|111ファイル・1,027件成功|
|実ブラウザ検出器と故障対照|73件成功|
|Web・Worker・scriptsの型|成功|
|Webビルド・設計値・持ち主監査|成功、許可追加0|
|最終撮影|22/22取得・コミットとビルド版の一致を確認|

## 帳面と引き継ぎ

効いた直しは8件（製品6・計測2）。事前予想は当たり3/7=42.9%、部分4。事後に記録した役目の修正等は的中率に入れない。候補の整理時点で137.6分/22=6.25分/枚。前回14.4分/枚より短縮した。取得だけの82.22秒/22と、待機・読書・全試験を含む時間を分けて記録した。共通定数・ネットワークの順・幅の形だけでは原因を説明できなかったため、次は呼出しと可視DOMの役目を先に数える。

成果物は外部の [L6](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/L6) に置いた。

- [数の表](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/L6/F-MATRIX.tsv)、[部品の有無](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/L6/F4-PRESENCE.tsv)、[追加タブ](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/L6/TAB-F10-COUNTS.tsv)、[対象外の残り](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/L6/OTHER-LANES-REMAINING.tsv)。
- [左右44枚](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/L6/final/index.html)、[候補22枚](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/L6/CANDIDATES-L6.tsv)、[合格済みの保護](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/L6/PROTECTED-AFTER.tsv)。
- [Penを直す物](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/L6/PEN-CHANGES.md)、[機能の差](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/L6/FUNCTIONAL-DIFFERENCES.md)。マイルの所属保存はFEATURE-WAITへ記録。
- [F/Gも使う道具の手順](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/COUNT-TOOL.md)、[帳面](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/LEARN.md)、[検証の記録](/Users/kentakenta/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/L6/POST-MERGE-VALIDATION.json)。追加タブの終了1は欠測として残し、左右の作成はその後に単独で成功した。

2仲間で止める。次は司令塔の代表・抜き取り判定、その後O7hUt7・e2ekFu・B9ZAr。G組の画面、Pen、合格台帳、親EC、migrationは変更していない。push・PR・統合・DB更新・配備は行っていない。

司令塔がPRを採番した後、反映履歴へ「一覧の作成ボタンと絞り込みを整え、紹介者をフォルダへ移せるようにした」を担当・PR番号・日本時間付きで記入する。未採番なので番号は推測しない。
