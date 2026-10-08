# G-7 フォルダ配布の確認（2026-10-09）

実装の確認は完了。見た目の位置一致は未合格。push・PR・DB更新・配備はしていない。

## 絵との比較

| 板 | 名前 | 変更前 | 変更後 | 左右比較 |
| --- | --- | --- | --- | --- |
| LRc93 | 統括テンプレート一覧 | 5% | 5% | 土台の列車2には数の帯があり、指定板にはない。表の位置・列の構成が異なる。G-7以外の一覧を戻す変更はしていない。 |
| JSirC / W2GYgL.png | フォルダ配布メニューと窓 | — | — | 1440・1152で撮影。先頭の太字の送る操作と区切り、全チェック済みの一覧、種類の札、アカウント選択、0件時の無効化を確認。窓の位置・高さ・行間は絵と異なる。 |

JSirCの採用PNGの窓には測定用の文字座標表がなく、位置一致率は計算していない。窓を撮れない板はなし。見本データでテンプレート画面を代表として確認した。タグ・リッチメニュー・回答フォームは同じフォルダ部品と窓を使用する。

G-3b/G-4のアカウント選択を使い回したため、フォルダ単位のチェックとフォルダの色の点も引き継ぐ。窓の共通部品の見た目を変える判断は司令塔へ返す。見た目の90%合格としては記録しない。

撮影結果は作業場所の `.g7-qa/`（ローカル用・git対象外）。`fdist-dialog-1440.png`・`fdist-dialog-1152.png`・両幅のメニューとバナー窓。テンプレート窓は2アカウント選択、全解除で配布無効、ページエラーなし、横のはみ出しなし。バナーはプロジェクトの「…」から全8枚を選んでG-6の窓を開く操作を確認した。

## 使用した既存API

- `GET /api/hq/templates?type=...`・`GET /api/hq/templates/:id`：フォルダ全体の一覧と保存内容。
- `GET /api/hq/templates/folders`・`GET /api/hq/templates/accounts`：作ったフォルダと配れるアカウント。
- `GET /api/line-accounts`・`GET /api/line-account-folders`：配る先のフォルダと所属。
- `POST /api/hq/templates/:id/preflight`：ひな形ごとの配布先・同名・版の確認。
- `POST /api/hq/templates/:id/distribute`：確認済みのひな形を順に配布。
- `GET /api/hq/templates/:id/distributions/:runId`：応答不明・作成中・再読込後の結果確認。再POSTしない。
- `POST /api/hq/banners/images/:id/deliver`：G-6を使い回す画像配布。

API・Worker・DBの追加は不要。失敗したひな形×アカウントだけ確認を取り直し、成功済みを再送しない。送信前の記録に失敗した場合はPOSTしない。

## 検証

- Doctor：`DOCTOR_LOCAL=1`、合格。
- 本線の確認SHA：`ccc594d1f8605351417cd4e07b7842ad1cefc3f7`。テスト前に取得し、専用ブランチへ取り込み済み。列車2とbnrをmerge。rebaseなし。
- `tsc --noEmit -p .`：合格。
- 指定hq範囲・フォルダ・変更した型・設計契約：85ファイル557試験、合格。種類札の調整後もconsoleの25試験を再確認。
- `build`：合格。`verify:design`：456件一致・不一致0、合格。
- 既存のv7試験にはReactの入れ子とモックの警告が出るが、試験の失敗はなし。v7の分岐・試験は削除していない。

## 競合を解いた箇所

- `hq-banners/list.tsx`：列車2のフォルダのkind指定とG-6の配布済み文言を残した。
- `hq-templates/saved-distribution-dialog.tsx`：G-6の題・説明・アカウント状況・案内・配布可否の追加口を残し、抽出した同じアカウント選択部品へ渡した。
- `hq-templates/store-list.tsx`：双方のCSS importを残した。
- `hq-templates/BEHAVIOR.md`・`docs/brain/rules/corrections.md`：G-7とbnrの記録を残した。
- G-6で追加されたStickyBarのクラス組み立ては実在する共通CSSを使うため、その追加1箇所だけ未解決クラスの基準へ登録。他の基準は緩めていない。

## 自分の変更ファイル

共通：`components/shared/action-menu.tsx`・`folder-panel.tsx`・`folder-panel-icons.react.test.tsx`、`components/templates/list-page.tsx`・`page-templates.module.css`。

統括：`v8/hq-templates/console.tsx`・`console.test.tsx`・`store-list.tsx`・`store-list.test.tsx`・`distribution-accounts.tsx`・`distribution-account-picker.tsx`・`saved-distribution-dialog.tsx`・`distribution-result-dialog.tsx`・`folder-distribution.ts`・`folder-distribution.test.ts`・`folder-distribution-dialog.tsx`・`folder-distribution-dialog.module.css`・`folder-distribution-result.tsx`・`BEHAVIOR.md`・この確認記録。

バナーの入口：`v8/hq-banners/project.tsx`・`project.test.tsx`・`BEHAVIOR.md`。

その他：設計の利用先・CSS数・クラス組み立ての基準、`.gitignore`、修正指示の記録、`docs/release-log/unreleased/pending-kenta-fdist-g7.md`。反映履歴のPR番号は司令塔の採番後に置き換える。

## 主なコミット

- 共通部品・配る先の抽出：`41cca6d719`
- フォルダ配布・復元・失敗だけの再確認：`4ca6a67ebb`
- G-6の取り込みと競合解消：`1825ed2e20`
- バナーのプロジェクト入口：`149d4cfe77`
