/**
 * 1152幅の横はみ出し契約（流入と計測 一覧 y1ztx）。
 * QA 1003-1459 で「最新追加」の日付（8月25日（火））が 8% 列からはみ出していた。
 * 1列目（流入元名）は伸び縮み・日付は中身に合わせた幅。v8 のみ（v7 不変）。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PAGE = readFileSync(resolve(__dirname, "page.tsx"), "utf-8");
const GLOBALS = readFileSync(resolve(__dirname, "../globals.css"), "utf-8");

describe("inflow-links 一覧の1152幅", () => {
  it("名前列と日付列に目印のクラスがある", () => {
    expect(PAGE).toMatch(/<col className="w-\[13%\] inflow-name-col" \/>/);
    expect(PAGE).toMatch(/<col className="w-\[8%\] inflow-date-col" \/>/);
  });

  it("v8 のみ列幅を上書きする（1列目は自動・日付は7rem）", () => {
    expect(GLOBALS).toMatch(/\[data-theme="v8"\] col\.inflow-name-col \{\s*width: auto;/s);
    expect(GLOBALS).toMatch(/\[data-theme="v8"\] col\.inflow-date-col \{\s*width: 7rem;/s);
  });
});
