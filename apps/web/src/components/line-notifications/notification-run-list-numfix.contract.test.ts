import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * 送れなかったもの・記録（板 DrwMm・PZBVb）と運用者検索（板 u8xibp）の
 * 数字の契約。見本HTMLとの突き合わせ（2026-10-03）。
 * 検索は13・行の日時は12/600・試行と理由は12。
 * 表の見出し・札・名のセルは共通部品（M10へ）。
 * 件数・日時は API の実値を出す（見本の数は書かない）。
 */

const here = dirname(fileURLToPath(import.meta.url));
const list = readFileSync(join(here, "notification-run-list.tsx"), "utf8");
const operator = readFileSync(
  join(here, "..", "..", "app", "line-notifications", "operator-notification-rules.tsx"),
  "utf8",
);

describe("notification-run-list-numfix (DrwMm/PZBVb/u8xibp)", () => {
  it("検索欄の字は13", () => {
    expect(list).toContain("px-3 text-label outline-none focus:border-accent");
    expect(operator).toContain("flex-1 bg-transparent text-label outline-none");
  });

  it("行の日時は12/600・試行と理由は12", () => {
    expect(list).toContain("whitespace-nowrap text-caption font-semibold");
    expect(list).toContain("block text-caption\">試行");
    expect(list).toContain("block text-caption leading-5 text-ink-secondary");
  });
});
