import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * 顧客へのお知らせ（板 g3iDs）の数字の契約。
 * 見本 `lint/V8-B/g3iDs.html` との突き合わせ（2026-10-03）。
 * 数カードは内側14・札11/600・数20/600（700は決まりで使わない）。
 * 一覧の見出し11/600・行の題12/600・数は12・操作13/600。
 * 件数・金額は API の実値を出す（見本の数は書かない）。
 */

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "page.tsx"), "utf8");
const css = readFileSync(join(here, "customer-notifications.module.css"), "utf8");

function block(selector: string): string {
  const m = css.match(new RegExp(`${selector}\\s*{([^}]*)}`));
  if (!m) throw new Error(`${selector} が無い`);
  return m[1];
}

describe("customer-notifications-numfix (g3iDs)", () => {
  it("数カードは内側14・札11/600・数20/600", () => {
    expect(page).toContain("rounded-card border-hairline border p-3.5");
    expect(page).toContain("text-ink-faint text-micro font-semibold");
    expect(page).toContain("text-ink text-title mt-1 font-semibold tabular-nums");
    expect(page).not.toContain("mt-1 text-2xl font-bold tabular-nums");
  });

  it("行の題は12/600（700は使わない）", () => {
    expect(page).toContain("truncate text-caption font-semibold text-ink");
    expect(page).not.toContain("truncate font-bold text-ink");
  });

  it("一覧の見出しは11/600・操作は13/600", () => {
    expect(block("\\.root :global\\(\\.line-notification-v6-header\\)")).toMatch(
      /font-size:\s*var\(--text-micro\)/,
    );
    expect(block("\\.root :global\\(\\.line-notification-v6-row-action\\)")).toMatch(
      /font-size:\s*var\(--text-label\)/,
    );
  });
});
