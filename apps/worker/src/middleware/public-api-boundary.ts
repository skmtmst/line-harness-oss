/**
 * 管理者認証より手前へ通す公開境界。authMiddleware の skip 判定と
 * 同じ意味で、method を区別する口もここで扱う。
 */
export function isPublicFormDefinition(method: string, path: string): boolean {
  return method.toUpperCase() === 'GET' && /^\/api\/forms\/[^/]+$/.test(path);
}

/** Includes the existing LIFF event compatibility URL, with its POST restriction. */
export function isPublicLiffOperation(method: string, path: string): boolean {
  return path.startsWith('/api/liff/')
    || (method.toUpperCase() === 'POST' && /^\/api\/events\/liff\/bookings\/[^/]+\/change$/.test(path));
}

export function isPublicApiBoundary(method: string, path: string): boolean {
  const normalizedMethod = method.toUpperCase();
  if(normalizedMethod==='POST' && (path==='/api/ec/events'||path==='/api/booking/pass-payments/webhook'||path==='/mcp'))return true;
  // フォーム定義の GET は LIFF が認証なしで読む。PUT/DELETE は管理 API。
  if (isPublicFormDefinition(normalizedMethod, path)) return true;
  // This compatibility URL is a LIFF operation and verifies the customer in
  // the event route. Only this method/path bypasses administrator login.
  if (isPublicLiffOperation(normalizedMethod, path)) return true;
  // LIFF の回答・開封・途中保存は route 側で LINE 署名を見る。
  if (
    normalizedMethod === 'POST' &&
    (/^\/api\/forms\/[^/]+\/submit$/.test(path) ||
      /^\/api\/forms\/[^/]+\/opened$/.test(path) ||
      /^\/api\/forms\/[^/]+\/partial$/.test(path) ||
      /^\/api\/forms\/[^/]+\/files$/.test(path))
  ) {
    return true;
  }
  return (
    path === '/webhook' ||
    (normalizedMethod === 'POST' && /^\/webhook\/\d+$/.test(path)) ||
    path === '/docs' ||
    path === '/openapi.json' ||
    path === '/api/affiliates/click' ||
    path === '/webhooks/xserver/support-email' ||
    path === '/api/public/nen/adopted-photos' ||
    path === '/api/public/nen/gallery-preview' ||
    path === '/api/site/collect' ||
    path === '/api/site/script.js' ||
    // #819: 計測タグからの成果受信。サイトIDと許可ドメインで検証する
    // 公開口で、管理画面の認証は通さない(OPTIONSの事前確認も含む)。
    path === '/api/public/web-conversions' ||
    path.startsWith('/t/') ||
    path.startsWith('/r/') ||
    path.startsWith('/pool/') ||
    path.startsWith('/images/') ||
    (normalizedMethod === 'GET' && /^\/liff\/(?:files|statements)\/[\w-]+$/.test(path)) ||
    path === '/api/auth/login' ||
    path === '/api/auth/logout' ||
    path === '/api/auth/line' ||
    path === '/api/auth/line/callback' ||
    path === '/api/auth/two-factor/verify' ||
    // TOTP未登録の管理者の初回設定。合言葉で本人確認する公開経路（N-426）。
    path === '/api/auth/two-factor/setup' ||
    path === '/api/auth/two-factor/setup/confirm' ||
    // 会員登録・メールログイン・パスワード再設定。Turnstile と回数制限で守る。
    /^\/api\/auth\/(register|password|ops-invite)\//.test(path) ||
    /^\/api\/staff\/invitations\/[^/]+\/verify$/.test(path) ||
    // N-433: メール変更の確定。トークン自体が資格情報で、ログイン状態に依らない。
    path === '/api/staff/email-change/confirm' ||
    path.startsWith('/auth/') ||
    path === '/setup' ||
    path === '/api/integrations/stripe/webhook' ||
    path === '/api/instagram/webhook' ||
    // 課金の Stripe Webhook は route 内で署名検証する。
    path === '/api/hq/billing/webhook' ||
    path === '/api/integrations/eccube/events' ||
    path === '/api/integrations/eccube/columns' ||
    // ECから届く誕生日クーポンの利用記録。route 内で同じHMAC署名を確かめる。
    path === '/api/integrations/eccube/coupon-usages' ||
    path === '/api/internal/deployments/events' ||
    path === '/api/integrations/codex-slack/events' ||
    path === '/api/integrations/ai-loop/reports' ||
    path === '/api/integrations/slack/actions' ||
    path === '/api/integrations/slack/events' ||
    /^\/api\/webhooks\/incoming\/[^/]+\/receive$/.test(path) ||
    // N-270: 外部システムからの成果受信。route 内で地点ごとの
    // 受信鍵をHMAC-SHA256で照合する。管理画面の認証は通さない。
    (normalizedMethod === 'POST' && /^\/api\/conversions\/ingest\/[^/]+$/.test(path)) ||
    // デリバリー受注の通知受け口。route 内でサービスごとの合言葉を
    // HMAC-SHA256で照合し、受信台帳で重複を排除する。管理画面の認証は通さない。
    (normalizedMethod === 'POST' &&
      /^\/api\/restaurant-test\/delivery\/webhooks\/[^/]+$/.test(path)) ||
    // #939 N-380: 外部システム向け公開API。route 内で integration_api_tokens
    // の Bearer トークンを照合する。管理画面の認証は通さない。
    path.startsWith('/api/public/v1/') ||
    path === '/api/meet-callback' ||
    path === '/api/qr' ||
    path === '/api/public/brand' ||
    path === '/api/health'
  );
}
