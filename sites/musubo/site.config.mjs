// Public information only. Never put credentials or customer data in this file.
export default {
  origin: "https://musubo.jp",
  previewOrigin: "https://stg.musubo.jp",
  stagingAppOrigin: "https://nen-line-stg-admin.pages.dev",
  // Set only after the production /register AND /login pages have been verified.
  // Verified 2026-10-02: /register, /login and / all returned HTTP 200 with the
  // real sign-up and sign-in pages (not a fallback or error page).
  productionAppOrigin: "https://admin.musubo.jp",
  operator: {
    name: "Shed Products株式会社",
    representative: "代表取締役 山本 恭平",
    address: "東京都世田谷区上野毛４丁目２２番２号カヤカミノゲ１Ｆ",
    phone: "公式LINEの窓口からご請求いただいた場合、遅滞なく電話番号を開示します。",
    supportLineUrl: "https://lin.ee/nITNIsa",
    supportHours:
      "公式LINEは24時間受付。返信は平日10:00〜18:00（土日祝・年末年始を除く）。",
  },
  // The application's fallback prices are not the authoritative Stripe prices.
  // The live amounts shown on the sign-up screen are the authoritative source,
  // so this text intentionally does not restate the amounts.
  commercial: {
    prices:
      "ライト・スタンダード・プロの3つの月額プラン（いずれも税込・月払いと年払いを選べます）。年払いは月払いより割安です。初めてのお申込みは30日間の無料体験から始められます。各プランの税込金額と追加費用は、お申込み画面に表示される最新の金額が正式なものです。",
    paymentTiming:
      "お支払いはクレジットカードのみです。お申込み手続きが完了した時点で初回のご請求が発生し、以後は月払いなら毎月、年払いなら毎年、同じ更新日にご請求します。無料体験から有料プランへは、お客様がお申込み手続きをされたときに切り替わります。",
    cancellation:
      "解約はいつでもお手続きいただけます。解約されたお支払い期間の末日まではそのままご利用いただけ、次回の更新が停止します。お手続きは管理画面の「課金プラン」から「支払い方法を管理」へ進み、決済代行会社Stripeのページで行います。期間の末日を過ぎると配信と生成の機能は停止し、それまでの内容の閲覧のみ可能になります。",
    refunds:
      "サービスの性質上、ご利用期間中の日割りでの返金は行いません。当社の責めに帰すべき不具合によりご利用いただけなかった場合は、公式LINEの窓口にご連絡いただいたうえで個別に対応します。",
  },
  legal: {
    approved: true,
    effectiveDate: "2026-10-03",
    retention:
      "解約または無料体験の終了から90日間はお客様のデータを保存し、その後に削除します。90日の間にご連絡いただければ、それより早い削除にも対応します。",
    overseasProcessing:
      "お問い合わせメールの送受信は日本国内のサーバー（エックスサーバー）で処理します。サイトの配信とデータの保管（Cloudflare）、LINEの配信（LINEヤフー）、Googleビジネスプロフィールとの連携（Google）、決済（Stripe）、文章の生成（OpenAI）では、各社の設備の所在地により日本国外で処理される場合があります。委託先の一覧はプライバシーポリシーに記載しています。",
  },
};
