/**
 * ウェビナー作成 (板 ) と実装の数字突き合わせ契約。
 * 板: 段の余白 20（四方）、入力の枠 h36・丸み10。
 * 選ぶカード・選ぶ欄は共通部品のため M10へ。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const FIELD_CSS = readFileSync(resolve(__dirname, "../../components/shared/text-field.module.css"), "utf-8");
const CSS = readFileSync(resolve(__dirname, "../../v8/webinar-edit/form.module.css"), "utf-8");

describe("webinar 作成の板の数字", () => {
  it("段カードは採用した共通の余白を使う", () => {
    const page = readFileSync(resolve(__dirname, '../../v8/webinar-edit/basic-form.tsx'), 'utf8');
    expect(page).toContain('<Card');
    const card = readFileSync(resolve(__dirname, '../../components/shared/card.module.css'), 'utf8');
    expect(card).toContain('padding: var(--card-content-padding');
  });

  it("入力の枠は共通の高さ36と角を使う", () => {
    expect(FIELD_CSS).toContain("border-radius: var(--radius-control)");
  });
});
