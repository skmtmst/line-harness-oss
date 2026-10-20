> 文書：見た目を変える場所の地図｜区分：今の説明｜最終確認：2026-10-20（日本時間）

# 見た目を変える場所

値・使い方の正本は [V8の決まり](v8-design-rules.md)、型と部品の持ち主は [型の対応表](v8-pattern-catalog.md)、画面ごとの形はPencilの★V8です。この地図は現在のファイルと変数へ案内します。新しい値や上限を決めません。

管理画面はV8に固定しています。[globals.css](../apps/web/src/app/globals.css) の `@theme` と `:root` が共通値の入口です。テーマ切替用のセレクタを追加しません。`@theme` はTailwindのクラス生成にも使うため、同じ名前があるだけで削除しません。

以下の `components/`・`lib/` は `apps/web/src/` からの相対です。値の定義を変える前に、使っている部品と役目を確かめます。

| 変えたいもの | 現役の持ち主 | 探す名前・確かめること |
|---|---|---|
| 色 | globals.css | `--color-ink`・`--color-canvas`・`--color-accent-deep`・`--color-hairline`。白文字・焦点・札も確認 |
| 余白 | globals.css・型のCSS | `--polish-space-card`・`--polish-space-row`・`--space-16`・役目別 `--tpl-*`。固有の寸法を汎用値にしない |
| 文字・行の高さ | globals.css | `--font-sans`・`--text-body`・`--text-label`・`--text-caption`。長い名前・数・IME・省略を確認 |
| 主・副ボタン | [Button](../apps/web/src/components/shared/button.tsx)とbutton.module.css | `--color-primary-border`・`--radius-primary-action`・`--control-shadow`、variant・size・busy。危険操作と保存中も確認 |
| 表 | [DataTable](../apps/web/src/components/shared/table.tsx)とdata-table.module.css・record-table-columns.ts・[一覧の型](../apps/web/src/components/templates/list-page.tsx) | `--shadow-row-line`・`--color-hairline`・列の口。長い名前・札・行末操作・0件・読込・ページ送り |
| 窓・確認・引き出し | [Dialog](../apps/web/src/components/shared/dialog.tsx)・[ConfirmDialog](../apps/web/src/components/shared/confirm-dialog.tsx)・[Drawer](../apps/web/src/components/shared/drawer.tsx)と各CSS | `--radius-panel`・`--color-scrim`・役目別幅の口。親子の窓・Esc・焦点・未保存・二度押し |
| 左メニュー・外側 | [Sidebar](../apps/web/src/components/layout/sidebar.tsx)とsidebar.module.css、[AppShell](../apps/web/src/components/app-shell.tsx) | `--sidebar-*`・`--mobile-header-height`。店・統括・運営とアカウント切替 |
| 数の帯 | [KpiBand](../apps/web/src/components/shared/kpi-band.tsx)・[KpiCard](../apps/web/src/components/shared/kpi-card.tsx)と各CSS | `--color-hairline`、presentationの口。0・未取得・失敗を分ける |
| 札・タグ・状態の言葉 | [StatusBadge](../apps/web/src/components/shared/status-badge.tsx)・[TagPill](../apps/web/src/components/shared/tag-pill.tsx)、[表示語の入口](../apps/web/src/lib/status-labels.ts)・[共通の語彙](../apps/web/src/components/shared/status-words.ts) | `--polish-status-*`・`--color-status-*`・`--radius-pill`。同じ値でも業務の意味を区別 |
| 入力・選ぶ欄 | [TextField](../apps/web/src/components/shared/text-field.tsx)・[FormControls](../apps/web/src/components/shared/form-controls.tsx)・[Select](../apps/web/src/components/shared/select.tsx)と各CSS | `--radius-field`・`--color-control-border`・`--control-shadow`・`--polish-focus*`。欄の誤り・焦点・長文・閲覧のみ |
| カード | [Card](../apps/web/src/components/shared/card.tsx)とcard.module.css | `--card-edge`・`--card-shadow`・`--radius-card`。平面の帯・浮く窓と区別 |
| LIFF | [tokens.css](../apps/liff/src/tokens.css)・[card-surface.css](../apps/liff/src/card-surface.css)・[liff-skin.css](../apps/liff/src/components/ui/liff-skin.css)・[button.module.css](../apps/liff/src/components/ui/button.module.css) | `--color-liff-*`・`--liff-radius*`・`--liff-header-h`。管理画面の値へ一括置換しない |

変更はPencilと決まり → 正の部品・値 → 影響する機能 → 小さい差分 → 動作・型・ビルド → 1152・1440の崩れ・操作・画像の確認の順です。1920を含む既存CIも維持します。分割だけならDOMの役目・API・値・撮影の鍵を変えません。新しいファイルの置き場と公開入口は [構成の決まり](code-structure.md) に従います。
