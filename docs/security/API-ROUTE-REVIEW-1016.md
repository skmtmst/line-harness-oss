# API・LIFFの所属と権限の点検（B-265・B-332、続き）

2026-10-16 / kenta・Codex。試験前の開発基点は `765373beee065d1ef2e6f846cfc7d38f176f786c`。指定枝へ通常mergeし、前回の安全対策と共同開発者のUber通知署名の修正を保持した。rebase・force・stash・push・PR・配備・DB適用・本番設定変更はしていない。

## 一覧の作り方と読める範囲

`apps/worker/src/test-utils/route-security-inventory.ts` がTypeScriptの構文を読み、Honoの登録をたどる。GET/HEAD/OPTIONS、更新、ALL、子ルーター、定数、テンプレート、ループ、複数メソッドの `on`、計算したメソッド名を含む。使っていない関数・コメント・別ルーター・後から登録した門番を、保護の根拠には数えない。関数の引数の中身やSQL本文は一覧へ出さない。

`middleware/route-guard-coverage.test.ts` が、実際に起動したアプリの登録と突き合わせる。構文から展開した候補は、実登録にあるメソッドと経路だけを残す。実登録にあるのに一覧から欠けた経路は試験を落とす。結果は `API-ROUTE-INVENTORY-1016.tsv`。現在は1,652経路、うち管理認証1,479・`/api/liff/` 89。残りは認証開始・署名付き受信・公開画像などを含む。互換URLのイベント予約変更、フォームのお客さま用入口も一覧に含める。

列は、メソッド・経路・コード位置・管理ログインの要否・所属確認の呼出し根拠・スタッフの機能権限・閲覧のみの共通拒否・個別の門番。**呼出しの有無だけで、戻り値を正しく検査した証明にはしない。** `REVIEW` は、所属確認がないと確定した印ではなく、SQLへ直接所属を渡す処理、別ファイルの門番、署名、公開資料などを読むための候補。公開の時刻表と、本人の予約・回答の取得を同じ認可にしない。

管理経路は共通認証で未ログイン401を確認し、owner/admin/staffの別アカウントqueryは403を確認する。更新とCSV書出しは閲覧のみ403。機能ごとの「見えるだけ」権限もCSV・ダウンロードへ使えず、編集権限なら通る。GETと書き出しも機能権限なしのstaffが403になることを確認する。本人専用・明示公開・運営専用の例外は、一覧の分類と既存の専用試験で扱う。元のS07が求める「すべての個別資源へ実在する他店IDを入れる」検査とは区別し、一覧作成だけでその全件を済にしない。

## 見つけて直した抜け

| 対象 | 問題と変更 | 根拠・回帰試験 |
| --- | --- | --- |
| 友だちの統合一覧 | 店指定なしでは全店の友だち・回答を統合していた。サーバーで決めた担当店をSQLへ渡し、統合・連絡先抽出・ページ分割の前に絞る。キャッシュもDBと担当店集合を分ける | `routes/users-grouped.ts`、`services/users-grouped.ts`、`routes/security-scope-inventory.test.ts`。別統括・同じ統括の担当外・別DB・広い範囲から狭い範囲への切替 |
| 決済履歴 | 友だちIDだけの指定や無指定で他店の履歴を返していた。友だちの所属と担当店集合をSQLで照合。未割当の履歴は従来と同じく既定統括の無制限担当者のみ | `routes/stripe.ts`、`packages/db/src/stripe.ts`、上記の所属試験 |
| 流入先の切替グループ一覧 | 全店の一覧を返していた。担当する有効先のグループだけを返す | `routes/traffic-pools.ts`、上記の所属試験 |
| 配信の運用点検5経路 | 集計・重複判定・タグの除外が全店を読んでいた。各CTEと削除対象を担当範囲へ限定。他店のメッセージで自店のタグを外さない。配信を下書きへ戻す操作も配信の全所属を先に検査 | `routes/profile-refresh.ts`、上記の所属試験。別統括の実在配信ID、複数店配信、同じ名前のタグ・同じ人物キーの他店データで確認 |
| 所属列のない旧資源 | 文面ひな形、流入元の分類、共通のリンク先設定、Search Console、写真報酬ルール、手引きリンクを他統括のowner/adminも使えた。既定統括かつ担当店を制限していない人だけに限定 | `middleware/tenant-scope.ts` の `isLegacyGlobalApi`、上記の所属試験。既定統括の継続利用と店舗限定担当者の拒否も確認。新しい統括へ提供するには、所属を持つ設計と別承認が必要 |
| Google Sheets4経路 | 接続解除・出力先変更・同期で本文の店IDを検査していなかった。許可された店をqueryへ付けても、本文の他店IDは拒否。OAuth完了時も最新の担当範囲を再確認 | `routes/google-sheets.ts`、上記の所属試験、`google-sheets.test.ts`。拒否後は外部への鍵交換・設定保存をしない |
| イベントの本人操作 | LIFFが指す店と違うログインチャネルのトークンも検証候補にしていた。履歴・変更・取消・待ち・申込・限定表示は対象店のチャネルだけで照合 | `routes/events.ts`、`services/liff-auth.ts`、`events-channel.security.test.ts`、`liff-auth.test.ts`。他店・期限切れ・欠落・店のチャネル未設定を拒否 |
| 待ち案内のURL2経路 | LIFFの指定がないURLで、他店チャネルのトークンを使えた。保存済み案内のハッシュから所属だけを調べ、その店のチャネルを再検証。停止した統括・無効店の案内も拒否 | `services/event-waitlist.ts`、`routes/events.ts`、`events-channel.security.test.ts`。拒否後も案内の状態と版が変わらない |
| ウェビナーの本人操作7経路 | URLで選んだウェビナーと異なる店のトークンでも、同じLINE利用者IDなら通る余地があった。従来の本人確認後、ウェビナーの所属チャネルでも検証してから友だちを取得 | `routes/webinars.ts`、`webinars-channel.security.test.ts`。同じ本人IDを返す他店トークンでも拒否。視聴記録を作らない |
| イベント変更の互換URL | 管理画面の認証が先に要求され、お客さまが本人の変更へ到達できなかった。このPOSTだけLINE本人確認へ渡す。統括の停止と、対象店のイベント機能の停止はその前で維持 | `middleware/auth.ts`、`tenant-public-boundary.ts`、`feature-enforcement.ts`、`index.ts`。実アプリに登録した入口と停止統括の試験 |

| 閲覧権限の書出し | GETならCSVも通る判定だった。全体の閲覧のみと機能ごとの閲覧権限から、CSV・export・download・添付取得を除外。編集権限の通常操作は継続 | `middleware/auth.ts`、`route-guard-coverage.test.ts`。全管理GETのformat=csvをowner/admin/staffの閲覧のみで拒否。小さい実ルーターでも閲覧200・書出し403・編集の書出し200を確認 |
| 未割当の友だち | 未割当の旧友だちを別統括の店からも解決できた。指定店が既定統括に属するときだけ旧データへ引き当てる | `packages/db/src/friends.ts`、`test/friend-account-lookup.test.ts`。実SQLで他統括と存在しない店を拒否 |
| 停止後のウェビナー公開・素材 | 公開スラグと署名付き素材の取得時も有効店・有効統括を検査。管理画面のスラグ重複確認には従来の取得を維持 | `packages/db/src/webinars.ts`、`test/webinar-public-scope.test.ts`、`routes/webinars.ts` |
| LIFFの店指定の食い違い | 停止LIFFと有効な別店を同時指定して停止判定をすり抜けられた。同じアカウント行に両方が一致しなければ403 | `tenant-public-boundary.ts`、同試験の実SQLiteケース |

| 会員・ペットの本人操作9経路 | LIFFや店のqueryを省くと、停止した統括の会員が本人操作を続けられた。共通の本人取得SQLで有効店・有効統括を照合 | `routes/nen-members.ts`、`nen-members-membership-d1.test.ts`。停止・保管・店無効・所属欠落を拒否 |

未割当の旧ウェビナーは既定統括のチャネルだけで本人確認する。対象店にチャネルがない場合は環境の別店チャネルへ戻さない。店を持つウェビナー・待ち案内は本人のトークンを2回検証するため、LINE検証の呼出しと遅延は増える。認証前に非公開資源の存在を見せない順序を優先した。

旧スコアルール5経路は、behaviorfixの `e2ba928a88` で410停止済みであることをgit log/diffで確認した。前回この枝へ入れた同じ停止を保持し、重複した別実装は作らない。ウェビナーの今回の修正は本人解決の部分だけで、behaviorfix側の視聴期限・実際の視聴時間・保存時の版の変更とは異なる。

## 故障対照と検査

各修正の門番・SQL範囲・キャッシュ境界を一時的に外し、対応する試験がAssertionErrorで終了1になることを確認する。元に戻した通常の試験が終了0になることも別に記録する。対象は手元の架空データのSQLiteのみ。LINE・Google・Slackへの実送信や実認証はしない。

検査の実測値とコミットは `SECURITY-FIXES-1016.md` の続きへ記載する。依存更新を含むため、関連試験だけで全体を合格とせず、型・全試験・全ビルド・新品の作業場所でのci-localまで確認する。

## 規模制限を守る分割

ci-localで大きい既存ファイル13本の行数超過を検出したため、上限や例外は変えず、既存の安全対策を役割ごとに分けた。公開importとJSONは維持する。

- Workerの環境型：`worker-bindings.ts`（型だけ）。
- 公開経路：`middleware/public-api-boundary.ts`。認証のfacadeから同じ関数を再exportする。
- 機能判定の本文アカウント抽出：`middleware/feature-account-body.ts`。
- 本人と所属の解決：`services/webinar-caller.ts`、`nen-member-identity.ts`、`event-waitlist-owner.ts`、`google-sheets-account.ts`。
- 配信点検のSQL範囲：`services/profile-refresh-scope.ts`。
- エラーの固定分類：`services/event-input-error.ts`、`slack-error-summary.ts`。Slackの自由文抑止は維持する。
- DBの所属付き取得：`packages/db/src/friend-account-identity.ts`、`webinar-lookup.ts`。元のモジュールから同じ関数を再exportする。
- 旧スコア：到達しない旧処理を除き、同じ5経路を410だけ返すhandlerへ置き換えた。

分割後に関連試験と28故障対照をやり直し、ファイル位置も含めた経路一覧を再生成した。最終のci-local結果は `SECURITY-FIXES-1016.md` に記録した。
