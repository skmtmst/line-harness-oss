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

const arrowIcon = (size = 10) =>
  `<span class="arrow"><svg width="${size}" height="${size}" aria-hidden="true"><use href="#arrow"/></svg></span>`;

export function button(url, text) {
  return `<a class="btn-dark" href="${escapeHtml(url)}">${text}${arrowIcon(11)}</a>`;
}

// Shared SVG symbols: the musubo mark and the arrow used inside buttons.
const symbols = `<svg width="0" height="0" class="svg-defs" aria-hidden="true"><defs><symbol id="mk" viewBox="0 0 30 30"><path d="M4 24V12a5 5 0 0 1 10 0v12" stroke="var(--mk1,#1E8A5A)" stroke-width="4" stroke-linecap="round" fill="none"/><path d="M14 24V12a5 5 0 0 1 10 0v12" stroke="var(--mk2,#143E34)" stroke-width="4" stroke-linecap="round" fill="none"/></symbol><symbol id="arrow" viewBox="0 0 10 10"><path d="M2 5h6M5 2l3 3-3 3" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></symbol></defs></svg>`;

// Scroll-drawn ribbon behind the top page (decorative).
const ribbon = `<svg id="ribbon" aria-hidden="true" fill="none" preserveAspectRatio="none">
  <defs><linearGradient id="rbG" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="4000"><stop offset="0" stop-color="#1E8A5A"/><stop offset=".5" stop-color="#5DB383"/><stop offset="1" stop-color="#143E34"/></linearGradient></defs>
  <path id="rbMain" stroke="url(#rbG)" stroke-linecap="round" stroke-width="96"/>
  <path id="rbFlow" stroke="rgba(255,255,255,.35)" stroke-linecap="round" stroke-width="6" stroke-dasharray="18 382"/>
</svg>`;

const mark = (size = 28) =>
  `<svg width="${size}" height="${size}" aria-hidden="true"><use href="#mk"/></svg>`;

// JSON-LD is an inert data block (not executed), so it is compatible with script-src 'self'.
const jsonLd = (data) =>
  `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;

export function structuredData({ path, heading, config, origin }) {
  const org = {
    "@type": "Organization",
    "@id": `${origin}/#organization`,
    name: config.operator.name,
    url: `${origin}/`,
    logo: `${origin}/assets/icon-512.png`,
    address: {
      "@type": "PostalAddress",
      streetAddress: config.operator.address,
      addressCountry: "JP",
    },
    ...(isSupportLine(config.operator.supportLineUrl)
      ? {
          contactPoint: {
            "@type": "ContactPoint",
            contactType: "customer support",
            url: config.operator.supportLineUrl,
            availableLanguage: "ja",
          },
        }
      : {}),
  };
  const graph = [
    org,
    {
      "@type": "WebSite",
      "@id": `${origin}/#website`,
      name: "musubo",
      url: `${origin}/`,
      inLanguage: "ja",
      publisher: { "@id": `${origin}/#organization` },
    },
  ];
  if (path !== "/" && heading)
    graph.push({
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "ホーム", item: `${origin}/` },
        { "@type": "ListItem", position: 2, name: heading, item: `${origin}${path}` },
      ],
    });
  return jsonLd({ "@context": "https://schema.org", "@graph": graph });
}

export function notFoundBody() {
  return `<section class="sub-hero"><div class="sub-hero-card"><div class="sub-watermark" aria-hidden="true">404</div><div class="sub-hero-inner"><div class="sub-label"><div class="rule"></div><div class="en">404 NOT FOUND</div></div><h1>ページが見つかりません</h1><p class="sub-lead">お探しのページは、URLが変わったか、削除された可能性があります。お手数ですが、トップページからお進みください。</p><p class="nf-actions">${button("/", "musuboのトップへ")}<a class="text-link" href="/contact/">お問い合わせ</a></p></div></div></section>`;
}

export function layout({
  title,
  description,
  path = "/",
  heading,
  body,
  config,
  production,
  noindex = false,
}) {
  const origin = production ? config.origin : config.previewOrigin;
  const pageUrl = `${origin}${path}`;
  const app = escapeHtml(
    production ? config.productionAppOrigin : config.stagingAppOrigin,
  );
  const preview = production
    ? ""
    : '<div class="preview-note" role="note">確認用サイト · 登録・ログインは検証環境です。実際の申込みには使わないでください。</div>';
  return `<!doctype html>
<html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}">
<meta name="robots" content="${production && !noindex ? "index,follow" : "noindex,nofollow"}">
${production && !noindex ? `<link rel="canonical" href="${escapeHtml(pageUrl)}">` : ""}
<meta name="theme-color" content="#143e34">
<meta property="og:site_name" content="musubo"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:type" content="website"><meta property="og:locale" content="ja_JP"><meta property="og:url" content="${escapeHtml(pageUrl)}">
<meta property="og:image" content="${escapeHtml(origin)}/assets/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="musubo そのつながりを、もっと、育てよう。お店とお客さまを結ぶ、LINE運用ツール">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${escapeHtml(origin)}/assets/og.png">
<link rel="icon" href="/assets/favicon-32.png" sizes="32x32" type="image/png"><link rel="icon" href="/assets/favicon-16.png" sizes="16x16" type="image/png"><link rel="icon" href="/assets/symbol.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/assets/apple-touch-icon.png" sizes="180x180"><link rel="manifest" href="/assets/site.webmanifest">
<link rel="stylesheet" href="/assets/site.css"><script src="/assets/site.js" defer></script>
${noindex ? "" : structuredData({ path, heading, config, origin })}</head>
<body class="${path === "/" ? "home" : "sub"}"><a class="skip-link" href="#main">本文へ移動</a>${preview}
${symbols}
<div id="page">
${path === "/" ? ribbon : ""}
<header class="site-header">
  <div class="bar">
    <a href="/" class="logo" aria-label="musubo ホーム">${mark()}<span>musubo</span></a>
    <nav class="site-nav" aria-label="メインメニュー"><a href="/#features">できること</a><a href="/#start">はじめ方</a><a href="/#plans">料金について</a><a href="/#faq">よくある質問</a></nav>
    <div class="header-actions">
      <a href="${app}/login" class="login">ログイン</a>
      <a href="${app}/register" class="btn-dark">新規登録${arrowIcon()}</a>
      <button type="button" class="menu-btn" aria-expanded="false" aria-controls="mobile-nav" aria-label="メニューを開く"><i></i><i></i></button>
    </div>
  </div>
  <div class="mobile-menu" id="mobile-nav" hidden>
    <nav aria-label="モバイルメニュー">
      <a href="/#features">できること<span class="en">FEATURES</span></a>
      <a href="/#start">はじめ方<span class="en">START</span></a>
      <a href="/#plans">料金について<span class="en">PLANS</span></a>
      <a href="/#faq">よくある質問<span class="en">FAQ</span></a>
      <a href="/contact/">お問い合わせ<span class="en">CONTACT</span></a>
    </nav>
    <div class="mm-actions">
      <a href="${app}/register" class="btn-dark">無料で新規登録${arrowIcon(11)}</a>
      <a href="${app}/login" class="mm-login">ログイン</a>
    </div>
  </div>
</header>
<main id="main">${body}</main>
<footer class="site-footer" id="footer">
  <div class="wrap cols">
    <div>
      <div class="brand mk-light">${mark()}<span>musubo</span></div>
      <div class="slogan">人と人を、結ぼう。</div>
    </div>
    <nav class="links" aria-label="フッターメニュー"><a href="/#features">できること</a><a href="/#plans">料金について</a><a href="/contact/">お問い合わせ</a><a href="${app}/login">ログイン</a></nav>
    <nav class="links" aria-label="法務情報"><a href="/terms/">利用規約</a><a href="/privacy/">プライバシーポリシー</a><a href="/legal/">特定商取引法に基づく表記</a></nav>
    <div class="contact">お問い合わせは公式LINEから（24時間受付）。返信は平日10:00〜18:00（土日祝・年末年始を除く）。</div>
  </div>
  <div class="wrap legal">
    <span>© ${new Date().getFullYear()} ${escapeHtml(config.operator.name)}</span><span>LINEはLINEヤフー株式会社の商標または登録商標です。musuboは同社の公式サービスではありません。</span>
  </div>
</footer>
</div>
</body></html>`;
}
