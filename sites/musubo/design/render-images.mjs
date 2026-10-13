// Renders the site icons and the OGP image into ../public/assets. Run locally when the
// design changes:  node sites/musubo/design/render-images.mjs   (requires `playwright`).
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "public", "assets");
const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
);
const page = await browser.newPage();
for (const [name, size] of [
  ["favicon-16.png", 16],
  ["favicon-32.png", 32],
  ["apple-touch-icon.png", 180],
  ["icon-512.png", 512],
]) {
  await page.setViewportSize({ width: size, height: size });
  // iOS masks the corners itself and paints transparency black, so its icon is full-bleed.
  const svg = readFileSync(join(here, "icon.svg"), "utf8").replace(
    name === "apple-touch-icon.png" ? 'rx="20"' : "\u0000",
    'rx="0"',
  );
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`,
  );
  await page.screenshot({ path: join(out, name), omitBackground: true });
}
await page.setViewportSize({ width: 1200, height: 630 });
await page.goto(`file://${join(here, "og.html")}`);
await page.waitForTimeout(300);
await page.screenshot({ path: join(out, "og.png") });
await browser.close();
console.log("rendered icons and og.png");
