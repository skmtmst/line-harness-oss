> 文書：旧code-rules案から採用先への案内｜区分：今の説明｜最終確認：2026-10-20（日本時間）

# コードの決まりを探す

置き場・命名・公開export・依存方向の正本は [code-structure](code-structure.md) です。段2のcode-rules下書きを別の正本として採用せず、確定した構成と見張りへ案内します。

| 下書きで扱ったこと | 現在の採用先 |
|---|---|
| 置き場・共通化 | 構成の決まり §1・§2 |
| 公開名・Next標準名・barrel・循環 | 構成の決まり §1・§3。Webのimportは拡張子なし、Worker・packagesは既存方式 |
| API prefix/suffix・transport案 | [既存のAPI公開入口](../apps/web/src/lib/api.ts)と[分割先](../apps/web/src/lib/api/index.ts)。公開名を一括改名しない |
| 理由のコメントと経緯 | 構成の決まり §4。二重送信・会計・監査・本人削除とブロックの違いは理由を残す |
| 目的ごとの書き方・試験 | 構成の決まり §5・§6 |
| 品質の検査 | 構成の決まり §7。実測baselineを水増ししない |
| 新しい入口 | 構成の決まり §8、`pnpm new:screen`・`pnpm new:route` |

下書きの400行・80行などの新しい凍結基準や、未存在のtransport名は導入しません。現役の検査を保ち、変更理由で分けます。API path・DB名・外部公開名・保存値は改名しません。Next標準ファイル、DBの `test/`、LIFFの公開互換入口などは役目から判断します。
