> 文書：文字を見る試験の判断案｜区分：司令塔が承認 2026-10-23｜最終確認：2026-10-23（日本時間）

# Q02-D 18ファイルの判断案

土台：95ed89396efa98b6ace3f81887d49026261031ec。18ファイルをすべて読み、削除0・試験変更0。元の68は文字を見る試験の数で、現在の実行件数ではない。2026-10-23に司令塔が承認：残す7／書き換える11／消す0。書き換えは1ファイルずつ実施し、禁止の見張り・計算・故障対照と動きの試験を保つ。完了した範囲は個別コミットと引き継ぎ記録で示す。

| 現在のファイル | 案 | 理由・守り方 |
|---|---|---|
| `apps/liff/src/pages/liff-414-boards-nodes.test.ts` | 書き換える | 375/414幅で実際の日時選択・確認・フォームを描画しdata-design-nodeを検証する。幅と板IDの接続を守る。 |
| `apps/web/src/app/affiliates/affiliate-report-shape.test.ts` | 書き換える | 紹介者詳細へ不正な集計（null・配列・非有限数・byOffer欠落）を返して操作し、画面が落ちず読込失敗と記録維持の案内を出す。型偽装の禁止は残す。 |
| `apps/web/src/app/hq/hq-unavailable.test.ts` | 書き換える | HQサイドバーの4リンクと直接URLの入口を描画し、実機能へ進めることを確認する。メニュー定義の実データ試験は残す。 |
| `apps/web/src/app/issue-461-table-header-spacing-contract.test.ts` | 書き換える | 対象4画面の描画した表見出しについて実ブラウザの計算済み余白と列位置を確認する。共通Thのimport文字列では動作を保証できない。 |
| `apps/web/src/app/issue-702-badge-contrast-contract.test.tsx` | 書き換える | 共通札・タブ・手順を各状態で描画し、計算済み文字色/背景色の比を検証する。コントラスト計算・低比率の故障対照・5tone描画は残す。 |
| `apps/web/src/components/layout/sidebar-shell-fidelity.test.ts` | 書き換える | HQ/店舗/previewのサイドバーを描画し、会社表示・設定リンク・版の表示条件を確認する。sidebar-groups等の既存描画試験と故障対照を照合。 |
| `apps/web/src/components/shared/avatar.test.tsx` | 残す | 画像失敗の頭文字への切替・空名・色の安定性は実部品の動作試験。コントラスト算出もアクセシビリティの見張りなので維持し、将来は実描画の色も接続する。 |
| `apps/web/src/components/shared/button-busy-contract.test.ts` | 残す | 現在はTypeScript構文解析による全画面の禁止検査＋悪い/良いfixtureの実行。古い特定ファイルの文字固定から既に更新されており、共通busy表示の再発を守る。 |
| `apps/web/src/components/shared/card-shape-contract.test.ts` | 残す | カードの影/角丸の構文検査を実行し、変数の連鎖・上書き・条件合成の故障対照を持つ。見張りを消す対象ではない。#1795の枠計測にも触らない。 |
| `apps/web/src/components/shared/green-semantics-contract.test.tsx` | 書き換える | 生色の禁止検査と4.5:1の計算は残す。CardHeader/StatusBadge/Noticeの役割の色は実ブラウザ描画へ接続し、CSS文字列固定だけの部分を置き換える。 |
| `apps/web/src/components/shared/motion-audit-regression.test.tsx` | 書き換える | 保存中の幅・更新中の操作・焦点・IME中Escapeの動作はすべて残す。menuの退場タイミングと手順窓の高さ変化だけをDOM/計測で試す。#1795は統合済みのため着手できる。 |
| `apps/web/src/components/shared/table-header-migration-contract.test.ts` | 書き換える | 共通Thを使った画面の表の役割と列の整合を描画で確認する。直書き見出し/二重上書きの禁止検査は残し、移行時の出現文字列と過去数の固定を分ける。 |
| `apps/web/src/components/shared/v8-rule-values.test.ts` | 残す | verifyRuleValues/Bindingsという解析器を実行し、旧高さ・条件限定上書き・影の参照・未定義・循環の故障対照を持つ。禁止の見張りに当たる。 |
| `apps/web/src/lib/card-radius-contract.test.ts` | 残す | V8の役割別角丸の変数解決と、窓にカード角丸を使わない禁止を守る。画面を機械的に消す対象ではなく、実ブラウザの角丸確認を補完する検査。 |
| `apps/web/src/lib/route-integrity.test.ts` | 残す | 全画面のroute一覧・リンク先実在・静的redirectの設定を検査する。保存済みURLの到達性を守る構成検査。必要ならリンク抽出器の故障対照を強める。 |
| `apps/web/src/lib/size-scale-contract.test.tsx` | 書き換える | 半端値の増殖禁止は残す。正規値とクラスを付けただけのTokenProbeでは実CSSの適用を保証しないので、実共通部品の計算済み寸法へ接続する。 |
| `apps/worker/src/features/automations/automation-trigger-wiring.test.ts` | 書き換える | フォーム/クリック/予約/担当割当/手動返信を実HTTP・業務呼出で発火し、保存済みIDと呼出順・未確定時の未発火・二重防止を検証する。既存動作試験と照合する。 |
| `sites/musubo/test/site.test.mjs` | 残す | 実buildの出力HTML・配布物・法令案内・公開停止・escaping・外部通信禁止・静的リンクを検査する。生成結果の検査が中心であり、単なる実装ソース固定とは異なる。CSS/JSの禁止検査も維持。 |
