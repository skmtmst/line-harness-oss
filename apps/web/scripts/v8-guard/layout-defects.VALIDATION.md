# guards の検証・引き継ぎ（2026-10-10）

- 枝：`codex/kenta-guards-1010`、作業場所：`~/lh-work/lh-pages-guards`
- 検証基準の本線：`5c2829221153a90e35a269e92b647ba9378ee8cc`（#1685は開始・最終検証前の取得時点では未統合）
- 開始前の `DOCTOR_LOCAL=1 bash scripts/codex/doctor.sh`：合格
- `node --test apps/web/scripts/v8-guard/layout-defects.test.mjs`：4試験合格。9種類の故障を検出し、CLIは1。9種類の修復後は0。除外・既存許可・同じ場所の悪化・CIの空白検査の重複も確認。
- 実際の管理画面：64画面×1152・1440・1920＝192測定。新規違反0、測定失敗0、理由付きの既存許可351項目。採取後に許可表を使って192測定を再実行して合格。
- web の型検査・本番用ビルド：合格（CIと同じモックAPI URL・飲食の検証フラグ）。
- 既存のマイグレーション用CI・タブの見張りの契約試験：2ファイル・3試験合格。
- 変更したmjsの構文検査・差分検査：合格。
- 自分が起動した静的サーバー・モックAPI・ブラウザ：終了。

検証コマンドは `layout-defects.README.md`。元の道具と読み取ったblankfixの指紋・許可の基準点は `layout-defects-baseline.json`。

## 統合するとき

1. blankfixの画面修正と共通の検出部を残す。`blank-gap-browser.mjs` は同枝の検出部に、重複を外す指定・要素の位置の識別・フォルダとLINEの吹き出しの除外を足したもの。
2. CIは `layout-defects.mjs` に一本化する。blankfix側の別の `blank-gap.mjs` 実行ステップを重ねない。重複すると対照試験が止める。
3. `browser-env.mjs` はblankfixの `settleMs` とguardsのエラー収集・失敗時のページ終了を両方残す。
4. 統合した版で192測定を実行する。修正済みの許可は削ってよい。理由のない新規許可・CIでの自動採取は不可。
5. PR採番後、反映履歴のpendingファイル名と `#未採番` を番号に変える。

push・PR作成・D1更新・配備は実施していない。
