// Public information only. Never put credentials or customer data in this file.
export default {
  origin: "https://musubo.jp",
  previewOrigin: "https://stg.musubo.jp",
  stagingAppOrigin: "https://nen-line-stg-admin.pages.dev",
  // Set only after the production /register AND /login pages have been verified.
  productionAppOrigin: "",
  operator: {
    name: "Shed Products株式会社",
    representative: "代表取締役 山本 恭平",
    address: "東京都世田谷区上野毛４丁目２２番２号カヤカミノゲ１Ｆ",
    phone: "",
    supportLineUrl: "",
    supportHours: "",
  },
  // The application's fallback prices are not the authoritative Stripe prices.
  // Confirm the commercial terms with Masato before public release.
  commercial: {
    prices: "",
    paymentTiming: "",
    cancellation: "",
    refunds: "",
  },
  legal: {
    // 法務文面の承認・保存期間の日数・国外処理の案内は、この枝では触らない。
    // 日数は packages/shared/src/data-retention.json を読む仕組みが前提で、
    // その読み込み処理（DATA_RETENTION_DAYS）はまだ main に無い。
    // 公開サイトの承認済み文面を main へ上げるのは別の作業として分ける。
    approved: false,
    effectiveDate: "",
    retention: "",
    overseasProcessing: "",
  },
};
