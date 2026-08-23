# PR #0 検証基盤 — 仕様と実装内容

作成日: 2026-08-24
依頼元: `docs/v5-base-parts-claude-review-handoff-2026-08-24.md` および同レビューへの承認
分岐元: `origin/codex/development` `5caafc6`

---

## 0. このPRが何をするか

Pencil V5 で確定した値を本番コードへ入れていく前に、**効果と副作用を測る道具**を先に用意する。

トークンを変えてから影響を調べる仕組みを作るのでは順序が逆になるため、
`PR #0 検証基盤 → PR #1 トークン → PR #2 共通部品 → PR #3以降 画面移行` の先頭に置く。

**このPRはレンダリング結果を1pxも変えない。** `.tsx` と `.module.css` と `globals.css` を変更しない。

## 1. 反映した修正

レビューで受けた指摘をすべて反映した。実測で裏を取ったものは根拠を書く。

| 指摘 | 反映 |
|---|---|
| PR順序は `#0 → #1 → #2` | 修正。部品はPR #1のトークンに依存するため、部品先行は矛盾していた |
| 表示制御はHTMLの `hidden` 属性へ統一 | **実測で確認**。`[hidden]:where(:not([hidden=until-found])){display:none!important}` が `@layer base` にあり、`!important` なのでレイヤーに関係なく効く |
| `focus-visible` は `Button` とカード内リンクのみ | 反映。`Th` 本体・`SummaryCard` 本体は操作要素ではないので不要（PR #2で実装） |
| variantは意味名 `detailVariant="description"｜"notice"` | 反映。`investigations.mNUQ3` の `reason` に記録した |
| `design-parts.json` は正本ではなく検証用スナップショット | 反映。JSON冒頭に明記。正本はPencilの `.pen` |
| 状態を3段階にする | 反映。`pending` / `implemented` / `active` |
| JSONと基準値は実装コードと分離 | 反映。`apps/web/design/` へ置いた |
| TSXの計数はTypeScript AST | 反映。**これが決定的だった。§4を参照** |
| 追跡できないimportやルートを未解決として出す | 反映。全ファイルを1回走査して集める |
| `design:debt:check` と `design:debt:update` を分ける | 反映 |
| 承認済み仕様書とrelease logをPRへ含める | 反映。この文書と `docs/release-log/unreleased.md` |
| HTML完全一致ではなく正規化CSS一致と実行時コード差分なし | 反映。§7の受け入れ条件 |
| 必須35項目が消えた場合もCIを落とす | 反映。`required` を照合スクリプトが検査する |

### push前レビューで受けた6点

| 指摘 | 反映 |
|---|---|
| 表示制御の正規表現が全角コロン | 直した。ただし**機能上は効いていた**（`：?` が省略可のため `md:hidden` は検知できていた）。一方で前置きを固定列挙していたのは**本当の抜け**で、`md:max-lg:hidden` や `peer-checked:hidden` を見逃していた。列挙をやめ、**最後のコロンより後ろ**だけを見る方式に変えた |
| `design:impact` の `--` 付き呼び出しが失敗 | スクリプトが先頭の余分な `--` を捨てるようにした。両方の書き方で動く。仕様書のコマンドも直した |
| 別名importで表示制御検査を回避できる | 名前の決め打ちをやめ、**importの行き先**で判断するようにした。default importの任意名・`as` での改名・名前空間import・相対パスに対応。負の試験を7件追加 |
| 未解決 `className` が増えてもCIが通る | `unresolved-classname` を基準値に入れた。増えたら落ちる |
| `tPTMp` のコントラストと `focus-visible` を investigations へ | 追加。トークンにも `lastCheckedAt` を持たせ、照合スクリプトが必須にした |
| 受け入れ条件16・17を未確認のまま残さない | 実測に置き換えた。§7 |

## 2. 変更ファイル

### 新規（7）

| パス | 役割 |
|---|---|
| `apps/web/design/design-parts.json` | Pencilから写した検証用スナップショット |
| `apps/web/design/design-debt-baseline.json` | 直書きの基準値（生成物） |
| `apps/web/scripts/verify-design-values.mjs` | CSSとPencilの照合 |
| `apps/web/scripts/design-debt.mjs` | 直書きの計数（確認／更新） |
| `apps/web/scripts/design-impact.mjs` | 影響レポート |
| `apps/web/src/lib/design-debt.test.ts` | 増加防止の試験 |
| `docs/v5-pr0-verification-base-spec-2026-08-24.md` | この文書 |

### 変更（3）

| パス | 内容 |
|---|---|
| `apps/web/package.json` | `verify:design` / `design:debt:check` / `design:debt:update` / `design:impact` |
| `.github/workflows/required-pr-gate.yml` | `pnpm --filter web build` の直後に `verify:design` を1行追加 |
| `docs/release-log/unreleased.md` | 運用者向けの1行 |

## 3. 状態の3段階

見る場所が状態で変わる。

| 状態 | 意味 | 照合する場所 |
|---|---|---|
| `pending` | コード未実装 | 見ない。報告のみで落とさない |
| `implemented` | コードはあるが画面では未使用 | **CSSモジュールのソース**（`source` の値） |
| `active` | 実画面で利用中 | **ビルド後のCSS**（`resolved` の値。`var()` を解決）＋配信漏れ |

`active` をビルド後で見るのは、部品があっても画面が使っていなければ
CSSモジュールが出力されないため。逆に `implemented` をビルド後で見ると
「まだ誰も使っていないだけ」なのに配信漏れとして落ちてしまう。

PR #0 時点は全項目 `pending`。PR #1 がトークンを、PR #2 が部品を進める。

## 4. AST解析で分かったこと — 私の先の報告は過少計上だった

レビューで報告した直書きの数は `grep` で数えたもので、**大幅に間違っていた**。

| 指標 | 先の報告（grep） | 実際（AST） |
|---|---:|---:|
| 主要ボタンの直書き | 16か所 | **168か所** |
| 副次ボタンの直書き | 26か所 | **335か所** |
| 直書き `<th>` | 308か所 | **378か所** |
| 任意値記法 | 991か所 | **1518か所** |

原因は `grep` が行単位で動くこと。このコードベースは1行に多数のJSXを詰めており、
`className` がテンプレート文字列の条件分岐の中にあることも多い。

実物で確認した例（`components/friend-attributes-v2/tag-list-v2.tsx`）:

```
className={`h-8 min-w-8 rounded-md px-2 ${page === value ? 'bg-accent font-bold text-on-accent' : 'border border-hairline'}`}
```

これは主要ボタンだが、`<button[^>]*className="[^"]*bg-accent` のような
正規表現では拾えない。**AST解析を求められたのは正しかった。**

※ 上の数は `origin/codex/development` 上の値。私が先に測ったのは
移行済みの未コミット差分を含む作業ツリーだったため、その分の差もある。

## 5. 直書きの指標

| キー | 数えるもの | 扱い |
|---|---|---|
| `arbitrary-value` | `className` の中の Tailwind 任意値記法（`[`） | 基準値。増えたら落ちる |
| `direct-th` | JSXの `<th>` 要素（`<Th>` は当たらない） | 基準値 |
| `direct-primary-button` | `button` / `Link` / `a` で `bg-accent` を持つもの | 基準値 |
| `direct-secondary-button` | 同上で `border-hairline` を持つもの | 基準値 |
| `unresolved-classname` | 静的に読めない `className`（変数や関数の戻り値） | 基準値。増えたら落ちる |
| `display-class-on-part` | 共通部品への `className` に表示制御クラス | **0固定** |

`display-class-on-part` だけ0固定にするのは、共通部品のCSSがカスケードレイヤーに
属さず Tailwind のユーティリティにつねに勝つため。`className="hidden"` は
**エラーも警告も出さずに無視される**。表示の切り替えはHTMLの `hidden` 属性で行う。

**部品かどうかは名前で決めない。** `import Button as SharedButton` のように
改名するだけで検査をすり抜けられるため、**importの行き先**が
`design-parts.json` の `code` と一致するかで判断する。
default importの任意名、`as` での改名、名前空間import、相対パスに対応している。

**表示制御クラスかどうかは前置きを列挙しない。** `md:` `dark:` `peer-checked:`
`data-[open]:` を並べても、重ねがけ（`md:max-lg:hidden`）や新しい前置きを見逃す。
`!` を外し、**最後のコロンより後ろ**が `hidden` `flex` `block` などかで判断する。

静的に読めない `className` は他の数には入れず、`unresolved-classname` として
別に数える。現在 467か所 / 74ファイル。

## 6. 出力例

### `pnpm --filter web verify:design`（PR #0 時点）

```text
Pencil V5 とCSSの照合

トークン
  --color-ink             $ink              #1d1d1f                 … 未実装
  …
部品
  共通 サマリーカード（XywGr） … 未実装（19項目）
  共通 ボタン（主要・副次）（nBRKk / uzNEC） … 未実装（13項目）
  共通 表見出しセル・見出し行（tPTMp） … 未実装（7項目）

────────────────────────────────────────────
照合対象 0 件 / 一致 0 / 不一致 0
未実装   51 件

合格（照合対象がまだありません）
```

### `pnpm --filter web design:debt:check`

```text
直書きの数

  arbitrary-value            1518 か所
  direct-primary-button       168 か所
  direct-secondary-button     335 か所
  direct-th                   378 か所
  unresolved-classname        467 か所

未解決の className は基準値に入れている。増えたら落ちる。
  変数や関数の戻り値で組まれていて静的に読めない。ほかの数には入っていない。
    components/friend-attributes-v3/friend-attributes-v3-static.tsx (30)
    …
合格
```

### `pnpm --filter web design:impact --token --color-hairline`

```text
影響レポート: トークン --color-hairline

  Pencil     $hairline = #dadde2
  状態       pending
  覚え書き   変更。旧 #e2e4df

  探した書き方  var\(\s*--color-hairline\s*\)  \b(?:bg|text|border|…)-hairline\b

  参照しているファイル 142 / 到達するルート 94
    /  /accounts  /affiliates  /analytics  …

  共通部品を通らない直書き（この変更では直らない）
    arbitrary-value            1518 か所
    …
  撮り直す基準画面
    ● /             ダッシュボード。KPIカード・ボタン・カード見出し
    ● /friends      友だち。一覧・表見出し・詳細検索モーダル
    ● /tags         友だち属性。一覧・フォルダ・タブ
    ● /broadcasts   一斉配信。表見出し・KPI・状態バッジ
    ● /tags/new     タグを作る。入力フォームとボタン
    ● /emergency    運用状態。統合できていないローカル部品の比較用
    ● は今回の変更が届くルート

  未解決 1 件（追跡できなかったもの。影響が無いという意味ではない）
    行き先が見つからない import: components/emergency/release-log-panel.tsx → generated/release-log.json
```

## 7. 受け入れ条件と結果

「わざと壊して落ちること」を実際に確認したものには ✔ と壊し方を書く。

### 照合スクリプト

| # | 条件 | 結果 |
|---|---|---|
| 1 | 全 `pending` で終了コード0 | ✔ |
| 2 | 値が設計と違うと終了コード1 | ✔ `--color-ink` を `implemented` にすると `#1a1c1a` と不一致で落ちる |
| 3 | 必須トークンを消すと終了コード1 | ✔ 「トークンが 11 件。必須 12 件を下回っています」 |
| 4 | 必須Node IDを消すと終了コード1 | ✔ 「必須のPencil Node ID XywGr が部品に含まれていません」 |
| 5 | 未ビルドで `active` にすると終了コード1 | ✔ 「ビルド成果物がありません」 |
| 6 | 調査中の部品を契約に入れると終了コード1 | ✔ 「investigations へ移してください」 |
| 6-2 | `active` がビルド後CSSを読む | ✔ `--color-hairline` を `active` にすると実値 `#e2e4df` と不一致で落ちる |
| 6-3 | 配信漏れを検知する | ✔ `--radius-tile` を `active` にすると「ビルド後CSSに見つかりません」で落ちる |

### 増加防止

| # | 条件 | 結果 |
|---|---|---|
| 7 | 任意値記法を1つ足すと落ちる | ✔ `arbitrary-value: 1 → 2` |
| 8 | 直書き `<th>` を1つ足すと落ちる | ✔ `direct-th: 11 → 12` |
| 9 | 共通部品へ `className="hidden"` を渡すと落ちる | ✔ 「display-class-on-part は0でなければなりません」 |
| 10 | 減って基準を締め直さないと落ちる | ✔ 「減っています（基準を締め直してください）」 |
| 11 | 締め直すと通る | ✔ |
| 11-2 | 未解決 `className` が増えると落ちる | ✔ 基準値に入れたので 7〜10 と同じ扱い |

### 表示制御と部品の見分け（負の試験・12件）

| # | 条件 | 結果 |
|---|---|---|
| 11-3 | 前置きが何段でも基底で判断する | ✔ `md:max-lg:hidden` `peer-checked:hidden` `data-[open]:hidden` `!hidden` `dark:lg:inline-flex` |
| 11-4 | 似ているだけのものは拾わない | ✔ `overflow-hidden` `hidden-thing` `flex-1` `table-fixed` `blocked` |
| 11-5 | default importに別名を付けても検知する | ✔ `import SharedDialog from '…'` → `<SharedDialog className="md:hidden">` |
| 11-6 | `as` での改名でも検知する | ✔ `import { default as Renamed } from '…'` |
| 11-7 | 名前空間importでも検知する | ✔ `import * as Parts` → `<Parts.Thing className="hidden">` |
| 11-8 | 相対パスのimportでも検知する | ✔ |
| 11-9 | 同じ名前でも別ファイルからのimportなら拾わない | ✔ |

### 影響レポート

| # | 条件 | 結果 |
|---|---|---|
| 12 | トークン指定で出力する | ✔ |
| 13 | 部品指定で出力する | ✔ `--part summary-card` / `--part XywGr` |
| 14 | 追跡できないものを未解決として出す | ✔ 動的importをわざと足すと「動的import（行き先が定数でない）」が出る |
| 14-2 | `--` の有無どちらでも動く | ✔ `pnpm --filter web design:impact --token X` と `-- --token X` の両方で終了コード0 |

### 影響がないこと

| # | 条件 | 結果 |
|---|---|---|
| 15 | `.tsx` `.module.css` `globals.css` の差分が0 | ✔ |
| 16 | **CSSの出力が完全に一致する** | ✔ 実測。反映履歴あり／なしでビルドし、CSS 4ファイルの内容ハッシュが一致（`04f0c01e…`） |
| 17 | **実行時コードの差は反映履歴の1行ぶんだけ** | ✔ 実測。`.next/static` の全145ファイルのうち差があるのは運用状態ページのチャンク1つのみ（`page-866cd578…` → `page-eb5acec8…`）。残り144ファイルは同一 |
| 18 | 型検査・テスト・ビルドが通る | ✔ |
| 19 | 既存の `raw-colors.test.ts` と基準値に差分がない | ✔ |

**16・17 について。** 当初「HTML完全一致」としていたが、これは成立しない。
反映履歴の行は `src/generated/release-log.json` を経て運用状態ページの
チャンクへ埋め込まれるため、実行時コードは**必ず変わる**。
実測すると、変わるのはその1ファイルだけで、CSSは1バイトも変わらない。

（この検証で自分の測り方の誤りも見つかった。最初は
`.next/static/chunks/*.js` を非再帰で比べており、145ファイル中30しか
見ていなかった。再帰で比べ直して上の結果を得た。）

## 8. 未確認事項

1. **受け入れ条件16・17。** ビルド出力の同一性は、`.next` のファイル名にハッシュが
   入るため内容で比べる必要がある。今回は「`.tsx`／CSSを変更していない」ことと
   ビルドが通ることまでを確認した。**正規化CSS一致と実行時コード差分なしの
   自動比較は入れていない**
2. **`design-parts.json` の値の鮮度。** Pencilから手で写しており、
   Pencil側が変わっても自動では検知できない。`lastCheckedAt` で運用する
3. **ルート割り出しの精度。** 深さ上限12。`export * from` はこのリポジトリに
   0件だったため、検知の動作は動的importでのみ確認した
4. **`display-class-on-part` の部品名。** `design-parts.json` の `components` を
   読む形にしたが、部品が増えるたびにJSONの更新が要る
5. **`export * from` の検知。** このリポジトリに0件だったため、動作を確認できていない。
   動的importでのみ検知を確認した
6. **`display-class-on-part` はPR #0では一度も発火しない。** 共通部品がまだ
   存在しないため、`design-parts.json` の `code` が指すファイルが無く、
   importの照合が成立しない。仕組みが働くことは合成したソースを使う
   負の試験（11-5〜11-9）で確認した

## 9. 手元で流すときの注意

ビルドには `NEXT_PUBLIC_API_URL` が要る。未設定だと書き出しの途中で止まる。
CIでは設定済み。手元では次のように渡す。

```bash
NEXT_PUBLIC_API_URL=https://nen-line-stg.skmtmst.workers.dev pnpm --filter web build
```

`verify:design` はビルド成果物を読むので、`active` の項目がある状態では
先にビルドが要る。CIの `run:` は既定で `bash -e` なので、ビルドが失敗すれば
照合まで進まない。

## 10. 次のPR

`PR #1 トークン`。`origin/codex/development` へ取り込まれた後、最新から切り直す。
この枝へ積まない。
