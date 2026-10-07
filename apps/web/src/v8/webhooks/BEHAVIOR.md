# 外部連携（V8）の動き

入口：`app/webhooks/page.tsx`（V8 のときだけ、タブごとに `src/v8/webhooks/*.tsx`）と `app/webhooks/new/page.tsx`（V8 のときだけ `src/v8/webhooks/create.tsx`）。
API 接続のタブ（`ralAc`）も `src/v8/webhooks/api-tokens.tsx`（今までの V8 `app/webhooks/apitokens-v8.tsx` の動きを写して一から書いた。古いファイルは残す）。v7 の画面・試験は触らない。

| タブ・画面 | ファイル | 絵 |
|---|---|---|
| こちらから送る | `outgoing.tsx` | 一覧 `ZSbFY`・1152 `AsfFB`・閲覧のみ `l5SRfT`・状態 `wWrpY` |
| こちらで受け取る | `incoming.tsx` | `gW0F2`・作る窓 `H031gC` |
| Google Sheets | `sheets.tsx` | `DxAAA`・解除の窓 `YZ57z` |
| やり取りの記録 | `interactions.tsx` | `Uv9AA`・中身 `DA0Ag` |
| 見本 | `samples.tsx` | `SAUCs` |
| API 接続 | `api-tokens.tsx` | `ralAc`・発行した鍵の窓 `UkZLi` |
| 送り先を作る | `create.tsx` | `hsD8e`（競合 `NGh7b` は口が無い） |
| 共通（頭・タブ・数の帯・閲覧のみの帯） | `shell.tsx` | 上のすべて |

## 受け付ける URL と指定（今と同じ）
- `/webhooks`（＝こちらから送る）、`/webhooks?tab=incoming|api-tokens|sheets|interactions|notify`
- `/webhooks?tab=incoming&source=<line|booking|form|ec|payment>`：作る窓を開き、どこから来るかを選んでおく
- `/webhooks?tab=sheets&sheets=<connected|reconnected|error:…>`：Google の許可から戻ったときの知らせ
- `/webhooks/new?event=<出来事>`：その出来事を選んでおく（絵の箱に無い出来事なら「詳細条件」を開いておく）
- 送り先を直すのは今と同じ `/webhooks/edit?id=`（V8 の画面はまだ無い）

## 呼ぶ口（今と同じ）
- 送り先：`api.webhooks.outgoing.list / update（isActive・secret）/ delete / test / create`、本人確認（`webhook.secret`）
- 受け取り口：`api.webhooks.incoming.list / detail / update（name・isActive・secret）/ delete / create / unmatched / resolveUnmatched / test`
- やり取り：`api.webhooks.interactions.list（periodDays・direction・status・search・page・limit）/ retry / retryFailed`
- Google Sheets：`api.webhooks.googleSheets.connection / runs / connectStart / setTarget / sync / disconnect`
- フォルダの箱：`api.folders.list('webhook', accountId)`・追加は共通の `FolderAddDialog`（kind=`webhook`）
- 帯の数：送り先の一覧・受け取り口の一覧・やり取りの集計（この30日・`limit: 1`）を1回ずつ読む（どのタブも同じ）

## 権限（今と同じ R32）
- 作る・直す・止める・合言葉・削除は統括だけ。試しに送る・失敗のやり直し・届物の結び付けは管理者も。
- 閲覧のみ（統括でない人）には、押せない作る・設定・フォルダを追加・この見本で作る・まとめてやり直すを**置かず**、場所だけ空ける（2026-10-06 オーナー決定）。タブの下・数の帯の上に「閲覧のみで見ています」の帯。

## 今の V8 と違うところ
- 送る一覧：左にフォルダの列（箱は `kind=webhook`）。**送り先をフォルダへ入れる口がまだ無い**（送り先の表に folder_id が無い）ので、全件が未分類。フォルダを選ぶと0件。箱の件数は口が返さないので出さない。
- 送る一覧：並びの部品は絵に無いので、既定を名前順にし、送った回数順は「よく使う絞り込み」から選ぶ。
- 送る一覧：行の右は「中身を見る（失敗があれば やり直す）」と「設定」（押すと操作の一覧。右クリックでも同じ一覧）。操作の名前は「鍵を作り直す」。
- 送る一覧：動いているのに一度も送っていない行は「まだ送っていません」。
- 数の帯：「先月より」は先月の集計の口が無いので、今月送ったの下は成功の回数。
- 受け取る：受け取り口の2行目は「〇〇から」（口ごとの今月の件数の口が無い）。作るのは窓（`H031gC`）。削除はカードの下に小さく。
- 受け取る：見分けかた・届いたらすることを変える口は Worker にある（`PATCH /api/webhooks/incoming/:id/config`）が、`lib/api.ts` に無いので、今の設定を見せるだけ。「＋ すること を足す」は置かず、まだできないと一言で伝える。
- やり取りの記録：「CSV で書き出す」は口が無いので置かない。期間は道具の段の右、件数はページ送りの段の左。中身は口の文（`triggerSummary`）の最初の「・」の前を1行目にする。
- 作る：「いつ送りますか」の既定は「選んだものだけ送る」（要らない個人情報まで送らない）。絵の箱（友だち・運用・EC）に無い出来事は「詳細条件」を開くと選べる。「それでも送れないとき」は保存する口が無いので置かない。
- 作る（競合 `NGh7b`）：作る口（POST）にも直す口（PUT）にも版の競合の返事（409）が無く、作る画面に「保存する」も無いので、この状態は出ない。

## API 接続（`api-tokens.tsx`）
- 呼ぶ口（今と同じ）：`api.webhooks.apiTokens.list / create / rotate / revoke`、本人確認（`webhook.api_token`）。入れ替えの競合（`TOKEN_ROTATE_CONFLICT`）は一覧を読み直して一言。
- 「API 接続の鍵を発行する」→ 発行の窓（名前・できること）→ 発行した鍵の窓（`UkZLi`）。平文の鍵はこの窓にだけ1回出す。× と「写したので閉じる」は閉じるだけ。入れ替えたあとも同じ窓。アカウントを替えたら窓は閉じる。
- 今までの V8 との違い：発行の入力を本文の箱から窓へ移した（絵に入力の箱が無く、窓で開けば一覧が下へずれない）。
- 行の右は「入れ替える」と「…」（止める）。右クリックでも同じ一覧。名前を変える・できることを変える口は無いので置かない。止めた鍵は一覧の口が返さないので「止めている」行と「動かす」は出ない（動かす口も無い）。
- 日時は絵の書き方（作った日 `2026/06/02`・最後に使った `9/30 10:02`・まだなら「まだ使っていません」）。
- 統括でない人：発行・入れ替え・「…」を置かない（発行のボタンは場所だけ空ける）。タブの下に閲覧のみの帯。

## 1152 の送り先一覧（AsfFB）
- 狭い幅（共通の useNarrowViewport）では4列：送り先（名前＋「送るタイミング → URL のホスト」）・今月送った（回数＋最後に送った日時／失敗の数）・状態・操作。
- 操作は「…」だけ。中に 中身を見る・（失敗があり変えられる人なら）失敗をやり直す・直す・止める／動かす・鍵を作り直す・試しに送る・削除する。
- 広い幅（ZSbFY）は今までどおり6列・「中身を見る／やり直す」と「設定」。
