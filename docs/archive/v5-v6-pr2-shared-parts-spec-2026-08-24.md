> **廃止(2026-09-03)。読まない・判断に使わない。** これは V2〜V5 世代の要件・仕様で、V6(2026-08-26 正本化)で置き換えられた。現在の正本は `docs/v6-requirements/v6-requirements-master-index.md` と `docs/v6-common-rules.md`。歴史の確認以外の目的で開かない。

# V5/V6 共通部品 PR #2 仕様

作成日: 2026-08-24
対象: `apps/web` の共通 `Button`、`SummaryCard`、表見出し
目的: Pencilの共通部品をコード側の正本へし、画面ごとの書き直しを減らす

## 設計の優先順位

1. 共通基盤はV5を正本とする
2. 対象画面または部品にV6がある場合はV6を優先する
3. V6固有の差が無い場合はV5共通部品を使う
4. 意味の違う部品を見た目だけで統合しない

Pencilは読み取りだけ行い、変更していない。

## Pencil確認結果

| Node ID | 役割 | V6の判断 |
|---|---|---|
| `nBRKk` | 主要ボタン | V6専用部品なし。V5を使用 |
| `uzNEC` | 副次ボタン | V6専用部品なし。V5を使用 |
| `XywGr` | 数値サマリーカード | V6専用部品なし。V5を使用 |
| `tPTMp` | 表見出しセル | V6代表10画面で同じ部品を54回使用 |
| `mNUQ3` | 配信KPIカード | V6一斉配信で4回使用。意味と3行目の見た目が違うため調査中 |

## 今回の部品API

### Button

- `variant="primary" | "secondary"`
- `href` がある場合だけリンクとして描画する
- `href` と `disabled` / `aria-disabled` の同時指定は型エラーにする
- リンクへ渡した `target`、`rel`、`aria-*`、`hidden` を捨てない
- 表示制御は `className="hidden"` ではなくHTMLの `hidden` 属性を使う
- Pencilにフォーカス状態が無いため、固有デザインは足さずブラウザ既定の輪郭を残す

### SummaryCard

- `XywGr` と同じ数値カードだけを扱う
- 取得できない値は `null` で「—」を表示する
- 読み込み中は `aria-busy="true"` を付ける
- 文字列値の `emergency` と告知色の `mNUQ3` は統合対象外にする

### TableHeadRow / Th

- `Th` の `scope` はHTMLの4値に限定し、既定値を `col` にする
- Pencilに無い `uppercase` と `tracking-wider` は持たない
- 列幅は画面側で決める

## 状態の扱い

3部品は `design-parts.json` で `implemented` にする。まだ画面へ移行しないため、ビルド後の配信を意味する `active` にはしない。カード・表・ボタンの各移行PRで実画面から読み込まれた時点で、該当部品を `active` に変える。

## 受け入れ条件

- 39宣言がPencilの値と一致する
- V5/V6優先ルールとV6部品参照数が契約テストで守られる
- `href + disabled` が型エラーになる
- リンク分岐でHTML propsが失われない
- `hidden` 属性で3部品を非表示にできる
- `Th` が既定で `scope="col"` を出す
- フォーカス輪郭を消す指定がない
- 生の色、部品内変数、任意値記法を追加しない
- 既存画面を移行しないため、レンダリング結果を変えない
- Webの全テスト、型検査、ビルド、`verify:design`、設計負債検査が通る
