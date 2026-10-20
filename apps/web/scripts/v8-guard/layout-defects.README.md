> 文書：崩れの見張り｜区分：今の説明｜最終確認：2026-10-19（日本時間）

# 崩れの見張り

`layout-defects.mjs <baseUrl> [out.json]` は1152・1440・1920の実画面を測ります。開けない画面、予期しない転送、画面のエラー、文字の切れ・重なり、箱のはみ出し、入力エラーの理由不足は失敗します。`layout-overflow.mjs` は横送り・右端越え・省略時の全文確認を同じ3幅で調べます。

固定の枚数・px・色・文言・旧ノードの一致や、画面ごとの許可表は使いません。`--compare-url` は同じ検出器で比較値を残しますが、既存の崩れも失敗です。`--record-allow` は廃止しました。切れ/重なりの検出閾値は変えていません。空白量だけの合否は外し、`blank-gap.mjs` の診断へ切り離しました。

`browser-host.mjs --test --test-concurrency=1 layout-defects.test.mjs layout-overflow.test.mjs owner-rules.test.mjs pendec2-rules.test.mjs b244-rules.test.mjs` で検出器の正常・故障・復旧を確認できます（このフォルダからの相対名）。`--fixtures <JSON>` は名前→HTMLの故障対照、`--fixture <HTML>` は単体の対照です。故障時はCLIも終了1になります。

操作の遮断・選択状態・必須/任意・入力理由・未保存の入力保持の試験は継続します。実画面を使う試験は、先に同じ作業場所の本番形式ビルドと見本API・静的配信を準備してください。CIの必須ジョブへの接続変更はG02が担当します。
