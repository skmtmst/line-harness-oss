import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import config from "./site.config.mjs";
import { isHttpsOrigin, layout, publicationIssues } from "./src/shared.mjs";
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
  const pages = [
    {
      path: "/",
      title: "musubo｜人と人を結ぶ、LINE運用ツール",
      description:
        "そのつながりを、もっと育てよう。LINEの配信・友だち管理・チャット・フォーム・予約・複数店舗の管理をひとつに。musuboで、お客さまと向き合う時間を。",
      body: home(settings, production),
    },
    ...Object.entries({
      terms: "利用規約",
      privacy: "プライバシーポリシー",
      legal: "特定商取引法に基づく表記",
      contact: "お問い合わせ",
    }).map(([kind, title]) => ({
      path: `/${kind}/`,
      title: `${title}｜musubo`,
      description: `musuboの${title}をご案内します。`,
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
    ? ""
    : `RewriteEngine On\nRewriteCond %{HTTP_HOST} !^${previewHost}(?::80|:443)?$ [NC]\nRewriteRule ^ - [F,L]\nRewriteCond %{HTTPS} !on\nRewriteRule ^ ${settings.previewOrigin}%{REQUEST_URI} [R=301,L]\n`;
  await writeFile(
    join(output, ".htaccess"),
    `${hostGuard}Options -Indexes\nDirectoryIndex index.html\n<IfModule mod_headers.c>\n Header always set X-Content-Type-Options "nosniff"\n Header always set Referrer-Policy "strict-origin-when-cross-origin"\n Header always set X-Frame-Options "DENY"\n Header always set Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"\n${production ? "" : ' Header always set X-Robots-Tag "noindex, nofollow"\n'} Header always set Cache-Control "no-cache"\n</IfModule>\n`,
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
