/**
 * ウェビナー作成 (板 j7PP04) と実装の数字突き合わせ契約。
 * 板: 段の余白 20（四方）、入力の枠 h36・丸み10。
 * 選ぶカード・選ぶ欄は共通部品のため M10へ。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(resolve(__dirname, "new/new-v8.module.css"), "utf-8");

describe("webinar 作成の板の数字", () => {
  it("段カードは余白20（四方）", () => {
    expect(CSS).toMatch(/\.card \{[^}]*padding: 20px;/s);
  });

  it("入力の枠は h36・丸み10", () => {
    expect(CSS).toMatch(/\.input \{[^}]*height: 36px/s);
    expect(CSS).toMatch(/\.input \{[^}]*border-radius: var\(--radius-control, 10px\)/s);
  });
});
