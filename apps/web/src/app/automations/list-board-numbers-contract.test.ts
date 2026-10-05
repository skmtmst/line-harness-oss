/**
 * オートメーション一覧 (1152板 En14p) と実装の数字突き合わせ契約。
 * 板: padding 20・gap 12 / KPI見出し 13px #131118 粗500 / KPI数字 22px #131118 粗600
 *     表の見出し 上下12・左右24（--tpl-thead-*） 粗600 secondary 地 table-head。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PAGE = readFileSync(
  resolve(__dirname, "../automations/page.tsx"),
  "utf-8",
);
const LIST = readFileSync(resolve(__dirname, 'list-v8.tsx'), 'utf-8');
const TABLE_CSS = readFileSync(resolve(__dirname, '../../components/shared/table.module.css'), 'utf-8');

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

  it("V8表の見出しは共通Thで左右24・上下12・secondary・地table-headを使う", () => {
    expect(LIST).toContain('<TableHeadRow>');
    expect(LIST).toContain('<Th>ルール</Th>');
    expect(TABLE_CSS).toMatch(/\[data-theme='v8'\] \.headRow \{[^}]*background: var\(--color-table-head\)/s);
    expect(TABLE_CSS).toMatch(/\[data-theme='v8'\] \.headRow \.cell \{[^}]*padding:\s*var\(--tpl-thead-pad-block\) var\(--tpl-thead-pad-side\)[^}]*color: var\(--color-ink-secondary\)/s);
  });
});
