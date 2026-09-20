import { describe, expect, it } from "vitest";
import {
  DASHBOARD_CARD_GROUPS,
  DASHBOARD_TODAY_VISIBLE_LIMIT,
  dashboardCardGroupOf,
  type DashboardCardId,
} from "./dashboard-cards";

describe("DASHBOARD_CARD_GROUPS", () => {
  it("画面が送る22枚すべてを含み、IDに重複がない", () => {
    const all = Object.values(DASHBOARD_CARD_GROUPS).flat();
    expect(all).toHaveLength(22);
    expect(new Set(all).size).toBe(22);
  });

  it("DASH-01の原因だった support-mark-status を right 区分に含む", () => {
    expect(DASHBOARD_CARD_GROUPS.right).toContain("support-mark-status");
    expect(dashboardCardGroupOf("support-mark-status")).toBe("right");
  });

  it("知らないIDは null を返す", () => {
    expect(dashboardCardGroupOf("no-such-card")).toBeNull();
  });

  it("今日やることの上限は4", () => {
    expect(DASHBOARD_TODAY_VISIBLE_LIMIT).toBe(4);
    expect(DASHBOARD_CARD_GROUPS.today.length).toBeGreaterThanOrEqual(
      DASHBOARD_TODAY_VISIBLE_LIMIT,
    );
  });
});
