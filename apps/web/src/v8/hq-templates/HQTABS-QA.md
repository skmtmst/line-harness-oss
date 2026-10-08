# hqtabs の作業報告（2026-10-08）

今の進捗を全体像から整理するとこれ：統括の2タブを店のV8部品に接続し、一覧・作る・編集・削除・並べ替え・保存後の配布を実装した。push・PR・DB更新・配備は行わない。

## 板ごとの照合

| 板ID | 名前 | 初回一覧表示 | 最終1440幅 | 左右・重ね合わせで見た結果 |
| --- | --- | --- | --- | --- |
| y0sapC | 友だち情報欄のひな形 | 36% | 96%（50/52文字） | 操作の切れ・重なりなし。API未提供の集計・使用先は「—」。HTML見本と文字座標表で表の寸法が違う。 |
| Qgjmc | 対応マーク | 89% | 100%（44/44文字） | 操作の切れ・重なりなし。状態別集計・使用先・詳細な自動変更ルールはAPI未提供。HTML見本と文字座標表で表の寸法が違う。 |

準備中の初期画面では本文がなく、一致率を比較できないため、初めて一覧を描いた時点を開始値にした。照合の正本は指定の `pencil-texts/*.tsv`。データ違い・APIにない値・依頼された名称変更を一致率で覆い隠さない。

指定の2板は撮影できた。1152幅の対応板は提供されていないため、1152幅の設計一致率は算出しない。1152・1440・1920幅の6状態は画面を撮影し、横スクロール0px、配る・行メニューの右端越え0を試験で確認した。1152幅では情報欄のフォルダ列を選択欄へ畳む。

## 司令塔へ戻す違い

- HTML見本では表の行・列幅が文字座標表と一致せず、右の配る操作も右端へ寄っている。共有部品の見た目は変更せず、座標表に合う本線の店部品を使用した。HTMLと座標表の照合は司令塔の判断が必要。
- 画面名・パンくずは「タグ」。左メニューの名称は専任担当の取り込み待ち。フォルダの色も統括APIにないため店の色で代用しない。
- 情報欄の種類移行、フォームでの使用数・出す場所・入力済み友だちの重複除外集計・月内変更数、マーク別状態集計・7日間の変更数・詳細な自動変更ルール、分類フォルダの色・一括順序APIは未提供。これらの操作・代用値は追加していない。ひな形の並べ替えは既存PATCHで保存する。

## 使用したAPI

接続は既存の `hqFriendAttributesApi` と `hqTemplatesApi`。Worker・DB・APIの型は変更していない。

- `GET /api/staff/me`：所属・利用者を確認し、作成の再確認記録を別利用者と混同しない。
- `GET /api/hq/templates?type=friend_field|mark`：一覧と提供済み集計。
- `GET /api/hq/templates/:id`：保存済み定義・版。
- `POST /api/hq/templates`：依頼IDと `Idempotency-Key` を付けて作成。応答不明は同じ入力・ID・保存意図で再確認。
- `PATCH /api/hq/templates/:id`：編集・並べ替え。`expectedRevision` を付ける。
- `DELETE /api/hq/templates/:id`：確認後の削除。`expectedRevision` を付ける。
- `GET/POST /api/hq/templates/folders`、`PATCH/DELETE /api/hq/templates/folders/:id`：分類フォルダ。
- `GET /api/hq/templates/accounts` と `GET /api/line-account-folders`、`GET /api/line-accounts`：配布先選択と既存のアカウントフォルダ部品。
- `GET /api/hq/templates/:id/received-versions`：配布済みの版。取得失敗を未配布に読み替えない。
- `POST /api/hq/templates/:id/preflight`：配布前の確認。期限と許された重複解決方法を守る。
- `POST /api/hq/templates/:id/distribute`：確認した番号で配布。
- `GET /api/hq/templates/:id/distributions/:runId`：進み具合・結果。応答不明時はGETで回復しPOSTを重ねない。

## 変更ファイル

- 店の部品再利用：`tags/attribute-host.ts`、`fields-tab.tsx`、`marks-tab.tsx`、`field-editor.tsx`、`mark-basic-fields.tsx`、`mark-editor.tsx`、`list.module.css`、V8に限定した列幅変数 `src/app/globals.css`。
- 統括接続：`hq-templates/attributes.tsx`、`attribute-model.ts`、`attribute-distribution.tsx`、`attribute-tabs.tsx`、`console.tsx`、`store-list.tsx`、`BEHAVIOR.md`。
- 動作試験：`hq-templates/attributes.test.tsx`、`attribute-tabs.test.tsx`、`console.test.tsx`、`console-tag-folder.test.tsx`、`hq-broadcasts/create.test.tsx`。後ろ3本は追加のAPI読み込みに対応した部分モックへ変更。
- 検証：`scripts/visual-qa/mock-api.mjs`、`capture.spec.mjs`、`components/templates/list-page-folder-nav.test.tsx`、`src/lib/screen-css-budget-baseline.json`、`design/design-impact-baseline.txt`、この報告。

フォルダ列の試験は、編集画面の `folders` と一覧の左列を混同していた判定をJSXの構文解析へ変更し、取り違えを再現する試験を追加した。CSS基準は取り込んだhq枝の5ファイルだけを同期し、無関係な減少は反映していない。

削除した旧期待値は、準備中タブの「各アカウントで作る」という案内・リンクの2箇所。使えるようになったため、タブ選択・URLの動作確認へ置き換えた。保存・配布・権限・失敗時の試験とv7分岐は残した。

## 検証

- `DOCTOR_LOCAL=1 bash scripts/codex/doctor.sh`：合格。
- 最新本線を取得・mergeしてから試験。本線SHA：`ccc594d1f8605351417cd4e07b7842ad1cefc3f7`。
- 指定の統括試験：63ファイル・348件合格。
- 店・変更した共通部品・設計ガード：36ファイル・208件合格。
- 最終再実行は両方を合わせて99ファイル・556件すべて合格。
- 応答不明・版衝突・下書き・保存後配布・閲覧のみ・並べ替え・未保存の確認・選択肢IDの保持を確認。編集の版を故意に0へ変えると試験が落ちることを確認し、復元した。
- `tsc --noEmit -p .`、web build、`verify:design`、`git diff --check`：合格。設計値は456件一致・不一致0。
- `measure.sh hqtabs y0sapC,Qgjmc`：96%・100%。左右比較・重ね合わせを確認。撮影サーバーは停止。
- `capture.spec.mjs --grep hqtabs`：6件合格。V8を明示し、1152・1440・1920幅で確認。

## 解いた競合

1. `hq-templates/BEHAVIOR.md`：本線のタブ・絞り込みの動きとhq枝の保存後配布・フォルダ選択の動きを両方残した。
2. `hq-templates/store-list.tsx`：本線のタブ・絞り込み・集計を残し、店のスタイルと統括固有のスタイルを両立させた。
3. `tag-edit/edit.tsx`：本線のCheck表示と、統括の保存ラベル・保存可否を両方残した。
4. `docs/brain/rules/corrections.md`：双方の記録を残し、今回の競合解消方針を追記した。

競合解消コミット：`309988347c`。その後の本線取り込み：`4d616339d1`。

実装コミット：店の部品再利用 `cfd1687062`、統括のタブ・保存・配布 `40d0bb2ecf`。検証とこの報告は別コミット。

次のタスクはこれ：司令塔が内容を確認し、列車2へ取り込む。採番後の更新履歴・push・PR・統合・検証環境への反映は司令塔が行う。
