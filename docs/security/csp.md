> 文書：ブラウザの読み込み制限（CSP）｜区分：今の説明｜最終確認：2026-10-19（日本時間）

# ブラウザの読み込み制限（CSP）

管理画面とLIFFの静的配信は `_headers` の強制用 `Content-Security-Policy` を使う。Workerが作るHTMLは別の応答なので、静的ファイルだけで全経路の制限を確認したことにはならない。

Next.jsの静的出力の起動スクリプトはpostbuildで同じ配信元のファイルに移す。内容のSHA-256を名前とintegrityに使い、元の順序を保つ。固定nonceや許可先の追加で通さない。Turnstile・LINE SDKの許可名、動画用blob Worker、PDF用blob frameは現在のヘッダーを参照する。

## 確認の方法

通常ビルド後に `node scripts/security/csp-browser.mjs web` と `node scripts/security/csp-browser.mjs liff` をheavy経由で実行する。認証後LIFFは `CSP_LIFF_CACHED=1` を付け、通常SDKのキャッシュとprofile応答だけを架空の値にする。SDKそのものを試験用へ置き換えない。通常表示で違反0、故意のinline・未知スクリプトが拒否されること、PDFの文字入り紙面とblob Workerを別に確認する。

配備前は出力のヘッダーと、配備後のHTML・静的資産・JSON・エラー応答を照合する。配備先の実効値はこの文書編集では確認していない。手順と残条件は[安全点検表](SECURITY-CHECKLIST.md)へ記録する。

### 保った制約と残った物

| 対象 | 状態・理由 |
| --- | --- |
| スクリプトのinline/eval/未知の配信元 | 許可しない。試験では注入したスクリプトが実行されず、実際に強制の違反が出ることも確認 |
| スタイルのinline | 既存のReactの寸法指定・属性に対する `style-src 'unsafe-inline'` は従来どおり残る。起動スクリプトを通すために追加した物ではない。ここも外すには、動的な寸法を含む画面のCSSへの移動と見た目の照合が必要で、今回のAPI担当では変更しない。**全てのunsafe-inlineを除いた方針とは言わない** |
| 画像・音声/動画・APIの接続先 | 従来のHTTPS指定は残る。登録する素材やAPI設定で接続先が変わるため、任意の外部接続の防止まで完成したとはしない。script-srcへHTTPS全体の許可は入れない |
| LINE内の追加窓・共有先を選ぶ操作 | 同梱SDKにevalを使う経路がある。通常の画面表示と別に、本当のLINE内での操作は今回の外部ログイン禁止のため未確認。unsafe-evalは足さず、SDKの機能を勝手に削らない |
| Workerが作るHTML | 静的配信の `_headers` はWorkerが作る応答を変えない。既存の `html-security.ts` は別のReport-Only方針を持つ。動的HTML/別のSDKを含む経路全部の強制には、応答ごとのnonce等と別の全経路確認が必要 |
| 本番での実効値と違反の収集 | 未配備。収集先はまだないため、ブラウザの違反がSlackへ自動で届くとは説明しない。将来の収集でもURL/query/本文断片をそのまま保存しない |

S45は、上記のLINE内操作・Worker経路と本番の実効値が残るため「未」を保つ。過去の調査・故障対照の生記録は[保管先](../document-archives.md#s05)から確認できる。
