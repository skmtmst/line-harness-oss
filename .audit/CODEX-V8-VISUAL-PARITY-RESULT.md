# V8 の実装と絵の見本を自動で比べる道具（Muse・2026-10-03）

このファイルは司令塔への返事と同じ中身。原本の置き場
（`/Users/kentakenta/lh-work/design/v8/CODEX-V8-VISUAL-PARITY-RESULT.md`）には
Muse の砂場から書けないので、作業場所の `.audit/` に同じものを置く。
司令塔が原本へ写すこと。

- 枝: `codex/muse-v8-visual-parity`
- 土台: `origin/codex/development` 392d94a735（2026-10-03 取り込み済み）
- 開始前の診断: `DOCTOR_LOCAL=1 bash scripts/codex/doctor.sh` → 最終行「合格」

## できたこと

1. 見本の取り込み
   - `scripts/visual-qa/build-v8-design-map.mjs`：BOARD-INDEX（496板）＋HANDOVER-MAP＋
     V8B-HANDOVER-MAP＋specs から `v8-design-map.json`（504板・場所つき384板）を作る。
     板ID→画面のURL・状態（種類）・幅（1440/1152）。
   - `scripts/visual-qa/sync-v8-design-refs.mjs`：場所が決まった板だけ
     `scripts/visual-qa/v8-design-refs/<板ID>.png` に写す（版に入れない）。
2. 板IDの契約試験 `scripts/visual-qa/v8-board-id-contract.test.ts`
   - 採用で消えた板ID（対応表の `retired`）の利用を落とす（今は空。496板ぜんぶに
     見本があり、消えた板は確認できなかったため。消えた板が出たら `retired` に足す）。
   - 対応表に無いID（V6時代の名残109種）は落とさず一覧を出す（積み替え途中のため）。
3. 撮って並べる道具 `scripts/visual-qa/v8-parity.mjs`（1枚）・`v8-parity-all.mjs`（一括）
   - 実装を偽APIで開いて撮り、見本と横に並べた画像・差に赤枠の画像・metrics.json を出す。
   - 数値：はみ出し・右端越え・単語途中の改行・表の列のずれ・Noto Sans JP以外の書体・
     見本の文字の有無・画素の差。`drift`（目安の点数）つき。
   - 画素の比べは依存なしの自作（`v8-png.mjs`：読む・書く・並べる・赤枠）。
4. `tools/v8-pr-check.sh`（報告だけ・終了符号は常に0）
   - 変わった V8 の画面の板を拾って1枚ずつ流し、PR に貼れる Markdown を出す。
   - リポジトリに `tools/` が無かったので新設。司令塔フォルダの同名の重い検査とは別物。
5. 偽APIの数を見本にそろえた
   - 動いた 2,988回・条件外1,240・失敗6（合計4,234）、広告費¥86,000/73人/2件
     （`/api/ad-costs` を新設）、報酬¥70,400・成果38件・承認待ち5件・今月認めた33件。
   - 友だち1,284人は前から一致。承認待ち8→5・承認済み34→33に減った。

## 使い方（コマンド）

```sh
node scripts/visual-qa/build-v8-design-map.mjs            # 対応表を作り直す
node scripts/visual-qa/sync-v8-design-refs.mjs            # 見本を写す（場所つきの板）
node scripts/visual-qa/v8-parity.mjs --board ywJ5H       # 1枚比べる
node scripts/visual-qa/v8-parity.mjs --board ywJ5H --width 1152 --route /friends
tools/v8-pr-check.sh --boards ywJ5H,mcOqK                 # PR用（報告だけ）
node scripts/visual-qa/v8-parity-all.mjs                  # 全部撮って順位づけ
```

前に mock-api と web（3101番）を立てておく。初回だけ `npx playwright install chromium`。

## 試験の結果

- 新規：`v8-board-id-contract.test.ts` 5件・`v8-png.test.ts` 3件 → 全部合格。
- 触った所：`scripts/visual-qa/` 一式 103件合格・4件飛ばし（1つだけ砂場の EPERM で
  `mock-api-method-contract.test.ts` が動かない。道具ではなく場所の問題）。
- fixture を文字で読む web の試験 5ファイル40件 → 合格（`packages/shared` の dist
  を作り直したら通った）。
- 型検査 `tsc -p scripts/tsconfig.json` → 合格。`git diff --check` → 合格。
- 道具の動作確認：PR 検査の異常系（変更なし・撮影失敗）は終了符号0で報告だけ出すことを確認。
  比較パイプラインは実物の見本で確認（同じ絵で差0・塗った絵で差25.0%・赤枠つき）。
  測定スクリプトの構文も確認。ブラウザでの撮影だけ未確認（下の止まった所）。

## SHA

- 土台 `origin/codex/development` 392d94a735（merge 済み・競合なし）
- この枝の先端はコミット後に確定（下の `git log` を見る）

## 止まった所

1. 全部の撮影とずれの順位づけができなかった。砂場が `listen` を止めている
   （偽API・web が立てられない）うえ、Chromium が `SEGV` で落ちるため。
   `.audit/v8-parity-report.md`（＝`/tmp/v8-parity-report.md`）に
   対象384板の一覧・見本の数の照合・再実行手順を書いた。NodeTerm の作業ツリーで
   `v8-parity-all.mjs` を回して、この2ファイルを上書きしてほしい。
2. 原本 `design/v8/CODEX-V8-VISUAL-PARITY-RESULT.md` に書けなかった（作業場所の外）。
   このファイルを写してほしい。
3. 反映履歴 `docs/release-log/unreleased/codex-muse-v8-visual-parity-muse.md` に
   PR 番号 `#番号` が無い（push・PR は司令塔のため）。採番後に行末へ足してほしい。
4. `retired`（採用で消えた板ID）は空のまま。496板ぜんぶに見本があり、消えた板を
   裏づけられなかったため、推測で入れなかった。消えた板が出たら対応表に足すと
   試験が落ちる。
