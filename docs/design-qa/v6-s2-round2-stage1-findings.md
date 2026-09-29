# S2 第1段（機能6〜13）撮影と判定の所見 — 2026-09-04

対象は 86 画面（機能 6 一斉配信・7 リマインダ・8 自動応答・9 友だち追加時の配信・10 ウェビナー・11 テンプレート・12 リッチメニュー・13 回答フォーム）。
撮った head は `codex/development` の `49e1341c`。設計画像は 2026-09-03 に Pencil から撮り直したもの（`docs/design-reference/*-v6/`）を使った。

判定の正本は `scripts/visual-qa/screens.mjs` の各行、集計は `docs/design-qa/v6-progress-ledger.md`（機械生成）。この文書はそこに載らない「なぜ撮れなかったか」と文言の一覧を残す。

## 1. 判定の内訳

| 判定 | 数 |
|---|---:|
| 一致 | 0 |
| 構造一致・データ未接続 | 3 |
| 要修正 | 46 |
| 未実装 | 15 |
| 未判定（撮れていない・比べられない） | 22 |
| **合計** | **86** |

**「一致」は 0 件。** 一致は文言一致 ＋ 寸法一致 ＋ 全状態撮影済みのときだけ付ける。

## 2. 撮れなかった 22 画面の理由

撮れなかったものは判定を空欄のまま残した。見ていない絵を「合っていた」と数えないため。
理由は 3 つに分かれ、**そのうち 16 画面は実装ではなく撮影ハーネス側の不足**だった。

### 2-1. 撮影ハーネスの固定データ不足（16 画面）— `scripts/visual-qa/` は S0 の所有

モックに口が無く、`EMPTY_PAGE`（`{items:[],total:0,page:1,limit:20}`）へ落ちている。
**器の形が本番と違う**ので、画面が配列を期待している所で落ちる。

| 口 | 本番（Worker）が返す形 | モックが返す形 | 落ちる画面 |
|---|---|---|---|
| `/api/webinars` | `{ success, data: [...] }`（配列。`webinars.ts:767`） | 空の器 | `ZC13r` `zCQXe` — `page.tsx:125` で `narrowed is not iterable` |
| `/api/webinars/:id` | ウェビナー1件 | 空の器 | `PV1Vh` `d3rFGD` `Ho8z4` `Xjk8q` `GB0NR` `D6yO7e` `Q8sHa` `yxyzQ` — `edit/page.tsx:950` で `webinar.schedule` が無いまま `.length` |
| `/api/rich-menu-groups` | 配列（`rich-menu-groups.ts:745`） | `[]`（形は正しいが空） | `kQ1bs` `DIUbO` `NXdDk` `UMiJ9` `szXsT` — `rmg-1` `rmg-2` が見つからない |
| `/api/friend-add-routing/draft` | `{ ..., routing }`（`friend-add-routing.ts:224`） | `routing` を持たない | `uLQQc` `txMO9` `U3SI5` — 画面は `res.data.routing` を読む（`page.tsx:102`） |
| `/api/forms` | 配列 | `[]` | `v9tYhl`（行が無くフォームを開けない） |
| `/api/folders?type=template` | 配列 | `[]` | `CzndJ` `W7LBc` のフォルダ状態 |
| `/api/segment-presets` | 配列 | 空の器 | `sqFXf-save`（保存済み条件が無く「この条件を使う」に届かない） |
| `/api/broadcasts` の行 | `lineAccountId` を持つ | 持たない | `bPF0s`（アカウント違いの止め画面が出る。`reserved/page.tsx:47`） |

**`bPF0s` 6-1-I 一斉配信・予約完了は、2026-09-03 夜のマージで `/broadcasts/reserved` が入り、未実装ではなくなった。**
撮れるようになったが、出るのは面ではなく「選択中のアカウントの配信ではありません」の止め画面。
モックの `broadcast-0` に `lineAccountId: 'visual-qa-account'` を持たせれば通る。
**設計側に `bPF0s.txt` が無い**（`.png` だけ）ので、文字の突き合わせはそのあとでも別途 Pencil からの書き出しが要る。

### 2-2. 撮影ハーネスが「落ちた画面」を撮って合格にしていた（2 画面）

`capture-screens.mjs` の `FAILURE_TEXTS` に **「設定を表示できませんでした」が入っていない。**
そのため `uLQQc` `txMO9` は本文が

> 設定を表示できませんでした / もう一度読み込む

だけの絵なのに「撮影OK・はみ出し0」と出ていた（`friend-add-v6/uLQQc.txt:62`、`txMO9.txt:62`）。
**この絵をもとに書かれていた過去の判定は取り消した。**

同じ形の見落としを防ぐため、`FAILURE_TEXTS` に「設定を表示できませんでした」を足すことを S0 へ渡す。

### 2-3. 実装に押しどころが無い（4 画面）

| 画面 | ルート | 何が無いか |
|---|---|---|
| `xkRDb` 6-1-M フォルダ操作 | `/broadcasts` | `data-qa-open="xkRDb"` の押しどころ。一覧に出るのは「フォルダを追加」だけ |
| `CzndJ` 11-1-H フォルダ操作 | `/templates` | フォルダごとの操作の口。出るのは種類のタブと「すべて」「text」のチップだけ |
| `PSmHo` 7-1-G 有効化完了 | `/reminders/edit?…&stage=confirm` | `stage=confirm` そのもの。開いても素の編集画面（「保存」「一覧へ戻る」）が出る |
| `Y0Sn3-fail` 7-1-I 削除確認（一部失敗） | `/reminders` | 「このページのリマインダをすべて選ぶ」。全選択が無く一部失敗の絵に進めない |

## 3. 撮影ハーネスの誤り（この PR で直した。`screens.mjs` の S2 区画）

1. **ARIA に無い役割で探していた。** `role: 'text'` は Playwright の `getByRole` に無く、常に 0 件になる。ラジオを指していたので `role: 'radio'` にした（`cPk8A` `sqFXf`）。
2. **変種が基本手順を二重に持っていた。** `capture-screens.mjs` は `[...steps, ...variant.steps]` で繋ぐので、変種側に同じ手順を書くと**開いた窓の上から下のラジオを押す**ことになる（`sqFXf-save`）。

この 2 つを直して機能 6 は 30 枚 → 34 枚になった。

**`role: 'text'` は S3 の区画にもあと 4 か所ある**（`screens.mjs:1604` 田中 明／`2059` 発送した／`2211` 高橋 直人／`2375` 高田 誠）。同じ理由で当たらないはずなので S3 へ渡す。

## 4. 「準備中」「取得できません」「壊れ値」「内部語」の一覧

撮った実装の文字（`docs/design-qa/*-v6/*.txt`）から拾った。**コードの grep ではなく、画面に出た文字だけ**を数えている。

### 4-1. 準備中（6 件）

| 機能 | 文言 | 出どころ |
|---|---|---|
| 6 一斉配信 | リッチメッセージ（準備中） | `broadcast-form.tsx:85` |
| 6 | リッチビデオ（準備中） | 同 `:86` |
| 6 | カードタイプ（準備中） | 同 `:87` |
| 6 | クーポン（準備中） | 同 `:88` |
| 6 | リサーチ（準備中） | 同 `:89` |
| 8 自動応答 | 一度も当たっていないルール（30日以上の絞り込みは準備中） | `auto-replies/page.tsx:515` |

機能 6 の 5 件はメッセージ種別の選択肢に「（準備中）」を付けたもの。
`v6-common-rules.md` §5-5 は「動くまで描かない」なので、**選択肢ごと出さないか、`BlockedAction` で理由を本文の文字にする**のが第 2 段の直し方。

### 4-2. 取得できません（2 件・同じ面）

| 機能 | 文言 | 画面 |
|---|---|---|
| 12 リッチメニュー | 公開中 —・一覧を取得できませんでした | `RW5Tb-error` |
| 12 | 一覧を取得できませんでした | `RW5Tb-error`（`rich-menus/page.tsx:458`） |

未取得の `—` と失敗の文が同じ行に並ぶ。**どちらの状態なのかが読めない。**

### 4-3. unavailable（0 件）

S2 の 8 機能では 1 件も出ていない。

### 4-4. 壊れ値（2 か所・計 81 行）

| 機能 | 文言 | 画面 | 数 |
|---|---|---|---:|
| 6 一斉配信 | `1通（undefined）` | `u6gHt`（6-1-J 結果詳細）`:111` | 1 |
| 6 | `Invalid Date 作成` | `u6gHt:115` | 1 |
| 11 テンプレート | `undefined件で使用` | `W7LBc` `GFlD7` `M9cij` `NKyoA` の全行 | 80 |

**「取れない数字を 0 にしない」の裏返しで、取れないものが `undefined` のまま出ている。**
未取得は `—` ＋「未取得 / 取得失敗 / 権限不足 / 未接続」のラベルにそろえる。

### 4-5. 内部語（10 件）

| 機能 | 文言 | 画面 |
|---|---|---|
| 6 | `Flex` | `Bw0zt` `FpgxH` `XQfMD`（メッセージ種別のタブ） |
| 8 | `Flex（JSONを直接書く）` | `K7vg2` `ivDoe` `nzWIX` |
| 8 | `画像（JSONを直接書く）` | 同上 |
| 9 | LINEアカウントとWebhookイベントの組み合わせで、同じ通知を1回だけ処理します。 | `ec9vg` |
| 9 | webhookの記録で防ぎます | `ec9vg` |
| 9 | 有効（webhookの記録で判定） | `quhg6` |
| 11 | `Flex` | `GFlD7` `M9cij` `NKyoA-empty` |
| 11 | 内容 / `JSON` * | `GFlD7` |
| 11 | 種類の欄とフォルダのチップが `text` | `W7LBc:77,95` ほか計 84 行 |
| 12 | LINE 公式アカウントにはまだ `rich menu` が登録されていません。 | `GO8RQ` `TL7tp` `szXsT` `RW5Tb` |
| 13 | このアカウントに `LIFF` を登録すると、配れるURLが出ます。 | `cSqvP` `vCqUj` |

`JSON` `webhook` `rich menu` `LIFF` `text` は運用者向けの文に出す言葉ではない。
`Flex` は LINE 側の呼び名なので、用語表へ載せるかどうかは司令塔の判断が要る。

## 5. 設計と実装の差で目立つもの

機能をまたいで同じ差が出ている。第 2 段は 1 機能 1 PR だが、**直し方は共通にできる**。

1. **LINEプレビューの面が無い。** 機能 6（`zZ9fA` `XQfMD` `Bw0zt` `h0kahp` `FpgxH`）・7（`uJP22` `J64xI` `JCz6J` `W98zZQ` `s6Vvp`）・8（`K7vg2` `ivDoe`）・9（`ec9vg`）・10（`lvaY5`）・11（`GFlD7` `j9ixI` `hsBtl` `J3GxEZ`）・12（`XtfO3` `DIUbO` `NXdDk`）の計 21 画面。設計は全部に置いている。
2. **ステッパー（STEP 1〜5、リッチメニューは 1〜3）が無い。** 機能 7 の 6 画面・8 の 4 画面・10 の `lvaY5`・12 の `XtfO3` `UMiJ9`。機能 6 だけは 5 段が入っている。
3. **差し込みが生表記のまま。** `{{name}}` `{{meet_url}}`（機能 7）。横断レビュー §7 の 33 番（差し込みチップに統一）が実装側に届いていない。
4. **削除の前に「どこで使われているか」を言わない。** `M9cij`（テンプレート）は設計が「このテンプレートは 3か所で使われています／削除すると、この3か所では文面が空になり、配信が止まります。」を出す。`szXsT`（リッチメニュー）も設計は「まず LINE から取り下げる（おすすめ）」の段取りを踏ませる。

## 6. 他の担当へ渡すもの

| 渡す先 | 内容 |
|---|---|
| S0（`scripts/visual-qa/`） | モックに `/api/webinars`（配列で返す）・`/api/webinars/:id`・`/api/rich-menu-groups`・`/api/forms`・`/api/folders?type=template`・`/api/segment-presets` の固定データを足す。`/api/friend-add-routing/draft` は `routing` を持つ形にし、`/api/broadcasts` の行に `lineAccountId: 'visual-qa-account'` を入れる |
| S0（`components/shared/folder-panel.tsx`） | フォルダ行の「…」（名前を変える／消す）と `data-qa-open`。設計 `q76C35` は常に見える「…」だが、いまはカーソルを置いたときだけ出る「編集」で、撮った絵に写らない。**7 画面が同じ部品を使う**ので S1〜S3 では触らない（旧 PR #602 に実装あり） |
| S0（`capture-screens.mjs`） | `FAILURE_TEXTS` に「設定を表示できませんでした」を足す。いま落ちた画面を「撮影OK」と言う |
| S3（`screens.mjs` の S3 区画） | `role: 'text'` が 4 か所残っている（`:1604` `:2059` `:2211` `:2375`）。ARIA に無い役割なので当たらない |
| pen（Pencil） | `bPF0s` 6-1-I の設計テキスト（`docs/design-reference/broadcasts-v6/bPF0s.txt`）が無い。`.png` だけでは文字を突き合わせられない |
| 司令塔 | `Flex` を用語表に載せるか（LINE 側の呼び名で、言い換えると通じない恐れがある） |
