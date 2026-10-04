/**
 * コンバージョン一覧 (板 r6dJFy) と実装の数字突き合わせ契約。
 * 板: 行 padding 上下9・左右20・gap16・区切り #eceef1 / 見出し 13/20 (見出し行は共通部品 TableHeadRow のため M10へ)。
 * 一覧の td だけを直す。詳細ダイアログの表 (cXqlS)・警告箱は別板のため対象外。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PAGE = readFileSync(resolve(__dirname, "page.tsx"), "utf-8");

describe("conversions 一覧の板の数字", () => {
  it("一覧の行セルは左右20・上下9 (px-5 py-[9px])", () => {
    const listCells = PAGE.split("<tbody")[1].split("</tbody>")[0];
    expect(listCells).toMatch(/px-5 py-\[9px\]/);
    expect(listCells).not.toMatch(/px-4 py-3/);
  });

  it("見出し行は共通部品 (TableHeadRow/Th) のため触らない", () => {
    expect(PAGE).toMatch(/<TableHeadRow>/);
  });
});
