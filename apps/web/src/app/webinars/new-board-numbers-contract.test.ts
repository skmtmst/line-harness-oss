/**
 * ウェビナー作成 (板 j7PP04) と共通部品の数字突き合わせ契約。
 * 板: 段の余白 20（四方）、入力の枠 h36・丸み10。
 * 段と入力が共通部品で描かれていることは new-board-numbers-react.test.tsx が描いて見る。
 * 下の 2 件は共通部品（components/shared）の値の見張り。共通部品の試験へ移すのは別の束で行う。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const FIELD_CSS = readFileSync(resolve(__dirname, "../../components/shared/text-field.module.css"), "utf-8");

describe("webinar 作成の板の数字", () => {
  it("段カードは採用した共通の余白を使う", () => {
    const card = readFileSync(resolve(__dirname, '../../components/shared/card.module.css'), 'utf8');
    expect(card).toContain('padding: var(--card-content-padding');
  });

  it("入力の枠は共通の高さ36と角を使う", () => {
    expect(FIELD_CSS).toContain("border-radius: var(--radius-control)");
  });
});
