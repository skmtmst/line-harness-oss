# 列車40・10月16日03:20指示の再検査

監査指紋とGoogle投稿の横空白は解消した。型・ビルド・全Web/scripts/Worker試験・画面検査は成功。ci-localの全合格とは扱わない。PR未作成のため反映履歴ゲートに必要な実際の題名・番号がなく、主実行の最終集約が失敗している。仮の反映履歴は指示どおり保持した。push・PR・DB更新・配備は実施していない。

## 取り込みと変更

開始は作業役Aの投稿修正 `1a39edea14` が入ったクリーンな枝 `codex/kenta-train-40-1015`。doctorは `DOCTOR_LOCAL=1` で合格。

- 本線 `5ace6976dc519607874959df2b9f6396868e27a2` を `beaadb2385` で `--no-ff` merge。最初は浅い履歴の影響で242ファイルの競合が出たため、未解消のmergeをabortしてクリーンへ戻し、`git fetch --deepen=30 origin codex/development` で履歴を追加取得。共通祖先cd63を確認して再mergeすると競合0で12ファイルを取り込めた。画面や共通部品を片側へ寄せる解消は行っていない。
- `ce5ba8ec09` でCTAの既存レビュー1件を指定どおり更新。指紋は `a9b0c30ee5eb76d7` → `4824e32cbdb8ad58`。理由に「10-16 司令塔が再確認：catch 同一・error-visible」を追記。記録は62件のまま、countとdispositionも維持。[差し替えの証拠](train40-final3-1016/review-update-proof.json)。関連11試験とWeb全試験の双方で成功。
- 検査中に本線が#1741・#1742入りの `b4adb688bd42c359d1539dbf802b5ad888a9e647` へ進んだため、fetchし `d345696c6d` で `--no-ff` merge。競合0、Workerと文書7ファイルだけの追加。後続の影響範囲を別のci-localで再検査した。

G（A〜Fをまとめたbd600）、testfix、L7、列車39の6605は既に包含済み。[包含確認](train40-final3-1016/incorporated.json)。初回の指定枝と共通部品の競合解消の全記録は [夜の記録](train40-evening-1015.md) と [続き2](train40-final2-1016.md)。API2の枝・追加マイグレーションは取り込んでいない。

Codexによる画面の編集は0。Google投稿は作業役Aのコミットを保持した。新しい許可・例外・上限の追加なし。カード例外の削除とレビュー表示分離は前回のbfe815を保持。

## 検査結果

重い試験・ビルド・実ブラウザは全てheavy経由。Node22.23.3。主ci-localの検査SHAは `ce5ba8ec09bf46576f0ac6b9032242674aff3390`、baseは5ace。後続の検査SHAは `d345696c6d228d337afb19ce0fd957dd6a042ec6`、baseはb4adb。

|検査|結果|
|---|---|
|全パッケージ型検査（ce5）|成功|
|全パッケージ型検査（d345）|成功|
|scripts型検査|成功|
|Web全試験|2,255ファイル・13,456件成功、skip/todo各1|
|scripts全試験|112ファイル・1,034件成功・1件skip|
|Worker全試験（ce5）|987ファイル・11,788件成功|
|Worker全試験（最新d345）|988ファイル・11,801件成功|
|DB全試験|382ファイル・2,270件成功|
|Web/Workerビルド、設計値|成功|
|Web lint、共有・LIFF・SDK・MCP・文書試験|成功|
|行数上限|2,674本文ファイル・437凍結・違反0（最終d345）|
|3幅のはみ出し・配置比較・一覧・操作|成功|
|全185画面の見出し|不一致・測定失敗0|
|速度11場面×5回|全55測定完了・超過0|
|空白差分検査|成功|

主ci-localは114工程を評価し、82成功・1失敗・31省略。[集計と原ログ](train40-final3-1016/ci-local-summary.json)。失敗はrequired-pr-gateの最終集約だけ。changesの反映履歴検査が実際のPR題名不明でunsupportedとなり、その状態を最終集約が拒否した。製品の検査失敗は0。PR情報を仮定した再実行やゲートの変更で通していない。31省略には、この未実施1件とuses/if/不要な診断成果物が含まれる。

後続ci-localはWorker型・全試験・ビルド、LIFF入口、文書など28工程を評価し、17成功・失敗0・11省略。[集計と原ログ](train40-final3-1016/ci-local-backend-summary.json)。この実行も同じPR情報不足1件を含むため終了2。部分検査を全CI合格とは扱わない。

## Google投稿と画面の証拠

本線と比較した配置検査は201条件を全取得、新規失敗0・既存の許可1。投稿の1152/1440/1920はいずれも指摘・許可0。前回の横空白2件は解消。[配置と速度の集計](train40-final3-1016/layout-summary.json)。投稿画像の幅320は維持し、画像の右に投稿の詳細を並べる作業役Aの実装を検査した。1440/1920画像を開いて切れ・重なりがないことも確認。正式なPen合格への追加は0。

画像はci-localの保存済みビルドから取得し、version.jsonがce5の完全SHAで一致することを確認した。

- [1440](/Users/kentakenta/lh-work/design/v8/codex-handoff/train40-final3-1016/post-1440.png)
- [1920](/Users/kentakenta/lh-work/design/v8/codex-handoff/train40-final3-1016/post-1920.png)
- [1152](/Users/kentakenta/lh-work/design/v8/codex-handoff/train40-final3-1016/post-1152.png)

T1j2Swのfresh-checkは通過。Penの保存時刻の警告は板の変更台帳・再作成記録で判定する案内で、合格追加の根拠にはしていない。[投稿の実寸](train40-final3-1016/post-diagnosis.json)。

後続d345はWeb・撮影コード・共有型・ルート依存のGit木がce5と一致している。[一致と追加7ファイルの証拠](train40-final3-1016/followup-scope.json)。このためWeb/画面/鍵の完了結果は同じ画面実装に対する証拠として保持。追加された反映履歴2件も最新の生成・全型検査で確認済み。

## 鍵

332条件中330を取得。基準鍵との差は170板・7,507属性で、旧差を解消・合格とは数えていない。[差の全板一覧](train40-final3-1016/lock-differences.tsv)。未取得は前回と同じDA0Ag/1440・cFo2p/1440の旧操作2件。checkの終了値は2であり、未取得を0や合格へ数えていない。

前回9d27の実測330条件と同じcompareShapesで直接比較し、追加で形の変わった条件・板は0。[前回との差](train40-final3-1016/lock-vs-prior.json)。基準manifestと板JSON、計333ファイルのSHA256は全て不変。record/acceptなし。[集計と原本](train40-final3-1016/locks-summary.json)。外のstable地図・鍵・Pen・合格台帳は変更なし。

## 司令塔への引き継ぎ

製品の残件2項目は解消し、実行した製品検査は成功。次は司令塔がpush・PRを作成し、実際の番号で反映履歴を採番して通常のPRゲートを確認する工程。仮の反映履歴はそのまま。DB更新・配備は未実施。
