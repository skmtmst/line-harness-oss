# A03：通知の署名確認と本文上限の共通化

> 続きの製品SHA：`25b667fa6059bf7586a45647083d917685effac9`。Worker全13,054件・型・build成功。管理画面13,684件・型・build・実ブラウザ成功（変更のないGit木を照合）。修正後ci-localは製品失敗0、正式PR番号の照合は採番待ち。

> 前回（署名共通化）の検査した製品SHA：`4ba17e925ce6c35b7c9f01bd9e15d062146ac89b`。Worker全12,974件・管理画面13,684件・両方の型/ビルド・実ブラウザが成功。ci-localの製品失敗0、正式PR番号による反映履歴照合だけ採番待ち。

## 範囲と開始版

- 作業場所 `~/lh-work/lh-cl-a03`、枝 `codex/kenta-train-cleanup-a03-1018`。
- 土台と検査前fetchの本線はどちらも `ff1308a85c7178787fc5d9bbfce4c431a92b07d7`。追加mergeなし。起点はクリーン、`DOCTOR_LOCAL=1` のdoctor合格、Node22・frozen installで検査する。
- 分担表A03と「ぶつけない渡し方」、D01の[署名契約](../v8-requirements/cleanup-stage2-contract.md#store-flags)、api-commonを確認した。
- 司令塔のB-370では開始が指示され、Slack宣言の貼り付けはオーナー・確認はpush前の司令塔の担当。今回は外部への書込み禁止を守りSlack送信なし。push前に宣言の実施を確認する。
- 元のLINE checkoutの `.nodeterm/project.json`・`.nodeterm/settings.json`・`lh-hq.code-workspace` は既存のローカル変更として保持。対象の作業木とは別。親EC・他束のファイルは変更しない。

## 実装と保持した契約

`apps/worker/src/lib/hmac.ts` の `verifyNenWebhook` が時刻・署名表記・一定時間の照合を担う。元の `computeHmacSha256Hex` / `safeEqualHex` の公開口も保持する。鍵の探索、所属の照合、応答、処理の順序、受信台帳、冪等処理は各受信口に残す。

| 受信口 | 署名対象と鍵 | 保持する差・本文上限 |
|---|---|---|
| 配達通知 `/api/restaurant-test/delivery/webhooks/:service` | 出前館/ロケットナウは `timestamp.body`、サービスごとの既存鍵 | 5分・整数秒、`sha256=` は大小文字とも可、128KiB。送信元IP・店・接続の境界は変更しない |
| 同上のUber | 既存の公式方式 `x-uber-signature` とアプリのclient secret | 本文だけの署名、時刻不要。自社方式に変えない。本文上限は同じ128KiB |
| 自動LINE `/api/ec/events` | `timestamp.body`、指定accountのconnector鍵のみ | 数字の時刻、実際のミリ秒経過の5分、小文字 `sha256=` のみ、64KiB・超過400。既存のbyte復号も保持（下記） |
| お問い合わせ `/webhooks/xserver/support-email` | `timestamp.body`、中継用の既存鍵 | 10桁の時刻・現在秒切捨て・前置きなし。JSON内のrawは14Mi文字まで。署名対象全体のbyte上限へ勝手に変更しない |
| EC `/api/integrations/eccube/events` | ヘッダー有りは `timestamp.account.body`、無しは `timestamp.body` | 5分を小数秒で判定、前置きは大小文字可、256KiB。予備鍵の探索順と宛先一意性を保つ |
| キャンペーン `/api/integrations/eccube/columns`・`/coupon-usages` | `timestamp.body`、既存のEC全体鍵 | EC同様の時刻・前置き、256KiB。鍵の最小長と処理前の検査を保つ |

本文の値とUTF-8の検査は `apps/worker/src/lib/webhook-body.ts` へ集約。元々content-lengthを見ていた配達/ECだけ申告値の先行検査も共通化し、読取り後の実byte数検査を残した。メールは既存どおり文字数で、`support-inbox.ts` は既存importへの定数追加と参照置換だけ。許可先・上限・権限・画面の見張りを増減しない。

ECはヘッダー有りでconnector鍵→全体鍵、無しで全体鍵→既存の宛先解決→その宛先のconnector鍵。同じ時刻判定の値を予備鍵の検査にも渡す。探索に時間が掛かったことだけで最初の受理結果を変えない。他accountの鍵を列挙して試さない。

## 残した物と理由

- **自動LINEの旧署名復号**：元は `\w{64}` を通した文字列を2文字ずつ `parseInt(...,16)` → Uint8Arrayにしていたため、一部の非16進表記も正当な署名と同じbyte列に復号される。今回も受理結果を1つも変えない指示を優先し、この復号だけを専用profileとして保持した。通常の非16進署名は拒否するが、これを「全受信口の厳密16進化が完了」とは扱わない。厳密化は受理結果を変えるため司令塔の別判断。故障対照でも、この互換性と他口の厳密な16進検査の両方を守る。
- **support-relay送信側**：`A06-HANDOFF.md` を読み、共通実行器・CAS journal・結果不明で再送しない契約を確認。依頼どおり外部呼出しの接続は行わない。`sendViaXServerRelay` 本体・送信用の署名関数・その鍵/16進変換の補助も土台と完全一致。受信の検証だけを共通処理へ委譲した。
- A01/A06/A09/A11のファイル、新migration、画面、検査の上限/許可一覧は変更しない。DB適用・配備・push・PR・実送信・決済なし。
- APIのパス・入力・応答・管理画面の公開関数は変えない。画面側の接続作業は不要。

## 検査と証拠

| 検査 | 結果 |
|---|---|
| 最初のWorker型・主要6ファイル | 型成功・121件成功（`/tmp/a03-check.log`） |
| 最終の共通検証・実受信・EC鍵の3ファイル | 56件成功（`/tmp/a03-receivers-final.log`） |
| 土台の元コードへ同じ受信試験を適用 | 6ファイル132件成功 |
| 共通化後・故障を元に戻した後 | 各7ファイル164件成功 |
| 故障対照 | 17種類すべて期待値の不一致で検出、復元後成功 |
| コード長・差分空白 | 違反0（`/tmp/a03-code-size-final.log`）、`git diff --check`成功 |
| 検査用コピーと作業木 | 対象13ファイルが完全一致、SHA256を保存 |

故障は署名の素通し、期限の除去、support/自動LINEの前置き許可の拡大、accountの除去、本文trim、先頭1文字だけの比較、UTF-8を文字数へ変更、境界を1byte狭める、各受信口の本文検査の除去、本文上限の引上げ、content-length検査の除去、ECの先行鍵/予備鍵の除去。検査用コピーだけを変更し、実コードを壊していない。

証拠は `/var/folders/6v/dqgxy7ts2b12xlw5764btjc40000gn/T/a03-evidence-cypnxxkv/apps/worker/` の `summary.json`・`source-hashes.json`・各log、実行は `/tmp/a03-mutations.py`、集約は `/tmp/a03-mutations-final.log`。正常ケースと復元の両方が成功したことを確認した。

最初の受信試験の構文誤りは修正し、失敗ログ `/tmp/a03-new-targeted.log` も保持。初回の比較コピーはDB bootstrapの参照位置を再現できず失敗し、配置を直して再実行した（`/tmp/a03-mutations.log`）。この環境準備失敗を製品失敗や故障の検出に数えない。

重い関連検査の待機は未開始のまま終了し、コミット済みの同じ版でci-localの全工程を実行した。初期の待機を検査成功へ数えていない。

## 最終の確認

| 検査 | 結果 |
|---|---|
| 最終のWorker型 | 終了0。直接の型検査 `/tmp/a03-type-final.log`、ci-localでも成功 |
| Worker全試験 | 1,096ファイル・12,974件成功、終了0 |
| Worker本体build | 成功、後続のLIFF実ブラウザ/安全ヘッダー/公開SDK互換も成功 |
| 管理画面 | lint・型・全2,308ファイル13,684件・本番build・実ブラウザ成功。既存のskip/todo各1 |
| その他 | 共有型・共有試験（UTC/Asia Bangkokで各385件）・LIFF型/531件・SDK53件・MCP型/68件/build・文書6件・リポジトリの各検査が成功 |
| 同じHMACを使う他の受信口 | Meet callback/recovery、Codex/AI内部連携、support-inbox、conversions、webhooksの14ファイル193件成功（`/tmp/a03-all-hmac-callers.log`） |
| V8の差分判定 | 成功、既存の条件でrun=false。画面/共有型/撮影/lockfileの変更がないため後続は省略。検査の許可/上限/条件の変更なし |

ci-localは `~/lh-work/tools/hq/ci-local/run.sh <作業場所>` の全工程を実行。最終114工程は **成功59 / 省略54 / 集計失敗1**。省略54の内訳は通常の条件/actionの53と、正式PR番号不明の反映履歴照合1。**製品検査の失敗は0**。changesのPR番号が未入力のため反映履歴工程は手元では実行不能となり、その未完了を受けてrequired-pr-gateが終了1になった。正式なPRゲート合格とは扱わない。

PRの題名と本文にはA03・司令塔指定の仮番号#0000を明示したが、番号は仮造しない。`[skip release-log]` や許可の追加も使わない。司令塔の採番後、ファイル名/本文の#0000を実番号へ置き換え、通常のPR照合を実行する。

実際のリポジトリ変数一覧を読み、VITE_LIFF_ID / VITE_BOT_BASIC_ID / VITE_CALENDAR_CONNECTION_ID / V8_SPEED_ENFORCEMENTが未設定と確認。手元でこの4つの空値を明示した。設定自体の変更やトークン値の取得はしていない。

主ログは `/tmp/a03-ci-local.log`、各工程とmanifest/results/summaryは `~/lh-work/tools/hq/ci-local/logs/20261018-000510-4ba17e925c-5438/`。採番待ちによる元の失敗ログも保持した。故障対照の手順・集計・各ログは永続の `~/lh-work/design/v8/review/CLEANUP-1017/A03-EVIDENCE/` にも保存した。

反映履歴は `docs/release-log/unreleased/0000-kenta-cleanup-a03.md`（##変更、@kenta、#0000、日本時間）。製品入力は上記SHAで固定し、最後の追記はこの検査記録だけ。全製品ファイルのGit差分がないことと作業木の清潔さを確認してコミットまでで引き継ぐ。push/PR/DB更新/配備/実送信/決済なし。


## 続き：長いファイルの分割と F05（2026-10-18）

- 開始時クリーン。doctor合格後、まとめ枝 `codex/kenta-train-cleanup-all-1018` の `e9b423eb7c798f7d5a530a05a6e86a0c26dd56f9`（A06・#1771入り）を `020d5c5d64` でmerge。浅い履歴での最初のmergeは拒否され、`git fetch --deepen=40 origin codex/development` 後に競合なく取り込んだ。rebase・force・pushなし。検査前の最新本線も同じ `e9b423eb7c`。
- `PLAN-COVERAGE.tsv` の primaryBundle=A03 は0件。追加の計画IDはない。`LONG-FILES-1018.tsv` も bundle=A03 は0件だが、`restaurant-delivery.ts` はA08と記載されていた。分担表の「A03がHMAC route/serviceを一括所有、A08は同ファイルを分割しない」と本依頼を優先し、このファイルをA03で分割した。担当表や他束の実装は変更していない。
- デリバリーroute本体2,216行/1ファイルを、入口39行＋types（4個の行の型）63行、common（店舗ゲート・送信台帳）387行、orders-read（一覧・詳細）362行、orders-actions（注文操作）187行、history（履歴・CSV）226行、controls（品切れ・受付）342行、webhooks（署名・受信台帳・取込）273行、uber（接続・callback・probe）397行へ分割。合計2,276行/9ファイル。公開exportと登録順は保持。SQL・処理を含む全74文の構文比較は不足0/追加0、19個の登録順も一致。新しいモジュール間の循環0。最初の分割は既存の新規400行の検査で2件指摘されたため、型と注文の読み書きをさらに分割し、違反0へ。上限・凍結一覧は変更していない。
- `scripts/verify-staging-restaurant-delivery.test.ts` は移動先common/orders-read/orders-actions/history/controlsを読み、同じ4個のGETと4個のPOST、環境・店舗の拒否を検査するよう参照と字下げだけ変更。既存の88件を含め、試験の削除・改名・動きの期待値の緩和は0。
- F05の指摘どおり、中継メールの送信には転送禁止がなかった。`redirect: manual` を指定し、3xx・opaqueredirect・転送済み応答をJSON読取り前に拒否してbodyを解放する。宛先は既存設定のURL1個のまま、受信署名・メール入力・署名材料・成功ID・既存エラー・送信回数は保持。転送URLや本文・署名は記録せず、結果不明の自動再送も追加しない。
- 新しい `support-relay.test.ts` 13件は200成功、301/302/303/307/308、opaque/転送済み、エラー応答/不正JSON/切断を模擬。転送を有効に戻すと偽の転送先へ漏れるtransportで故障を検出する。実送信なし。
- 既存の認証付き試験だけではrouteゲートの登録削除が検出できなかったため、`restaurant-delivery-boundary.test.ts` 7件を追加。実登録したrouteへ認証済みスタッフを渡し、正常成功と環境オフ/本番/不明環境/パック無し/別統括/所属外accountの拒否を検査する。上流の認証で偶然拒否される結果をrouteゲートの証拠に使わない。
- 残した物：A06共通送信器への接続、永続journal/共有遮断・結果不明の保存先と、送信側timeout/応答容量の方針は今回の受信署名共通化へ混ぜない。`A06-HANDOFF.md` を確認済み。F05の本文と署名の転送漏えいを防ぐ最小修正を先に入れた。自動LINEの旧署名復号の互換性は前回どおり保持し、厳密化は司令塔の判断に残す。新migration・DB更新・配備なし。
- 初期型検査はA06 SDKの生成物が古く、続くprebuildは既定Node26とSQLiteのABIが不一致だった。SDKを再生成し、CIと同じNode22で解消。分割直後の受付再開用helperの参照漏れも共通側へ移して解消した。これら初期失敗と、最初のゲート故障対照が検出できなかったログを保持する。

検査結果と最終のci-local記録は下へ追記する。外部の `DONE-A03.tsv` は指定の4区分（前後の数・試験と移動先・見張り・見送った物と担当）を記録する。


最終構成での関連試験は9ファイル184件、確認用スクリプトは14件、Node22のWorker型検査はすべて終了0。初期の失敗ログは別途保持している。


### 安全検査が分割先を見失った点の修正

最初のci-local（製品 `1286476bc0`）のWorker全試験は13,049成功/5失敗だった。失敗はroute-guard-coverageの4件とpublic-entrypoints.securityの1件で、実登録されている18経路が静的な検査から落ちた。検査器は `routes` 直下のファイルを集め、そこで見つかった登録関数を追うため、下位フォルダへ移した関数は拾えなかった。

A01の検査器・認証・許可一覧・snapshot・公開経路の文書は変更せず、分割した8ファイルを `routes/restaurant-delivery-<役割>.ts` へ移した。mainの公開口と19個の登録順、全74文の比較結果（不足0/追加0）は同じ。静的検査が実登録と再び一致し、失敗した5件を含む127件と型が成功した。`scripts/verify-staging-restaurant-delivery.test.ts` の参照先も同じ移動へ追随する。元の5失敗ログを保持し、残す安全検査が経路を見失う故障を検出した証拠とする。

`routes/restaurant-delivery.ts` が入口、直下の `restaurant-delivery-types.ts` / `restaurant-delivery-common.ts` / `restaurant-delivery-orders-read.ts` / `restaurant-delivery-orders-actions.ts` / `restaurant-delivery-history.ts` / `restaurant-delivery-controls.ts` / `restaurant-delivery-webhooks.ts` / `restaurant-delivery-uber.ts` が最終の移動先。下位フォルダ版は残さない。


## 続きの最終検査と引き継ぎ

| 検査 | 結果 |
|---|---|
| 最終配置の安全検査・受信・店舗ゲート | 5ファイル127件成功。旧レイアウトで欠測した18経路の5失敗は、検査器・snapshotを変えず配置を直して解消 |
| 共通署名と受信の関連検査 | 9ファイル184件成功。最終の平置き配置でもWorker全試験に含めて成功 |
| 故障対照 | 転送followへの変更・転送応答の拒否除去・店舗ゲート登録の除去・Webhook登録の除去の4種をAssertionErrorで検出。正常・復元後13/88/7件すべて成功。初回のゲート対照が既存88件で検出できなかったログも保持し、追加7件で改善 |
| 分割前との比較 | 全74文が同一（不足0/追加0）、登録19個の順も一致。新module間の循環0。新規400行の既存検査は違反0、上限・凍結一覧の変更0 |
| 修正後Worker | Node22。1,100ファイル13,054件、型、Worker build、LIFF実ブラウザ入口・安全ヘッダー・公開SDK互換すべて成功 |
| 修正後リポジトリ | scripts 1,091件成功・既存skip1、scripts型、共有385件（UTC/Asia Bangkok各）、LIFF型/531件、共通所有・DB生成物・移行安全が成功 |
| 管理画面 | 2,308ファイル13,684件成功、既存skip/todo各1。lint・型・本番build・EC一覧/通知/タグ編集/認証/MFA/フォームの実ブラウザ・設計値・安全ヘッダーが成功 |
| その他 | SDK53件、MCP型/68件/build、文書6件成功 |
| V8差分の判定 | 通常条件のrun=false。apps/web・共有型・visual-qa・lockfileの変更なし。条件・上限・許可の変更なし |
| 最終の差分 | 余白違反0。コミット後の作業ツリーはクリーン。push/PR/新migration/DB更新/配備/実送信/実決済なし |

全体のci-localは製品 `1286476bc0` で114工程＝成功58/省略54/失敗2。失敗は修正前Workerの5件と、その結果および採番不足を受けた旧required-pr-gateの集計だけだった。元の終了1・全生ログを保持する。

配置を直した製品 `25b667fa60` で、変更の影響する `repository-checks` / `worker-checks` / `worker-build` と依存の `changes` を再実行した。40工程＝成功28/通常省略11/正式PR番号不足で実行不能1/失敗0、終了2。新しい製品検査の失敗は0。番号を捏造したり、`[skip release-log]` を指定したりしていない。

未変更範囲の結果は、apps/web・apps/liff・apps/docs・packages・visual-qa・.github・lockfile・release-log等12項目のGit木/ファイルが初回と修正版で完全一致することを照合して引き継ぐ。影響する3ジョブとchangesを修正版の結果へ置き換えた参照用集計は成功59/省略54/旧集計失敗1。**この参照用集計を正式PRゲートの合格にはしない。** 旧集計には古いWorker失敗も含まれており、正式PR番号が無いchangesの照合も未実行なので、司令塔が採番後に通常のPRチェックで確定する。

単独のWorker build待機は、命令が始まっておらず枠も持っていないことを確認して終了した。成功には数えず、修正後ci-localのWorker buildで検証した。共通枠の長い待ち時間を実行時間や成功へ読み替えていない。待機中に枠・メモリ条件・他者のPIDを変更していない。

証拠：`~/lh-work/design/v8/review/CLEANUP-1017/A03-EVIDENCE/RESUME-1018/`。`ci-reconciled.json`、両runのresults/summary/manifest、生の失敗/成功ログ、`unaffected-trees.json`、`fixed-source-hashes.json`、`a03-split-equivalence-flat.json`、`a03-flat-imports.json`、故障4種と正常/復元の全ログを保存した。`DONE-A03.tsv` は指定の4区分を記録。前回の署名17種の故障証拠も元の場所へ保持する。

次は司令塔が枝を取り込み、#0000の反映履歴を正式PR番号へ置き換え、通常ゲートで確認する。A06の送信共通器接続・永続journal/共有遮断・送信timeout/応答容量の方針と、EC自動LINEの旧署名復号の厳密化は、既記の理由で後続の担当判断に残す。
