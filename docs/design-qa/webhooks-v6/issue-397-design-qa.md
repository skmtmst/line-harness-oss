# 機能26 外部連携 V6再判定

- 対象: Issue #397
- Node: `k3WxrO` / `M0Gb7`
- 設計: `docs/design-reference/webhooks-v6/k3WxrO.png` / `docs/design-reference/webhooks-v6/M0Gb7.png`
- 実装: `docs/design-qa/webhooks-v6/k3WxrO-1920.png` / `docs/design-qa/webhooks-v6/M0Gb7-1920.png`
- 確認幅: 1440px / 1920px
- 表示倍率: 100%

## 比較結果

`k3WxrO` は、4指標、説明、検索と絞り込み、接続別の回数・直近結果・再送可否、一覧、ページ送りを比較した。設計の固定値を実APIから表示し、URLは途中を伏せている。テスト送信APIが無いため、設計の「1回試してみる」は動く操作として表示していない。

`M0Gb7` は、受け取り口、照合、合言葉、受信後の処理、マスク済み受信内容、差し込み項目、そのほかの受け取り口、右側の案内を比較した。合言葉と受信値は再表示しない。受信後の実行器は未接続で、処理の表示名もAPIが返さないため、その状態を画面内へ明記している。

両画面とも1440px・1920pxで横はみ出しはなく、`undefined`・`NaN`・`Invalid Date`・`API error` と秘密値の露出はない。

## 判定

final result: passed

2画面とも実API接続と正式再判定は完了。設計構造は一致し、上記2つの未提供データだけ理由付き `structure_match_data_pending` とした。
