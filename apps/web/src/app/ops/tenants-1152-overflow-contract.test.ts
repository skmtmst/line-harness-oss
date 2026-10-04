/**
 * 1152幅の横はみ出し契約（契約先一覧 /ops → tenants）。
 * QA 1003-1459 の offRight で表が器からはみ出していた。
 * 統括名は伸び縮み（省略＋title 済み）・利用/請求と操作は中身幅へ。v8 のみ。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PAGE = readFileSync(resolve(__dirname, "tenants/page.tsx"), "utf-8");
const CSS = readFileSync(resolve(__dirname, "readonly-v8.css"), "utf-8");

describe("tenants 一覧の1152幅", () => {
  it("利用/請求と操作の列に目印のクラスがある", () => {
    expect(PAGE).toMatch(/tenants-use-col/);
    expect(PAGE).toMatch(/tenants-op-col/);
  });

  it("v8 のみ中身幅 (8rem) に上書きする", () => {
    expect(CSS).toMatch(/\[data-theme='v8'\] th\.tenants-use-col \{\s*width: 8rem;/s);
    expect(CSS).toMatch(/\[data-theme='v8'\] th\.tenants-op-col \{\s*width: 8rem;/s);
  });
});
