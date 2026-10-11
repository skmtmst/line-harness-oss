# ftflake: 友だち2,000人の表のCI時間切れ（2026-10-12）

## 原因と修正

原因は **(a) 検査の待ち条件**。止まるのは `friends-table.browser.mjs` の元の28行目、幅1152の初期表示で `tbody.height === rowCount * row.height` を待つところ。

実際の応答は2,000件、描画は12行（index 0〜11）、全行60px。表全体は120,000.0625pxまたは119,999.9375pxで、±1/16pxの小数差が30秒後も残る。操作を始める前にこの差を描画未完了と判定して止まる。全6件の失敗でJavaScriptのconsole error・pageerrorは0件。CSSの未使用preload警告だけだった。待ち時間を延ばしても条件の誤りは直らない。

取得件数・描画行数・indexの重複や範囲・行高・表全体の高さを確認する状態待ちに変更した。許す小数差は表全体で最大1/8 CSS pxだけ（行ごとの許容値ではない）。スクロール後とフォーカス保持の固定250ms待ちも、対象行とフォーカスが実際に揃ったことを待つ。スクロール前後の高さ比較にも同じ上限を使う。30秒の上限、横はみ出し、名前の幅、選択、アンマウント後の選択、キーボード、メニュー、フォーカスの検査は維持。

製品コード・見た目・API・DB・速度基準は変更していない。製品変更がないので依頼どおり反映履歴は追記しない。

## 再現と修正後の結果

開始SHA: `10b9385fdace71da80b4fc60c1ffb46ce4a3bab3`。
検査修正のコミット: `8bccf85efb106fd1bdd0b3e2b25d29b5d988b2e8`。
テスト前に取得して取り込み確認した本線SHA: `d5deaebec39819a933b58179a9b0dd67c745e9ba`（Already up to date）。比較用の別worktreeでもこのSHAをビルドした。

| 版 | 通常 | CPU4倍 | 止まった回 |
| --- | --- | --- | --- |
| 列車21・修正前 | 19/20合格 | 19/20合格 | 通常19回目・CPU4倍12回目 |
| 本線・修正前 | 18/20合格 | 18/20合格 | 通常9・20回目、CPU4倍15・20回目 |
| 列車21・修正後 | **20/20合格** | **20/20合格** | なし |

各回は同じCLIで1440・1152・1920の3幅を順番に検査する（失敗時はその幅で停止）。修正後の40回はすべて3幅を完走した。各条件20回、合計120回。重い処理は同時実行せず、CPU4倍は各pageへCDP `Emulation.setCPUThrottlingRate({ rate: 4 })` を適用した。小さい標本なので故障率の同一性までは断定しないが、本線にも同じ待ち条件の故障がある。

環境は手元のmacOS・Node v26・PlaywrightのChromium。CIのLinux・Node 22とOSは異なるが、組み立て方は `.github/workflows/required-pr-gate.yml` と同じ。`NEXT_PUBLIC_API_URL=http://127.0.0.1:8788`、`NEXT_PUBLIC_RESTAURANT_TEST_ENABLED=true` で共有パッケージとwebをビルドし、静的outを4310（列車）・4311（本線）で配る。8788の既存見本APIを起動し、変更していないstress APIで実際に2,000件を返す。修正前の本線比較には、待ち条件を変えず診断だけ足した検査の保存版を使用。

```sh
node scripts/visual-qa/friends-table.browser.mjs http://127.0.0.1:4310 /tmp/ftflake-normal
FRIENDS_TABLE_CPU_RATE=4 node scripts/visual-qa/friends-table.browser.mjs http://127.0.0.1:4310 /tmp/ftflake-cpu4
node --test --test-concurrency=1 scripts/visual-qa/friends-table-state.test.mjs
```

上のCLIを各20回、毎回別の保存先へ実行した。生の記録・画像・console・行数・待ち条件・時刻は `/tmp/lh-ftflake/{before-head,before-base,after-head}/`。実行ごとの `run.log`・`results.json`・`diagnostics.json`、失敗時の `failure.json`・`failure.png` を保存。各組の `summary.json` に全40回の終了状態を残している。代表画像は `/tmp/lh-ftflake/before-head/cpu1/19/failure.png`。修正版は失敗診断をCIの既存成果物ディレクトリにも出す。

## 対照試験

`friends-table-state.test.mjs` の実ブラウザ試験2件はCPU4倍でも合格。±1/16pxを持つ静的な表で旧条件が時間切れになることと、新条件が通ることを両方確認する。±1px・1行分の高さずれ、未測定の詰め物、2,000件の不足、60行以上の描画、重複index、対象行なし、フォーカス違いは通さない。測定済みの高さになってから待ちが終わることも確認。CIの同じ手順へこの対照試験を追加した。

## V8の全手順・関係する試験・型検査

V8 screen guard の全20命令が終了コード0。ログと手順別の終了状態は `/tmp/lh-ftflake/guard/`。

- はみ出し検査72通り: 崩れ0。本線との比較198場面: 新規0。
- 故障注入25件、列車17の操作、列車18の予約プレビュー: 合格。
- 一覧のソース・実ブラウザ・読み込み中の表示: 合格。5種類・7種類・3種類の故障注入も検出。
- ページの題184画面: 合格。
- 速度の対照17件と11場面×5回の共通測定: 合格。固定目標も合格。友だち2,000人は表示326ms、長い処理0ms（50ms以上の通知なし）、実応答2,000件・描画13行。手元の結果をCIの86ms解消の証拠とはしない。
- CI手順として再実行した表の対照2件と全3幅の操作検査: 合格。
- 参考画像24枚の本線比較: 違い0枚。
- 関係するweb試験: 59ファイル・314件合格（`--maxWorkers=4 --minWorkers=1`）。
- workflow契約試験: 1件合格。Web・scriptsの型検査、MJSの構文検査、差分検査: 合格。Webと本線の静的ビルドも合格。

速度報告には、実際に合格した各手順の `SPEED_BUDGET_OUTCOME`・`STRESS_SPEED_OUTCOME`・`PERF3_TARGETS_OUTCOME` を渡して確認した。

## 速度86msについて

30秒の待ち条件の故障と、速度の86ms超過は分ける。保存済みのCIの別診断（run `38157801616`、artifact `11709859122`）では2,000人の長い処理は64・57・60ms（中央値60ms）。CPUサンプルの主要な負荷はタグの「+N」を決める幅の読み取りで、表の再レイアウトも時間を使っている。3回の別診断を正式の5回の測定へ混ぜない。86msそのものを生んだ処理を特定したとは断定しない。表示や操作が30秒かかる証拠ではなく、今回の修正でも製品の速さや65ms目標は変えていない。

## 変更ファイル

- `.github/workflows/required-pr-gate.yml`: 同じ表検査の手順で対照試験も実行。
- `scripts/visual-qa/friends-table.browser.mjs`: 状態待ち、CPU4倍の実行口、失敗診断。
- `scripts/visual-qa/friends-table-state.mjs`: 件数・行・高さ・対象行・フォーカスの判定。
- `scripts/visual-qa/friends-table-state.test.mjs`: 実ブラウザでの丸め差と故障注入。
- `docs/qa/ftflake-1702.md`: 本記録。
- `docs/brain/Memory.md`・`docs/brain/rules/corrections.md`: 状況と再発防止の引き継ぎ。

## 引き継ぎ

検証用の見本API・静的サーバーは停止し、比較用worktreeは外した。画像・console・生の結果は上記保存先に残した。

コミットまで。push・PR更新・GitHub Actionsの再実行・D1更新・配備は行わない。司令塔がpushしてPR #1702のCIを再実行し、Linuxでの結果を確認する。
