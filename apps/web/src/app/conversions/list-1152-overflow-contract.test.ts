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
  it("URLを含む行文は折り返してはみ出さない (break-all + title)", () => {
    expect(PAGE).toMatch(/line-clamp-2 break-all" title=\{sourceTriggerLabel\(point\)\}/);
    expect(PAGE).toMatch(/line-clamp-2 break-all" title=\{usageLabel\(point\)\}/);
  });
});
