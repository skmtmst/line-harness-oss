/**
 * コンバージョン一覧 (板 ) と実装の数字突き合わせ契約。
 * 板: 行 padding 上下9・左右20・gap16・区切り #eceef1 / 見出し 13/20 (見出し行は共通部品 TableHeadRow のため M10へ)。
 * 一覧の td だけを直す。詳細ダイアログの表 ・警告箱は別板のため対象外。
 */
import { readUiSource, readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs';
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PAGE = readUiSource(resolve(__dirname, "page.tsx"), "utf-8");
const CSS = readFileSync(resolve(__dirname, "../../v8/conversions/list.module.css"), "utf-8");
const TOKENS = readFileSync(resolve(__dirname, "../globals.css"), "utf-8");

describe("conversions 一覧の板の数字", () => {
  it("共通部品の平らな表は共通部品に寸法を渡し、画面からセルを上書きしない", () => {
    const listCells = PAGE.split("<tbody").at(-1)!.split("</tbody>")[0];
    expect(listCells).toContain('<Td');
    expect(PAGE).toContain("padding: '0 var(--tpl-list-inset)'");
    expect(PAGE).toContain('columnLayout={{');
    expect(CSS).not.toMatch(/:global\([^)]*\).*\.table/);
    expect(listCells).not.toMatch(/\bpx-\d+\s+py-/);
  });

  it("見出し行は共通部品 (TableHeadRow/Th) のため触らない", () => {
    expect(PAGE).toMatch(/<TableHeadRow\b/);
  });
});
