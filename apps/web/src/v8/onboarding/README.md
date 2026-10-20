> 文書：onboarding のコード案内｜区分：今の説明｜最終確認：2026-10-20（日本時間）

# はじめの質問・使い方の設定：コードの入口

現役の読み込み先を探す案内です。URL・保存・権限・失敗時の条件は下の動きの説明と要件を読み、ここへ複製しません。

## URLから本体へ

単独のNextページへ直接つながる機能ではありません。呼び出し側の画面から利用します。

呼び出し側：[v8/dashboard/dashboard.tsx](../dashboard/dashboard.tsx)、[v8/dashboard/first-steps.tsx](../dashboard/first-steps.tsx)、[v8/hq-attention/attention.tsx](../hq-attention/attention.tsx)、[v8/hq-starter-sets/starter-sets.tsx](../hq-starter-sets/starter-sets.tsx)、[v8/rich-menu-sample/sample.tsx](../rich-menu-sample/sample.tsx)、[v8/settings/accounts/accounts.tsx](../settings/accounts/accounts.tsx)、[v8/settings/getting-started/getting-started.tsx](../settings/getting-started/getting-started.tsx)

本体：[icons.tsx](icons.tsx)、[sample-menu.tsx](sample-menu.tsx)、[setup-card.tsx](setup-card.tsx)、[setup-links.tsx](setup-links.tsx)、[style-entry.tsx](style-entry.tsx)、[wizard.tsx](wizard.tsx)

## 外に見せる名前（index.ts）

- [index.ts](index.ts)：`SetupCard`・`SetupWarningBands`・`setupSummary`・`useStyleSetup`・`useFirstRun`・`styleLabel`・`STYLE_CHOICES`・`FEATURES`・`featureHref`・`featureName`・`sampleMenuFor`・`StyleWarning`・`useStarterMenu`・`SampleMenuTiles`・`StyleEntry`
- [public/model/index.ts](public/model/index.ts)：`StyleWarning`・`FEATURES`・`STYLE_CHOICES`・`featureHref`・`featureName`・`sampleMenuFor`・`styleLabel`
- [public/sample-menu/index.ts](public/sample-menu/index.ts)：`SampleMenuTiles`
- [public/setup-card/index.ts](public/setup-card/index.ts)：`SetupCard`・`SetupWarningBands`・`setupSummary`
- [public/style-entry/index.ts](public/style-entry/index.ts)：`StyleEntry`
- [public/use-first-run/index.ts](public/use-first-run/index.ts)：`useFirstRun`
- [public/use-starter-menu/index.ts](public/use-starter-menu/index.ts)：`useStarterMenu`
- [public/use-style-setup/index.ts](public/use-style-setup/index.ts)：`useStyleSetup`
- [wizard/index.ts](wizard/index.ts)：`WizardStep`・`Props`・`Pair`・`SummaryData`・`default`

機能の内部は宣言元を直接読み、外部は明示された公開入口を使います。Nextのpage・layoutとWorkerのroute登録は直接接続します。決まりは [コードの構成と名前](../../../../../docs/code-structure.md)。

## API・保存の実装へ

- [lib/api.ts](../../lib/api.ts)
- [lib/api/helpers/styles.ts](../../lib/api/helpers/styles.ts)

HTTP契約は [API文書の一覧](../../../../../docs/README.md#api)、失敗の形式は [エラーの共通契約](../../../../../docs/error-codes.md)。公開名や応答を改名しません。

## 動きと試験

- [BEHAVIOR.md](BEHAVIOR.md)
- [load-state.test.tsx](load-state.test.tsx)
- [model.test.ts](model.test.ts)
- [style-setup-links.test.tsx](style-setup-links.test.tsx)

実行：`NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web test -- src/v8/onboarding`。関連する入口の試験も実行してください。保存・入力保持・権限・別店舗・失敗からの回復を守り、文書の整合だけを動作の合格に数えません。
