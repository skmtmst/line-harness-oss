/**
 * 外部連携 (板 l5SRfT 一覧・NGh7b 送り先を作る) と実装の数字突き合わせ契約。
 * l5SRfT: 表の見出し 地table-head・13/20・12px/500、行 9/20。
 * NGh7b: 段の余白 20（四方）、入力の枠 h36・丸み10、選ぶ欄 h36。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = resolve(__dirname);

describe("外部連携の板の数字", () => {
  it("incoming 未対応表の見出しは地table-head・13/20・500", () => {
    const css = readFileSync(resolve(DIR, "incoming-v8.module.css"), "utf-8");
    expect(css).toMatch(/\.unmatchedTable thead th \{[^}]*background: var\(--color-table-head\)/s);
    expect(css).toMatch(/\.unmatchedTable thead th \{[^}]*padding: 13px 20px/s);
    expect(css).toMatch(/\.unmatchedTable thead th \{[^}]*font-weight: 500/s);
  });

  it("incoming 未対応表の行は 9/20", () => {
    const css = readFileSync(resolve(DIR, "incoming-v8.module.css"), "utf-8");
    expect(css).toMatch(/\.unmatchedTable tbody td \{[^}]*padding: 9px 20px/s);
  });

  it("new の段カードは余白20（四方）", () => {
    const css = readFileSync(resolve(DIR, "new/new-v8.module.css"), "utf-8");
    expect(css).toMatch(/\.card \{[^}]*padding: 20px;/s);
  });

  it("new の入力の枠は h36・丸み10 (NGh7b 枠)", () => {
    const css = readFileSync(resolve(DIR, "new/new-v8.module.css"), "utf-8");
    expect(css).toMatch(/\.input \{[^}]*height: 36px/s);
  });
});
