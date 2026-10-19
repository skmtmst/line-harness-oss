# データベースの基準の形

最初に読むのは [bootstrap.sql](bootstrap.sql) です。新規環境用の基準の形で、
[schema.sql](schema.sql) に [migrations/](migrations/) の全履歴を適用して生成します。
手で編集せず、`pnpm --dir packages/db generate:bootstrap` で作り直し、
`pnpm --dir packages/db check:bootstrap` で整合を確認します。
bootstrap.sql と bootstrap-meta.json は両方ともGitで管理します。
全履歴との構造の一致は `test/bootstrap.test.ts` でも検証します。

`schema.sql` は初期の土台で、現在の完成形ではありません。
`migrations/` は既存環境へ順に適用する変更の履歴です。移動・改名・書き換えはしません。
生成と新規作成は番号の数値順、同番号はファイル名順で処理します。
bootstrapは既定の統括と友だちの固定欄を含みますが、稼働環境の業務データや適用記録のコピーではありません。

## 新しい環境の適用記録

`create-line-harness` は、その実行で新しく作ったDBだけにbootstrapを適用し、成功した後で
bootstrap-meta.json の includedMigrations を `_migrations`（name / applied_at）へ記録します。
metaの件数・名前の重複・ファイルの実在を確認し、その一覧にない後続migrationは適用成功後に記録します。
記録に失敗したら後続へ進まず、未適用を適用済みとして扱いません。
bootstrapで重複エラーが出た場合も途中適用の恐れがあるため停止します。

metaが無い・不整合の場合は、従来どおりschemaと全履歴で立ち上げます。
この経路も新規DBの成功したファイルだけを記録し、従来から許容している重複エラーで
終わったファイルは記録しません。途中までしか適用されていない可能性があるためです。
その場合の未適用は、既存のDB更新手順で内容と照合してください。
既存DBへの接続時には、bootstrapの適用やこの新規用の記録追加を行いません。

古い `db:migrate` / `db:migrate:local` は初期schemaだけを当てるため削除しました。
新規環境は初期設定CLI（`pnpm deploy:setup`）から立ち上げます。
既存環境の更新は [DB更新手順](../../docs/migration-runbook.md) に従います。
新規作成のコードを変更しても、既存の本番・検証DBへ自動で記録が追加されることはありません。
