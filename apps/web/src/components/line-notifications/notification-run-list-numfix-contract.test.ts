import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * 送れなかったもの・記録（板 ・）と運用者検索（板 ）の
 * 数字の契約。見本HTMLとの突き合わせ（2026-10-03）。
 * 検索は13・行の日時は12/600・試行と理由は12。
 * 表の見出し・札・名のセルは共通部品（M10へ）。
 * 件数・日時は API の実値を出す（見本の数は書かない）。
 */

const here = dirname(fileURLToPath(import.meta.url));
const list = readFileSync(join(here, "../../v8/settings/line-notifications/runs-tab.tsx"), "utf8");
const css = readFileSync(join(here, "../../v8/settings/line-notifications/screen.module.css"), "utf8");
const operator = readFileSync(
  join(here, "..", "..", "v8", "settings", "line-notifications", "operator-tab.tsx"),
  "utf8",
);

describe("notification-run-list-numfix (DrwMm/PZBVb/u8xibp)", () => {
  it("検索欄は現役の共通部品を使う", () => {
    expect(list).toContain("<SearchField aria-label=\"お客様の名前・注文番号で探す\"");
    expect(operator).toContain("<SearchField aria-label=\"お知らせを検索\"");
  });

  it("日時と試行の履歴は現役の文字の決まりで出す", () => {
    expect(list).toContain("className={styles.runWhen}");
    expect(css).toMatch(/\.runWhen\s*\{[\s\S]*?font-weight: 600/);
    expect(list).toContain("className={styles.runAttempts}");
    expect(css).toMatch(/\.runAttempts\s*\{[\s\S]*?font-size: var\(--tpl-sb-row-sub\)/);
  });
});
