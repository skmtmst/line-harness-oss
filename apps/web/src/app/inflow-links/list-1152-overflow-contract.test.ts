/**
 * 1152幅の横はみ出し契約（流入と計測 一覧 y1ztx）。
 * 全列が要る表なので列は消さず、狭い幅では表の中だけ横に送る。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PAGE = readFileSync(resolve(__dirname, "../../v8/inflow-links/list.tsx"), "utf-8");

describe("inflow-links 一覧の1152幅", () => {
  it("表は共通の列の並びで幅の中に収める", () => {
    expect(PAGE).toContain("<DataTable className={styles.table}>");
    expect(PAGE).toContain('data-table-layout="columns"');
    expect(PAGE).not.toContain("data-scroll-x");
    const css = readFileSync(resolve(__dirname, "../../v8/inflow-links/list.module.css"), "utf8");
    expect(css).toContain("min-width: 0");
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
      "状態",
    ]) {
      expect(PAGE, `${head} が無い`).toContain(head);
    }
  });
});

describe("inflow-links 広告費の表の1152幅（板 y1ztx の横展開）", () => {
  const ADS = readFileSync(resolve(__dirname, "ad-integration.tsx"), "utf-8");

  it("費用の表も横送りの殻に入れる", () => {
    expect(ADS).toContain("data-scroll-x");
    expect(ADS).toContain("min-w-[760px]");
  });

  it("列を削らない（7列すべて出す）", () => {
    for (const head of [
      "流入元",
      "媒体",
      "計測リンク",
      "この30日の費用",
      "友だち追加",
      "1人あたり",
      "取り込み",
    ]) {
      expect(ADS, `${head} が無い`).toContain(head);
    }
  });
});
