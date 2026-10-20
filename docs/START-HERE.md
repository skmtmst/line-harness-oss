> 文書：開発・運用の引き継ぎ入口｜区分：今の説明｜最終確認：2026-10-20（日本時間）

# 次に作業する人へ

まず [AGENTS.md](../AGENTS.md) の順で必読を読み、[開発手順](development.md)から手元を準備してください。この文書は現役コードと判断待ちを探す入口です。仕様・設定値・合格台帳の正本を増やしません。

| 確かめたいこと | 次に開く場所 |
|---|---|
| 置き場・名前・公開index・依存 | [コードの構成と名前](code-structure.md)。旧code-rules案の採用先もここ |
| URLから本体・API・試験へ | [機能案内の一覧](feature-guides.md) → 各機能README → BEHAVIOR |
| 型・共通部品と見た目の直し先 | [V8の決まり](v8-design-rules.md)、[型の対応表](v8-pattern-catalog.md)、[変更箇所の地図](v8-change-map.md) |
| 動き・受け入れ条件 | [34機能の索引](v6-requirements/v6-requirements-master-index.md)、[追加要件](v8-requirements/README.md)、[段2の共通契約](v8-requirements/cleanup-stage2-contract.md) |
| HTTP登録・処理・共有型 | [APIの追い方](handoff-api.md)、[エラーの契約](error-codes.md) |
| 設定名・DB構造 | [設定と秘密値の保管先](config-and-secrets.md)、[DB構造](db-schema.md)。実値を文書へ書かない |
| 検査と公開前の工程 | [検査の入口](code-structure.md#5-検査の入口)、[配備ゲート](DEPLOY-GATE.md)、[V8切替](v8-requirements/v8-switch.md) |
| 何を外し、何を保持したか | [整理の引き継ぎ](handoff-cleanup.md)、[文書の保管先](document-archives.md)、[変更履歴](release-log/README.md) |
| 配布物・フォント・規約 | [表示と契約の確認事項](legal/distribution-and-terms.md) |

最初の調査対象は指定土台 `2577adf6e0cd7d2af551c663d79cd833da4e0c7d`。段2の途中版であり、本番の配備済み・全体CI合格・販売可を意味しません。各束の古い未完了は、その版の記録です。現在も未完了かは最新コードと同じSHAの検査結果で確かめます。

司令塔の手元にしかない資料はAGENTS.md §17にあります。束の `DONE-*.tsv`・`*-HANDOFF.md`・`API-CONTRACT-*.md` は `~/lh-work/design/v8/review/CLEANUP-1017/`。それらの値や応答をここへ写さず、現役の要件・公開入口・試験へ接続します。

専門家の確認が要るものはSELL-06（LIFF SDKのLINE独自契約）とSELL-10（正式規約と飲食草案の整合）。著作権者の表記・配布物へ残す表示と本文の確定は司令塔へ残します。未確認を完了にせず、確認する担当と根拠を引き継いでください。
