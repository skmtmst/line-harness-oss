/**
 * コンバージョン一覧の板の数字の禁止の見張り。
 * 共通の表に列の寸法を渡すこと・見出し行を共通部品で作ることは v8/conversions/list.test.tsx が描画して確かめる。
 */
import { readUiSource, readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs';
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PAGE = readUiSource(resolve(__dirname, "page.tsx"), "utf-8");
const CSS = readFileSync(resolve(__dirname, "../../v8/conversions/list.module.css"), "utf-8");

describe("conversions 一覧の板の数字", () => {
  it("共通部品の平らな表は共通部品に寸法を渡し、画面からセルを上書きしない", () => {
    expect(CSS).not.toMatch(/:global\([^)]*\).*\.table/);
    // 表の本体（<tbody>〜</tbody>）のセルに px-/py- の手書きを置かない。
    expect(PAGE).not.toMatch(/<tbody\b(?:(?!<\/tbody>)[\s\S])*?\bpx-\d+\s+py-/);
  });
});
