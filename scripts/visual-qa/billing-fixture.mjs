/** ローカルの表示確認だけに使う料金。鍵・価格ID・外部決済は持たない。 */
export const BILLING_SUMMARY = {
  state: 'trialing', planKey: null, planInterval: null, planName: null, planStatus: 'trialing',
  trialEndsAt: '2026-10-12T00:00:00.000Z', trialEndsLabel: '10/12', trialDaysLeft: 25,
  trialMonthlyImages: 20, currentPeriodEndsAt: null, currentPeriodEndsLabel: null,
  canSend: true, canGenerate: true, blockedReason: null, dataRetentionDays: 90,
  stripeReady: true, portalAvailable: false,
  plans: [
    { key: 'light', name: 'ライト', description: '1店舗で始める', monthlyYen: 9800, yearlyYen: 99000,
      monthlyImages: 50, maxStaff: 3, recommended: false,
      features: ['LINE公式アカウント 1', '権限者 3人', '配信 月 5,000通', 'バナー生成 月 50枚', '登録メディア 5GB'] },
    { key: 'standard', name: 'スタンダード', description: '複数店舗をまとめて運用', monthlyYen: 29800, yearlyYen: 303000,
      monthlyImages: 150, maxStaff: 10, recommended: true,
      features: ['LINE公式アカウント 5', '権限者 10人', '配信 月 30,000通', 'バナー生成 月 150枚', '登録メディア 30GB', '統括ひな形の配布'] },
    { key: 'pro', name: 'プロ', description: '本部主導で大きく回す', monthlyYen: 59800, yearlyYen: 609000,
      monthlyImages: 500, maxStaff: null, recommended: false,
      features: ['LINE公式アカウント 無制限', '権限者 無制限', '配信 月 100,000通', 'バナー生成 月 500枚', '登録メディア 200GB', '優先サポート・API'] },
  ].map((plan) => ({ ...plan, cta: 'checkout', available: true, yearlyAvailable: true, priceFromStripe: true, yearlyPriceFromStripe: true, current: false })),
}
