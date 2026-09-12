## 修正

- required-pr-gate の web-build ジョブで、`actions/cache` の `restore-keys` がロックファイルのハッシュだけでソース違いの古い `apps/web/.next/cache` を復元し、Next.js の webpack 永続キャッシュに古い成果物を混入させて偽の失敗を招いていたのを、完全一致のときだけキャッシュを使うようにして止めた @sonnet #1539 #696 2026-09-10 12:25
