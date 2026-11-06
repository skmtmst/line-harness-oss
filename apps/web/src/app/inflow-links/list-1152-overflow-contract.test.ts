/**
 * 1152幅の横はみ出し契約（流入と計測 一覧 ）。
 * 全列が要る表なので列は消さず、狭い幅では表の中だけ横に送る。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PAGE = readFileSync(resolve(__dirname, "../../v8/inflow-links/list.tsx"), "utf-8");

describe("inflow-links 一覧の1152幅", () => {
  it("表は共通の列の並びで幅の中に収める", () => {
    expect(PAGE).toMatch(/<DataTable\b[^>]*\bcolumnLayout=\{\{/);
    expect(PAGE).toContain('data-table-layout="columns"');
    expect(PAGE).not.toContain("data-scroll-x");
    const css = readFileSync(resolve(__dirname, "../../v8/inflow-links/list.module.css"), "utf8");
    expect(css).toContain("min-width: 0");
  });

  it("主要情報と行メニューの発行URL操作を残す", () => {
    for (const head of [
      "流入元名",
      "追加先",
      "友だちになったら",
      "友だち追加",
      "クリック",
      "最新追加",
      "状態",
    ]) {
      expect(PAGE, `${head} が無い`).toContain(head);
    }
    expect(PAGE).toContain('label: \'URLをコピー\'');
    expect(PAGE).toContain('value={referralUrl(row.refCode)}');
  });
});

describe("inflow-links 広告費の表の1152幅（板 y1ztx の横展開）", () => {
  const ADS = readFileSync(resolve(__dirname, "../../v8/inflow-links/ads.tsx"), "utf-8");

  it("費用の表も幅の中に収める", () => {
    expect(ADS).toContain('columnLayout={INFLOW_TABLE_LAYOUT}')
    expect(ADS).toContain('<DataTable label=');
    expect(ADS).not.toContain("data-scroll-x");
    const css = readFileSync(resolve(__dirname, "../../v8/inflow-links/ads.module.css"), "utf8");
    expect(css).toContain("min-width: 0");
    expect(css).toContain("text-overflow: ellipsis");
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
