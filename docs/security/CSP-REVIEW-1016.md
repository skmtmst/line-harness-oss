# ブラウザの読み込み制限の確認（B-351/10）

## 17:43の追加依頼への対応

web/LIFFの静的配信用 `_headers` はReport-Onlyから強制用の `Content-Security-Policy` へ移した。**本番設定の操作・配備はしていない。** 試しの方針を併記して合格に見せる方式にはしない。

- Next.jsの静的出力の起動スクリプトは、ビルド後の `postbuild` で同じ配信元のファイルへ移す。元のバイト列のSHA-256をファイル名とintegrityへ使い、元の順番を保って同期実行する。静的ページへ固定nonceを埋め込まない。201ページ・657種類を最初の通常ビルドで確認した。
- 動画処理には `worker-src 'self' blob:` だけを指定し、PDFの既存プレビューには `frame-src` の `blob:` を指定する。スクリプトのinline・eval・不特定の配信元の許可は足さない。LINEのframe/親frameのワイルドカードは、確認したホスト名へ置き換えた。
- Turnstile・LINEのSDKは名前を指定する。管理画面の書体は同梱し、LIFFのGoogle Fontsは従来の名前による許可を保つ。通常のビルド経路がpostbuildを通ることは配備用workflowとも照合した。
- ヘッダーは1つの全パス規則を保つ。[Cloudflare Pagesの上限](https://developers.cloudflare.com/pages/configuration/headers/)は100規則・1行2,000文字。ページごとの大量のハッシュをヘッダーへ詰める形にはしない。`securityHeaders` がパス・重複・文字数を検査する。

最初の強制下の実ブラウザ確認は、管理画面8経路（認証画面4・統括ダッシュボード・友だち・受信箱・運用状態）とLIFFの未設定時6経路で違反0。管理画面の認証後はリポジトリの架空APIを使い、ログイン画面への戻りを成功扱いにしない。未設定のLIFFだけで認証後の成功とはしないため、同梱した通常SDKへ架空のキャッシュとprofile応答を与える追加確認を別に行う。最終は本線#1754取り込み後の管理画面8経路・LIFF未設定6経路・通常SDKの架空認証6経路で、通常表示の違反0。実PDFの紙面と文字の描画、blob Worker、非許可スクリプトの拒否も成功した。詳細は [今回の検査記録](SECURITY-B351-CONTINUATION.md)。

通常ビルド後、heavy経由で `node scripts/security/csp-browser.mjs web`・同じく `liff` を実行する。認証後LIFFは `CSP_LIFF_CACHED=1` を付ける。通常SDKのキャッシュ、profile権限の照合、profile応答を架空のものにするだけで、QA用SDKへの置換はしない。`channel: chromium` の内蔵PDFビューアを使い、ブラウザ内部の部品を通信の代替に巻き込まない。PDFはloadイベントやMIMEの一致だけで成功にせず、文字入りの紙面の描画を検査する。各ページの違反0と、故意の悪いスクリプトに対する違反は別に記録する。

起動スクリプトの外部化により同じ配信元への取得が増える。手元の機能確認とは別に、配備前の通常の速度点検も司令塔の関門に残る。

### 保った制約と残った物

| 対象 | 状態・理由 |
| --- | --- |
| スクリプトのinline/eval/未知の配信元 | 許可しない。試験では注入したスクリプトが実行されず、実際に強制の違反が出ることも確認 |
| スタイルのinline | 既存のReactの寸法指定・属性に対する `style-src 'unsafe-inline'` は従来どおり残る。起動スクリプトを通すために追加した物ではない。ここも外すには、動的な寸法を含む画面のCSSへの移動と見た目の照合が必要で、今回のAPI担当では変更しない。**全てのunsafe-inlineを除いた方針とは言わない** |
| 画像・音声/動画・APIの接続先 | 従来のHTTPS指定は残る。登録する素材やAPI設定で接続先が変わるため、任意の外部接続の防止まで完成したとはしない。script-srcへHTTPS全体の許可は入れない |
| LINE内の追加窓・共有先を選ぶ操作 | 同梱SDKにevalを使う経路がある。通常の画面表示と別に、本当のLINE内での操作は今回の外部ログイン禁止のため未確認。unsafe-evalは足さず、SDKの機能を勝手に削らない |
| Workerが作るHTML | 静的配信の `_headers` はWorkerが作る応答を変えない。既存の `html-security.ts` は別のReport-Only方針を持つ。動的HTML/別のSDKを含む経路全部の強制には、応答ごとのnonce等と別の全経路確認が必要 |
| 本番での実効値と違反の収集 | 未配備。収集先はまだないため、ブラウザの違反がSlackへ自動で届くとは説明しない。将来の収集でもURL/query/本文断片をそのまま保存しない |

S45は、上記のLINE内操作・Worker経路と本番の実効値が残るため「未」を保つ。以下は、今回の追加対応前のReport-Only調査の履歴。

---


2026-10-16 / kenta・Codex。本線 `af8e504d75` を取り込み済みの `8d78dd3111` と、その上の今回の差分を確認。**Report-Only のまま出力へ載せる準備と手元のブラウザ確認まで。本番へは配備していない。制限を強制すると止まる候補があり、S45は「未」を保つ。**

## 今回の変更

既存の `apps/web/public/_headers`・`apps/liff/public/_headers` の Report-Only に、HTML属性内のスクリプトとフォーム送信先の確認を追加した。`/*` なので試しのページだけでなく、通常の静的配信の全パスが対象。従来の強制用ヘッダーは変更していない。

`next build` の `apps/web/out/_headers` と、通常の `vite build` の `apps/liff/dist/_headers` がソースと完全一致することをブラウザ検査の冒頭で検査する。ローカルのHTTPサーバーがこのファイルのヘッダーを各応答へ付け、Chromiumで実行する。単にファイルの文字を読んで「本番で効いた」とはしない。

Cloudflare Pagesでは出力先の `_headers` を静的応答へ適用する。Functions等が作る応答は別にヘッダーを付ける必要がある。[Cloudflare公式](https://developers.cloudflare.com/pages/configuration/headers/)。Worker側のHTMLは既存の `apps/worker/src/middleware/html-security.ts` が担当し、今回その方針は変えていない。

## 外から読み込む物の一覧

コードのURL、通常ビルドのHTML/CSS/JS、同梱したLINE SDKを照合。URLの実値・query・トークンは記録しない。設定やお客さまの素材で接続先が変わる物は、固定ドメインの一覧だけで全件確認した扱いにしない。

| 物 | 接続先・方式 | コードの根拠 | 今の方針・確認 |
| --- | --- | --- | --- |
| 管理画面のJS・CSS・書体 | 同じ配信元。Inter/Noto Sans JPはビルド中にGoogleから取り込み、`/_next/static/media/`へ同梱 | `apps/web/src/app/layout.tsx`、`apps/web/out` | selfで許可。実際のJS・CSS・woff2をブラウザが取得。実行中のGoogle Fonts通信とは区別 |
| LIFFのJS・SDK | JS本体と `@line/liff` は同梱。追加SDKの配信元は `static.line-scdn.net` | `apps/liff/src/lib/liff-auth.ts`、`apps/liff/dist/assets/`、`apps/worker/src/client/` | self/SDK配信元を許可。通常のSDKを同梱した束で初期表示まで確認。本当のLINEログインはしない |
| LINE SDKの追加通信 | `liffsdk.line-scdn.net` の翻訳、`uts-front.line-apps.com` 等。LINEの画面遷移は `liff.line.me`・`liff-subwindow.line.me`・`access.line.me` 等 | 通常ビルドへ入った `@line/liff` 2.31.1の束 | HTTPS接続とLINEのframeを許可。認証後・LINEアプリ内・追加窓は未確認。追加窓にはevalを使うコードもあり、強制前に別途確認 |
| ロボット避け（Turnstile） | `challenges.cloudflare.com` のJS/iframe | `apps/web/src/components/auth/turnstile.tsx` | script/frameで許可。実物のURLに対する架空のJS/iframe応答でCSPの許可を確認。実サイトキーでの認証はしない |
| LIFFの書体 | `fonts.googleapis.com` のCSS、`fonts.gstatic.com` の書体 | `apps/liff/index.html` | style/fontで許可。架空CSSと同梱woff2の代替応答で読み込みを確認 |
| 画像・音声・動画 | Workerの `/images/`・`/media/`、LINEスタンプの `stickershop.line-scdn.net` 等。お客さまが登録したHTTPS素材、data/blobもある | `apps/web/src/v8/inbox-chat/`、`apps/worker/src/services/image-access.ts`、`apps/liff/src/` | img/mediaのHTTPS・data/blobを許可。画像の代替応答を確認。任意の素材ホストすべての実取得は未確認 |
| QR画像 | 現行の通常画面はWorker経由。ブラウザ確認用の補助実装には `api.qrserver.com` もある | `apps/web/src/components/dashboard/qr-browser-behavior.mjs` | 補助実装を通常画面の外部通信と混同しない。画像のHTTPS許可に含まれる |
| API・通知の接続 | 管理画面の `NEXT_PUBLIC_API_URL`、LIFFの `VITE_API_BASE`、Worker同居時の相対パス。SSEもHTTP(S) | `apps/web/src/lib/api.ts`・`update-client.ts`、`apps/liff/src/lib/api.ts` | self/HTTPS接続を許可。架空のHTTPS APIへ取得可能。`connect-src https:` は広い許可のままで、外部への持ち出し防止を完成したとはしない |
| 添付PDFの表示 | 認証後に取得した内容をblob URLのiframeで開く | `apps/web/src/components/shared/form-file-attachments.tsx` | 下の停止候補。お客さまの書類を検査へ使わない |
| 動画の処理 | HLS用のblob Worker | `apps/worker/src/client/webinar/main.tsx` の `new Hls()`、同梱 `hls.js` | 下の停止候補。架空のblob Workerで制限を確認 |

## 実ブラウザの結果と強制前の停止候補

管理画面は `/login`・`/login/two-factor`・`/register`・`/password/forgot` の4経路。通常のLIFFは `/` の1経路。ログイン用の実アカウント・顧客データ・本物の外部送信は使わず、外向きの要求はPlaywrightで代替応答する。LINE未設定のLIFFは「開けませんでした」が表示される段までであり、認証後の画面を確認した意味ではない。

- 4つの管理画面は各9件の `script-src-elem: inline` を報告。Report-Onlyなので起動は続き、ログイン画面のパスワード表示ボタンも動いた。
- LIFFの初期表示は違反0。ただしLINEログイン後・全LIFF画面の合格ではない。
- SDK・Turnstile・Google Fonts・画像・API・LINE/Turnstileのframeの代替読み込みは成功し、これらの許可済みHTTPS資源の違反は0。
- 未許可の別ドメインのスクリプトを故意に読み込み、実行が続きながら違反が出ることを確認。別の対照文書だけで制限を強制し、inlineスクリプトが実行されないことも確認。

| 停止候補 | 根拠 | 次の判断 |
| --- | --- | --- |
| 管理画面の起動 | Next.jsが出力したinlineの起動スクリプト。上記4経路で各9件を実測 | hash等と静的書き出しの整合を設計する。今回、unsafe-inlineを足して違反を隠さない |
| blob Worker | 両方の方針で `worker-src: blob` の違反を架空Workerで検出 | HLSの実利用条件と必要なworker-srcを確認。今回ヘッダーは緩めない |
| 添付PDFのblob iframe | 現行コードがblobを使う一方、frame-srcにはblobがない。管理画面の架空blobプレビューで `frame-src: blob` を2件検出 | 本人確認済みの取得・PDF表示を保つ方針を後続で決める。画面や方針を今回変更しない |
| LINE SDKの追加窓・eval | 同梱SDKに追加窓の初期化でevalを使う経路がある | 未到達。LINEアプリ内を含む承認済みの試験で確認する。通常表示の成功から安全とは推測しない |

Report-Onlyは通信や実行を止めず、ブラウザで違反を観察する仕組み。[MDNの説明](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy-Report-Only)。現在 `report-to`/`report-uri` の収集先は設けていないため、**CSP違反が自動でSlackやCloudflareログへ集まる状態ではない**。後続で収集する場合も、ブラウザが送るページURL・blocked URL・query・スクリプトの断片をそのまま保存しない。

## 再確認の入口

重い命令は `zsh ~/lh-work/tools/hq/heavy.sh` で包む。`NEXT_PUBLIC_API_URL` には手元の架空APIを指定してwebを通常ビルドし、LIFFは `VITE_LIFF_QA` と本物のLIFF IDを使わず通常ビルドする。その後、ルートで `node scripts/security/csp-browser.mjs web` と `node scripts/security/csp-browser.mjs liff`。出力先は `CSP_REPORT_PATH` で変更できる。外部資源は公開originだけを記録し、パス/queryは保存しない。検査用の固定画面パスは記録する。

`scripts/security/csp-policy.test.ts` はReport-Onlyの欠落・SDK許可の削除・unsafe-inlineの混入・属性制限の削除・対象パスの縮小・強制への誤移動を検出する。実物を弱める故障対照も実行し、AssertionErrorで失敗、復元後に成功した。検査結果全体は [B-351の作業記録](SECURITY-B351-1016.md)。
