# G02 安全CIの接続整理（2026-10-18）

指定枝 `codex/kenta-train-cleanup-g02-1018`、指定土台 `e5f527128ceb2d32b22af1be945c3cf996f9dd49`。開始時の作業ツリーはクリーン、DOCTOR_LOCAL=1のdoctorは合格。検査前にfetchした `origin/codex/development=e9b423eb7c798f7d5a530a05a6e86a0c26dd56f9` は指定土台に包含済み。指定土台を動かす追加mergeは不要だった。元のLINE checkoutの既存3パス（`.nodeterm/project.json`・`.nodeterm/settings.json`・`lh-hq.code-workspace`）は今回の作業外として保持した。

## 変更と残した守り

G01の `G01-to-G02-proposed.patch` を照合して必須workflowへ適用した。新規API、画面、DB、migration、製品の稼働設定の変更はない。`PLAN-COVERAGE.tsv`のprimaryBundle=G02、`LONG-FILES-1018.tsv`のbundle=G02はともに0件。長いファイルの分割対象はない。

- code-sizeの行数凍結、旧タイトルの固定px、リッチメニューの固定字体、および削除済みの窓の固定検査への実行接続を外した。検査のダミー復活や別名の固定検査への移植は行わない。
- ブラウザの故障対照の実行列は35本→23本。G01で削除済みの15本を除き、既存20本と、現在の`layout-overflow`・`form-rules`・`active-modal-audit`の3本を接続した。本体の試験を削除・変更していない。
- 削除済みファイルへの直接呼出しは19件→0件。YAML/シェル構文を検査する既存工程から、直接書かれたスクリプトの存在も検査する。欠落した起動ファイル・ブラウザホストへ渡す試験・一致しないglob・偽のディレクトリを拒否し、引用や折り返しと実行ディレクトリを扱う。
- 新しい接続確認は一般のBash解析器ではない。変数パス、パッケージ命令、シェル内部の間接呼び出しは従来の実行工程で確認する。スクリプトの内容や見た目の文字、行数、固定枚数は判定しない。
- required-pr-gateのジョブ名・依存関係・実行条件・環境、trigger・権限・concurrencyは前後同一。ブランチ保護・外部の正式な鍵・台帳・上限・許可表は変更していない。
- 配備前の安全検査、配備lock、認証とMFA、権限、DB bootstrap・migration安全、frozen-lockfileと依存の安全下限、崩れ・操作と故障対照、速度の検査を残した。配備workflowとlock・lockfileは変更しない。

手元の接続確認命令は `.github/README.md` に記載。反映履歴は指定の`0000-kenta-cleanup-g02.md`で、日本時間・@kenta・#0000を記録する。#0000は司令塔による実PR採番待ちで、正式PR検査の合格を意味しない。

## 所有者へ残すもの

- G01から引き継いだUI初期被覆の2件はU05/U02の所有。実ブラウザの結果は生のまま残し、UI・検査の本体をこの束で変更して通さない。
- A09のプラグイン試験への接続候補は、この土台に`test`命令も試験ファイルもまだない。別束の成果を推測して接続しない。司令塔がA09を取り込む際、`pnpm --filter @line-harness/plugin-myservice test`を接続する。
- A01からのMCP依存監査と、A09の生成物更新は担当成果の統合後に司令塔が扱う。このCI接続整理で依存を更新したり、生成済みSDKを手書きで直したりしない。
- 新しいDBの表・列は不要で、migration番号案はなし。push・PR・DB更新・配備・実送信・実決済・外部サービスへの書き込みは行わない。

## 検証の記録

外部の証拠置場：`~/lh-work/design/v8/review/CLEANUP-1017/G02-validation/`。前後の接続先は`connections.json`、ブラウザ試験の対応は`browser-suite-map.json`、保持したlock等のハッシュは`retained-hashes.txt`。最終結果は以下へ追記する。
