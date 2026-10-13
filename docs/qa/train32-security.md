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
| S10 | 更新前auditの重大7・高9を確認 | Next/MDX/eslint、sharp、MCP SDK、proxy-addr、source-map-js、brace-expansionを修正版へ限定更新 | 更新後auditは重大2・高1。関連・全体試験とビルドは下記に記録 | tinypoolとbracesは開発用の残り。運営設定不要、無検証のVitestメジャー更新はしない |
| S04 | 失効済みの平文鍵が通り、最終利用の記録がないことを2件で再現。セッション未結合の確認票も1件で再現 | 本人セッション＋使い切り確認票による交換/失効。確認票は現在のセッションへ必ず結合。交換時だけ表示、日時のみ照会、旧鍵と本人の全セッションを失効。監査は同じ取引 | staff-api-key.security.test.ts 11件。本人以外・鍵だけ・閲覧のみ・代理・目的違い・確認なし・未結合を拒否、監査失敗時ロールバック。確認を外す対照2件失敗 | 保存のハッシュ化・Calendar暗号化は案だけ。migration・DB更新なし。APIは追加、画面は未追加。実施時に専用暗号鍵の設定と番号承認が必要 |

## 同種探索

S05: `.github`・`scripts`・現行文書・更新CLIを検索。配備workflowはHTTP更新を呼ばない。`packages/create-line-harness/src/commands/update.ts`は公開版情報を取得した後、Cloudflare向けの更新エンジンを直接使う。管理画面の旧更新ボタン・履歴・update-clientには呼出しが残るが、この運用の配備経路ではない。公開`/admin/version`を保った。鍵だけで実行するHTTP経路とその旧成功試験を取り除き、廃止後の拒否・副作用なしの試験へ置き換えた。エンジン本体とCLIの試験は保つ。

## 最終検査

下記の全体検査は成功。B-270によりPencil・重ね画像・位置一致・3幅の画面差分比較は行わない。既存CIの操作・速度・静的コードの検査は実施した。

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

S11データの案: 実環境には接続せず、古い実データの所属メタ情報の欠落・旧CDNの残りは未確認。必要なら司令塔が件数だけの台帳を作り、友だち・回答・写真の保存参照とR2のheadを照合する。所属を一意に解ける物だけfriendIdを補い、解けない物は公開せず担当へ確認する。同じキーへメタ情報を補う方法を先に選び、キーを動かす必要がある場合はprivateの新キーへコピー→認証/署名で表示確認→DB参照の切替→旧公開URLとCDNを失効、の承認済み工程にする。戻し方も公開URLの復活ではなく認証側の参照を戻す。今回のデータコピー・移動・メタ情報更新は0件。

S14同種探索: Worker・管理画面・LIFF・DB・共有の型・LINE SDK・MCPの実行コードを探索。1,382のconsole呼出し（205ファイル）から動的な例外・URL・識別子を取り除いた。ソースの全件検査で固定コードとroute型以外を拒否し、例外追加・生のpath・動的コード・payloadの混入を対照で検出する。監査の「誰が・何を・いつ」はD1へ残ることを既存の成功・拒否試験で確認。ログの旧形式を見ていた試験をD1と伏せ字の確認へ更新した。処理の成功・失敗・後続の継続の確認は維持した。

S14ヘッダー: `_headers`を管理画面、独立LIFF、Worker配信LIFFへ追加。Workerが生成するHTMLにも同じ保護を付け、変更できないアセットのヘッダーはbodyを変えず包み直す。[Cloudflareのヘッダー仕様](https://developers.cloudflare.com/workers/static-assets/headers/)と[Viteのアセット仕様](https://developers.cloudflare.com/workers/vite-plugin/reference/static-assets/)を照合した。管理画面は他サイトの埋め込みを拒否、LIFFは自サイトとLINEの親を許す。nosniff・no-referrer・不要な機器の権限・object/base/formも設定した。

S14実ブラウザ: Chromiumで実ビルドを配信し、宣言されたヘッダーを付けて確認。LINE SDKの公開配信物自体を読み込み、認証と顧客APIは人工のものへ置き換える（実LINEログインや実送信はしない）。LIFFの予約、正しい埋め込みと別サイトからの拒否が成功。管理画面のパスワード表示、二段階から回復コードへ切り替え、失敗の表示も成功。画像・フォントの読み込みと誤ったMIMEの拒否も成功。厳しいscript-srcを強制するとNextの起動が止まり、report-onlyで13件のinline違反を確認したため、nonce/hash対応までは読み込みのCSPをreport-onlyにする。CIへ同じ2命令を接続した。

S14初回の全体検査は37件失敗。ログの古い形への期待、認証の順序、公開素材の試験用DB、途中で追加したHTML試験を含む。これを最終合格に数えず、順序を修正・D1の監査確認へ更新して関連を再検査。初回ブラウザも試験の文言と親側のCSPを切り分けて訂正し、強制・report-onlyの両方を実行した。ログ `/tmp/train32-s14-worker-all.log`、`/tmp/train32-s14-failures-recheck.log`、`/tmp/train32-s14-two-fixes.log`、`/tmp/train32-s14-console-contract.log`、`/tmp/train32-s14-worker-browser-fixed.log`、`/tmp/train32-s14-web-browser-final.log`、結果 `/tmp/train32-security-browser/`。正式な見た目照合はB-270により行っていない。

追加コミット: S09の試験型補正 `35927f6f6b`、S11の署名する経路・欄・写真閲覧権限の補正 `f0e621da1e`、S13の認証順序 `cf5f41fe93`。S11追加の直しを外す対照も失敗し、修正版の7ファイル72件・Worker型検査が成功。

S14: `5c78d8b08e`。

## S10 依存と到達経路

付録Dの重大・高を一件ずつ確認した。以下の「届かない」は現リポジトリの入口・配備方式からの判断であり、依存の脆弱性そのものを否定しない。audit全体は重大7・高9・中17・低4から、重大2・高1・中12・低4へ減少。中・低を無差別に更新していない。

| 依存・一次情報 | 修正版への更新 | 外からの到達と理由 |
| --- | --- | --- |
| [Next Windows RCE](https://github.com/advisories/GHSA-p293-qw3h-jr36) | 15.5.21 → 15.5.27（MDX・eslintも同版） | 管理画面は静的export、配備先にNextサーバーなし。開発Mac/CI LinuxなのでWindows経路はない |
| [Next AVIF最適化](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4) | 同上 | next/imageの実行コードと公開画像最適化APIがなく、R2画像はNext最適化器へ渡さない |
| [sharp SVG処理](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) | 0.35.4 → 0.35.5 | Next/ローカル開発ツールの間接依存。Workerの顧客画像処理にsharpの呼出しはない。将来の開発用入力も考え修正 |
| [MCP OAuth資格情報転送](https://github.com/advisories/GHSA-6qxp-vccf-f47h) | 1.30.0 → 1.31.0（サーバーとテンプレート） | MCPはStdioServerTransport。影響するOAuthクライアントを使用せず、公開HTTP/OAuth入口なし。将来の接続に備えて修正 |
| [proxy-addr IPv6信頼判定](https://github.com/advisories/GHSA-jqcg-44mw-7w3h) | 2.0.7 → 2.0.8 | Express/MCPの間接依存。APIはHonoでExpressのtrust proxyを使わず、MCPもstdio。修正済み |
| [source-map-js offset処理](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) | 1.2.1 → 1.2.2 | PostCSS/Viteのビルド用。顧客提供source mapを解析するAPIなし。CI入力の守りとして修正 |
| [brace-expansion再帰](https://github.com/advisories/GHSA-qhr7-859c-m2p7)・[カンマ解析](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) | 1系→1.1.21、5系→5.0.12 | lint/buildの固定glob。顧客がglobを指定する入口なし。両系列を修正しメジャーを混ぜない |
| [tinypool constructor](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3)・[run options](https://github.com/advisories/GHSA-85c8-ppgw-ccpr) | 1.1.1が残る（修正版2.1.2以上） | Vitestの開発実行のみ。先行するprototype汚染が必要で、外部HTTP入力からworker/run設定へ渡す入口なし。Vitestのメジャー移行と組で別途検証する。audit重大2件は残存 |
| [braces展開](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | 3.0.3が残る（auditに修正版なし） | ビルド/テストのソース管理されたglobだけ。顧客入力から展開器へ渡す入口なし。audit高1件は残存、修正版待ち |

証拠は `/tmp/train32-s10-after-audit.json`、関連試験とビルドは最終検査へ記録する。一括audit fix・メジャー更新・検査の上限変更・未記載の許可への逃がしはしていない。

配備向けの依存だけの追加確認 `pnpm audit --prod --json` は重大0・高0・中8・低1（`/tmp/train32-s10-production-audit.json`）。開発用を含む全体の重大2・高1の残りを隠さない。脆弱性のある版を使うことはauditで確認し、使っていない実行経路の攻撃実行は行っていない。

## S04 移行案（SQLは案、実行・ファイル作成なし）

必要な番号は仮に **637（スタッフ鍵）・638（旧Calendar）**。本線の現最大636に対する案であり予約ではない。司令塔が作成前・push前に最新本線と公開PRを再確認し、空いている番号についてオーナー承認を受ける。今回migrationファイルは0本。

スタッフ鍵は復号する必要がないため暗号化ではなく、十分な乱数から作る鍵のSHA-256指紋を保存する。必要な列とSQLの案:

```sql
ALTER TABLE staff_members ADD COLUMN api_key_hash TEXT;
ALTER TABLE staff_members ADD COLUMN api_key_hash_version INTEGER;
ALTER TABLE staff_members ADD COLUMN api_key_created_at TEXT;
ALTER TABLE staff_members ADD COLUMN api_key_last_used_at TEXT;
ALTER TABLE staff_members ADD COLUMN api_key_revoked_at TEXT;
ALTER TABLE staff_members ADD COLUMN api_key_expires_at TEXT;
CREATE UNIQUE INDEX idx_staff_api_key_hash ON staff_members(api_key_hash) WHERE api_key_hash IS NOT NULL;
```

既存のapi_keyがNOT NULLなので、新コードの切替後に既知の鍵を使えないランダムな墓標へ置換する。索引付きの指紋・失効・期限の判定を既存列で表現できないため列追加が必要。権限は既存スタッフの権限を毎要求再取得し、鍵専用scopeを増やす場合は許可範囲の別要件を決める。

移し方: ①新列を追加して、指紋優先・旧鍵の移行期間を期限つきで受けるコードを配備、②承認済みツールが対象件数だけdry-run、③旧鍵の読取り・指紋化はメモリ内だけ、DB/バックアップの秘密値を出力しない、④日時の設定表の記録を新列へ移す、⑤全スタッフへ新鍵を一度だけ発行し旧鍵と旧セッションを止める、⑥移行数・旧鍵0件・所属検査を確かめて平文を墓標にする。SQLの標準関数だけでは安全なSHA-256移行を完結できないため、承認済みアプリ処理を使う。

古い鍵を止める理由: 保存方式だけ変えても控えに残る旧鍵は有効なまま。再発行と失効が必要。戻し方: 新列を保った互換コードへ戻すか鍵認証を停止する。古い平文のDB控えを戻して旧鍵を再び通さない。新しい鍵の再発行は本人確認から行う。

旧CalendarはGoogleへ送る際に復号が必要なのでAES-256-GCMで暗号化する。必要な列とSQLの案:

```sql
ALTER TABLE google_calendar_connections ADD COLUMN access_token_enc TEXT;
ALTER TABLE google_calendar_connections ADD COLUMN refresh_token_enc TEXT;
ALTER TABLE google_calendar_connections ADD COLUMN api_key_enc TEXT;
ALTER TABLE google_calendar_connections ADD COLUMN credentials_key_version INTEGER;
ALTER TABLE google_calendar_connections ADD COLUMN credentials_migrated_at TEXT;
```

専用の32-byte暗号鍵を承認後に設定し、各値のnonceは毎回別にする。AADに所属統括・接続id・列名を含め、別店/別欄へコピーした暗号文を拒否する。Calendarの所属統括は接続のline_account_id/staff_idから解決し、曖昧な古い行は自動移行せず隔離して担当を確認する。暗号文はversion/nonce/ciphertext/tagの形式。①件数だけのdry-run、②旧tokenをメモリ内で暗号化、③復号照合後にaccess_token/refresh_token/api_keyをNULL、④再連携で旧Google tokenをGoogle側でも取り消す。既存の接続削除APIはローカルの切断でありGoogle側の失効の代わりにはならない。

戻し方: 新旧対応の暗号復号コードを保った版へ戻し、鍵の版を保持する。復号鍵を失う場合は接続を無効化してGoogle再連携へ進む。平文への書き戻しや古い有効tokenの復活を避ける。新列と鍵の版なしでは段階移行・安全なローテーションができないためmigrationが必要。

migrationなしの代わり: 今回は既存platform_settingsに発行/最終利用/失効日時を置き、鍵の照会は日時だけ。交換時だけ秘密を返し、本人セッション＋auth.api_keyの一回票が必須。対象idは本文で受けず本人に固定、閲覧のみ・代理・鍵だけの操作を拒否。鍵/監査/全本人セッションの失効は同一D1 transaction。監査失敗は全体を戻す。表示を失った鍵は再表示せずもう一度本人確認で交換する。画面追加はしない。最終利用は「有効な鍵の照合日時」であり、その後の権限/MFA判定まで成功したことは意味しない。スタッフの一覧/詳細とCalendarの接続応答は既に秘密を除外していることを同種探索で確認した。

平文の保存は引き続き残る。これを直ったとは報告せず、承認後の移行工程へ渡す。ログの秘密・例外全文はS14で閉じた。新APIに必要な本人向け経路を正式仕様と権限分類へ登録したが、未記載APIの検査許可・上限は増やしていない。

## 最終検査の本線

検査前fetchで `b7e54d350c3901be638dd843ba4808b6f4b63991`（サイト変更）へ進んでいた。競合なしでmergeし、その後の差分で全体を検査する。

Worker全体983ファイル11,660件成功、Web全体2,190ファイル13,018成功（skip/todo各1）。追加の確認票の未結合を閉じた後、Worker全体を再検査する。DB全体の初回は3ファイル4件失敗（2265成功）。これはS14で取り除いた起点/接続/送り先の識別子をconsoleへ出す旧期待。送信の継続・健全な行への配信・復号失敗時の動きは維持し、固定コードと識別子/秘密/URLの非出力へ更新した。3ファイル29件の再検査が成功。初回ログは `/tmp/train32-final-db-first.log`、修正後は `/tmp/train32-db-log-fixed.log`。失敗を最終合格に数えない。

## 最終合格の一覧

Node22.23.3。Vitest最大4 workers、重い検査は一つずつ。UnitはNEXT_PUBLIC_API_URL=http://127.0.0.1:8788。型・実ビルドはhttp://127.0.0.1:18788、CIのV8動作用NEXT_PUBLIC_RESTAURANT_TEST_ENABLED=true。どちらも手元の人工APIだけ。設定ファイル・秘密の設定・配備設定は変えていない。

| 検査 | 最終結果 |
| --- | --- |
| Worker全体（確認票の未結合を閉じた後） | 983ファイル・11,661件成功 |
| 管理画面全体 | 2,190ファイル・13,018成功、skip/todo各1（既存） |
| LIFF全体 | 78ファイル・469件成功 |
| scripts全体 | 111ファイル・1,028件成功 |
| DB全体（ログ期待を更新した後） | 382ファイル・2,269件成功 |
| 共有部品 | 33ファイル・382件成功、Asia/Bangkokでも同数成功 |
| 更新エンジン / 作成CLI | 20ファイル160件 / 8ファイル52件成功 |
| SDK / MCP / docs | 11ファイル53件 / 3ファイル68件 / 2ファイル6件成功 |
| 全ワークスペース型 / scripts型 | 成功（scriptsはNode22の型） |
| 全ワークスペースbuild | 成功（Next15.5.27・MCP SDK1.31.0含む） |
| lint / entity-picker / v8-only / 静的design検査 | 成功。既存warningは残る。上限と許可を増やさない |
| bootstrap / migration-policy | 成功。既存535件の安全検査。新規migration0件 |
| シェル / Actions構文 | 10シェル・14workflow・196run step成功 |
| 本線からの型の所有点検 | 新しい未許可の候補0・一時許可0 |
| CIの検査器の対照 | Nodeの既存ガード73件、速度の対照も成功 |
| 追加されたサイトの既存試験 | 成功（本線を取り込んだ後の確認） |

CIの実ブラウザ: Webhook（2幅）、現役WorkerのLIFF直入/SDK経由、S14のWorker/管理画面ヘッダー、素材の権限、EC一覧の店舗切替、保管済みタグ、MFA（3幅）、LINE通知、フォーム回答、取消失敗と操作メニュー（stgfix17）、2,000行の選択/再描画/キーボードがすべて成功。幅を変える試験は操作の回帰検査であり、Pencilと位置の一致の証拠にはしない。実環境のLINEログイン・実送信・実Calendar・実R2は扱っていない。

速度: 共通CI条件で11場面×5回、budget / stress / perf3 / train17すべて成功。基準のファイル、倍率、上限、許可の一覧を変えていない。画面の一致を示すPencil、重ね画像、位置±4px/90%、画面差分の3幅比較はB-270により未実施。

証拠: `/tmp/train32-final-worker-bound.log`、`/tmp/train32-final-web.log`、`/tmp/train32-final-*.log`、`/tmp/train32-final-unit-results.json`、`/tmp/train32-final-check-results.json`、`/tmp/train32-final-browser-results.json`、`/tmp/train32-final-speed-results.json`、`/tmp/train32-speed.json`（55測定完了）、`/tmp/train32-security-browser/`。実施した機能検査と未実施の見た目照合を混ぜない。

S04の追加の否定の証拠: `/tmp/train32-s04-before.log`（2件失敗）、`/tmp/train32-s04-control.log`（確認を外すと2件失敗）、`/tmp/train32-s04-bound-before.log`（未結合1件失敗）、`/tmp/train32-s04-bound-fixed.log`（11件＋ログ契約2件成功）。確認票の発行セッションと現在のセッションは一致が必須で、旧NULL互換を新しい鍵操作へ持ち込まない。権限・所属・稼働状態・生きたセッション・代理状態を鍵の更新SQLでも確認し、同時の変更は409。

本番・検証環境への接続、migration作成/適用、データ移動、push、PR、配備はなし。最終差分とクリーン状態はコミット後に確認し、以下へ記録する。

追加の保存: S14のDBログ試験 `87b9610fd1`、S10 `18c9bda794`、S04 `ccfd639254`。検査前の本線取り込み `59da00f192`。これ以外の件別のコミットは上記の各項に記載。文書・反映履歴・Memoryは別の最終コミットにまとめる。

引き渡し: 司令塔がpush・PRを作る際に反映履歴の0000を実番号へ採番する。S04の保存方式の移行はオーナー判断の後に別工程。旧公開キャッシュ/R2直公開、Cloudflare側のアクセスURL記録、完全CSPに必要なnonce/hashの対応は運営/画面の担当へ渡す。今回の枝から本番・検証へ反映しない。

最終の文書を保存後、`git diff --check` と `git status --short` が空であることを確認する。Pencilや画面の一致を「合格」と扱わない。画面差分の比較、位置合わせ、プレビューの形の測定はB-270で対象外（layout-overflow、layout-defectsの実画面比較、stgfix18-preview、title-auditを実画面へ当てる工程は実施しない）。
