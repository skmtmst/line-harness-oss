> 文書：配布時の表示と規約の引き継ぎ｜区分：今の説明｜最終確認：2026-10-20（日本時間）

# 配布物と規約の確認事項

この文書はSELL-06・07・10の引き継ぎです。規約本文、著作権者、売却や再配布の可否を確定しません。司令塔の2026-10-18の点検を、D02の指定土台のlockと現役ファイルに照合しました。

## SELL-07：ライセンス・依存・フォントの表示

ルートにはLICENSE・LICENCE・NOTICEの本文ファイルがありません。[READMEのMIT表記](../../README.md#ライセンス)は残します。著作権者は司令塔が確定するため、推測した本文や表記を追加していません。

[依存表示の一覧](dependency-notices.tsv)は現在のpnpm-lockの1,056件を1行ずつ載せています。通常依存・開発依存の直接利用先、ライセンスのメタデータ、根拠、導入済み本文のファイル名を分けています。直接利用先のない物を開発専用とは扱いません。1,035件は前回取得した固定版のnpmメタデータとlockのintegrityが一致、21件は導入済みpackage.jsonで確認しました。メタデータ未確認は0件ですが、本文と最終配布物の表示を全件確認した意味ではありません。

対象lockのSHA-256：`48bc335b327de27fd09daeaa2ced47d9f3edaefb2702bcface5760f1e7dfb3e8`。依存を更新したら一覧も再照合します。メタデータの元資料は司令塔の `review/SELLABLE-1018/license-registry-metadata.json`。一覧のevidence列で固定版の配布元または導入先へ追えます。

| 表示対象 | 現在の入口 | 本文・表示の確認先／残ること |
|---|---|---|
| 自前のコード | ルートREADME・各package.json | 著作権者・対象年・MIT本文と上流の表示を司令塔が確定 |
| 通常・開発・任意依存 | 依存表示TSV | 名前・固定版・ライセンス情報と実配布物を対応。MIT等のメタデータだけで表示済みにしない |
| Next内部の同梱物 | Nextの導入先とビルド出力 | Next自身のLICENSEだけで内部の別ライセンスを確認済みにしない。静的出力に入る範囲を配布担当が確認 |
| sharp/libvips等 | lockの `@img/*` とNext依存 | ビルド時のみかバイナリごと渡すかを区別。SaaS・ソース・SDK・CLIの引渡しを混ぜない |
| Inter | [管理画面layout](../../apps/web/src/app/layout.tsx)と[LIFF HTML](../../apps/liff/index.html) | [公式OFL本文](https://raw.githubusercontent.com/google/fonts/main/ofl/inter/OFL.txt)。管理画面はnext/font同梱、LIFFは外部取得 |
| Noto Sans JP | 同上 | [公式OFL本文](https://raw.githubusercontent.com/google/fonts/main/ofl/notosansjp/OFL.txt)。同梱ファイルと表示場所を配布担当が照合 |
| Shippori Mincho | LIFF HTMLのGoogle Fonts指定 | [公式OFL本文](https://raw.githubusercontent.com/google/fonts/main/ofl/shipporimincho/OFL.txt)。利用先と取得方法を保持 |
| Zen Maru Gothic | 同上 | [公式OFL本文](https://raw.githubusercontent.com/google/fonts/main/ofl/zenmarugothic/OFL.txt)。利用先と取得方法を保持 |
| アイコン・独自素材 | lucide-react、見本画像・ロゴ等 | 依存の表示と独自素材の権利を分ける。顧客のアップロードの権利は推測しない |

配布担当は実際に渡すSHA・配布形式を固定し、ソース・ブラウザJS・フォント・Worker・CLI/SDK等の各成果物に、必要な本文・表示がどこに残るかを対応づけます。D02は表示一覧までで、成果物へ表示を組み込む処理は変更していません。商用提供可能という判定にも置き換えません。

## SELL-06：LIFF SDKは専門家の確認が要る

`@line/liff` と `@liff/*` は一般のMIT依存と分けます。導入済みREADMEが指す [LINE開発者契約](https://terms.line.me/LINE_Developers_Agreement?lang=ja) を確認対象にし、提供形態・売却形態・契約主体・プロバイダーとチャネルの移管をオーナーと専門家へ渡します。独自契約があることだけで利用禁止・移転可能と結論しません。資格情報の受け渡しだけで完了にしません。

## SELL-10：正式規約と飲食草案は専門家の確認が要る

**規約の正本は正式サイトの2026-10-04版**です（司令塔の決定）。[サイトの設定](../../sites/musubo/site.config.mjs)はapprovedと施行日、[サイト本文](../../sites/musubo/src/legal.mjs)が内容の入口です。[正式公開URL](https://musubo.jp/terms/)の配信本文との一致は、今回の取得手段では確認できませんでした。

[飲食の草案](musubo-terms-v0.1-draft.md)と[画面用データ](../../apps/web/src/content/terms/musubo-terms.ts)は `v0.1-draft`・2026-08-23です。正式サイトの規約に合わせる前提で保持し、独立した正式規約として確定しません。本文と版をD02で書き換えていません。

表示側は [飲食追加の規約表示](../../apps/web/src/v8/restaurant/store-new/terms-body.tsx)と [共通のリンク設定](../../apps/web/src/lib/auth-email.ts) から追えます。専門家とオーナーが、同意した文書・版・保存記録、草案の補足として残す範囲、正式本文との整合を確認し、その後に司令塔が文書・画面・保存の担当へ同じ決定を渡します。既存の同意記録を消したり、一括で新しい版へ同意済みにしたりしません。
