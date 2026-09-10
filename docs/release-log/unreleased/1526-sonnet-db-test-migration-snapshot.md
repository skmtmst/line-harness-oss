## 変更

- db テスト対象12ファイル(046/047/048/050・affiliate系4件・conversion系2件・mileage系2件)のsetupDb/setupSqlite/setupDbWithMigrationsを、schema+全移行を1度だけ組み立てた写しから起こす方式へ変え、db スイート全体でのvitestワーカー未処理エラー(`onTaskUpdate`タイムアウト)によるRequired gate落ちを止めた。試験件数(161件/856件)・検証内容・各テストの独立性は変えていない @kenta #1526 2026-09-09 22:45
