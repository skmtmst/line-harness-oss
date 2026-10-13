# 列車32 セキュリティ強化

開始本線: `e75ea5d615fa4ec3bce4c2d0777dcc6c74050348`。専用枝: `codex/kenta-train-32-1013`。doctor合格、開始時クリーン。本番・検証環境へ接続せず、migration・push・PR・配備なし。重い検査は直列、Vitest最大4 workers。

## 項目別

| 件 | 再現 | 直し | 試験 | 残り・運営設定 |
| --- | --- | --- | --- | --- |
| S05 | 更新鍵だけでエンジン・DBへ進むことを再現 | 現運用で不要なHTTP更新を廃止し全経路404。鍵や設定で再開しない | admin-update.security.test.ts 6件、admin-version.test.ts 5件合格。直しを外す対照は5件失敗 | 設定不要。司令塔は配備時に旧更新鍵・配備専用資格情報のWorker内保持が必要か棚卸し |
| S08 | 別統括tokenでNULLタグの読取・付与が通る | tokenの所属アカウントから統括を解き、NULLタグは既定統括だけ | public-api-tags.test.ts 読取・付与の否定、自己タグ・既定共通タグの正常系 | 設定・migration不要 |
| S09 | 他統括・停止中の移行先が通り、全店の友だち数を返した | 両端の担当範囲・統括・有効・アーカイブ・統括稼働状態を検査、件数は元店舗のみ | health-migrate.security.test.ts 7件、既存health系9件合格。対照は6件失敗 | 設定・migration不要 |
| S11 | 個人写真・添付・任意キー・ウェビナーを公開経路から取得できることを対照で再現 | 公開配信の置き場と形式だけを許可。個人写真・旧フォーム添付は所属確認後に5分署名URL、no-store。ウェビナーは公開素材の別名も遮断 | image-access、images-public-delivery、media-usage-reference、file-scan-gate、nen-photo関連16ファイル238件成功。修正なし対照12件＋個人添付別名1件失敗 | migration・データ移動なし。既存API_KEYが署名に必要。運営はR2直公開と旧CDNキャッシュを別途確認。長時間表示で期限が切れた写真は再取得が必要 |
| S13 | 未着手 | — | — | — |
| S14 | 未着手 | — | — | — |
| S10 | 未着手 | — | — | — |
| S04 | 案とmigrationなしの守りを予定 | — | — | — |

## 同種探索

S05: `.github`・`scripts`・現行文書・更新CLIを検索。配備workflowはHTTP更新を呼ばない。`packages/create-line-harness/src/commands/update.ts`は公開版情報を取得した後、Cloudflare向けの更新エンジンを直接使う。管理画面の旧更新ボタン・履歴・update-clientには呼出しが残るが、この運用の配備経路ではない。公開`/admin/version`を保った。鍵だけで実行するHTTP経路とその旧成功試験を取り除き、廃止後の拒否・副作用なしの試験へ置き換えた。エンジン本体とCLIの試験は保つ。

## 最終検査

未実施。CI命令を列挙後、全試験・型・ビルド・ブラウザ・3幅・速度を順番に実施する。

## コミット

S05: `3750327308`。

S08同種探索: 公開APIのNULLタグ条件は一覧と付与の2箇所。両方を同じtokenから解いた統括判定で閉じた。タグ追加のシナリオ登録は従来の所属限定試験を維持。Node26/SQLiteのABI差はNode22.23.3に揃えて解消（製品の失敗には数えない）。

S09同種探索: 古い移行APIは現在のhealth画面とapi.health.migrateから使うので保持。既存一覧・詳細は両端の可視範囲を検査済み。新しいUID移行と引継ぎAPIは別用途なので古い友だち追加時の自動マッチをそこへ勝手に置き換えない。

S08: `2fbc7830b1`。

## 10月13日再開

途中のS11差分を保持して、最新本線 `b56967dbb20156c56ee2c2c6b7f5e7f341f1d196` を `b8484348a2` でmerge（競合0）。初回Worker全体11,615成功・途中S11のPDF公開1件失敗、Web全体2,190ファイル13,018成功（skip/todo各1）。S11のPDF公開を閉じ、関連238件成功。全体の最終検査は残りの修正後に再実行する。Node22.23.3、API URLは手元のみ、最大4 workers、重い物は直列。B-270に従い列車で見た目照合はしない。

S11同種探索: IMAGESの保存先と公開URL生成を検索。配信のルート画像、rich-menus、media（フォームの表示画像）、broadcast-media、imagemaps（拡張子なし含む）、instagram-jpeg、banner、公開写真の派生、統括のuploadsを保持。privateの本人確認と原本、pendingは引き続き公開不可。公開素材 `/media/:id/content` にも個人添付・ウェビナーの遮断を実装。署名は保存先と友だち台帳で所属を確認し、スタッフの担当店舗またはLIFFの本人・店舗一致のみ発行。外部のoriginは署名しない。署名の鍵・パス・期限改ざんと期限切れ、別店舗・別人・未認証・削除済みの拒否を確認。署名URLを保存データへ書かず、応答時だけ発行する。既存の公開キャッシュや利用者が保存した写しは、このコードだけでは取り消せないため運営工程へ渡す。

型検査でS09と新しいS11の試験スタッフにreadOnlyが不足していたので、試験データだけを補った。Worker型検査の再実行は成功。

証拠（ローカル・git外）: `/tmp/train32-resume-worker-all.log`、`/tmp/train32-resume-web-all.log`、`/tmp/train32-s11-final-related.log`、`/tmp/train32-s11-baseline-control.log`、`/tmp/train32-s11-live-private-control.log`、`/tmp/train32-s11-typecheck-fixed.log`。最初の追加試験はウェビナーの試験データにcreated_at/updated_atが不足して失敗、補正して再実行し成功。途中の失敗を合格に数えない。

S09: `acb54531f5`。
