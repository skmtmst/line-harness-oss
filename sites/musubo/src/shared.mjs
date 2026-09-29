export const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );

export function isHttpsOrigin(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.origin === value
    );
  } catch {
    return false;
  }
}

export function isSupportLine(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      ["lin.ee", "line.me"].includes(url.hostname) &&
      url.pathname !== "/"
    );
  } catch {
    return false;
  }
}

export function publicationIssues(config) {
  const issues = [];
  if (!isHttpsOrigin(config.origin)) issues.push("サイトの公開URL");
  if (
    !isHttpsOrigin(config.productionAppOrigin) ||
    config.productionAppOrigin === config.stagingAppOrigin
  )
    issues.push("確認済みの本番登録・ログインURL");
  for (const [key, label] of Object.entries({
    name: "運営会社",
    representative: "代表者",
    address: "所在地",
    phone: "電話番号",
    supportHours: "問い合わせ受付時間",
  })) {
    if (!config.operator[key]?.trim()) issues.push(label);
  }
  if (!isSupportLine(config.operator.supportLineUrl))
    issues.push("問い合わせ公式LINEのURL");
  for (const [key, label] of Object.entries({
    prices: "税込料金・追加費用",
    paymentTiming: "支払時期",
    cancellation: "更新・解約条件",
    refunds: "返金条件",
  })) {
    if (!config.commercial[key]?.trim()) issues.push(label);
  }
  if (!config.legal.approved) issues.push("法務文面の承認");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(config.legal.effectiveDate))
    issues.push("施行日");
  if (!config.legal.retention?.trim()) issues.push("データ保存・削除方針");
  if (!config.legal.overseasProcessing?.trim())
    issues.push("国外取扱い・委託先の確認");
  return issues;
}

export const arrow = '<span aria-hidden="true">↗</span>';
export function logo() {
  return '<a class="brand" href="/" aria-label="musubo ホーム"><img src="/assets/symbol.svg" width="34" height="34" alt=""><span>musubo</span></a>';
}

export function button(url, text, style = "primary") {
  return `<a class="button button-${style}" href="${escapeHtml(url)}">${text}${arrow}</a>`;
}

export function layout({
  title,
  description,
  path = "/",
  body,
  config,
  production,
}) {
  const app = production ? config.productionAppOrigin : config.stagingAppOrigin;
  const preview = production
    ? ""
    : '<div class="preview-note">確認用サイト · 登録・ログインは検証環境です。実際の申込みには使わないでください。</div>';
  return `<!doctype html>
<html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}">
<meta name="robots" content="${production ? "index,follow" : "noindex,nofollow"}">
${production ? `<link rel="canonical" href="${escapeHtml(config.origin + path)}">` : ""}
<meta name="theme-color" content="#143e34"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:type" content="website"><meta property="og:locale" content="ja_JP">
<link rel="icon" href="/assets/symbol.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/site.css"><script src="/assets/site.js" defer></script></head>
<body><a class="skip-link" href="#main">本文へ移動</a>${preview}
<header class="site-header"><div class="header-inner">${logo()}
<nav class="desktop-nav" aria-label="メインメニュー"><a href="/#features">できること</a><a href="/#start">はじめ方</a><a href="/#plans">料金について</a></nav>
<div class="header-actions"><a class="login-link" href="${app}/login">ログイン</a>${button(`${app}/register`, "新規登録", "small")}<button class="menu-toggle" aria-expanded="false" aria-controls="mobile-nav" aria-label="メニューを開く"><span></span><span></span></button></div></div>
<nav id="mobile-nav" class="mobile-nav" aria-label="モバイルメニュー" hidden><a href="/#features">できること</a><a href="/#start">はじめ方</a><a href="/#plans">料金について</a><a href="/#faq">よくある質問</a><a href="${app}/login">ログイン</a></nav></header>
<main id="main">${body}</main>
<footer class="site-footer"><div class="wrap"><div class="footer-top"><div>${logo()}<p>人と人を、結ぼう。</p></div><nav aria-label="フッターメニュー"><a href="/#features">できること</a><a href="/#plans">料金について</a><a href="/contact/">お問い合わせ</a><a href="${app}/login">ログイン</a></nav></div>
<div class="footer-bottom"><nav aria-label="法務情報"><a href="/terms/">利用規約</a><a href="/privacy/">プライバシーポリシー</a><a href="/legal/">特定商取引法に基づく表記</a></nav><small>© ${new Date().getFullYear()} musubo</small></div>
<p class="trademark">LINEはLINEヤフー株式会社の商標または登録商標です。musuboは同社の公式サービスではありません。</p></div></footer></body></html>`;
}
