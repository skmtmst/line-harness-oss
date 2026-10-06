/**
 * コンバージョン一覧 (板 r6dJFy) と実装の数字突き合わせ契約。
 * 板: 行 padding 上下9・左右20・gap16・区切り #eceef1 / 見出し 13/20 (見出し行は共通部品 TableHeadRow のため M10へ)。
 * 一覧の td だけを直す。詳細ダイアログの表 (cXqlS)・警告箱は別板のため対象外。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PAGE = readFileSync(resolve(__dirname, "conversion-points-v8.tsx"), "utf-8");
const CSS = readFileSync(resolve(__dirname, "conversion-points-v8.module.css"), "utf-8");

describe("conversions 一覧の板の数字", () => {
  it("V8一覧の行セルは左右20・上下9（従来の一覧の余白は変更しない）", () => {
    const listCells = PAGE.split("<tbody")[1].split("</tbody>")[0];
    expect(listCells).toContain('<td');
    expect(PAGE).toContain('className={styles.table}');
    expect(CSS).toMatch(/\.table td \{[^}]*padding: 9px 20px;/s);
    expect(listCells).not.toMatch(/\bpx-\d+\s+py-/);
  });

  it("見出し行は共通部品 (TableHeadRow/Th) のため触らない", () => {
    expect(PAGE).toMatch(/<TableHeadRow>/);
  });
});
