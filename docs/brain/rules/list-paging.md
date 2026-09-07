# 一覧のページ送り・並び順・絞り込み(共通一覧契約)

一覧の口(API)と画面を作る・直すときの正本は `docs/list-paging-contract.md`(#557 / PR #1350)。

要点:
- offset 型(`page`・`limit`・`total`)は上限が数千件までの管理一覧、cursor 型(`limit`・`nextCursor`)は会話・写真など増え続ける一覧。
- 応答の形は `{ items, total?, nextCursor?, limit, sort }`。旧 `pagination: {...}` 形は契約に書いた期限までに読み替える。
- 並び順は口が固定で返し、絞り込みはサーバ側に寄せる(画面でなめ直さない)。
- 口側は `apps/worker/src/lib/list-paging.ts`、画面側は `apps/web/src/lib/use-server-list.ts` を使う。

機能ごとの乗り換え(友だち一覧 #489-7、写真審査 #500-4、機能設定 #507-6)は台帳の後続票で行う。
