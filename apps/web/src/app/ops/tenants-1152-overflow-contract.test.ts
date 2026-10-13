/**
 * 1152幅の横はみ出し契約（契約先一覧 /ops → tenants）。
 * QA 1003-1459 の offRight で表が器からはみ出していた。
 * 統括名は伸び縮み（省略＋title 済み）・利用/請求と操作は中身幅へ。v8 のみ。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PAGE = readFileSync(resolve(__dirname, "../../v8/ops/tenants.tsx"), "utf-8");
const CSS = readFileSync(resolve(__dirname, "../../v8/ops/tenants.module.css"), "utf-8");

describe("tenants 一覧の1152幅", () => {
  it("名前の列は伸び縮みし、狭い幅では補助列を畳む", () => {
    expect(PAGE).toContain('className={parts.grow} role="cell"')
    expect(PAGE).toContain('<TruncatedText')
    expect(PAGE).toContain('href={tenantDetailHref(row.id)}')
    expect(CSS).toContain('@media (max-width: 1023.98px)')
    expect(CSS).toContain('display: none')
  })
})
