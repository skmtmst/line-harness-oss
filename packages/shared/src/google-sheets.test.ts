import { describe, expect, it } from "vitest";
import {
  isGoogleSheetsConnectionPayload,
  isGoogleSheetsRunsPayload,
} from "./google-sheets";

const CONNECTION = {
  status: "connected",
  googleAccountEmail: "owner@example.com",
  spreadsheetId: "sheet-123",
  spreadsheetTitle: "LINE連携シート",
  spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-123",
  lastSyncedAt: "2026-09-26T03:00:00.000Z",
  lastSyncStatus: "ok",
  lastSyncError: null,
  consecutiveFailures: 0,
  connectedAt: "2026-09-20T00:00:00.000Z",
};

describe("isGoogleSheetsConnectionPayload", () => {
  it("data包みの正しい形を受け入れる", () => {
    expect(
      isGoogleSheetsConnectionPayload({
        connection: CONNECTION,
        oauthConfigured: true,
        syncRunning: false,
        canManage: true,
      }),
    ).toBe(true);
  });

  it("包みなしの古い形・壊れた値は受け入れない（画面は読み込めなかった表示へ）", () => {
    // 口が data を返さない（事故の形）。undefined のまま読むと止まる。
    expect(isGoogleSheetsConnectionPayload(undefined)).toBe(false);
    expect(isGoogleSheetsConnectionPayload(null)).toBe(false);
    expect(isGoogleSheetsConnectionPayload({})).toBe(false);
    // 包みごと無い・旗が欠けた応答も弾く。
    expect(isGoogleSheetsConnectionPayload({ connection: CONNECTION })).toBe(false);
    expect(
      isGoogleSheetsConnectionPayload({
        connection: { status: "unknown-state" },
        oauthConfigured: true,
        syncRunning: false,
        canManage: true,
      }),
    ).toBe(false);
  });
});

describe("isGoogleSheetsRunsPayload", () => {
  it("data包みの正しい形を受け入れる", () => {
    expect(
      isGoogleSheetsRunsPayload({
        runs: [
          {
            id: "run-1",
            kind: "manual",
            dataType: "friends",
            status: "ok",
            rowsWritten: 12,
            error: null,
            startedAt: "2026-09-26T03:00:00.000Z",
            finishedAt: "2026-09-26T03:01:00.000Z",
          },
        ],
      }),
    ).toBe(true);
  });

  it("runsが配列でない・欠けた形は受け入れない", () => {
    expect(isGoogleSheetsRunsPayload(undefined)).toBe(false);
    expect(isGoogleSheetsRunsPayload({ runs: {} })).toBe(false);
    expect(isGoogleSheetsRunsPayload({ runs: [{ id: "run-1" }] })).toBe(false);
  });
});
