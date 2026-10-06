/**
 * オートメーション作成 (板 tJqST) と実装の数字突き合わせ契約。
 * 板: 選ぶカード 余白14・gap8・丸み12 / 選ぶ欄・ボタン 高さ36・丸み10。
 * v7 に載せないため [data-theme='v8'] 付きで上書きする。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(resolve(__dirname, "new/new-automation.module.css"), "utf-8");

describe("automation 作成の板の数字", () => {
  it("選ぶカードは v8 で余白14・gap8・丸み12", () => {
    expect(CSS).toMatch(/\[data-theme='v8'\] \.eventCard \{[^}]*padding: 14px/s);
    expect(CSS).toMatch(/\[data-theme='v8'\] \.eventCard \{[^}]*gap: 8px/s);
    expect(CSS).toMatch(/\[data-theme='v8'\] \.eventCard \{[^}]*border-radius: var\(--radius-card\)/s);
  });

  it("選ぶ欄・ボタンは v8 で高さ36・丸み10", () => {
    expect(CSS).toMatch(/\[data-theme='v8'\] \.select \{[^}]*height: 36px/s);
    expect(CSS).toMatch(/\[data-theme='v8'\] \.action \{[^}]*height: 36px/s);
  });

  it("土台（v7）の高さ40は変えていない", () => {
    expect(CSS).toMatch(/\.select \{[^}]*height: 40px/s);
    expect(CSS).toMatch(/\.action \{[^}]*height: 40px/s);
  });
});
