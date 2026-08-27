# V6 画像比較の進め方（引き継ぎ）

262枚の設計と実装を突き合わせる作業の、いまの状態と手順。
**会話を切っても、ここと `screens.mjs` があれば続けられます。**

## いまどこまで進んだか

**262枚のうち252枚を台帳に登録し、判定を付けました。**
残るのは機能4の10枚（PR #402で比較済み・`screens.mjs` への統合はこれから）だけです。

| 機能 | 枚数 | 撮れた | PR |
|---|---|---|---|
| 1 ダッシュボード | 5 | 5 | [#413](https://github.com/skmtmst/line-harness-oss/pull/413) |
| 2 受信箱 | 17 | 17 | [#424](https://github.com/skmtmst/line-harness-oss/pull/424) |
| 3 友だち | 11 | 6 | [#434](https://github.com/skmtmst/line-harness-oss/pull/434) |
| 4 友だち属性 | 21 | 11登録 | [#402](https://github.com/skmtmst/line-harness-oss/pull/402) |
| 5 シナリオ配信 | 14 | 10 | [#439](https://github.com/skmtmst/line-harness-oss/pull/439) |
| 6 一斉配信 | 15 | 9 | [#442](https://github.com/skmtmst/line-harness-oss/pull/442) |
| 7 リマインダ | 11 | 3 | [#448](https://github.com/skmtmst/line-harness-oss/pull/448) |
| 8 自動応答 | 11 | 4 | [#450](https://github.com/skmtmst/line-harness-oss/pull/450) |
| 9 友だち追加時の配信 | 10 | 3 | [#451](https://github.com/skmtmst/line-harness-oss/pull/451) |
| 10 ウェビナー | 13 | 7 | [#453](https://github.com/skmtmst/line-harness-oss/pull/453) |
| 11 テンプレート | 10 | 6 | [#454](https://github.com/skmtmst/line-harness-oss/pull/454) |
| 12 リッチメニュー | 9 | 5 | [#456](https://github.com/skmtmst/line-harness-oss/pull/456) |
| 13 回答フォーム | 7 | 4 | [#457](https://github.com/skmtmst/line-harness-oss/pull/457) |
| 14 共通情報 | 4 | 2 | [#458](https://github.com/skmtmst/line-harness-oss/pull/458) |
| 15 登録メディア | 5 | 3 | [#460](https://github.com/skmtmst/line-harness-oss/pull/460) |
| 16 成果とアフィリエイト | 9 | 6 | [#461](https://github.com/skmtmst/line-harness-oss/pull/461) |
| 17 マイル・行動スコア | 11 | 3 | [#463](https://github.com/skmtmst/line-harness-oss/pull/463) |
| 18 流入と計測 | 9 | 5 | [#464](https://github.com/skmtmst/line-harness-oss/pull/464) |
| 19 コンバージョン | 4 | 3 | [#465](https://github.com/skmtmst/line-harness-oss/pull/465) |
| 20 分析 | 9 | 4 | [#466](https://github.com/skmtmst/line-harness-oss/pull/466) |
| 21 NEN配信 | 7 | 5 | [#468](https://github.com/skmtmst/line-harness-oss/pull/468) |
| 22 写真審査 | 4 | 1 | [#469](https://github.com/skmtmst/line-harness-oss/pull/469) |
| 23 EC連携 | 4 | 1 | [#470](https://github.com/skmtmst/line-harness-oss/pull/470) |
| 24 LINE通知 | 6 | 2 | [#471](https://github.com/skmtmst/line-harness-oss/pull/471) |
| 25 オートメーション | 8 | 5 | [#472](https://github.com/skmtmst/line-harness-oss/pull/472) |
| 26 外部連携 | 4 | 2 | [#473](https://github.com/skmtmst/line-harness-oss/pull/473) |
| 27 予約管理 | 7 | 3 | [#474](https://github.com/skmtmst/line-harness-oss/pull/474) |
| 28 予約設定 | 4 | 3 | [#476](https://github.com/skmtmst/line-harness-oss/pull/476) |
| 29 イベント予約 | 4 | 3 | [#477](https://github.com/skmtmst/line-harness-oss/pull/477) |
| 30 ログインユーザー | 4 | 3 | [#479](https://github.com/skmtmst/line-harness-oss/pull/479) |
| 31 機能設定 | 1 | 1 | [#480](https://github.com/skmtmst/line-harness-oss/pull/480) |
| 32 運用状態 | 4 | 4 | [#481](https://github.com/skmtmst/line-harness-oss/pull/481) |
| 台帳262枚 | — | — | [#407](https://github.com/skmtmst/line-harness-oss/pull/407) |

**合計：登録252枚／撮れる146枚／未実装99枚／未確認7枚。**

**枝は積んでいます**（1→2→3→5→6→7→…→32）。下から順に統合してください。

## 撮れた割合が高い機能・低い機能

| | 機能 |
|---|---|
| 高い | 32 運用状態（4/4）・31 機能設定（1/1）・2 受信箱（17/17）・28 予約設定（3/4） |
| 低い | 22 写真審査（1/4）・23 EC連携（1/4）・17 マイル（3/11）・9 友だち追加時（3/10） |

## 手順（1機能ぶん）

```bash
# 0. 枝を切る（前の機能の枝から積む）
git checkout -b codex/kenta-v6-featureN-visual

# 1. 設計の文言を読む。画像を読むより桁違いに安い
#    設計HTMLは書き出し済み（/Volumes/My Passport/Github/v6-design-ref/fN/）
python3 scripts/visual-qa/design-text.py …/fN/<id>.html 64 40

# 2. 画面が落ちるなら、口の返事の形から当てる
node scripts/visual-qa/diagnose.mjs "/そのルート"

# 3. screens.mjs に行を足す → 一度に洗い出す
node scripts/visual-qa/capture-screens.mjs --check
node scripts/visual-qa/capture-screens.mjs --feature N --impl
node scripts/visual-qa/capture-screens.mjs --feature N --design

# 4. 基準画像と単体テスト
npx playwright test scripts/visual-qa/capture.spec.mjs
cd apps/web && npx vitest run --config vitest.config.ts
```

先に `node scripts/visual-qa/mock-api.mjs &` と
`NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web exec next dev --port 3101 &`。

**設計の大きさは書き出したHTMLから自動で読みます**（`sizeFromHtml`）。
台帳へ手で書き写す必要はありません。

## 何度も引っかかったこと

**画面が落ちる原因は、たいてい実装ではなく固定データの形。**
一覧の口の既定（`{items,total,page,limit}`）が、通や配列を待っている
画面へ返るとそこで落ちます。**今夜だけで9回**ありました
（ウェビナー2・マイル・流入・NEN・EC・予約・共通アクション2）。
`diagnose.mjs` が ★ を付けて教えます。

**返事の形は口ごとに違う。** `{success,data}` だけではありません。

| 形 | 口 |
|---|---|
| `{requests}` `{menus}` `{staff}` | 予約 |
| `{items}` | イベント |
| `{routes, totalFriends, …}` | 流入の集計 |
| `{summary, members, pagination}` | マイル |
| `{summary, daily, participants, sessions, dropoff, formFunnel}` | ウェビナーの分析 |

**型に照らして固定データを書く。** 別名で書いた項目は握りつぶされ、画面は
既定値のまま描かれます。エラーは出ません。今夜も3回やりました
（`tagId`↔`tagIds`／`eventType: 'download'`／`lastLoginAt` は型に無い）。

**型に無い項目を書かない。** 書くと**実装に在るように見えます。**
（`StaffMember` に `lastLoginAt` は無く、設計の「最後に入った」は出せません。）

**文字の一致だけで画面の状態を決めない。** 今夜2回やりました。
「LINEでログイン」は説明文にも出ます（`/staff/new`）。
「もう一度試す」は反映履歴の本文にも出ます（運用状態の更新履歴タブ）。
**押せる形で在るかどうか**で見ます。

**押せるものが操作の役を持っているとは限らない。** 表の行に `onClick` を
付けただけのものは `button` でも `link` でもありません。`role: 'text'` を使います。

**操作の名前は一部だけ書く。** 長く書くと、読み上げ名の空白の入り方が
違うだけで当たりません。

**「押せない」と「無い」は別。** `status: 'unconfirmed'` を使います。

**重なりを `fullPage` で撮らない。** `position: fixed` が最初のビューポート
位置に焼き込まれます。

**時計は止める。日本時間で撮る。**

## 判定の言葉

| 判定 | 意味 |
|---|---|
| 一致 | 実データまで繋いで比べ、差が無い |
| 構造一致 | 配置・部品・文言が合う |
| データ未接続 | 出どころが無く値が `—`。**最終的な「一致」にはしない** |
| 未確認 | 押せる場所はあるが撮れない。**「無い」と言い切らない** |
| 未実装 | 実装が無い。**合格画像にしない** |
| 取得不能 | 権限などで辿り着けない |

## 全画面に効く決めごと

**サイドバーの選択状態は比べません。** 設計の共通サイドバーはどの画面でも
「友だち属性」が選ばれたままです（共通部品なので1つしか持てない）。

## 基準画像を更新したこと（2026-08-28）

`capture.spec.mjs-snapshots` の12枚を更新しました
（analytics・automations・dashboard・rich-menus・staff・templates の1440/1920）。

**画面を変えたからではありません。** これまで空だった口に固定データを
入れたので、**中身が入った絵に変わった**ためです。基準画像が見張るのは
「前回から変わっていないか」だけなので、意図して変えたぶんは更新します。

（設計との突き合わせは別で、**差がある画像を合格として扱いません。**）

## 全機能に共通して見えたこと

**1. 記録が残らない・読めない**

| 機能 | 何が残らないか |
|---|---|
| 8 自動応答 | 誰の何という入力に何が実行されたか |
| 14 共通情報 | 変更の履歴（いつ・誰が・何から何へ） |
| 17 マイル | 増減の記録。手で動かした理由 |
| 24 LINE通知 | いつ・だれに・どのお知らせを送ったか |
| 25 オートメーション | 動いた記録（コードに「残していない」と明記） |
| 26 外部連携 | 送った・受け取ったやり取り |
| 30 ログインユーザー | 入った記録（数だけ出て中身は読めない） |
| 32 運用状態 | 緊急操作が `localStorage`。別の端末からは見えない |

**2. 「送る前に何が起きるか」を見せる場所が無い**

| 機能 | 何が見えないか |
|---|---|
| 5 シナリオ | 開始前に何人へ届くか |
| 7 リマインダ | 配信予定と重複 |
| 14 共通情報 | 直すと何か所の文が変わるか |
| 15 登録メディア | 差し替えると何か所に効くか |
| 19 コンバージョン | 成果地点がどこから呼ばれているか |
| 32 運用状態 | 止めると何件・何人に効くか |

**3. 中の仕組みの言葉が画面に出ている**

`silent rule` `automation rule 未登録`（8）／`friends.unfollow_count`（9）／
`TEMPLATE` `(inline)`（8）／`sent` `pending` `failed`（21）／
`受信 (Incoming)` `送信 (Outgoing)`（26）／`download`（19・こちらの固定データ由来）

**4. 試す場所が無い**

7 リマインダ・8 自動応答。どちらも**黙って動く**ものです。

## 設計側で見つかった食い違い

| 場所 | 何が食い違うか | 対応 |
|---|---|---|
| `vUXKb` `NjK9q` | 接続状態の有効友だち4人 と 友だちの状態398人 | Pencilを直した |
| `NjK9q` | 5件表示・総数5件なのに2ページ | Pencilを直した |
| `NjK9q` | 表示件数のプルダウンが共通部品と別の見た目 | Pencilを直した |
| `k6lHgo` | 対応マークのプルダウンに「保留」が無い | Pencilを直した |
| `q76C35` | 「停止中／停止済み」が実装の型に無い | **未決** |
| `M1EXwB` | フォルダの合計が 9 と 11 で合わない／9件なのに12ページ | 記録のみ |
| `cmDfJ` | フォルダの合計が 14 と 16 で合わない | 記録のみ |
| 差し込みの書き方 | `{会社名}`（14）と `{{name}}`（7）が混在 | 記録のみ |
| 共通サイドバー | どの画面でも「友だち属性」が選択 | 比較対象から外す |

Pencilを直すときは**必ず先に退避**します（`pencil-backups/` にmd5照合つき）。
上書き保存で履歴が残りません。
