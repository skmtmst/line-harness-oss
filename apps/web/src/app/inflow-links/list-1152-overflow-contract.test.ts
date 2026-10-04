/**
 * 1152幅の横はみ出し契約（流入と計測 一覧 y1ztx）。
 * 全列が要る表なので列は消さず、狭い幅では表の中だけ横に送る。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PAGE = readFileSync(resolve(__dirname, "page.tsx"), "utf-8");

describe("inflow-links 一覧の1152幅", () => {
  it("表は横送りの殻に入れ、最小幅を渡す", () => {
    expect(PAGE).toContain("styles.tableShell");
    expect(PAGE).toContain("data-scroll-x");
    expect(PAGE).toContain("'--scroll-min'");
  });

  it("列を削らない（10列すべて出す）", () => {
    for (const head of [
      "流入元名",
      "追加先",
      "友だちになったら",
      "友だち追加",
      "クリック",
      "最新追加",
      "発行URL",
      "操作",
    ]) {
      expect(PAGE, `${head} が無い`).toContain(head);
    }
  });
});
