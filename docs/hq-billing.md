# 統括の課金プラン（月払い・年払い）

`/hq/billing` は既定が月払い。切り替えは画面内だけで保持し、再度開くと月払いに戻る。
通貨は税込JPYのみ。ライト・スタンダード・プロすべてStripe Checkoutで申し込む。

| プラン | 月払い | 年払い | 年払いの月あたり |
| --- | ---: | ---: | ---: |
| ライト | ¥9,800 | ¥99,000 | ¥8,250 |
| スタンダード | ¥29,800 | ¥303,000 | ¥25,250 |
| プロ | ¥59,800 | ¥609,000 | ¥50,750 |

年払いの札は全プラン「約15% OFF」で固定。月あたりは年額÷12を切り捨てる。
Stripeから取得できたJPY価格を優先し、取得できない場合は表の決定額を仮表示する。
APIは既存の `monthlyYen` / `priceFromStripe` / `available` を維持し、
`yearlyYen` / `yearlyPriceFromStripe` / `yearlyAvailable` を追加する。
画面の価格単位は `/月（税込）`、年払いではその下に `年額 ¥99,000（税込）` のように表示する。

## 検証環境の設定

Worker secretの設定名だけを記す。値をGit・画面・ログに載せない。

| プラン | 月払いの設定名 | 年払いの設定名 |
| --- | --- | --- |
| ライト | `STRIPE_PRICE_LIGHT` | `STRIPE_PRICE_LIGHT_YEAR` |
| スタンダード | `STRIPE_PRICE_STANDARD` | `STRIPE_PRICE_STANDARD_YEAR` |
| プロ | `STRIPE_PRICE_PRO` | `STRIPE_PRICE_PRO_YEAR` |

Stripeのテスト環境で、Masatoが年ごと・JPYのPriceを作成して登録する。
Codexは `pnpm exec wrangler secret list --config apps/worker/wrangler.staging.toml` で設定名の有無だけ確認する。
既存の `STRIPE_SECRET_KEY` と `STRIPE_BILLING_WEBHOOK_SECRET` を使用し、Webhook・OAuth・Cronは変更しない。
年の設定が無いプランは年払いの申込みボタンが無効になり、「価格がまだ設定されていません」と案内する。
月払いの価格には代替しない。APIでも503で止め、顧客やCheckoutを作成しない。

## 契約と周期

- `POST /api/hq/billing/checkout` は `planKey` と `interval: 'month' | 'year'` を受け付ける。
  周期省略は既存クライアントとの互換のため月払い。不正な周期は400。
- `checkout.session.completed` と `customer.subscription.*` は価格IDからプランを判定する。
- summaryの `planInterval` はStripeの契約の価格IDから読む。取得できない場合はnullとし、月払いと決めつけない。
- `current_period_end` はStripeの値をそのまま保存・表示する。年払いの更新日を月単位に計算し直さない。
- DB変更はない。月⇔年の契約変更やCustomer Portalの設定は今回の対象外。
- 年払いでも配信・生成などの月間上限は変わらない。

## 確認・配備・切り戻し

ローカルの表示確認は `pnpm qa:mock` と `pnpm qa:web` で `/hq/billing` を開く。
固定の表示用データだけを返し、外部のStripeには接続しない。
`billing.test.ts` は実コンポーネントで切り替え、金額、札、無効ボタン、3プランの送信周期を検査する。
共有Toggleを再利用し、ページ固有CSS Moduleで正本の40×22pxに合わせる。
この静的に解決できないclassName 1件だけをdesign-debt基準に記録する。生の色・独自ボタン・任意値クラスは増やさない。
共有Buttonの利用先は増減しないため、design-impact-baselineは変更しない。ページ数も変わらない。

専用PRを `codex/development` に統合し、最新コードとの一致とクリーン状態を確認してから
`pnpm deploy:lock` → `pnpm deploy:staging`（dry-run）→ `pnpm deploy:staging -- --apply`。
対象は開発・検証のみ。本番のコード、DB、設定には触れない。
切り戻しは変更のrevert PRから同じ配備手順で反映する。DBの復元は不要。

StripeテストモードのCheckoutで年額・年ごとの請求を確認し、テストカードで申込み後、
契約中（年払い）と約1年後の更新日を確認する。月払いも従来どおり確認する。
