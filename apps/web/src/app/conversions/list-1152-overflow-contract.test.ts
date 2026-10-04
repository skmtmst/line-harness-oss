/**
 * 1152幅の横はみ出し契約（コンバージョン一覧）。
 * QA 1003-1459 で `サイトの「https://example.com/downl…」に到達` が
 * 列からはみ出していた。切れないURLは2行までの中で折り返し、全文は title。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PAGE = readFileSync(resolve(__dirname, "page.tsx"), "utf-8");

describe("conversions 一覧の1152幅", () => {
  it("短い行文は1行省略し、全文はtitleで確認できる", () => {
    expect(PAGE).toMatch(/block truncate" title=\{sourceTriggerLabel\(point\)\}/);
    expect(PAGE).toMatch(/block truncate" title=\{usageLabel\(point\)\}/);
  });
});
