import { describe, expect, test } from "vitest";
import { validateFlexContent } from "./flex-content";

describe("カード内容の検証（R201）", () => {
  test("構造のないJSONは有効なカード設定にしない", () => {
    expect(validateFlexContent("flex", "{}")).toContain("バブルかカルーセル");
    expect(validateFlexContent("flex", "[]")).toContain("バブルかカルーセル");
    expect(validateFlexContent("flex", "null")).toContain("バブルかカルーセル");
    expect(validateFlexContent("flex", '{"type":"text","text":"hi"}')).toContain(
      "バブルかカルーセル",
    );
  });

  test("JSONでない内容はJSON形式を求める", () => {
    expect(validateFlexContent("flex", "{壊れている")).toContain("JSON形式");
  });

  test("正常なバブル・カルーセルは通す", () => {
    expect(
      validateFlexContent(
        "flex",
        '{"type":"bubble","body":{"type":"box","layout":"vertical","contents":[]}}',
      ),
    ).toBeNull();
    expect(validateFlexContent("flex", '{"type":"carousel","contents":[]}')).toBeNull();
  });

  test("カード以外・空はここでは見ない", () => {
    expect(validateFlexContent("text", "{}")).toBeNull();
    expect(validateFlexContent("flex", "")).toBeNull();
    expect(validateFlexContent("flex", null)).toBeNull();
  });
});
