import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * 名寄せパネル（`w1W8h`）の数字の契約。
 * 見本 `lint/V8-B/w1W8h.html` との突き合わせ（2026-10-03）。
 * 主体カードは内側16・間隔12、比較の段は内側16。
 * 件数・日付は API の実値を出す（見本の数は書かない）。
 */

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "identity-review.module.css"), "utf8");

function block(selector: string): string {
  const m = css.match(new RegExp(`${selector}\\s*{([^}]*)}`));
  if (!m) throw new Error(`${selector} が無い`);
  return m[1];
}

describe("identity-review-numfix (w1W8h)", () => {
  it("主体カードは縦積み・間隔12・内側16", () => {
    const b = block("\\.subject");
    expect(b).toMatch(/flex-direction:\s*column/);
    expect(b).toMatch(/gap:\s*12px/);
    expect(b).toMatch(/padding:\s*16px/);
  });

  it("比較の段は縦積み・内側16", () => {
    const b = block("\\.section");
    expect(b).toMatch(/flex-direction:\s*column/);
    expect(b).toMatch(/padding:\s*16px/);
  });
});
