# V6 画像比較の進め方（引き継ぎ）

262枚の設計と実装を突き合わせる作業の、いまの状態と手順。
**会話を切っても、ここと `screens.mjs` があれば続けられます。**

## いまどこまで進んだか

| 機能 | 枚数 | PR | 状態 |
|---|---|---|---|
| 1 ダッシュボード | 5 | [#413](https://github.com/skmtmst/line-harness-oss/pull/413) | 5枚とも構造一致（4枚はデータ未接続） |
| 2 受信箱 | 17 | [#424](https://github.com/skmtmst/line-harness-oss/pull/424) | **17枚すべて撮影可・未実装ゼロ** |
| 3 友だち | 11 | [#434](https://github.com/skmtmst/line-harness-oss/pull/434) | 6枚撮影可・4枚未実装・1枚取得不能 |
| 4 友だち属性 | 21 | [#402](https://github.com/skmtmst/line-harness-oss/pull/402) | 比較済み。**`screens.mjs` への統合はこれから** |
| 5 シナリオ配信 | 14 | [#439](https://github.com/skmtmst/line-harness-oss/pull/439) | 10枚撮影可・4枚未実装 |
| 6 一斉配信 | 15 | [#442](https://github.com/skmtmst/line-harness-oss/pull/442) | 9枚撮影可・5枚未確認・1枚撮り方 |
| 台帳262枚 | — | [#407](https://github.com/skmtmst/line-harness-oss/pull/407) | — |

**枝は積んでいます**（1 → 2 → 3 → 5 → 6）。下から順に統合してください。

残りは機能7以降の**約180枚**です。

## 手順（1機能ぶん）

```bash
# 0. 枝を切る（前の機能の枝から積む）
git checkout -b codex/kenta-v6-featureN-visual

# 1. 設計を書き出す（Pencil MCP）
#    Export([id], "html-css", "…/v6-design-ref/fN/<id>.html")

# 2. 設計の文言を読む。画像を読むより桁違いに安い
python3 scripts/visual-qa/design-text.py …/fN/<id>.html 57 60

# 3. 画面が落ちるなら、口の返事の形から当てる
node scripts/visual-qa/diagnose.mjs "/そのルート"

# 4. screens.mjs に行を足す → 一度に洗い出す
node scripts/visual-qa/capture-screens.mjs --check
node scripts/visual-qa/capture-screens.mjs --feature N --impl
node scripts/visual-qa/capture-screens.mjs --feature N --design --from …/fN

# 5. 基準画像と単体テスト
npx playwright test scripts/visual-qa/capture.spec.mjs
pnpm --filter web test
```

先に `node scripts/visual-qa/mock-api.mjs &` と
`NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web exec next dev --port 3101 &`。

## 何度も引っかかったこと

**画面が落ちる原因は、たいてい実装ではなく固定データの形。**
一覧の口の既定（`{items,total,page,limit}`）が、配列や別の形を待っている
画面へ返るとそこで落ちます。これまでに8回ありました。`diagnose.mjs` が
★を付けて教えます。

**型に照らして固定データを書く。** 別名で書いた項目は握りつぶされ、画面は
既定値のまま描かれます。エラーは出ません。`isShared` を `visibility` と
書いて、5行とも「自分だけ」で撮れていたことがあります。

**操作の名前は一部だけ書く。** 長く書くと、読み上げ名の空白の入り方が
違うだけで当たりません。

**「押せない」と「無い」は別。** `status: 'unconfirmed'` を使います。

**重なりを `fullPage` で撮らない。** `position: fixed` が最初のビューポート
位置に焼き込まれ、途中から始まる嘘の絵になります。

**時計は止める。** 「6日前」は今日から数えます。止めないと翌朝に「7日前」へ
変わり、基準画像が赤くなります。実際に一度なりました。

**日本時間で撮る。** 機械の時計帯のままだと設計の「14:16」が「12:16」に
なります。

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
「友だち属性」が選ばれたままです（共通部品なので1つしか持てない）。実装は
現在地を出すほうが正しく、設計側は直せません。ここを差として数えると
262枚すべてが未一致になります。

## 設計側で見つかった食い違い

| 場所 | 何が食い違うか | 対応 |
|---|---|---|
| `vUXKb` `NjK9q` | 接続状態の有効友だち4人 と 友だちの状態398人 | Pencilを直した |
| `NjK9q` | 5件表示・総数5件なのに2ページ | Pencilを直した |
| `NjK9q` | 表示件数のプルダウンが共通部品と別の見た目 | Pencilを直した |
| `k6lHgo` | 対応マークのプルダウンに「保留」が無い | Pencilを直した |
| `q76C35` | 「停止中／停止済み」が実装の型に無い | **未決** |
| 共通サイドバー | どの画面でも「友だち属性」が選択 | 比較対象から外す |

Pencilを直すときは**必ず先に退避**します（`pencil-backups/` にmd5照合つき）。
上書き保存で履歴が残りません。
