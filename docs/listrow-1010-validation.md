# 一覧の行の共通ルール（listrow・2026-10-10）

- 作業ツリー: `~/lh-work/lh-pages-listrow`
- 専用ブランチ: `codex/kenta-listrow-1010`
- テスト前・コミット前に取得した本線: `5c2829221153a90e35a269e92b647ba9378ee8cc`
- `DOCTOR_LOCAL=1 bash scripts/codex/doctor.sh`: 合格。
- push・PR作成・DB更新・配備は実施しない。

## 入れた決まり

- B-194: 名前は共通の名前セルで「フォルダの丸＋名前1行」に統一。省略時も全文を title で読める。状態は状態列へ移した。
- B-193: 編集は名前か「…」から開く。共通 RowActions の編集もメニューへ集約し、閲覧のみには出さない。
- B-195: KpiCard の言葉は札へ移し、数字の位置には数字か「—」を表示する。
- B-190: 共通 TagOverflow が実際の幅に合わせて札を畳み、押せる「+N」で全件を表示する。タグを外す・条件を選ぶ操作も残す。
- B-198: リンクは共通の緑の変数に統一。案内の札とキーボードの選択輪は青を保つ。
- 自動応答の名前から外した実行条件は詳細パネルへ残した。停止・再開・入力検査・権限判定の動きは維持する。

## 確認

- Web の全体試験: 2,031ファイル・11,936件を実行（11,929合格、5失敗、1スキップ、1 TODO）。失敗した4ファイルは修正後にすべて再実行して合格。
- 最終修正後: 自動応答36ファイル・201件、共通部品／Webhook／統括タグ／招待11ファイル・102件、すべて合格。
- スクリプト試験: 87ファイル・796件、すべて合格。
- Web とスクリプトの型検査、Web ビルド、設計値照合（456/456一致）、設計負債検査、差分検査は合格。既存の未使用変数などのビルド警告は残る。
- 一覧の実画面検査: 43ルートを1152・1440・1920幅で確認。初回は狭いWebhook一覧の丸の重複1件を検出して修正。修正後のWebhook・自動応答は6通りすべて合格。残り123通りの初回合格と合わせ、全129通りに未解決の違反はない。
- 「+N」を押して3個すべてのタグを表示し、スクリーンショットで確認。一斉配信と共通RowActionsのメニューから編集画面へ進めることも確認。
- CI にソース検査と実画面検査を追加。編集ボタン・名前の2行目・KPIの言葉・青い文字・タグのはみ出しを意図的に挿入した対照試験は、5種類すべてを検出した。
- ソース検査は名前の丸の重複も検出する。入力の検査を取り除く変更はしていない。

招待画面の既存テストはフォルダAPIの未固定データを読み、担当アカウントでなく「まとめて選ぶ」を押していた。変更前でも失敗することを確認し、APIの返却値と押すアカウントを固定した。名前・担当範囲の入力エラーとフォーカス移動の確認は残している。

確認コマンド:

```sh
NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web exec vitest run --config vitest.config.ts --maxWorkers=2
pnpm exec vitest run --config vitest.config.ts scripts --maxWorkers=2
pnpm --filter web typecheck
pnpm typecheck:scripts
NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web build
pnpm --filter web verify:design
pnpm --filter web design:debt:check
node apps/web/scripts/list-row-audit.mjs
node apps/web/scripts/v8-guard/list-row-audit.mjs http://127.0.0.1:4318 /tmp/list-row-audit.json
git diff --check
```

実画面検査は偽APIを8788、書き出した画面を4318で起動して実施。CIでは既存の偽API・画面サーバーに続けて実行する。

## 司令塔への引き継ぎ

Pencil ★V8との画素照合・PASSED.tsvへの記録は司令塔が行う。この実装の検査結果を、462枚の画素一致の合格として扱わない。

PR採番後、`docs/release-log/drafts/kenta-listrow-1010.md` を `docs/release-log/unreleased/<PR番号>-kenta-listrow.md` へ移し、各行へ実際の `#PR番号` を付ける。今回の依頼ではPRを作らないため、番号を仮置きしていない。
