# B-351：CSPの強制と短命URLの追加対応

2026-10-16 / kenta・Codex。開始は `2bfabc53c0f5f8a2d93e9f499851e0107d25615d`、指定の作業枝はクリーン。doctor合格。`git fetch origin` 後の本線 `af8e504d75ad3d647fd2698690e2a97daa388387` は `git merge --no-ff` で取り込み済みだった。作業中に本線が `9bfaf28a109329a766c05c4c7c63dfc8625ac823`（#1754）へ進んだため、`8d652cb2020b133d78e487acb336299db0ba44d5` で通常mergeし、型・ビルド・全試験を再実行した。rebase/force/stash・push/PR・DB適用・secret/本番設定の変更・配備は行っていない。

## 変更

- [CSP](CSP-REVIEW-1016.md)：静的配信の強制用ヘッダー、内容ハッシュによる起動スクリプトの外部化、動画用WorkerとPDF表示。見た目の部品は変更しない。LINE内の追加窓・Workerの別のHTML方針・スタイル属性などの残件は同文書へ。
- [取得URL](SIGNED-DOWNLOADS.md)：添付全種別は最長15分、明細も最長15分で本人認証を併用。新しい表・列は不要。旧署名なし添付URLの停止・後からLINEで取得する場合の影響を明記した。
- 点検表の件数は49項目＝済21・未16・分からない12、未の高は15。残条件があるS41/S45を済に繰り上げない。B-351保留1/2/3/7は変更しない。

## 検査の記録

全て手元の架空データ。重い検査はheavyで順番を待って実行。秘密の実値・本物のログイン・外部送信は使わない。

| 検査 | 結果 |
| --- | --- |
| 最初の通常ビルド | web/LIFF成功。web201ページのinlineを657種類のハッシュ付きファイルへ移動 |
| 強制下の最初のブラウザ | 管理画面8経路・LIFF未設定6経路で違反0。blob Worker・blob iframe・外部資源の代替読み込みは成功、故意のinline/未知スクリプトは遮断 |
| web出力の全件点検 | 201ページすべてで実行可能なinlineは0。2,134参照すべてでファイル名のSHA-256とintegrityが内容に一致。async/deferへの変更0 |
| URL関連の追試 | Worker4ファイル70試験成功。LIFFのAPI3試験成功 |
| 故障対照 | URL期限の削除、明細の本人署名の結合削除、添付の持ち主照合削除、添付の署名確認削除、起動の外部化の削除、unsafe-inline拒否の削除の6種類でAssertionError/終了1、元のバイト列へ復元 |
| 全workspace型・scripts型 | 終了0 |
| 最終のweb/Worker/LIFFビルド | 3つとも終了0。webは再び201ページ・657種類を外部化 |
| scripts・共有型の全試験 | 116ファイル1,047試験成功・終了0 |
| Workerの全試験 | 1,002ファイル12,023試験成功・終了0 |
| LIFFの全試験 | 80ファイル479試験成功・終了0 |
| 本線#1754の画面の関連試験 | 1ファイル4試験成功・終了0 |
| 最終のブラウザ（heavy経由） | 管理画面8経路・LIFF未設定6経路・通常SDKの架空認証6経路で、通常表示のCSP違反0。全て終了0 |
| 実PDF・動画Worker | 文字入りのPDFをネイティブビューアで描画し、紙面と文字の画素を検査、画像でも確認。blob Workerも応答成功。object/フレームの停止0 |
| 悪いスクリプトの対照 | 各ヘッダーで、故意のinline・未許可の配信元のスクリプトを実行させず、強制による違反を記録。対照の違反を通常表示の0と混ぜない |
| 復元後のCSP/外部化の試験 | 2ファイル4試験成功・終了0 |
| 秘密検査・差分検査 | URL/CSPのコミット差分はGitleaks 8.30.1の伏せ字出力で検出0・終了0。差分の空白エラー0 |

生ログは `/tmp/lh-b351-*`。最初のブラウザの `/` は統括権限で `/hq` へ移る正常な動きだった。最初の検査では同一パスの断定が失敗したため成功扱いにせず、期待する遷移を明示して再実行した。最初の型検査ではcron用の型に既存secretの宣言が足りず失敗し、宣言を追加した。いずれも失敗したログを残した。

## 画面へ渡す口

明細は既存の `affiliateSelfApi.statements()` / `download(id)` を保つ。Workerの追加パスはない。会話のAPIを読み直すと本人の会話の添付URLが更新される。本人向けのLIFF取得画面と、15分後の再発行の導線は画面担当との後続の契約が必要。短命の署名URLをSlack等へ転記しない。詳細はSIGNED-DOWNLOADSを参照。

製品コミットは `2326c49306`（短命URL）・`d6670ad852`（CSP）。反映履歴のPR番号は司令塔が採番後に入れる。今回のci-localは再実行していない。以前のci-localとこの段の型/ビルド/全試験/ブラウザは版と範囲を分ける。

## 検査で直したことと残した失敗

最初の実PDFは、旧headless shell、iframeのloadイベントだけの判定、PDFを読み終わる前の検査用blobの失効、内蔵ビューアの部品まで偽物へ置くHTTP以外の通信の代替が重なっていた。通常Chromiumへ変更し、通信の代替はHTTP(S)だけに限定した。内蔵PDFビューアの読み込み後に文字と紙面を検査する。CSPなし・現行CSP・objectの許可を変えた対照は同じ描画になり、製品のobjectの制限を緩めて直したわけではない。[Playwright公式のブラウザの違い](https://playwright.dev/docs/browsers)も照合した。

LIFFの架空認証は、SDKがそのまま読むCookie名をURLエンコードしていたこと、profile権限/検証応答の不足、管理画面用APIの応答をLIFFへ渡していたことを修正した。実SDKと通常の束は変更せず、架空の認証情報・API応答だけで確認した。外部ログインや実送信はしない。

失敗ログは `/tmp/lh-b351-*first*`・`*shell*`・`*pdf-detailed*`・`*wrong-api-shape*`・`*before-paint*` 等へ保全。最終の生結果は `/tmp/lh-b351-csp-web-final.json`・`lh-b351-csp-liff-final.json`・`lh-b351-csp-liff-cached-final.json`、PDF画像は `lh-b351-pdf-preview.png`。全試験は `lh-b351-final-{typecheck,script-types,scripts,worker,liff,web-build,worker-build,liff-build}.log`。更新前の結果もbefore-1754名で残した。

残件はCSP記録のLINE内の追加窓・Worker HTML・スタイル属性等、URL契約の期限内転送と再発行画面、本番の反映/実効値。S41/S45はそれを理由に未を維持する。
