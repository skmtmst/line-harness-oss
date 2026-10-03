/**
 * オートメーション一覧 (1152板 En14p) と実装の数字突き合わせ契約。
 * 板: padding 20・gap 12 / KPI見出し 13px #131118 粗500 / KPI数字 22px #131118 粗600
 *     表の見出し padding:13px 20px 13px 粗600 #3d3d3d 地 #fafafb。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PAGE = readFileSync(
  resolve(__dirname, "../automations/page.tsx"),
  "utf-8",
);

describe("automations 一覧の板の数字", () => {
  it("KPI見出しは13px・#131118・粗500 (text-xs font-medium text-ink)", () => {
    expect(PAGE).toMatch(/text-xs font-medium text-ink/);
    expect(PAGE).not.toMatch(/text-ink-faint text-xs">動いているもの/);
  });

  it("KPI数字は22px・粗600 (text-metric トークン)", () => {
    expect(PAGE).toMatch(/text-metric font-semibold/);
    expect(PAGE).not.toMatch(/text-2xl font-bold/);
    expect(PAGE).not.toMatch(/text-\[22px\]/);
  });

  it("KPIカード内側は左右20・上下16 (px-5 py-4)", () => {
    const cards = PAGE.match(/rounded-card border-hairline border (px-5 py-4|p-4)/g) ?? [];
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) expect(c).toContain("px-5 py-4");
  });

  it("表の見出しは左右20・上下13・#3d3d3d・地table-head (px-5 py-[13px] text-ink-secondary bg-table-head)", () => {
    expect(PAGE).toMatch(/bg-table-head px-5 py-\[13px\] text-xs font-semibold text-ink-secondary/);
  });
});
