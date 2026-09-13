import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../build.mjs";
import config from "../site.config.mjs";
import {
  escapeHtml,
  isHttpsOrigin,
  isSupportLine,
  publicationIssues,
} from "../src/shared.mjs";

const dir = await mkdtemp(join(tmpdir(), "musubo-site-test-"));
const preview = await build({ output: join(dir, "preview") });
const page = (route, output = preview.output) =>
  readFile(join(output, route, "index.html"), "utf8");

test("all five pages have a Japanese title, heading, landmark, registration and login", async () => {
  assert.deepEqual(preview.paths, [
    "/",
    "/terms/",
    "/privacy/",
    "/legal/",
    "/contact/",
  ]);
  for (const route of preview.paths) {
    const html = await page(route);
    assert.match(html, /<html lang="ja">/);
    assert.equal([...html.matchAll(/<h1[ >]/g)].length, 1, route);
    assert.match(html, /<title>[^<]+musubo|<title>musubo/);
    assert.match(html, /<main id="main">/);
    assert.match(html, /<meta name="description" content="[^"]+">/);
    assert.ok(html.includes(`${config.stagingAppOrigin}/register`));
    assert.ok(html.includes(`${config.stagingAppOrigin}/login`));
  }
});

test("internal links, assets and fragment targets resolve on every page", async () => {
  for (const route of preview.paths) {
    const html = await page(route);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(ids.length, new Set(ids).size, `${route}: duplicate IDs`);
    for (const [, link] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      if (link.startsWith("https://")) {
        assert.ok(
          link.startsWith(config.stagingAppOrigin),
          `Unexpected network destination: ${link}`,
        );
        continue;
      }
      const target = new URL(link, `https://preview.invalid${route}`);
      const file = join(preview.output, target.pathname);
      const info = await stat(file);
      if (target.hash) {
        const targetHtml = await readFile(
          info.isDirectory() ? join(file, "index.html") : file,
          "utf8",
        );
        assert.ok(
          targetHtml.includes(`id="${target.hash.slice(1)}"`),
          `${route}: ${link}`,
        );
      }
    }
  }
});

test("preview is unmistakably non-public, non-indexable and cannot be used as production", async () => {
  for (const route of preview.paths) {
    const html = await page(route);
    assert.match(html, /確認用サイト/);
    assert.match(html, /name="robots" content="noindex,nofollow"/);
    assert.doesNotMatch(html, /rel="canonical"/);
  }
  assert.match(
    await readFile(join(preview.output, ".htaccess"), "utf8"),
    /X-Robots-Tag "noindex, nofollow"/,
  );
  assert.match(
    await readFile(join(preview.output, "robots.txt"), "utf8"),
    /Disallow: \//,
  );
  await assert.rejects(
    build({ production: true, output: join(dir, "blocked") }),
    /正式公開を停止/,
  );
  await assert.rejects(stat(join(dir, "blocked")), { code: "ENOENT" });
});

test("company identity is user-supplied, missing contacts and unapproved prices are not invented", async () => {
  const commerce = await page("/legal/");
  for (const field of ["name", "representative", "address"])
    assert.ok(commerce.includes(config.operator[field]));
  assert.match(commerce, /電話番号を取得中/);
  assert.match(commerce, /公式LINE窓口は準備中/);
  assert.doesNotMatch(commerce, /mailto:|href="tel:|9,800|29,800|59,800/);
  assert.match(await page("/terms/"), /正式な契約条件ではありません/);
  assert.match(await page("/privacy/"), /AI画像生成では/);
});

test("publication gate checks every commercial and legal requirement", () => {
  const issues = publicationIssues(config);
  for (const term of [
    "本番登録",
    "電話番号",
    "公式LINE",
    "受付時間",
    "税込料金",
    "支払時期",
    "解約",
    "返金",
    "承認",
    "施行日",
    "保存",
    "国外",
  ]) {
    assert.ok(
      issues.some((issue) => issue.includes(term)),
      `missing gate: ${term}`,
    );
  }
});

test("origins and official LINE URLs reject insecure, credential-bearing and spoofed values", () => {
  for (const url of [
    "",
    "http://example.com",
    "https://u:p@example.com",
    "https://example.com/register",
    "javascript:alert(1)",
  ])
    assert.equal(isHttpsOrigin(url), false);
  assert.equal(isHttpsOrigin("https://example.com"), true);
  for (const url of [
    "",
    "https://lin.ee.evil.test/a",
    "https://line.me@evil.test/a",
    "https://user@lin.ee/a",
    "http://lin.ee/a",
    "https://line.me/",
  ])
    assert.equal(isSupportLine(url), false);
  assert.equal(isSupportLine("https://lin.ee/test-fixture"), true);
});

test("configuration content is escaped before rendering", async () => {
  const settings = structuredClone(config);
  settings.operator.name = '<script>alert("x")</script>';
  const escaped = await build({ settings, output: join(dir, "escaped") });
  const html = await page("/legal/", escaped.output);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.equal(escapeHtml("&<>\"'"), "&amp;&lt;&gt;&quot;&#39;");
});

test("approved fixture builds production with correct URLs and without draft copy", async () => {
  // Synthetic fixture ONLY. It is never written back to site.config.mjs or deployed.
  const settings = structuredClone(config);
  settings.productionAppOrigin = "https://app.example.com";
  Object.assign(settings.operator, {
    phone: "テスト値",
    supportLineUrl: "https://lin.ee/test-fixture",
    supportHours: "テスト受付時間",
  });
  Object.assign(settings.commercial, {
    prices: "テスト料金",
    paymentTiming: "テスト支払時期",
    cancellation: "テスト解約条件",
    refunds: "テスト返金条件",
  });
  Object.assign(settings.legal, {
    approved: true,
    effectiveDate: "2026-09-13",
    retention: "テスト保存方針",
    overseasProcessing: "テスト取扱い方針",
  });
  assert.deepEqual(publicationIssues(settings), []);
  const production = await build({
    production: true,
    settings,
    output: join(dir, "production-fixture"),
  });
  for (const route of production.paths) {
    const html = await page(route, production.output);
    assert.doesNotMatch(
      html,
      /確認用サイト|草案|正式公開前に確定|窓口の準備中|文面作成日/,
    );
    assert.ok(!html.includes(settings.stagingAppOrigin));
    assert.match(html, /content="index,follow"/);
    assert.ok(html.includes(`href="${settings.origin}${route}"`));
  }
  assert.match(
    await readFile(join(production.output, "sitemap.xml"), "utf8"),
    /https:\/\/musubo.jp\/legal\//,
  );
  settings.productionAppOrigin = settings.stagingAppOrigin;
  assert.ok(
    publicationIssues(settings).some((issue) => issue.includes("本番登録")),
  );
});

test("static site does not collect information, install trackers, or embed external scripts", async () => {
  const js = await readFile(
    new URL("../public/assets/site.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    js,
    /fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|document.cookie|eval\(/,
  );
  for (const route of preview.paths) {
    const html = await page(route);
    assert.doesNotMatch(
      html,
      /<form\b|<iframe\b|<script[^>]+src="https?:|<link[^>]+href="https?:[^>]+stylesheet/,
    );
  }
  const htaccess = await readFile(join(preview.output, ".htaccess"), "utf8");
  assert.match(htaccess, /Options -Indexes/);
  assert.match(htaccess, /connect-src 'none'/);
  assert.match(htaccess, /frame-ancestors 'none'/);
});

test("mobile controls, native FAQ, reduced motion and sample disclosures are present", async () => {
  const html = await page("/");
  assert.match(html, /aria-controls="mobile-nav"/);
  assert.equal([...html.matchAll(/data-demo="/g)].length, 3);
  assert.equal([...html.matchAll(/<details>/g)].length, 5);
  assert.match(html, /表示はサンプル/);
  assert.match(html, /実際の管理画面の表示とは異なります/);
  const css = await readFile(
    new URL("../public/assets/site.css", import.meta.url),
    "utf8",
  );
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /focus-visible/);
  assert.match(css, /\[hidden\]/);
});

test("package contains only static public output, not source or configuration", async () => {
  const files = await readdir(preview.output);
  assert.deepEqual(files.sort(), [
    ".htaccess",
    "assets",
    "contact",
    "index.html",
    "legal",
    "privacy",
    "robots.txt",
    "sitemap.xml",
    "terms",
  ]);
});
