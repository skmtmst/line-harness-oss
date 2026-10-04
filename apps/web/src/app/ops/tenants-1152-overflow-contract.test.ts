/**
 * 1152幅の横はみ出し契約（契約先一覧 /ops → tenants）。
 * QA 1003-1459 の offRight で表が器からはみ出していた。
 * 統括名は伸び縮み（省略＋title 済み）・利用/請求と操作は中身幅へ。v8 のみ。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PAGE = readFileSync(resolve(__dirname, "tenants/page.tsx"), "utf-8");
const CSS = readFileSync(resolve(__dirname, "tenants/tenants-v8.module.css"), "utf-8");

describe("tenants 一覧の1152幅", () => {
  it("表の列を減らし、行末のメニューに操作をまとめる", () => {
    expect(PAGE).toContain('<Th className="w-16" align="right">操作</Th>')
    expect(PAGE).toContain('<MoreAction')
    expect(PAGE).toContain("label: '代理ログイン（閲覧のみ）'")
    expect(CSS).toContain('table-layout: fixed')
  })
})
