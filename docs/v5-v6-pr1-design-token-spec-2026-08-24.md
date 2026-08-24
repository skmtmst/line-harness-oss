# PR #1 V5/V6 デザイントークン実装仕様

作成日: 2026-08-24
対象: 管理画面の共通デザイントークン
分岐元: `codex/development` `e27a2ad8`

## 1. 目的

Pen.devの画像やPencilノードを渡したとき、既存CSSの値に引っ張られず、設計どおりに実装できる土台を作る。
色・角丸・文字サイズ・影を共通の名前で管理し、1か所の修正が利用画面へ一括で届く状態にする。

## 2. 設計の優先順位

1. 共通基盤はPencil V5を使う。
2. 対象画面・部品にV6が存在する場合はV6を正本として優先する。
3. V5/V6のどちらにも定義がない状態をコードだけで補わない。`investigations`へ残す。
4. Pencilの値を変えずにコード側だけ例外化しない。

Pencil正本を読み、V6は受信箱、一斉配信、リマインダ、自動応答、テンプレート、リッチメニュー、回答フォーム、予約管理、運用状態、店舗ダッシュボードなどに存在することを確認した。

代表10ノードは `WQhu3`、`G1pfMk`、`kAnOQ`、`u5zVV0`、`FH74x`、`HNUSO`、`MyusN`、`WGM4x`、`FawJ8`、`owlEd`。
これらはV5と同じグローバル変数を参照しているため、V6専用のCSS上書きは作らない。

## 3. 実装する12トークン

| コード | Pencil | 値 | 種別 |
|---|---|---:|---|
| `--color-ink` | `$ink` | `#1d1d1f` | 変更 |
| `--color-ink-secondary` | `$ink-secondary` | `#4a5565` | 変更 |
| `--color-ink-faint` | `$ink-faint` | `#6e7781` | 変更 |
| `--color-hairline` | `$hairline` | `#dadde2` | 変更 |
| `--color-surface-pearl` | `$surface-pearl` | `#fafafc` | 追加 |
| `--radius-tile` | `$radius-md` | `10px` | 追加 |
| `--text-caption` | `$size-caption` | `12px` | 追加 |
| `--text-label` | `$size-label` | `13px` | 追加 |
| `--text-metric` | `$size-metric` | `22px` | 追加 |
| `--text-micro` | `$size-micro` | `11px` | 追加 |
| `--text-nano` | `$size-nano` | `10px` | 追加 |
| `--shadow-card` | `XywGr effect` | `1px 1px 2px #1920261a` | 追加 |

色・角丸・文字サイズはTailwind v4が名前付きクラスを生成できるよう`@theme`へ置く。
影は共通部品が`var(--shadow-card)`で参照するため、`@theme`の外の`:root`へ置く。

## 4. V6での確認結果

代表10画面をPencil上で実測した参照数:

| Pencil変数 | 参照数 |
|---|---:|
| `$ink` | 3,481 |
| `$ink-secondary` | 1,249 |
| `$ink-faint` | 1,187 |
| `$hairline` | 966 |
| `$surface-pearl` | 54 |
| `$radius-md` | 232 |
| `$size-caption` | 545 |
| `$size-label` | 1,812 |
| `$size-metric` | 208 |
| `$size-micro` | 723 |
| `$size-nano` | 124 |

V6一斉配信では`mNUQ3`、V6各一覧では`tPTMp`が使われている。両部品の枠・角丸・影・文字は今回の共通トークンと同じ値だった。

## 5. コードへの影響

PR #0のAST影響レポートで、変更する既存色が届く範囲を測った。

| トークン | 参照ファイル | 到達ルート |
|---|---:|---:|
| `--color-ink` | 150 | 100 |
| `--color-ink-secondary` | 127 | 99 |
| `--color-ink-faint` | 141 | 93 |
| `--color-hairline` | 142 | 94 |

追加する8トークンは、PR #1時点では共通CSSへの配信だけで画面側の利用は0ルート。PR #2の共通部品から使い始める。

全トークンで未解決は1件。`generated/release-log.json`はビルド時生成物なので、静的importの段階では追跡できない。影響が無いとは扱わず、ビルドとCIで配信を確認する。

既存の負債基準は、任意値1,518、主要ボタン168、副次ボタン335、直書き`<th>`378、未解決`className`467。今回これらは増やさない。

## 6. 今回変えないもの

- 既存画面の`text-gray-*`や任意値記法を一括置換しない。画面移行PRで共通部品へ寄せる。
- `mNUQ3`と`XywGr`の統合はPR #2で扱う。
- 部品のCSSモジュールと画面移行はPR #2以降で扱う。
- Pencil自体は変更しない。

## 7. 未解決のコントラスト

`tPTMp`はV6でも使われているが、`$ink-faint`を`$surface-pearl`へ置く組み合わせは4.36:1で、通常文字のWCAG AA 4.5:1に届かない。

今回コードだけを`$ink-secondary`へ変えるとPencilと不一致になるため、設計どおり`$ink-faint`を実装し、`investigations.tPTMp-contrast`を残す。
Pencil側で色を決め直した後、同じトークン変更で全利用画面へ反映する。

## 8. 受け入れ条件

- 12トークンが`design-parts.json`で`active`になっている。
- ビルド後CSSに12トークンが配信され、Pencil値と一致する。
- V5を基盤、V6を優先する規則と代表V6ノードが機械可読な契約へ残る。
- `design:debt:check`の基準値が増えない。
- 影響レポートが、到達ルート・基準画面・未解決importを表示する。
- webの全テスト、型検査、109ページの本番ビルド、`verify:design`が通る。
- `.tsx`とCSSモジュールは変更せず、今回の差分をトークンと検証契約に限定する。
