> 文書：画面確認の道具｜区分：今の説明｜最終確認：2026-10-19（日本時間）

# 画面確認の道具

- `mock-api.mjs` はローカル確認用の応答を返します。`mock-fingerprint.mjs` は違う版の応答を使う事故を防ぎます。
- `capture.spec.mjs` は現行V8の到達・状態・CSV・保管操作、`busy-buttons.spec.mjs` と `friends-interactions.spec.mjs` は操作を確認します。
- `v8-parity.mjs` / `v8-parity-all.mjs` は人が確認するために画像と測定値を出す道具です。固定画像・文字位置の点数で合否を決めません。
- `v8-design-map.json` とURL表は画面の場所と開く状態の案内です。固定枚数・旧ノードの使用・写しの完全一致を要求しません。古い固定書き出しを自動で重ねる生成経路は廃止しました。
- `v8-pattern-audit.mjs` は共通部品の所在と手書き候補を調べます。字句ごとの一時許可表は使いません。
- `pixel-diff.mjs` は渡された2枚のRGBA画像を比較する純関数だけです。旧V6の画素判定・採点台帳・撮影入口は廃止しました。

崩れの必須検査は `apps/web/scripts/v8-guard/` の実測を使います。外部の板ロック・正式台帳・鍵はこのリポジトリの道具から変更しません。UI隣接の固定値試験の削除はU01〜U07、CIジョブの接続はG02が担当します。

`apps/web/scripts/v8-guard/store-heading.test.mjs` は、飲食店と予約媒体の題・店舗欄を1152/1440、複数店舗・長い店舗名・単一店舗で実測します。題の幅0・店舗欄との重なり・横のはみ出しを失敗にし、メニュー管理の幅制約を外す故障を検出して読み直し後の復元まで確認します。`V8_GUARD_BASE` に本番形式の出力を指定し、`V8_GUARD_ARTIFACT_DIR` で写真と実測値を保存できます。

`apps/web/scripts/v8-guard/dashboard-content.test.mjs` は、6スタイルの初回表示で案内を600ms遅らせ、見えている数の帯が後挿入で8pxを超えて動かないことを1152/1440で確認します。標準も選択済みの有効な模擬設定を使います。`DASHBOARD_DELAYS=0,600` で通常との比較、`V8_GUARD_ARTIFACT_DIR` で写真とフレーム、`V8_GUARD_VIDEO=1` で動画を保存できます。
`V8_GUARD_DASHBOARD_FAULT=1` は待機中の本文を表示して、後挿入の揺れを検出する故障対照です。600msの標準で赤、旗を外した同じ出力で緑へ戻ることまで確認します。

### ページ切り替えの待機表示

`apps/web/scripts/v8-guard/permission-flash.test.mjs` は共通の画面ゲートで本人未取得・Suspense・故障・復元を確認します。`permission-navigation.test.mjs` は本番形式の出力を使い、メニュー正本の全URL・画面内のタブ・6スタイルと実際の設定リンクを1152/1440、通常/API600ms遅延で確認します。書き込み操作は行いません。

`V8_GUARD_VIDEO=1` のときは接続先の録画を終了後に `video/navigation.webm` へ明示保存し、ファイルが空なら失敗にします。故障の対照は `V8_GUARD_PERMISSION_FAULT=1` とAPI600msの条件で赤になることを確認し、旗を外した実行で復元を確認します。

巡回用の出力は、CIと同じく `NEXT_PUBLIC_RESTAURANT_TEST_ENABLED=true NEXT_PUBLIC_GOOGLE_BUSINESS_ENABLED=true pnpm --filter web build` で作ります。環境の旗がオフの出力では、飲食店の画面へ入れず準備中の窓になるため、全画面の巡回結果として扱えません。

```sh
V8_GUARD_BASE=http://127.0.0.1:4310 V8_GUARD_ARTIFACT_DIR=/tmp/permission-navigation node apps/web/scripts/v8-guard/browser-host.mjs --test --test-concurrency=1 apps/web/scripts/v8-guard/permission-flash.test.mjs apps/web/scripts/v8-guard/permission-navigation.test.mjs
```

描画フレームごとに題・URL・見えている権限の待機/拒否文・閲覧のみの案内を記録し、オーナーで許可された切り替えに混ざれば失敗にします。写真は代表の切り替えを指定フォルダへ保存します。全操作の写真は `V8_GUARD_CAPTURE_FRAMES=all`、動画は `V8_GUARD_VIDEO=1` で追加できます。画面外や寸法0の読み上げ専用の文は対象外です。正式な権限不足は既存の役割別試験で守り、待機文を消すために許可へ変えません。

巡回の故障対照は、600ms遅延の周へ `V8_GUARD_PERMISSION_FAULT=1` を付けて実行します。配信するJavaScriptの共通の読み込み文だけを一時的に差し替え、権限文で失敗することを確認します。配信ファイルは変更しません。変数を外した同じ周で成功することまで確認します。
