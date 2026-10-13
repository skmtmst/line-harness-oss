# 列車32 セキュリティ強化

開始本線: `e75ea5d615fa4ec3bce4c2d0777dcc6c74050348`。専用枝: `codex/kenta-train-32-1013`。doctor合格、開始時クリーン。本番・検証環境へ接続せず、migration・push・PR・配備なし。重い検査は直列、Vitest最大4 workers。

## 項目別

| 件 | 再現 | 直し | 試験 | 残り・運営設定 |
| --- | --- | --- | --- | --- |
| S05 | 更新鍵だけでエンジン・DBへ進むことを再現 | 現運用で不要なHTTP更新を廃止し全経路404。鍵や設定で再開しない | admin-update.security.test.ts 6件、admin-version.test.ts 5件合格。直しを外す対照は5件失敗 | 設定不要。司令塔は配備時に旧更新鍵・配備専用資格情報のWorker内保持が必要か棚卸し |
| S08 | 別統括tokenでNULLタグの読取・付与が通る | tokenの所属アカウントから統括を解き、NULLタグは既定統括だけ | public-api-tags.test.ts 読取・付与の否定、自己タグ・既定共通タグの正常系 | 設定・migration不要 |
| S09 | 他統括・停止中の移行先が通り、全店の友だち数を返した | 両端の担当範囲・統括・有効・アーカイブ・統括稼働状態を検査、件数は元店舗のみ | health-migrate.security.test.ts 7件、既存health系9件合格。対照は6件失敗 | 設定・migration不要 |
| S11 | 個人写真・添付・任意キー・ウェビナーを公開経路から取得できることを対照で再現 | 公開配信の置き場と形式だけを許可。個人写真・旧フォーム添付は所属確認後に5分署名URL、no-store。ウェビナーは公開素材の別名も遮断 | image-access、images-public-delivery、media-usage-reference、file-scan-gate、nen-photo関連16ファイル238件成功。修正なし対照12件＋個人添付別名1件失敗 | migration・データ移動なし。既存API_KEYが署名に必要。運営はR2直公開と旧CDNキャッシュを別途確認。長時間表示で期限が切れた写真は再取得が必要 |
| S13 | 回数の共有・メール単位の拒否・容量の事前拒否がないことを試験で再現 | 既存D1のauth_throttlesで機能別に原子的に予約。共有DB失敗時は503。画像は宣言長と読み込み中の容量で拒否 | rate-limit-shared、images-upload-sizeの14件成功、直しを外す対照12件失敗。画像・フォーム・リッチメニュー等1,031件、認証関連148件、LINE代理送信等64件成功、Worker型検査成功 | migration・新設定不要。IPはCloudflareの接続元だけ。一般APIの従来のメモリ制限は追加の短期防御として維持 |
| S14 | 例外全文・識別子入りpathのログを否定試験で再現 | 管理画面・LIFF・Workerのヘッダーを追加。consoleは固定コードとroute型。監査の詳細はD1を維持 | security-log、security-console-contract、画像等の関連試験と2系統の実ブラウザ。SDK実体の読み込み・予約・MFA入力・画像・フォント・MIME拒否・埋め込み拒否を確認 | 完全CSPはreport-only。強制する対照でNextの起動が止まる。Cloudflare側のURL記録とログ集約の伏せ字は運営が別途確認（実環境未接続） |
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

S11: `9ba249b859`。

S13同種探索: メモリの一般API制限とは別に、認証入口は接続元30回/分、メールのログインは10回/15分、再設定依頼はメール3回/日、認証済みの書き出し・アップロードは担当者と統括の組で各30回/分を予約する。アップロードは接続元でも30回/分。既存のパスワード失敗・再設定の制限、MFAの5回制限は残す。同時の再設定12要求から3件だけ通ることと、未確認の転送ヘッダーで枠を増やせないことを確認。保存するキーは指紋だけで、メール・接続元・tokenの実値は含めない。専用の期限切れカウンターだけを2日後に掃除し、既存の認証状態と生きた枠は消さない。

本文の同種探索: 汎用画像10MiB、旧フォーム10MiB、リッチメニュー1MiB、ペットのプロフィール1,500,000 bytes・写真投稿8MiB、統括の取り込み10MiBを既存の容量のまま読みながら制限。JSONはbase64の展開率と入力欄4KiBを加えた本文上限と、既存の復号後上限を併用。LINE代理送信の本文1MiB・画像3MiBもストリームで止める。書類添付と来店スタンプの写真は既存の読みながらの制限を維持。素材の直接アップロードはR2署名と完了時のhead・メタ情報検査を使っており、Workerへ巨大な本文を読む経路ではない。

S13証拠: `/tmp/train32-s13-before.log`、`/tmp/train32-s13-upload-before.log`、`/tmp/train32-s13-related.log`、`/tmp/train32-s13-auth-related.log`、`/tmp/train32-s13-final-specific.log`、`/tmp/train32-s13-control.log`、`/tmp/train32-s13-after-control.log`、`/tmp/train32-s13-typecheck.log`。本番・検証には接続せず、D1更新・設定変更・配備はしていない。

S13: `cb0531f347`。追加の全体検査で、非公開アップロードと本人確認の回数を認証より先に数えると認証の拒否が503へ変わることを検出。非公開の操作は認証後に数え、閲覧のみの操作も403で先に断る。ガード網羅と回数の関連33件で確認した。回数の上限や許可の一覧を増やしていない。

S11追加の探索: 無関係なプロフィール応答へ画像URLを入れて署名を作らせる余地を閉じた。スタッフはその画像を扱う正規の画面用APIからだけ発行し、写真審査の閲覧権限も確認する。画像用の欄と回答の添付だけを書き換え、名前・説明などの文字はそのまま返す。管理画面で意図的に公開する登録済み素材のPDFは既存の配信口を保つが、任意のR2のPDFは公開しない。画像の公開URLはWORKER_PUBLIC_URLとWORKER_URLの両方を扱う。

S14同種探索: Worker・管理画面・LIFF・DB・共有の型・LINE SDK・MCPの実行コードを探索。1,382のconsole呼出し（205ファイル）から動的な例外・URL・識別子を取り除いた。ソースの全件検査で固定コードとroute型以外を拒否し、例外追加・生のpath・動的コード・payloadの混入を対照で検出する。監査の「誰が・何を・いつ」はD1へ残ることを既存の成功・拒否試験で確認。ログの旧形式を見ていた試験をD1と伏せ字の確認へ更新した。処理の成功・失敗・後続の継続の確認は維持した。

S14ヘッダー: `_headers`を管理画面、独立LIFF、Worker配信LIFFへ追加。Workerが生成するHTMLにも同じ保護を付け、変更できないアセットのヘッダーはbodyを変えず包み直す。[Cloudflareのヘッダー仕様](https://developers.cloudflare.com/workers/static-assets/headers/)と[Viteのアセット仕様](https://developers.cloudflare.com/workers/vite-plugin/reference/static-assets/)を照合した。管理画面は他サイトの埋め込みを拒否、LIFFは自サイトとLINEの親を許す。nosniff・no-referrer・不要な機器の権限・object/base/formも設定した。

S14実ブラウザ: Chromiumで実ビルドを配信し、宣言されたヘッダーを付けて確認。LINE SDKの公開配信物自体を読み込み、認証と顧客APIは人工のものへ置き換える（実LINEログインや実送信はしない）。LIFFの予約、正しい埋め込みと別サイトからの拒否が成功。管理画面のパスワード表示、二段階から回復コードへ切り替え、失敗の表示も成功。画像・フォントの読み込みと誤ったMIMEの拒否も成功。厳しいscript-srcを強制するとNextの起動が止まり、report-onlyで13件のinline違反を確認したため、nonce/hash対応までは読み込みのCSPをreport-onlyにする。CIへ同じ2命令を接続した。

S14初回の全体検査は37件失敗。ログの古い形への期待、認証の順序、公開素材の試験用DB、途中で追加したHTML試験を含む。これを最終合格に数えず、順序を修正・D1の監査確認へ更新して関連を再検査。初回ブラウザも試験の文言と親側のCSPを切り分けて訂正し、強制・report-onlyの両方を実行した。ログ `/tmp/train32-s14-worker-all.log`、`/tmp/train32-s14-failures-recheck.log`、`/tmp/train32-s14-two-fixes.log`、`/tmp/train32-s14-console-contract.log`、`/tmp/train32-s14-worker-browser-fixed.log`、`/tmp/train32-s14-web-browser-final.log`、結果 `/tmp/train32-security-browser/`。正式な見た目照合はB-270により行っていない。

追加コミット: S09の試験型補正 `35927f6f6b`、S11の署名する経路・欄・写真閲覧権限の補正 `f0e621da1e`、S13の認証順序 `cf5f41fe93`。S11追加の直しを外す対照も失敗し、修正版の7ファイル72件・Worker型検査が成功。
