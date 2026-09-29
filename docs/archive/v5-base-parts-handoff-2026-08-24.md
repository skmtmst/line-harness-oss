> **廃止(2026-09-03)。読まない・判断に使わない。** これは V2〜V5 世代の要件・仕様で、V6(2026-08-26 正本化)で置き換えられた。現在の正本は `docs/v6-requirements/v6-requirements-master-index.md` と `docs/v6-common-rules.md`。歴史の確認以外の目的で開かない。

# V5 基本パーツ 本番投入 引き渡し情報（Codex確認用）

作成日: 2026-08-24
対象: `apps/web` のデザイン基盤と共通部品
前提資料: `docs/v5-parts-to-code-map-2026-08-23.md`（6機能85画面の部品監査）
状態: **未コミット。Codexの確認後に投入する**

## 0. この変更が何をするか

Pencil V5 で確定した「基本のもの・基準となるもの」を本番コードへ入れる。

これまで同じ役割の部品がコード側で複数に割れていて、V5で1つに決めたものが
そのまま入らない状態だった。トークンの値をV5にそろえ、割れていた部品を
1つにして、V5の指定と一致していることを機械で確認できるようにする。

**「V5の通りに入れて」が、そのまま入る状態にするための土台。**

## 1. なぜ必要だったか（実測）

### トークンの値がPencilと違っていた

| 役割 | Pencil V5 | 変更前のコード |
|---|---|---|
| `hairline` 枠線 | `#DADDE2` | `#e2e4df` |
| `ink` 本文 | `#1d1d1f` | `#1a1c1a` |
| `ink-secondary` | `#4A5565` | `#565f59` |
| `ink-faint` | `#6E7781` | `#8b938d` |

値が合っていないため、設計どおりに描きたい画面はトークンを避けて生の色を
書いていた（`#DADDE2` 47か所、`#1D1D1F` 21か所）。同じ画面の中に
2系統の色が混ざっていた。

### 同じ部品が複数に割れていた

KPIカードは3か所にあり、3つとも寸法が違った。

| 実装 | 角丸 | 余白 | 影 | 見出し |
|---|---|---|---|---|
| `dashboard/kpi-card` | 12px | 20px | あり | 14px |
| `friends/friend-kpis` | 14px | 16px | あり | 12px（色は直書き） |
| `shared/list-kpis` | 12px | 16px | **なし** | 12px |

`<th>` は7通り以上（`text-gray-500` と `text-ink-faint` の混在、`uppercase`
や `tracking-wider` の有無）。主要ボタンは寸法が5通り（`px-4 py-2` / `px-5 py-2` /
`px-5 py-2.5` / `px-4 py-2.5` / `px-6 py-3`）で、**どれもV5仕様と違っていた**
（V5は高さ36px・`padding [9,13]`・13px）。

## 2. 変更内容

### 2-1. デザイントークン — `apps/web/src/app/globals.css`

色4種をPencil V5の値へ変更。V5にあってコードに無かった値を追加。

```
変更: --color-ink / --color-ink-secondary / --color-ink-faint / --color-hairline
追加: --color-surface-pearl: #fafafc   （表の見出し行の地 $surface-pearl）
追加: --radius-tile: 10px              （$radius-md）
追加: --text-caption/label/metric/micro/nano: 12/13/22/11/10px
追加: --shadow-card  : 1px 1px 2px #1920261a
追加: --shadow-float : 1px 1px 2px #19202626
```

`--radius-md` という名前は使っていない。Tailwind標準の `rounded-md` は6pxで、
上書きすると既存83か所が黙って10pxになるため。

影は `@theme` ではなく素の `:root` に置いた。Tailwindは影の値をクラスへ
直に埋め込むので、`@theme` では変数そのものが出力されず、CSSモジュールから
読めないため。

**この1ファイルの変更が、全103ページのトークン参照6725か所へ波及する。**

### 2-2. 共通部品（新規3つ）

書き方は **CSSモジュール**。値は `globals.css` のPencil由来トークンを
`var()` で参照し、ローカル変数は作らない。

| 部品 | Pencil | ファイル |
|---|---|---|
| 共通 サマリーカード | `XywGr` | `components/shared/summary-card.tsx` / `.module.css` |
| 共通 ボタン（主要・副次） | `nBRKk` / `uzNEC` | `components/shared/button.tsx` / `.module.css` |
| 共通 表見出しセル・見出し行 | `tPTMp` | `components/shared/table.tsx` / `.module.css` |

各部品は**高さ・余白・角丸・色・文字**を持ち、**幅は持たない**。
幅は画面ごとに違うので、呼び出し側から `className` で渡す。

Tailwindではなく CSS モジュールにした理由:

- 3系統に割れた原因はTailwindの任意値記法だった。`rounded-[14px]`
  `border-[#DADDE2]` は普通のクラスと同じ見た目で、規格外だと目で見て分からない
- Pencilのノード属性はCSS属性そのもので、翻訳が要らない。V5の 13px・22px・
  11px・角丸10px はTailwindの標準目盛りに無く、部品を足すたびに翻訳表が増える

ただし技術の選択だけではズレは止まらない。友だち属性V3のCSSモジュールは
ローカル変数 `--v3-accent: #08c654` を持ち、3つ目の色系統になっていた。
**止めるのは §3 の契約テストのほう。**

### 2-3. 削除

- `components/dashboard/kpi-card.tsx` — `shared/summary-card.tsx` へ統合

### 2-4. 移行したファイル

KPIカード（7ファイル）: `app/conversions` `app/inflow-links` `app/affiliates`
`app/analytics` `components/inflow-links/site-script` `components/friends/friend-kpis`
`components/shared/list-kpis`

表見出し（8ファイル・完成6機能ぶん）: `app/broadcasts/page` `app/tags/page`
`app/scenarios/detail/scenario-detail-client` `components/scenarios/scenario-list`
`components/friends/friend-table` `components/broadcasts/broadcast-detail`
`components/friend-fields/mark-list` `components/friend-fields/field-list`
`components/friend-fields/tags-page-v4`

ボタン（2ファイル・8箇所）: `app/page` `components/friend-fields/tag-editor-v4`

## 3. 検証結果

### 3-1. 配信されるCSSとPencilの照合 — 35項目すべて一致

ビルド後の実CSSから `var()` を解決し、Pencilのノード属性と1項目ずつ突き合わせた。

| 部品 | 照合項目 | 結果 |
|---|---:|---|
| 共通 サマリーカード `XywGr` | 19 | 全一致 |
| 共通 ボタン `nBRKk`/`uzNEC` | 11 | 全一致 |
| 共通 表見出し `tPTMp` | 5 | 全一致 |

### 3-2. 契約テスト

`components/shared/v5-parts-contract.test.ts`（新規・11件）が、
CSSの宣言とPencilの指定を1対1で見張る。合わせて次も落とす。

- トークンの値がPencilと違う
- 部品に生の色やローカル変数が入る
- 部品が幅を持つ
- tsx側にTailwindの任意値記法が入る
- 設計に無い装飾（`uppercase` など）が入る

**わざと壊して落ちることを確認済み。** 余白を14px→16pxに変えると
「設計の padding: [14, 16] に対応する宣言がない」と出て落ちる。

### 3-3. 通したもの

- 型検査: 通過
- テスト: 41ファイル 467件すべて通過
- ビルド: 成功（106ページ静的生成）
- `raw-colors.test.ts` の基準を更新（生の色が 3273 → 3267 か所へ減ったため）

### 3-4. 確認できていないこと

**実際の画面の見た目は確認していない。** 管理画面はローカルで起動できない
（`AuthGuard` がWorkerの `/api/auth/session` を見に行き、ローカルD1に職員が
いないためログインが通らない）。CSSの実値照合はしたが、ページ上での配置や
崩れは検証環境でないと分からない。

**投入前に検証環境での目視確認が要る。** 特に次の3点は見た目が変わる。

1. 枠線と文字の色が全ページでわずかに変わる（緑みグレー → 青みグレー）
2. 表の見出しの余白が `px-4`(16px) から `0 12px` へ、行の高さが44px固定になる。
   `uppercase` と `tracking-wider` が外れる
3. 移行した8箇所のボタンが高さ36px・13pxになる（従来は高さがまちまちで14px）

## 4. 波及の状態（この変更の効果）

「1か所直せば他も直る」がどこまで成立するようになったか。

| 対象 | 1か所で変わる | まだ直書き |
|---|---:|---:|
| 色・角丸・文字サイズ | **全103ページ**（6725か所） | — |
| サマリーカード | 12ファイル | 2箇所 |
| 表の見出しセル | 9ファイル | 40ファイル |
| 共通ボタン | 2ファイル | 主要14・副次26箇所 |

色と文字サイズは**すでに全ページへ波及する**。部品は今回作った3つが通り、
残りは §5 の順で入れていく。

## 5. 残っている作業

`docs/v5-parts-to-code-map-2026-08-23.md` の §6 が正本。要点のみ:

1. Pencil側に影の変数（`shadow-card` / `shadow-float`）を追加し、21部品の
   生の値を回収する
2. `LMiL2 配信5ステップタブ` と `gk4ne シナリオ作成3ステップ` のルール違反を直す
   （`#EEF0F3`・`cornerRadius=15`・生のfontSize）。この2つは統合候補
3. ハンドオフ `docs/v5-pencil-continuation-handoff-2026-08-23.md` §3 の部品表を
   実態へ直す（`AWHUI 標準一覧表` は6機能で**0回**、実際は `tPTMp` が107回）
4. 表見出しを残り40ファイルへ展開
5. ボタンを残り40箇所へ展開
6. `Blot6 ページネーション` と `niGPF 20件表示` を作る（16ファイルに散在）
7. `rpot9 標準プルダウン`（21回）、一覧アイコン4種

## 6. Codexに確認したいこと

1. **部品の書き方をCSSモジュールにしてよいか。** ページ側はTailwindのまま。
   部品の境界だけCSSにする
2. **トークンの値をPencilに合わせてよいか。** 全ページで枠線と文字の色が
   わずかに変わる
3. **表見出しから `uppercase` / `tracking-wider` を外してよいか。**
   Pencilのどの見出しセルにも指定が無い
4. **`XywGr 共通サマリーカード`（24回）と `mNUQ3 配信KPIカード`（12回）を
   1つにするか。** 値の段は完全に同じで、ラベルの色（`$ink-secondary` と
   `$ink-faint`）・3行目・余白（`[14,16]` と `18`）だけが違う
5. **投入の単位。** この変更を1本で入れるか、トークン／部品／移行に分けるか

## 7. 投入手順（承認後）

1. `codex/development` から枝を切り直す（枝を積まない）
2. この変更をコミット。作業ツリーにある他の未コミット変更は混ぜない
3. `docs/release-log/unreleased.md` へ運用者向けの1行を追加（PR番号入り）
4. PRを作り、番号を入れて push し直す
5. 検証環境で §3-4 の3点を目視確認する
6. 差があれば直し、比較画像を撮り直す
