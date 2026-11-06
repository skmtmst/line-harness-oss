/**
 * 1152幅の横はみ出し契約（コンバージョン一覧）。
 * 切れないURLは1行で省略し、全文は title。title に全文が載ることは v8/conversions/list.test.tsx が描画して確かめる。
 * ここは描画の試験で見えない CSS の省略だけを見る。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("conversions 一覧の1152幅", () => {
  it("短い行文は1行省略し、全文はtitleで確認できる", () => {
    const css = readFileSync(resolve(__dirname, "../../v8/conversions/list.module.css"), "utf8");
    expect(css).toContain("text-overflow: ellipsis;");
    expect(css).toContain("white-space: nowrap;");
  });
});
