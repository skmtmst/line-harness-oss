import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import config from "./site.config.mjs";
import { isHttpsOrigin, layout, notFoundBody, publicationIssues } from "./src/shared.mjs";
import { home } from "./src/home.mjs";
import { legalBody } from "./src/legal.mjs";

const root = dirname(fileURLToPath(import.meta.url));

// Replace every style="..." attribute with a class whose rule carries the same declarations.
// !important keeps the inline-style precedence the design relied on.
export function extractInlineStyles(html, styles = new Map()) {
  return html.replace(/<[a-zA-Z][^<>]*\sstyle="([^"]*)"[^<>]*>/g, (tag, decl) => {
    const name = `s-${createHash("sha256").update(decl).digest("hex").slice(0, 10)}`;
    styles.set(name, decl);
    let out = tag.replace(/\sstyle="[^"]*"/, "");
    if (/\sclass="/.test(out)) out = out.replace(/\sclass="([^"]*)"/, (_, c) => ` class="${c} ${name}"`);
    else out = out.replace(/^<([a-zA-Z][\w:-]*)/, `<$1 class="${name}"`);
    return out;
  });
}

export function importantDeclarations(decl) {
  return decl
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => `${d} !important`)
    .join(";");
}
export async function build({
  production = false,
  settings = config,
  output = join(root, "dist", production ? "production" : "preview"),
} = {}) {
  if (!isHttpsOrigin(settings.stagingAppOrigin))
    throw new Error("検証用アプリURLはHTTPSのoriginで指定してください");
  if (
    !production &&
    (!isHttpsOrigin(settings.previewOrigin) ||
      settings.previewOrigin === settings.origin)
  )
    throw new Error(
      "確認用サイトは本番と異なるHTTPSのoriginで指定してください",
    );
  if (production) {
    const issues = publicationIssues(settings);
    if (issues.length)
      throw new Error(
        `正式公開を停止しました。未確定項目：${issues.join("、")}`,
      );
  }
  // Titles put the page content first ("内容 | サイト名"); descriptions summarise the page
  // and invite the next step (about 140 characters or more).
  const pages = [
    {
      path: "/",
      title: "お店とお客さまを結ぶLINE運用ツール | musubo",
      description:
        "musubo（ムスボ）は、LINE公式アカウントにつないで使う運用ツールです。一斉配信やステップ配信、友だち管理、1対1チャット、回答フォームと予約、リッチメニューやAIバナー生成、GoogleビジネスプロフィールとInstagramへの同時投稿、複数店舗の管理までをひとつの画面で。30日間の無料トライアルで、まずは使い心地をお確かめください。",
      body: home(settings, production),
    },
    ...Object.entries({
      terms: [
        "利用規約",
        "LINE運用ツール「musubo」の利用規約です。利用登録とアカウントの管理、サービスの内容と外部サービス（LINE公式アカウント・Googleビジネスプロフィール等）との連携、30日間の無料トライアルと利用料金、更新・解約・返金、配信内容とお客さまの情報、AI機能、禁止事項などの利用条件を定めています。お申込みの前にご確認ください。",
      ],
      privacy: [
        "プライバシーポリシー",
        "LINE運用ツール「musubo」のプライバシーポリシーです。取り扱う情報と利用目的、お店からお預かりする情報の扱い、委託先と外部サービス、Googleビジネスプロフィール・Instagram連携で取り扱うデータ、安全管理、保存期間と削除、開示・訂正・利用停止等の請求方法とお問い合わせ窓口をご案内します。",
      ],
      legal: [
        "特定商取引法に基づく表記",
        "LINE運用ツール「musubo」の特定商取引法に基づく表記です。役務提供事業者と所在地、お問い合わせ窓口、販売価格・利用料金、料金以外に必要な費用、お支払方法と時期、30日間の無料トライアル、契約期間・自動更新・解約、返金の条件、動作環境をまとめています。お申込みの前にご確認ください。",
      ],
      contact: [
        "お問い合わせ",
        "LINE運用ツール「musubo」へのお問い合わせは、公式LINEで受け付けています。ご質問やご相談は、友だち追加してトークからメッセージを送るだけ。公式LINEは24時間受付、返信は平日10:00〜18:00（土日祝・年末年始を除く）です。運営会社の情報や、お問い合わせの際の注意点もこちらでご確認いただけます。",
      ],
    }).map(([kind, [title, description]]) => ({
      path: `/${kind}/`,
      title: `${title} | musubo`,
      heading: title,
      description,
      body: legalBody(kind, settings, production),
    })),
  ];
  await mkdir(output, { recursive: true });
  await cp(join(root, "public"), output, { recursive: true });
  const styles = new Map();
  for (const page of pages) {
    const target = join(output, page.path, "index.html");
    await mkdir(dirname(target), { recursive: true });
    await writeFile(
      target,
      extractInlineStyles(layout({ ...page, config: settings, production }), styles),
    );
  }
  // Custom 404 (served through ErrorDocument). Not listed in the sitemap and never indexed.
  await writeFile(
    join(output, "404.html"),
    extractInlineStyles(
      layout({
        path: "/404.html",
        title: "ページが見つかりません | musubo",
        description:
          "お探しのページは見つかりませんでした。URLが変わったか、削除された可能性があります。musuboのトップページから、できること・はじめ方・料金・よくある質問をご覧いただけます。",
        body: notFoundBody(),
        config: settings,
        production,
        noindex: true,
      }),
      styles,
    ),
  );
  // The CSP allows only same-origin stylesheets, so style="" attributes from the design
  // markup become generated classes appended to site.css.
  const cssFile = join(output, "assets", "site.css");
  await writeFile(
    cssFile,
    (await readFile(cssFile, "utf8")) +
      "\n/* generated from design markup by build.mjs */\n" +
      [...styles].map(([name, decl]) => `.${name}{${importantDeclarations(decl)}}`).join("\n") +
      "\n",
  );
  await writeFile(
    join(output, "robots.txt"),
    production
      ? `User-agent: *\nAllow: /\nSitemap: ${settings.origin}/sitemap.xml\n`
      : "User-agent: *\nDisallow: /\n",
  );
  await writeFile(
    join(output, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${production ? pages.map((page) => `<url><loc>${settings.origin}${page.path}</loc></url>`).join("") : ""}</urlset>`,
  );
  const previewHost = production
    ? ""
    : new URL(settings.previewOrigin).hostname.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      );
  // Xserver subdomains live under the apex web root. Deny the alternate apex path.
  const hostGuard = production
    ? `RewriteEngine On\nRewriteCond %{HTTPS} !on\nRewriteRule ^ ${settings.origin}%{REQUEST_URI} [R=301,L]\n`
    : `RewriteEngine On\nRewriteCond %{HTTP_HOST} !^${previewHost}(?::80|:443)?$ [NC]\nRewriteRule ^ - [F,L]\nRewriteCond %{HTTPS} !on\nRewriteRule ^ ${settings.previewOrigin}%{REQUEST_URI} [R=301,L]\n`;
  await writeFile(
    join(output, ".htaccess"),
    `${hostGuard}Options -Indexes\nDirectoryIndex index.html\nErrorDocument 404 /404.html\n<IfModule mod_headers.c>\n Header always set X-Content-Type-Options "nosniff"\n Header always set Referrer-Policy "strict-origin-when-cross-origin"\n Header always set X-Frame-Options "DENY"\n Header always set Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"\n${production ? "" : ' Header always set X-Robots-Tag "noindex, nofollow"\n'} Header always set Cache-Control "no-cache"\n</IfModule>\n`,
  );
  return { output, paths: pages.map((page) => page.path) };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const flags = process.argv.slice(2);
  if (flags.some((flag) => flag !== "--production"))
    throw new Error("Usage: node build.mjs [--production]");
  try {
    const result = await build({ production: flags.includes("--production") });
    console.log(
      `${flags.length ? "正式公開用" : "確認用"}サイト: ${result.paths.length}ページを構築しました (${result.output})`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
