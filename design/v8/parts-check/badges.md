# badges：V8共通部品の照合

- 測定：2026-10-05 日本時間。開始時の基準点：`4b1cd841318a66b265a6fb64dbe25baa4106b1b6`。中断前の共通部品の変更を引き継いだ。
- 正本：`/Users/kentakenta/lh-work/design/v8/parts/<ID>.html`。変更せず配信。実ファイルの属性は `data-pencil-id`（`data-layer-id` は付いていなかった）。
- 本番ビルドの `/v8-parts` と正本iframeを同時に表示。Playwrightで1440×1000のブラウザーから測定。
- 本体・文字・点・アイコン・棒の済み部分について、幅・高さ・上下左右padding・gap・border幅・outline色/幅/offset・角丸・地色・文字サイズ/太さ/行間/字間/色・影を比較。直接の文字は親の文字指定を測定。本体の幅は文字・点・gap・paddingを含む。
- 描かれないborder/outlineの色は比較対象外。枠があるタグ・経路・タイル・？は正本のoutlineの色と太さで比較。
- SVG正本は線を輪郭のpathに変換している。実装はLucideの線で、外側の寸法と描画の前景色を比較。オンの星は塗り・縁の色・1px線が一致。SVG内のpath個数やfill/strokeの表現方法を同一としていない。
- 数値：21/21合格。画像の最終合否は司令塔Claudeの確認待ち。

| ID | 部品 | 最大寸法差 | 色の不一致 | 数値判定 |
|---|---|---|---|---|
| mpVfY | 状態・対応済み | 0px | 0 | 数値合格 |
| ekmYd | 状態・予約中 | 0px | 0 | 数値合格 |
| ii85L | 状態・対応中 | 0px | 0 | 数値合格 |
| XwfSH | 状態・未対応 | 0px | 0 | 数値合格 |
| hQeAo | 状態・下書き | 0px | 0 | 数値合格 |
| C6DGX | 増減・良い | 0px | 0 | 数値合格 |
| OEQxt | 増減・悪い | 0px | 0 | 数値合格 |
| r9qfM2 | 増減・要確認 | 0px | 0 | 数値合格 |
| h7Ch3y | タグ | 0px | 0 | 数値合格 |
| HNps2 | 経路 | 0px | 0 | 数値合格 |
| zcGgI | 注目の星・オフ | 0px | 0 | 数値合格 |
| w0R1PQ | 注目の星・オン | 0px | 0 | 数値合格 |
| MFTlt | 顔・小 | 0px | 0 | 数値合格 |
| pDKi6 | 顔・中 | 0px | 0 | 数値合格 |
| zjEbn | 顔・大 | 0px | 0 | 数値合格 |
| C9CaMS | 印のタイル・小 | 0px | 0 | 数値合格 |
| E7USZ9 | 印のタイル・中 | 0px | 0 | 数値合格 |
| A2mryd | 印のタイル・大 | 0px | 0 | 数値合格 |
| KjC1z | ？ | 0px | 0 | 数値合格 |
| x4FeKG | 動きの印 | 0px | 0 | 数値合格 |
| tydx2 | 進みの棒 | 0px | 0 | 数値合格 |

比較した属性は合計 811 個。寸法差は最大0px、比較色はすべて完全一致。

## 画像と実測値

- `<ID>.png`：左＝絵・右＝実装、21枚。`badges-overview.png`：代表9例。
- 左の色が全面に広がる部品は、正本HTMLのbodyにも部品と同じ地色が指定されているため。比較対象はiframe内のdata-pencil-id要素。右は白い地に実装を置いている。
- `badges-measurements.json`：getComputedStyleの実測値。`badges-icon-paints.json`：SVGの塗りと線の色。
- `badges-reference-sha256.json`：正本HTMLの指紋。
- `handmade-badges.md`：画面に残る手書き部品の候補62件。画面は変更していない。

## V7と機能の確認

- 同じ本番CSS・書体・HTMLで、開始時HEADの部品CSSを重ねたV7（変更前）と現在のV7（変更後）を比較。19例の画像差は0画素、17例の本体の寸法とcomputedStyleも完全一致。全機能画面の撮影をしたという意味ではない。
- `badges-v7-before.png` / `badges-v7-after.png` / `badges-v7-measurements.json`に保存。
- vitest：関連9ファイル・76件合格。顔の画像失敗時の代替、補足の開閉/Escape/フォーカス、状態表示、処理の停止/失敗/読み上げ、新しい星の状態とdisabledを含む。
- apps/web tsc、確認用本番ビルド、git diff --check：合格（ビルドは既存のlint警告あり）。
- design:debt:check：増加なし。design-debt-baseline.jsonは変更していない。

## 手渡し

機能画面・docs/brain・docs/v6-*は変更していない。push・マージ・rebase・stash・force push・Slack投稿・DB更新・配備は行っていない。司令塔は21枚を見て画像の合否を決め、画面レーンへ手書き一覧を渡す。

## 属性ごとの比較

### mpVfY 状態・対応済み

| 要素 | 属性 | 絵 | 実装 | 差 |
|---|---|---|---|---|
| 本体 | backgroundColor | `rgb(232, 248, 238)` | `rgb(232, 248, 238)` | 0 |
| 本体 | borderBottomLeftRadius | `999px` | `999px` | 0 |
| 本体 | borderBottomRightRadius | `999px` | `999px` | 0 |
| 本体 | borderBottomWidth | `0px` | `0px` | 0 |
| 本体 | borderLeftWidth | `0px` | `0px` | 0 |
| 本体 | borderRightWidth | `0px` | `0px` | 0 |
| 本体 | borderTopLeftRadius | `999px` | `999px` | 0 |
| 本体 | borderTopRightRadius | `999px` | `999px` | 0 |
| 本体 | borderTopWidth | `0px` | `0px` | 0 |
| 本体 | boxShadow | `none` | `none` | 0 |
| 本体 | columnGap | `5px` | `5px` | 0 |
| 本体 | height | `22px` | `22px` | 0 |
| 本体 | outlineOffset | `0px` | `0px` | 0 |
| 本体 | outlineStyle | `none` | `none` | 0 |
| 本体 | outlineWidth | `3px` | `3px` | 0 |
| 本体 | paddingBottom | `2px` | `2px` | 0 |
| 本体 | paddingLeft | `8px` | `8px` | 0 |
| 本体 | paddingRight | `8px` | `8px` | 0 |
| 本体 | paddingTop | `2px` | `2px` | 0 |
| 本体 | rowGap | `5px` | `5px` | 0 |
| 本体 | width | `75px` | `75px` | 0 |
| 文字 | color | `rgb(4, 120, 51)` | `rgb(4, 120, 51)` | 0 |
| 文字 | fontSize | `12px` | `12px` | 0 |
| 文字 | fontWeight | `600` | `600` | 0 |
| 文字 | letterSpacing | `normal` | `normal` | 0 |
| 文字 | lineHeight | `18px` | `18px` | 0 |
| 点 | backgroundColor | `rgb(4, 120, 51)` | `rgb(4, 120, 51)` | 0 |
| 点 | borderBottomLeftRadius | `50%` | `50%` | 0 |
| 点 | borderBottomRightRadius | `50%` | `50%` | 0 |
| 点 | borderBottomWidth | `0px` | `0px` | 0 |
| 点 | borderLeftWidth | `0px` | `0px` | 0 |
| 点 | borderRightWidth | `0px` | `0px` | 0 |
| 点 | borderTopLeftRadius | `50%` | `50%` | 0 |
| 点 | borderTopRightRadius | `50%` | `50%` | 0 |
| 点 | borderTopWidth | `0px` | `0px` | 0 |
| 点 | boxShadow | `none` | `none` | 0 |
| 点 | columnGap | `normal` | `normal` | 0 |
| 点 | height | `6px` | `6px` | 0 |
| 点 | outlineOffset | `0px` | `0px` | 0 |
| 点 | outlineStyle | `none` | `none` | 0 |
| 点 | outlineWidth | `3px` | `3px` | 0 |
| 点 | paddingBottom | `0px` | `0px` | 0 |
| 点 | paddingLeft | `0px` | `0px` | 0 |
| 点 | paddingRight | `0px` | `0px` | 0 |
| 点 | paddingTop | `0px` | `0px` | 0 |
| 点 | rowGap | `normal` | `normal` | 0 |
| 点 | width | `6px` | `6px` | 0 |

### ekmYd 状態・予約中

| 要素 | 属性 | 絵 | 実装 | 差 |
|---|---|---|---|---|
| 本体 | backgroundColor | `rgb(233, 241, 255)` | `rgb(233, 241, 255)` | 0 |
| 本体 | borderBottomLeftRadius | `999px` | `999px` | 0 |
| 本体 | borderBottomRightRadius | `999px` | `999px` | 0 |
| 本体 | borderBottomWidth | `0px` | `0px` | 0 |
| 本体 | borderLeftWidth | `0px` | `0px` | 0 |
| 本体 | borderRightWidth | `0px` | `0px` | 0 |
| 本体 | borderTopLeftRadius | `999px` | `999px` | 0 |
| 本体 | borderTopRightRadius | `999px` | `999px` | 0 |
| 本体 | borderTopWidth | `0px` | `0px` | 0 |
| 本体 | boxShadow | `none` | `none` | 0 |
| 本体 | columnGap | `5px` | `5px` | 0 |
| 本体 | height | `22px` | `22px` | 0 |
| 本体 | outlineOffset | `0px` | `0px` | 0 |
| 本体 | outlineStyle | `none` | `none` | 0 |
| 本体 | outlineWidth | `3px` | `3px` | 0 |
| 本体 | paddingBottom | `2px` | `2px` | 0 |
| 本体 | paddingLeft | `8px` | `8px` | 0 |
| 本体 | paddingRight | `8px` | `8px` | 0 |
| 本体 | paddingTop | `2px` | `2px` | 0 |
| 本体 | rowGap | `5px` | `5px` | 0 |
| 本体 | width | `63px` | `63px` | 0 |
| 文字 | color | `rgb(11, 99, 206)` | `rgb(11, 99, 206)` | 0 |
| 文字 | fontSize | `12px` | `12px` | 0 |
| 文字 | fontWeight | `600` | `600` | 0 |
| 文字 | letterSpacing | `normal` | `normal` | 0 |
| 文字 | lineHeight | `18px` | `18px` | 0 |
| 点 | backgroundColor | `rgb(11, 99, 206)` | `rgb(11, 99, 206)` | 0 |
| 点 | borderBottomLeftRadius | `50%` | `50%` | 0 |
| 点 | borderBottomRightRadius | `50%` | `50%` | 0 |
| 点 | borderBottomWidth | `0px` | `0px` | 0 |
| 点 | borderLeftWidth | `0px` | `0px` | 0 |
| 点 | borderRightWidth | `0px` | `0px` | 0 |
| 点 | borderTopLeftRadius | `50%` | `50%` | 0 |
| 点 | borderTopRightRadius | `50%` | `50%` | 0 |
| 点 | borderTopWidth | `0px` | `0px` | 0 |
| 点 | boxShadow | `none` | `none` | 0 |
| 点 | columnGap | `normal` | `normal` | 0 |
| 点 | height | `6px` | `6px` | 0 |
| 点 | outlineOffset | `0px` | `0px` | 0 |
| 点 | outlineStyle | `none` | `none` | 0 |
| 点 | outlineWidth | `3px` | `3px` | 0 |
| 点 | paddingBottom | `0px` | `0px` | 0 |
| 点 | paddingLeft | `0px` | `0px` | 0 |
| 点 | paddingRight | `0px` | `0px` | 0 |
| 点 | paddingTop | `0px` | `0px` | 0 |
| 点 | rowGap | `normal` | `normal` | 0 |
| 点 | width | `6px` | `6px` | 0 |

### ii85L 状態・対応中

| 要素 | 属性 | 絵 | 実装 | 差 |
|---|---|---|---|---|
| 本体 | backgroundColor | `rgb(253, 243, 225)` | `rgb(253, 243, 225)` | 0 |
| 本体 | borderBottomLeftRadius | `999px` | `999px` | 0 |
| 本体 | borderBottomRightRadius | `999px` | `999px` | 0 |
| 本体 | borderBottomWidth | `0px` | `0px` | 0 |
| 本体 | borderLeftWidth | `0px` | `0px` | 0 |
| 本体 | borderRightWidth | `0px` | `0px` | 0 |
| 本体 | borderTopLeftRadius | `999px` | `999px` | 0 |
| 本体 | borderTopRightRadius | `999px` | `999px` | 0 |
| 本体 | borderTopWidth | `0px` | `0px` | 0 |
| 本体 | boxShadow | `none` | `none` | 0 |
| 本体 | columnGap | `5px` | `5px` | 0 |
| 本体 | height | `22px` | `22px` | 0 |
| 本体 | outlineOffset | `0px` | `0px` | 0 |
| 本体 | outlineStyle | `none` | `none` | 0 |
| 本体 | outlineWidth | `3px` | `3px` | 0 |
| 本体 | paddingBottom | `2px` | `2px` | 0 |
| 本体 | paddingLeft | `8px` | `8px` | 0 |
| 本体 | paddingRight | `8px` | `8px` | 0 |
| 本体 | paddingTop | `2px` | `2px` | 0 |
| 本体 | rowGap | `5px` | `5px` | 0 |
| 本体 | width | `63px` | `63px` | 0 |
| 文字 | color | `rgb(148, 96, 10)` | `rgb(148, 96, 10)` | 0 |
| 文字 | fontSize | `12px` | `12px` | 0 |
| 文字 | fontWeight | `600` | `600` | 0 |
| 文字 | letterSpacing | `normal` | `normal` | 0 |
| 文字 | lineHeight | `18px` | `18px` | 0 |
| 点 | backgroundColor | `rgb(148, 96, 10)` | `rgb(148, 96, 10)` | 0 |
| 点 | borderBottomLeftRadius | `50%` | `50%` | 0 |
| 点 | borderBottomRightRadius | `50%` | `50%` | 0 |
| 点 | borderBottomWidth | `0px` | `0px` | 0 |
| 点 | borderLeftWidth | `0px` | `0px` | 0 |
| 点 | borderRightWidth | `0px` | `0px` | 0 |
| 点 | borderTopLeftRadius | `50%` | `50%` | 0 |
| 点 | borderTopRightRadius | `50%` | `50%` | 0 |
| 点 | borderTopWidth | `0px` | `0px` | 0 |
| 点 | boxShadow | `none` | `none` | 0 |
| 点 | columnGap | `normal` | `normal` | 0 |
| 点 | height | `6px` | `6px` | 0 |
| 点 | outlineOffset | `0px` | `0px` | 0 |
| 点 | outlineStyle | `none` | `none` | 0 |
| 点 | outlineWidth | `3px` | `3px` | 0 |
| 点 | paddingBottom | `0px` | `0px` | 0 |
| 点 | paddingLeft | `0px` | `0px` | 0 |
| 点 | paddingRight | `0px` | `0px` | 0 |
| 点 | paddingTop | `0px` | `0px` | 0 |
| 点 | rowGap | `normal` | `normal` | 0 |
| 点 | width | `6px` | `6px` | 0 |

### XwfSH 状態・未対応

| 要素 | 属性 | 絵 | 実装 | 差 |
|---|---|---|---|---|
| 本体 | backgroundColor | `rgb(254, 240, 240)` | `rgb(254, 240, 240)` | 0 |
| 本体 | borderBottomLeftRadius | `999px` | `999px` | 0 |
| 本体 | borderBottomRightRadius | `999px` | `999px` | 0 |
| 本体 | borderBottomWidth | `0px` | `0px` | 0 |
| 本体 | borderLeftWidth | `0px` | `0px` | 0 |
| 本体 | borderRightWidth | `0px` | `0px` | 0 |
| 本体 | borderTopLeftRadius | `999px` | `999px` | 0 |
| 本体 | borderTopRightRadius | `999px` | `999px` | 0 |
| 本体 | borderTopWidth | `0px` | `0px` | 0 |
| 本体 | boxShadow | `none` | `none` | 0 |
| 本体 | columnGap | `5px` | `5px` | 0 |
| 本体 | height | `22px` | `22px` | 0 |
| 本体 | outlineOffset | `0px` | `0px` | 0 |
| 本体 | outlineStyle | `none` | `none` | 0 |
| 本体 | outlineWidth | `3px` | `3px` | 0 |
| 本体 | paddingBottom | `2px` | `2px` | 0 |
| 本体 | paddingLeft | `8px` | `8px` | 0 |
| 本体 | paddingRight | `8px` | `8px` | 0 |
| 本体 | paddingTop | `2px` | `2px` | 0 |
| 本体 | rowGap | `5px` | `5px` | 0 |
| 本体 | width | `63px` | `63px` | 0 |
| 文字 | color | `rgb(179, 38, 30)` | `rgb(179, 38, 30)` | 0 |
| 文字 | fontSize | `12px` | `12px` | 0 |
| 文字 | fontWeight | `600` | `600` | 0 |
| 文字 | letterSpacing | `normal` | `normal` | 0 |
| 文字 | lineHeight | `18px` | `18px` | 0 |
| 点 | backgroundColor | `rgb(179, 38, 30)` | `rgb(179, 38, 30)` | 0 |
| 点 | borderBottomLeftRadius | `50%` | `50%` | 0 |
| 点 | borderBottomRightRadius | `50%` | `50%` | 0 |
| 点 | borderBottomWidth | `0px` | `0px` | 0 |
| 点 | borderLeftWidth | `0px` | `0px` | 0 |
| 点 | borderRightWidth | `0px` | `0px` | 0 |
| 点 | borderTopLeftRadius | `50%` | `50%` | 0 |
| 点 | borderTopRightRadius | `50%` | `50%` | 0 |
| 点 | borderTopWidth | `0px` | `0px` | 0 |
| 点 | boxShadow | `none` | `none` | 0 |
| 点 | columnGap | `normal` | `normal` | 0 |
| 点 | height | `6px` | `6px` | 0 |
| 点 | outlineOffset | `0px` | `0px` | 0 |
| 点 | outlineStyle | `none` | `none` | 0 |
| 点 | outlineWidth | `3px` | `3px` | 0 |
| 点 | paddingBottom | `0px` | `0px` | 0 |
| 点 | paddingLeft | `0px` | `0px` | 0 |
| 点 | paddingRight | `0px` | `0px` | 0 |
| 点 | paddingTop | `0px` | `0px` | 0 |
| 点 | rowGap | `normal` | `normal` | 0 |
| 点 | width | `6px` | `6px` | 0 |

### hQeAo 状態・下書き

| 要素 | 属性 | 絵 | 実装 | 差 |
|---|---|---|---|---|
| 本体 | backgroundColor | `rgb(241, 242, 244)` | `rgb(241, 242, 244)` | 0 |
| 本体 | borderBottomLeftRadius | `999px` | `999px` | 0 |
| 本体 | borderBottomRightRadius | `999px` | `999px` | 0 |
| 本体 | borderBottomWidth | `0px` | `0px` | 0 |
| 本体 | borderLeftWidth | `0px` | `0px` | 0 |
| 本体 | borderRightWidth | `0px` | `0px` | 0 |
| 本体 | borderTopLeftRadius | `999px` | `999px` | 0 |
| 本体 | borderTopRightRadius | `999px` | `999px` | 0 |
| 本体 | borderTopWidth | `0px` | `0px` | 0 |
| 本体 | boxShadow | `none` | `none` | 0 |
| 本体 | columnGap | `5px` | `5px` | 0 |
| 本体 | height | `22px` | `22px` | 0 |
| 本体 | outlineOffset | `0px` | `0px` | 0 |
| 本体 | outlineStyle | `none` | `none` | 0 |
| 本体 | outlineWidth | `3px` | `3px` | 0 |
| 本体 | paddingBottom | `2px` | `2px` | 0 |
| 本体 | paddingLeft | `8px` | `8px` | 0 |
| 本体 | paddingRight | `8px` | `8px` | 0 |
| 本体 | paddingTop | `2px` | `2px` | 0 |
| 本体 | rowGap | `5px` | `5px` | 0 |
| 本体 | width | `63px` | `63px` | 0 |
| 文字 | color | `rgb(74, 85, 101)` | `rgb(74, 85, 101)` | 0 |
| 文字 | fontSize | `12px` | `12px` | 0 |
| 文字 | fontWeight | `600` | `600` | 0 |
| 文字 | letterSpacing | `normal` | `normal` | 0 |
| 文字 | lineHeight | `18px` | `18px` | 0 |
| 点 | backgroundColor | `rgb(74, 85, 101)` | `rgb(74, 85, 101)` | 0 |
| 点 | borderBottomLeftRadius | `50%` | `50%` | 0 |
| 点 | borderBottomRightRadius | `50%` | `50%` | 0 |
| 点 | borderBottomWidth | `0px` | `0px` | 0 |
| 点 | borderLeftWidth | `0px` | `0px` | 0 |
| 点 | borderRightWidth | `0px` | `0px` | 0 |
| 点 | borderTopLeftRadius | `50%` | `50%` | 0 |
| 点 | borderTopRightRadius | `50%` | `50%` | 0 |
| 点 | borderTopWidth | `0px` | `0px` | 0 |
| 点 | boxShadow | `none` | `none` | 0 |
| 点 | columnGap | `normal` | `normal` | 0 |
| 点 | height | `6px` | `6px` | 0 |
| 点 | outlineOffset | `0px` | `0px` | 0 |
| 点 | outlineStyle | `none` | `none` | 0 |
| 点 | outlineWidth | `3px` | `3px` | 0 |
| 点 | paddingBottom | `0px` | `0px` | 0 |
| 点 | paddingLeft | `0px` | `0px` | 0 |
| 点 | paddingRight | `0px` | `0px` | 0 |
| 点 | paddingTop | `0px` | `0px` | 0 |
| 点 | rowGap | `normal` | `normal` | 0 |
| 点 | width | `6px` | `6px` | 0 |

### C6DGX 増減・良い

| 要素 | 属性 | 絵 | 実装 | 差 |
|---|---|---|---|---|
| 本体 | backgroundColor | `rgb(232, 248, 238)` | `rgb(232, 248, 238)` | 0 |
| 本体 | borderBottomLeftRadius | `6px` | `6px` | 0 |
| 本体 | borderBottomRightRadius | `6px` | `6px` | 0 |
| 本体 | borderBottomWidth | `0px` | `0px` | 0 |
| 本体 | borderLeftWidth | `0px` | `0px` | 0 |
| 本体 | borderRightWidth | `0px` | `0px` | 0 |
| 本体 | borderTopLeftRadius | `6px` | `6px` | 0 |
| 本体 | borderTopRightRadius | `6px` | `6px` | 0 |
| 本体 | borderTopWidth | `0px` | `0px` | 0 |
| 本体 | boxShadow | `none` | `none` | 0 |
| 本体 | columnGap | `3px` | `3px` | 0 |
| 本体 | height | `22px` | `22px` | 0 |
| 本体 | outlineOffset | `0px` | `0px` | 0 |
| 本体 | outlineStyle | `none` | `none` | 0 |
| 本体 | outlineWidth | `3px` | `3px` | 0 |
| 本体 | paddingBottom | `2px` | `2px` | 0 |
| 本体 | paddingLeft | `7px` | `7px` | 0 |
| 本体 | paddingRight | `7px` | `7px` | 0 |
| 本体 | paddingTop | `2px` | `2px` | 0 |
| 本体 | rowGap | `3px` | `3px` | 0 |
| 本体 | width | `67.4688px` | `67.4688px` | 0 |
| 文字 | color | `rgb(4, 120, 51)` | `rgb(4, 120, 51)` | 0 |
| 文字 | fontSize | `12px` | `12px` | 0 |
| 文字 | fontWeight | `600` | `600` | 0 |
| 文字 | letterSpacing | `normal` | `normal` | 0 |
| 文字 | lineHeight | `18px` | `18px` | 0 |
| アイコン | backgroundColor | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | 0 |
| アイコン | borderBottomLeftRadius | `0px` | `0px` | 0 |
| アイコン | borderBottomRightRadius | `0px` | `0px` | 0 |
| アイコン | borderBottomWidth | `0px` | `0px` | 0 |
| アイコン | borderLeftWidth | `0px` | `0px` | 0 |
| アイコン | borderRightWidth | `0px` | `0px` | 0 |
| アイコン | borderTopLeftRadius | `0px` | `0px` | 0 |
| アイコン | borderTopRightRadius | `0px` | `0px` | 0 |
| アイコン | borderTopWidth | `0px` | `0px` | 0 |
| アイコン | boxShadow | `none` | `none` | 0 |
| アイコン | columnGap | `normal` | `normal` | 0 |
| アイコン | height | `12px` | `12px` | 0 |
| アイコン | outlineOffset | `0px` | `0px` | 0 |
| アイコン | outlineStyle | `none` | `none` | 0 |
| アイコン | outlineWidth | `3px` | `3px` | 0 |
| アイコン | paddingBottom | `0px` | `0px` | 0 |
| アイコン | paddingLeft | `0px` | `0px` | 0 |
| アイコン | paddingRight | `0px` | `0px` | 0 |
| アイコン | paddingTop | `0px` | `0px` | 0 |
| アイコン | rowGap | `normal` | `normal` | 0 |
| アイコン | width | `12px` | `12px` | 0 |

### OEQxt 増減・悪い

| 要素 | 属性 | 絵 | 実装 | 差 |
|---|---|---|---|---|
| 本体 | backgroundColor | `rgb(254, 240, 240)` | `rgb(254, 240, 240)` | 0 |
| 本体 | borderBottomLeftRadius | `6px` | `6px` | 0 |
| 本体 | borderBottomRightRadius | `6px` | `6px` | 0 |
| 本体 | borderBottomWidth | `0px` | `0px` | 0 |
| 本体 | borderLeftWidth | `0px` | `0px` | 0 |
| 本体 | borderRightWidth | `0px` | `0px` | 0 |
| 本体 | borderTopLeftRadius | `6px` | `6px` | 0 |
| 本体 | borderTopRightRadius | `6px` | `6px` | 0 |
| 本体 | borderTopWidth | `0px` | `0px` | 0 |
| 本体 | boxShadow | `none` | `none` | 0 |
| 本体 | columnGap | `3px` | `3px` | 0 |
| 本体 | height | `22px` | `22px` | 0 |
| 本体 | outlineOffset | `0px` | `0px` | 0 |
| 本体 | outlineStyle | `none` | `none` | 0 |
| 本体 | outlineWidth | `3px` | `3px` | 0 |
| 本体 | paddingBottom | `2px` | `2px` | 0 |
| 本体 | paddingLeft | `7px` | `7px` | 0 |
| 本体 | paddingRight | `7px` | `7px` | 0 |
| 本体 | paddingTop | `2px` | `2px` | 0 |
| 本体 | rowGap | `3px` | `3px` | 0 |
| 本体 | width | `61.7188px` | `61.7188px` | 0 |
| 文字 | color | `rgb(179, 38, 30)` | `rgb(179, 38, 30)` | 0 |
| 文字 | fontSize | `12px` | `12px` | 0 |
| 文字 | fontWeight | `600` | `600` | 0 |
| 文字 | letterSpacing | `normal` | `normal` | 0 |
| 文字 | lineHeight | `18px` | `18px` | 0 |
| アイコン | backgroundColor | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | 0 |
| アイコン | borderBottomLeftRadius | `0px` | `0px` | 0 |
| アイコン | borderBottomRightRadius | `0px` | `0px` | 0 |
| アイコン | borderBottomWidth | `0px` | `0px` | 0 |
| アイコン | borderLeftWidth | `0px` | `0px` | 0 |
| アイコン | borderRightWidth | `0px` | `0px` | 0 |
| アイコン | borderTopLeftRadius | `0px` | `0px` | 0 |
| アイコン | borderTopRightRadius | `0px` | `0px` | 0 |
| アイコン | borderTopWidth | `0px` | `0px` | 0 |
| アイコン | boxShadow | `none` | `none` | 0 |
| アイコン | columnGap | `normal` | `normal` | 0 |
| アイコン | height | `12px` | `12px` | 0 |
| アイコン | outlineOffset | `0px` | `0px` | 0 |
| アイコン | outlineStyle | `none` | `none` | 0 |
| アイコン | outlineWidth | `3px` | `3px` | 0 |
| アイコン | paddingBottom | `0px` | `0px` | 0 |
| アイコン | paddingLeft | `0px` | `0px` | 0 |
| アイコン | paddingRight | `0px` | `0px` | 0 |
| アイコン | paddingTop | `0px` | `0px` | 0 |
| アイコン | rowGap | `normal` | `normal` | 0 |
| アイコン | width | `12px` | `12px` | 0 |

### r9qfM2 増減・要確認

| 要素 | 属性 | 絵 | 実装 | 差 |
|---|---|---|---|---|
| 本体 | backgroundColor | `rgb(253, 243, 225)` | `rgb(253, 243, 225)` | 0 |
| 本体 | borderBottomLeftRadius | `6px` | `6px` | 0 |
| 本体 | borderBottomRightRadius | `6px` | `6px` | 0 |
| 本体 | borderBottomWidth | `0px` | `0px` | 0 |
| 本体 | borderLeftWidth | `0px` | `0px` | 0 |
| 本体 | borderRightWidth | `0px` | `0px` | 0 |
| 本体 | borderTopLeftRadius | `6px` | `6px` | 0 |
| 本体 | borderTopRightRadius | `6px` | `6px` | 0 |
| 本体 | borderTopWidth | `0px` | `0px` | 0 |
| 本体 | boxShadow | `none` | `none` | 0 |
| 本体 | columnGap | `3px` | `3px` | 0 |
| 本体 | height | `22px` | `22px` | 0 |
| 本体 | outlineOffset | `0px` | `0px` | 0 |
| 本体 | outlineStyle | `none` | `none` | 0 |
| 本体 | outlineWidth | `3px` | `3px` | 0 |
| 本体 | paddingBottom | `2px` | `2px` | 0 |
| 本体 | paddingLeft | `7px` | `7px` | 0 |
| 本体 | paddingRight | `7px` | `7px` | 0 |
| 本体 | paddingTop | `2px` | `2px` | 0 |
| 本体 | rowGap | `3px` | `3px` | 0 |
| 本体 | width | `50px` | `50px` | 0 |
| 文字 | color | `rgb(148, 96, 10)` | `rgb(148, 96, 10)` | 0 |
| 文字 | fontSize | `12px` | `12px` | 0 |
| 文字 | fontWeight | `600` | `600` | 0 |
| 文字 | letterSpacing | `normal` | `normal` | 0 |
| 文字 | lineHeight | `18px` | `18px` | 0 |

### h7Ch3y タグ

| 要素 | 属性 | 絵 | 実装 | 差 |
|---|---|---|---|---|
| 本体 | backgroundColor | `rgb(255, 255, 255)` | `rgb(255, 255, 255)` | 0 |
| 本体 | borderBottomLeftRadius | `6px` | `6px` | 0 |
| 本体 | borderBottomRightRadius | `6px` | `6px` | 0 |
| 本体 | borderBottomWidth | `0px` | `0px` | 0 |
| 本体 | borderLeftWidth | `0px` | `0px` | 0 |
| 本体 | borderRightWidth | `0px` | `0px` | 0 |
| 本体 | borderTopLeftRadius | `6px` | `6px` | 0 |
| 本体 | borderTopRightRadius | `6px` | `6px` | 0 |
| 本体 | borderTopWidth | `0px` | `0px` | 0 |
| 本体 | boxShadow | `none` | `none` | 0 |
| 本体 | columnGap | `0px` | `0px` | 0 |
| 本体 | height | `22px` | `22px` | 0 |
| 本体 | outlineColor | `rgb(218, 221, 226)` | `rgb(218, 221, 226)` | 0 |
| 本体 | outlineOffset | `-1px` | `-1px` | 0 |
| 本体 | outlineStyle | `solid` | `solid` | 0 |
| 本体 | outlineWidth | `1px` | `1px` | 0 |
| 本体 | paddingBottom | `2px` | `2px` | 0 |
| 本体 | paddingLeft | `8px` | `8px` | 0 |
| 本体 | paddingRight | `8px` | `8px` | 0 |
| 本体 | paddingTop | `2px` | `2px` | 0 |
| 本体 | rowGap | `0px` | `0px` | 0 |
| 本体 | width | `52px` | `52px` | 0 |
| 文字 | color | `rgb(74, 85, 101)` | `rgb(74, 85, 101)` | 0 |
| 文字 | fontSize | `12px` | `12px` | 0 |
| 文字 | fontWeight | `400` | `400` | 0 |
| 文字 | letterSpacing | `normal` | `normal` | 0 |
| 文字 | lineHeight | `18px` | `18px` | 0 |

### HNps2 経路

| 要素 | 属性 | 絵 | 実装 | 差 |
|---|---|---|---|---|
| 本体 | backgroundColor | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | 0 |
| 本体 | borderBottomLeftRadius | `5px` | `5px` | 0 |
| 本体 | borderBottomRightRadius | `5px` | `5px` | 0 |
| 本体 | borderBottomWidth | `0px` | `0px` | 0 |
| 本体 | borderLeftWidth | `0px` | `0px` | 0 |
| 本体 | borderRightWidth | `0px` | `0px` | 0 |
| 本体 | borderTopLeftRadius | `5px` | `5px` | 0 |
| 本体 | borderTopRightRadius | `5px` | `5px` | 0 |
| 本体 | borderTopWidth | `0px` | `0px` | 0 |
| 本体 | boxShadow | `none` | `none` | 0 |
| 本体 | columnGap | `0px` | `0px` | 0 |
| 本体 | height | `19px` | `19px` | 0 |
| 本体 | outlineColor | `rgb(218, 221, 226)` | `rgb(218, 221, 226)` | 0 |
| 本体 | outlineOffset | `-1px` | `-1px` | 0 |
| 本体 | outlineStyle | `solid` | `solid` | 0 |
| 本体 | outlineWidth | `1px` | `1px` | 0 |
| 本体 | paddingBottom | `1px` | `1px` | 0 |
| 本体 | paddingLeft | `6px` | `6px` | 0 |
| 本体 | paddingRight | `6px` | `6px` | 0 |
| 本体 | paddingTop | `1px` | `1px` | 0 |
| 本体 | rowGap | `0px` | `0px` | 0 |
| 本体 | width | `36.6094px` | `36.6094px` | 0 |
| 文字 | color | `rgb(74, 85, 101)` | `rgb(74, 85, 101)` | 0 |
| 文字 | fontSize | `11px` | `11px` | 0 |
| 文字 | fontWeight | `600` | `600` | 0 |
| 文字 | letterSpacing | `normal` | `normal` | 0 |
| 文字 | lineHeight | `17px` | `17px` | 0 |

### zcGgI 注目の星・オフ

| 要素 | 属性 | 絵 | 実装 | 差 |
|---|---|---|---|---|
| 本体 | backgroundColor | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | 0 |
| 本体 | borderBottomLeftRadius | `0px` | `0px` | 0 |
| 本体 | borderBottomRightRadius | `0px` | `0px` | 0 |
| 本体 | borderBottomWidth | `0px` | `0px` | 0 |
| 本体 | borderLeftWidth | `0px` | `0px` | 0 |
| 本体 | borderRightWidth | `0px` | `0px` | 0 |
| 本体 | borderTopLeftRadius | `0px` | `0px` | 0 |
| 本体 | borderTopRightRadius | `0px` | `0px` | 0 |
| 本体 | borderTopWidth | `0px` | `0px` | 0 |
| 本体 | boxShadow | `none` | `none` | 0 |
| 本体 | columnGap | `0px` | `0px` | 0 |
| 本体 | height | `24px` | `24px` | 0 |
| 本体 | outlineOffset | `0px` | `0px` | 0 |
| 本体 | outlineStyle | `none` | `none` | 0 |
| 本体 | outlineWidth | `3px` | `3px` | 0 |
| 本体 | paddingBottom | `0px` | `0px` | 0 |
| 本体 | paddingLeft | `0px` | `0px` | 0 |
| 本体 | paddingRight | `0px` | `0px` | 0 |
| 本体 | paddingTop | `0px` | `0px` | 0 |
| 本体 | rowGap | `0px` | `0px` | 0 |
| 本体 | width | `24px` | `24px` | 0 |
| アイコン | backgroundColor | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | 0 |
| アイコン | borderBottomLeftRadius | `0px` | `0px` | 0 |
| アイコン | borderBottomRightRadius | `0px` | `0px` | 0 |
| アイコン | borderBottomWidth | `0px` | `0px` | 0 |
| アイコン | borderLeftWidth | `0px` | `0px` | 0 |
| アイコン | borderRightWidth | `0px` | `0px` | 0 |
| アイコン | borderTopLeftRadius | `0px` | `0px` | 0 |
| アイコン | borderTopRightRadius | `0px` | `0px` | 0 |
| アイコン | borderTopWidth | `0px` | `0px` | 0 |
| アイコン | boxShadow | `none` | `none` | 0 |
| アイコン | columnGap | `normal` | `normal` | 0 |
| アイコン | height | `18px` | `18px` | 0 |
| アイコン | outlineOffset | `0px` | `0px` | 0 |
| アイコン | outlineStyle | `none` | `none` | 0 |
| アイコン | outlineWidth | `3px` | `3px` | 0 |
| アイコン | paddingBottom | `0px` | `0px` | 0 |
| アイコン | paddingLeft | `0px` | `0px` | 0 |
| アイコン | paddingRight | `0px` | `0px` | 0 |
| アイコン | paddingTop | `0px` | `0px` | 0 |
| アイコン | rowGap | `normal` | `normal` | 0 |
| アイコン | width | `18px` | `18px` | 0 |

### w0R1PQ 注目の星・オン

| 要素 | 属性 | 絵 | 実装 | 差 |
|---|---|---|---|---|
| 本体 | backgroundColor | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | 0 |
| 本体 | borderBottomLeftRadius | `0px` | `0px` | 0 |
| 本体 | borderBottomRightRadius | `0px` | `0px` | 0 |
| 本体 | borderBottomWidth | `0px` | `0px` | 0 |
| 本体 | borderLeftWidth | `0px` | `0px` | 0 |
| 本体 | borderRightWidth | `0px` | `0px` | 0 |
| 本体 | borderTopLeftRadius | `0px` | `0px` | 0 |
| 本体 | borderTopRightRadius | `0px` | `0px` | 0 |
| 本体 | borderTopWidth | `0px` | `0px` | 0 |
| 本体 | boxShadow | `none` | `none` | 0 |
| 本体 | columnGap | `0px` | `0px` | 0 |
| 本体 | height | `24px` | `24px` | 0 |
| 本体 | outlineOffset | `0px` | `0px` | 0 |
| 本体 | outlineStyle | `none` | `none` | 0 |
| 本体 | outlineWidth | `3px` | `3px` | 0 |
| 本体 | paddingBottom | `0px` | `0px` | 0 |
| 本体 | paddingLeft | `0px` | `0px` | 0 |
| 本体 | paddingRight | `0px` | `0px` | 0 |
| 本体 | paddingTop | `0px` | `0px` | 0 |
| 本体 | rowGap | `0px` | `0px` | 0 |
| 本体 | width | `24px` | `24px` | 0 |
| アイコン | backgroundColor | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | 0 |
| アイコン | borderBottomLeftRadius | `0px` | `0px` | 0 |
| アイコン | borderBottomRightRadius | `0px` | `0px` | 0 |
| アイコン | borderBottomWidth | `0px` | `0px` | 0 |
| アイコン | borderLeftWidth | `0px` | `0px` | 0 |
| アイコン | borderRightWidth | `0px` | `0px` | 0 |
| アイコン | borderTopLeftRadius | `0px` | `0px` | 0 |
| アイコン | borderTopRightRadius | `0px` | `0px` | 0 |
| アイコン | borderTopWidth | `0px` | `0px` | 0 |
| アイコン | boxShadow | `none` | `none` | 0 |
| アイコン | columnGap | `normal` | `normal` | 0 |
| アイコン | height | `18px` | `18px` | 0 |
| アイコン | outlineOffset | `0px` | `0px` | 0 |
| アイコン | outlineStyle | `none` | `none` | 0 |
| アイコン | outlineWidth | `3px` | `3px` | 0 |
| アイコン | paddingBottom | `0px` | `0px` | 0 |
| アイコン | paddingLeft | `0px` | `0px` | 0 |
| アイコン | paddingRight | `0px` | `0px` | 0 |
| アイコン | paddingTop | `0px` | `0px` | 0 |
| アイコン | rowGap | `normal` | `normal` | 0 |
| アイコン | width | `18px` | `18px` | 0 |

### MFTlt 顔・小

| 要素 | 属性 | 絵 | 実装 | 差 |
|---|---|---|---|---|
| 本体 | backgroundColor | `rgb(243, 236, 251)` | `rgb(243, 236, 251)` | 0 |
| 本体 | borderBottomLeftRadius | `999px` | `999px` | 0 |
| 本体 | borderBottomRightRadius | `999px` | `999px` | 0 |
| 本体 | borderBottomWidth | `0px` | `0px` | 0 |
| 本体 | borderLeftWidth | `0px` | `0px` | 0 |
| 本体 | borderRightWidth | `0px` | `0px` | 0 |
| 本体 | borderTopLeftRadius | `999px` | `999px` | 0 |
| 本体 | borderTopRightRadius | `999px` | `999px` | 0 |
| 本体 | borderTopWidth | `0px` | `0px` | 0 |
| 本体 | boxShadow | `none` | `none` | 0 |
| 本体 | columnGap | `0px` | `0px` | 0 |
| 本体 | height | `28px` | `28px` | 0 |
| 本体 | outlineOffset | `0px` | `0px` | 0 |
| 本体 | outlineStyle | `none` | `none` | 0 |
| 本体 | outlineWidth | `3px` | `3px` | 0 |
| 本体 | paddingBottom | `0px` | `0px` | 0 |
| 本体 | paddingLeft | `0px` | `0px` | 0 |
| 本体 | paddingRight | `0px` | `0px` | 0 |
| 本体 | paddingTop | `0px` | `0px` | 0 |
| 本体 | rowGap | `0px` | `0px` | 0 |
| 本体 | width | `28px` | `28px` | 0 |
| 文字 | color | `rgb(107, 63, 160)` | `rgb(107, 63, 160)` | 0 |
| 文字 | fontSize | `11px` | `11px` | 0 |
| 文字 | fontWeight | `600` | `600` | 0 |
| 文字 | letterSpacing | `normal` | `normal` | 0 |
| 文字 | lineHeight | `17px` | `17px` | 0 |

### pDKi6 顔・中

| 要素 | 属性 | 絵 | 実装 | 差 |
|---|---|---|---|---|
| 本体 | backgroundColor | `rgb(243, 236, 251)` | `rgb(243, 236, 251)` | 0 |
| 本体 | borderBottomLeftRadius | `999px` | `999px` | 0 |
| 本体 | borderBottomRightRadius | `999px` | `999px` | 0 |
| 本体 | borderBottomWidth | `0px` | `0px` | 0 |
| 本体 | borderLeftWidth | `0px` | `0px` | 0 |
| 本体 | borderRightWidth | `0px` | `0px` | 0 |
| 本体 | borderTopLeftRadius | `999px` | `999px` | 0 |
| 本体 | borderTopRightRadius | `999px` | `999px` | 0 |
| 本体 | borderTopWidth | `0px` | `0px` | 0 |
| 本体 | boxShadow | `none` | `none` | 0 |
| 本体 | columnGap | `0px` | `0px` | 0 |
| 本体 | height | `34px` | `34px` | 0 |
| 本体 | outlineOffset | `0px` | `0px` | 0 |
| 本体 | outlineStyle | `none` | `none` | 0 |
| 本体 | outlineWidth | `3px` | `3px` | 0 |
| 本体 | paddingBottom | `0px` | `0px` | 0 |
| 本体 | paddingLeft | `0px` | `0px` | 0 |
| 本体 | paddingRight | `0px` | `0px` | 0 |
| 本体 | paddingTop | `0px` | `0px` | 0 |
| 本体 | rowGap | `0px` | `0px` | 0 |
| 本体 | width | `34px` | `34px` | 0 |
| 文字 | color | `rgb(107, 63, 160)` | `rgb(107, 63, 160)` | 0 |
| 文字 | fontSize | `14px` | `14px` | 0 |
| 文字 | fontWeight | `600` | `600` | 0 |
| 文字 | letterSpacing | `normal` | `normal` | 0 |
| 文字 | lineHeight | `21px` | `21px` | 0 |

### zjEbn 顔・大

| 要素 | 属性 | 絵 | 実装 | 差 |
|---|---|---|---|---|
| 本体 | backgroundColor | `rgb(243, 236, 251)` | `rgb(243, 236, 251)` | 0 |
| 本体 | borderBottomLeftRadius | `999px` | `999px` | 0 |
| 本体 | borderBottomRightRadius | `999px` | `999px` | 0 |
| 本体 | borderBottomWidth | `0px` | `0px` | 0 |
| 本体 | borderLeftWidth | `0px` | `0px` | 0 |
| 本体 | borderRightWidth | `0px` | `0px` | 0 |
| 本体 | borderTopLeftRadius | `999px` | `999px` | 0 |
| 本体 | borderTopRightRadius | `999px` | `999px` | 0 |
| 本体 | borderTopWidth | `0px` | `0px` | 0 |
| 本体 | boxShadow | `none` | `none` | 0 |
| 本体 | columnGap | `0px` | `0px` | 0 |
| 本体 | height | `52px` | `52px` | 0 |
| 本体 | outlineOffset | `0px` | `0px` | 0 |
| 本体 | outlineStyle | `none` | `none` | 0 |
| 本体 | outlineWidth | `3px` | `3px` | 0 |
| 本体 | paddingBottom | `0px` | `0px` | 0 |
| 本体 | paddingLeft | `0px` | `0px` | 0 |
| 本体 | paddingRight | `0px` | `0px` | 0 |
| 本体 | paddingTop | `0px` | `0px` | 0 |
| 本体 | rowGap | `0px` | `0px` | 0 |
| 本体 | width | `52px` | `52px` | 0 |
| 文字 | color | `rgb(107, 63, 160)` | `rgb(107, 63, 160)` | 0 |
| 文字 | fontSize | `21px` | `21px` | 0 |
| 文字 | fontWeight | `600` | `600` | 0 |
| 文字 | letterSpacing | `normal` | `normal` | 0 |
| 文字 | lineHeight | `32px` | `32px` | 0 |

### C9CaMS 印のタイル・小

| 要素 | 属性 | 絵 | 実装 | 差 |
|---|---|---|---|---|
| 本体 | backgroundColor | `rgb(255, 255, 255)` | `rgb(255, 255, 255)` | 0 |
| 本体 | borderBottomLeftRadius | `7px` | `7px` | 0 |
| 本体 | borderBottomRightRadius | `7px` | `7px` | 0 |
| 本体 | borderBottomWidth | `0px` | `0px` | 0 |
| 本体 | borderLeftWidth | `0px` | `0px` | 0 |
| 本体 | borderRightWidth | `0px` | `0px` | 0 |
| 本体 | borderTopLeftRadius | `7px` | `7px` | 0 |
| 本体 | borderTopRightRadius | `7px` | `7px` | 0 |
| 本体 | borderTopWidth | `0px` | `0px` | 0 |
| 本体 | boxShadow | `none` | `none` | 0 |
| 本体 | columnGap | `0px` | `0px` | 0 |
| 本体 | height | `22px` | `22px` | 0 |
| 本体 | outlineColor | `rgb(218, 221, 226)` | `rgb(218, 221, 226)` | 0 |
| 本体 | outlineOffset | `-1px` | `-1px` | 0 |
| 本体 | outlineStyle | `solid` | `solid` | 0 |
| 本体 | outlineWidth | `1px` | `1px` | 0 |
| 本体 | paddingBottom | `0px` | `0px` | 0 |
| 本体 | paddingLeft | `0px` | `0px` | 0 |
| 本体 | paddingRight | `0px` | `0px` | 0 |
| 本体 | paddingTop | `0px` | `0px` | 0 |
| 本体 | rowGap | `0px` | `0px` | 0 |
| 本体 | width | `22px` | `22px` | 0 |
| アイコン | backgroundColor | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | 0 |
| アイコン | borderBottomLeftRadius | `0px` | `0px` | 0 |
| アイコン | borderBottomRightRadius | `0px` | `0px` | 0 |
| アイコン | borderBottomWidth | `0px` | `0px` | 0 |
| アイコン | borderLeftWidth | `0px` | `0px` | 0 |
| アイコン | borderRightWidth | `0px` | `0px` | 0 |
| アイコン | borderTopLeftRadius | `0px` | `0px` | 0 |
| アイコン | borderTopRightRadius | `0px` | `0px` | 0 |
| アイコン | borderTopWidth | `0px` | `0px` | 0 |
| アイコン | boxShadow | `none` | `none` | 0 |
| アイコン | columnGap | `normal` | `normal` | 0 |
| アイコン | height | `11px` | `11px` | 0 |
| アイコン | outlineOffset | `0px` | `0px` | 0 |
| アイコン | outlineStyle | `none` | `none` | 0 |
| アイコン | outlineWidth | `3px` | `3px` | 0 |
| アイコン | paddingBottom | `0px` | `0px` | 0 |
| アイコン | paddingLeft | `0px` | `0px` | 0 |
| アイコン | paddingRight | `0px` | `0px` | 0 |
| アイコン | paddingTop | `0px` | `0px` | 0 |
| アイコン | rowGap | `normal` | `normal` | 0 |
| アイコン | width | `11px` | `11px` | 0 |

### E7USZ9 印のタイル・中

| 要素 | 属性 | 絵 | 実装 | 差 |
|---|---|---|---|---|
| 本体 | backgroundColor | `rgb(255, 255, 255)` | `rgb(255, 255, 255)` | 0 |
| 本体 | borderBottomLeftRadius | `9px` | `9px` | 0 |
| 本体 | borderBottomRightRadius | `9px` | `9px` | 0 |
| 本体 | borderBottomWidth | `0px` | `0px` | 0 |
| 本体 | borderLeftWidth | `0px` | `0px` | 0 |
| 本体 | borderRightWidth | `0px` | `0px` | 0 |
| 本体 | borderTopLeftRadius | `9px` | `9px` | 0 |
| 本体 | borderTopRightRadius | `9px` | `9px` | 0 |
| 本体 | borderTopWidth | `0px` | `0px` | 0 |
| 本体 | boxShadow | `none` | `none` | 0 |
| 本体 | columnGap | `0px` | `0px` | 0 |
| 本体 | height | `28px` | `28px` | 0 |
| 本体 | outlineColor | `rgb(218, 221, 226)` | `rgb(218, 221, 226)` | 0 |
| 本体 | outlineOffset | `-1px` | `-1px` | 0 |
| 本体 | outlineStyle | `solid` | `solid` | 0 |
| 本体 | outlineWidth | `1px` | `1px` | 0 |
| 本体 | paddingBottom | `0px` | `0px` | 0 |
| 本体 | paddingLeft | `0px` | `0px` | 0 |
| 本体 | paddingRight | `0px` | `0px` | 0 |
| 本体 | paddingTop | `0px` | `0px` | 0 |
| 本体 | rowGap | `0px` | `0px` | 0 |
| 本体 | width | `28px` | `28px` | 0 |
| アイコン | backgroundColor | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | 0 |
| アイコン | borderBottomLeftRadius | `0px` | `0px` | 0 |
| アイコン | borderBottomRightRadius | `0px` | `0px` | 0 |
| アイコン | borderBottomWidth | `0px` | `0px` | 0 |
| アイコン | borderLeftWidth | `0px` | `0px` | 0 |
| アイコン | borderRightWidth | `0px` | `0px` | 0 |
| アイコン | borderTopLeftRadius | `0px` | `0px` | 0 |
| アイコン | borderTopRightRadius | `0px` | `0px` | 0 |
| アイコン | borderTopWidth | `0px` | `0px` | 0 |
| アイコン | boxShadow | `none` | `none` | 0 |
| アイコン | columnGap | `normal` | `normal` | 0 |
| アイコン | height | `15px` | `15px` | 0 |
| アイコン | outlineOffset | `0px` | `0px` | 0 |
| アイコン | outlineStyle | `none` | `none` | 0 |
| アイコン | outlineWidth | `3px` | `3px` | 0 |
| アイコン | paddingBottom | `0px` | `0px` | 0 |
| アイコン | paddingLeft | `0px` | `0px` | 0 |
| アイコン | paddingRight | `0px` | `0px` | 0 |
| アイコン | paddingTop | `0px` | `0px` | 0 |
| アイコン | rowGap | `normal` | `normal` | 0 |
| アイコン | width | `15px` | `15px` | 0 |

### A2mryd 印のタイル・大

| 要素 | 属性 | 絵 | 実装 | 差 |
|---|---|---|---|---|
| 本体 | backgroundColor | `rgb(255, 255, 255)` | `rgb(255, 255, 255)` | 0 |
| 本体 | borderBottomLeftRadius | `9px` | `9px` | 0 |
| 本体 | borderBottomRightRadius | `9px` | `9px` | 0 |
| 本体 | borderBottomWidth | `0px` | `0px` | 0 |
| 本体 | borderLeftWidth | `0px` | `0px` | 0 |
| 本体 | borderRightWidth | `0px` | `0px` | 0 |
| 本体 | borderTopLeftRadius | `9px` | `9px` | 0 |
| 本体 | borderTopRightRadius | `9px` | `9px` | 0 |
| 本体 | borderTopWidth | `0px` | `0px` | 0 |
| 本体 | boxShadow | `none` | `none` | 0 |
| 本体 | columnGap | `0px` | `0px` | 0 |
| 本体 | height | `32px` | `32px` | 0 |
| 本体 | outlineColor | `rgb(218, 221, 226)` | `rgb(218, 221, 226)` | 0 |
| 本体 | outlineOffset | `-1px` | `-1px` | 0 |
| 本体 | outlineStyle | `solid` | `solid` | 0 |
| 本体 | outlineWidth | `1px` | `1px` | 0 |
| 本体 | paddingBottom | `0px` | `0px` | 0 |
| 本体 | paddingLeft | `0px` | `0px` | 0 |
| 本体 | paddingRight | `0px` | `0px` | 0 |
| 本体 | paddingTop | `0px` | `0px` | 0 |
| 本体 | rowGap | `0px` | `0px` | 0 |
| 本体 | width | `32px` | `32px` | 0 |
| アイコン | backgroundColor | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | 0 |
| アイコン | borderBottomLeftRadius | `0px` | `0px` | 0 |
| アイコン | borderBottomRightRadius | `0px` | `0px` | 0 |
| アイコン | borderBottomWidth | `0px` | `0px` | 0 |
| アイコン | borderLeftWidth | `0px` | `0px` | 0 |
| アイコン | borderRightWidth | `0px` | `0px` | 0 |
| アイコン | borderTopLeftRadius | `0px` | `0px` | 0 |
| アイコン | borderTopRightRadius | `0px` | `0px` | 0 |
| アイコン | borderTopWidth | `0px` | `0px` | 0 |
| アイコン | boxShadow | `none` | `none` | 0 |
| アイコン | columnGap | `normal` | `normal` | 0 |
| アイコン | height | `17px` | `17px` | 0 |
| アイコン | outlineOffset | `0px` | `0px` | 0 |
| アイコン | outlineStyle | `none` | `none` | 0 |
| アイコン | outlineWidth | `3px` | `3px` | 0 |
| アイコン | paddingBottom | `0px` | `0px` | 0 |
| アイコン | paddingLeft | `0px` | `0px` | 0 |
| アイコン | paddingRight | `0px` | `0px` | 0 |
| アイコン | paddingTop | `0px` | `0px` | 0 |
| アイコン | rowGap | `normal` | `normal` | 0 |
| アイコン | width | `17px` | `17px` | 0 |

### KjC1z ？

| 要素 | 属性 | 絵 | 実装 | 差 |
|---|---|---|---|---|
| 本体 | backgroundColor | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | 0 |
| 本体 | borderBottomLeftRadius | `999px` | `999px` | 0 |
| 本体 | borderBottomRightRadius | `999px` | `999px` | 0 |
| 本体 | borderBottomWidth | `0px` | `0px` | 0 |
| 本体 | borderLeftWidth | `0px` | `0px` | 0 |
| 本体 | borderRightWidth | `0px` | `0px` | 0 |
| 本体 | borderTopLeftRadius | `999px` | `999px` | 0 |
| 本体 | borderTopRightRadius | `999px` | `999px` | 0 |
| 本体 | borderTopWidth | `0px` | `0px` | 0 |
| 本体 | boxShadow | `none` | `none` | 0 |
| 本体 | columnGap | `0px` | `0px` | 0 |
| 本体 | height | `16px` | `16px` | 0 |
| 本体 | outlineColor | `rgb(98, 106, 115)` | `rgb(98, 106, 115)` | 0 |
| 本体 | outlineOffset | `-1px` | `-1px` | 0 |
| 本体 | outlineStyle | `solid` | `solid` | 0 |
| 本体 | outlineWidth | `1px` | `1px` | 0 |
| 本体 | paddingBottom | `0px` | `0px` | 0 |
| 本体 | paddingLeft | `0px` | `0px` | 0 |
| 本体 | paddingRight | `0px` | `0px` | 0 |
| 本体 | paddingTop | `0px` | `0px` | 0 |
| 本体 | rowGap | `0px` | `0px` | 0 |
| 本体 | width | `16px` | `16px` | 0 |
| 文字 | color | `rgb(98, 106, 115)` | `rgb(98, 106, 115)` | 0 |
| 文字 | fontSize | `10px` | `10px` | 0 |
| 文字 | fontWeight | `600` | `600` | 0 |
| 文字 | letterSpacing | `normal` | `normal` | 0 |
| 文字 | lineHeight | `10px` | `10px` | 0 |

### x4FeKG 動きの印

| 要素 | 属性 | 絵 | 実装 | 差 |
|---|---|---|---|---|
| 本体 | backgroundColor | `rgb(245, 245, 247)` | `rgb(245, 245, 247)` | 0 |
| 本体 | borderBottomLeftRadius | `999px` | `999px` | 0 |
| 本体 | borderBottomRightRadius | `999px` | `999px` | 0 |
| 本体 | borderBottomWidth | `0px` | `0px` | 0 |
| 本体 | borderLeftWidth | `0px` | `0px` | 0 |
| 本体 | borderRightWidth | `0px` | `0px` | 0 |
| 本体 | borderTopLeftRadius | `999px` | `999px` | 0 |
| 本体 | borderTopRightRadius | `999px` | `999px` | 0 |
| 本体 | borderTopWidth | `0px` | `0px` | 0 |
| 本体 | boxShadow | `none` | `none` | 0 |
| 本体 | columnGap | `0px` | `0px` | 0 |
| 本体 | height | `24px` | `24px` | 0 |
| 本体 | outlineOffset | `0px` | `0px` | 0 |
| 本体 | outlineStyle | `none` | `none` | 0 |
| 本体 | outlineWidth | `3px` | `3px` | 0 |
| 本体 | paddingBottom | `0px` | `0px` | 0 |
| 本体 | paddingLeft | `0px` | `0px` | 0 |
| 本体 | paddingRight | `0px` | `0px` | 0 |
| 本体 | paddingTop | `0px` | `0px` | 0 |
| 本体 | rowGap | `0px` | `0px` | 0 |
| 本体 | width | `24px` | `24px` | 0 |
| アイコン | backgroundColor | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | 0 |
| アイコン | borderBottomLeftRadius | `0px` | `0px` | 0 |
| アイコン | borderBottomRightRadius | `0px` | `0px` | 0 |
| アイコン | borderBottomWidth | `0px` | `0px` | 0 |
| アイコン | borderLeftWidth | `0px` | `0px` | 0 |
| アイコン | borderRightWidth | `0px` | `0px` | 0 |
| アイコン | borderTopLeftRadius | `0px` | `0px` | 0 |
| アイコン | borderTopRightRadius | `0px` | `0px` | 0 |
| アイコン | borderTopWidth | `0px` | `0px` | 0 |
| アイコン | boxShadow | `none` | `none` | 0 |
| アイコン | columnGap | `normal` | `normal` | 0 |
| アイコン | height | `12px` | `12px` | 0 |
| アイコン | outlineOffset | `0px` | `0px` | 0 |
| アイコン | outlineStyle | `none` | `none` | 0 |
| アイコン | outlineWidth | `3px` | `3px` | 0 |
| アイコン | paddingBottom | `0px` | `0px` | 0 |
| アイコン | paddingLeft | `0px` | `0px` | 0 |
| アイコン | paddingRight | `0px` | `0px` | 0 |
| アイコン | paddingTop | `0px` | `0px` | 0 |
| アイコン | rowGap | `normal` | `normal` | 0 |
| アイコン | width | `12px` | `12px` | 0 |

### tydx2 進みの棒

| 要素 | 属性 | 絵 | 実装 | 差 |
|---|---|---|---|---|
| 本体 | backgroundColor | `rgba(29, 29, 31, 0.04)` | `rgba(29, 29, 31, 0.04)` | 0 |
| 本体 | borderBottomLeftRadius | `3px` | `3px` | 0 |
| 本体 | borderBottomRightRadius | `3px` | `3px` | 0 |
| 本体 | borderBottomWidth | `0px` | `0px` | 0 |
| 本体 | borderLeftWidth | `0px` | `0px` | 0 |
| 本体 | borderRightWidth | `0px` | `0px` | 0 |
| 本体 | borderTopLeftRadius | `3px` | `3px` | 0 |
| 本体 | borderTopRightRadius | `3px` | `3px` | 0 |
| 本体 | borderTopWidth | `0px` | `0px` | 0 |
| 本体 | boxShadow | `none` | `none` | 0 |
| 本体 | columnGap | `normal` | `normal` | 0 |
| 本体 | height | `6px` | `6px` | 0 |
| 本体 | outlineOffset | `0px` | `0px` | 0 |
| 本体 | outlineStyle | `none` | `none` | 0 |
| 本体 | outlineWidth | `3px` | `3px` | 0 |
| 本体 | paddingBottom | `0px` | `0px` | 0 |
| 本体 | paddingLeft | `0px` | `0px` | 0 |
| 本体 | paddingRight | `0px` | `0px` | 0 |
| 本体 | paddingTop | `0px` | `0px` | 0 |
| 本体 | rowGap | `normal` | `normal` | 0 |
| 本体 | width | `300px` | `300px` | 0 |
| 済み | backgroundColor | `rgb(8, 122, 62)` | `rgb(8, 122, 62)` | 0 |
| 済み | borderBottomLeftRadius | `3px` | `3px` | 0 |
| 済み | borderBottomRightRadius | `3px` | `3px` | 0 |
| 済み | borderBottomWidth | `0px` | `0px` | 0 |
| 済み | borderLeftWidth | `0px` | `0px` | 0 |
| 済み | borderRightWidth | `0px` | `0px` | 0 |
| 済み | borderTopLeftRadius | `3px` | `3px` | 0 |
| 済み | borderTopRightRadius | `3px` | `3px` | 0 |
| 済み | borderTopWidth | `0px` | `0px` | 0 |
| 済み | boxShadow | `none` | `none` | 0 |
| 済み | columnGap | `normal` | `normal` | 0 |
| 済み | height | `6px` | `6px` | 0 |
| 済み | outlineOffset | `0px` | `0px` | 0 |
| 済み | outlineStyle | `none` | `none` | 0 |
| 済み | outlineWidth | `3px` | `3px` | 0 |
| 済み | paddingBottom | `0px` | `0px` | 0 |
| 済み | paddingLeft | `0px` | `0px` | 0 |
| 済み | paddingRight | `0px` | `0px` | 0 |
| 済み | paddingTop | `0px` | `0px` | 0 |
| 済み | rowGap | `normal` | `normal` | 0 |
| 済み | width | `190px` | `190px` | 0 |
