/**
 * 外部連携 (板 NGh7b 送り先を作る) と実装の数字突き合わせ契約。
 * NGh7b: 段の余白 20（四方）、入力の枠 h36。
 *
 * 2026-10-06：作るの入口は V8 のとき src/v8/webhooks/create.tsx になり、
 * 古い new/new-v8.module.css はもう描かれない。新しい画面は数字を直書きせず
 * 変数（var(--tpl-*)）で書く決まりなので、変数の名前と、その値（globals.css）の両方を見る。
 * 受け取る（l5SRfT）の未対応表の数字（見出し 13/20・行 9/20）は、古い incoming-v8 だけが
 * 持っていた表の形で、新しい画面（src/v8/webhooks/incoming.tsx）は別の小さな表（miniHead・miniRow）に
 * なったので外した。古い試験は外付けSSDの Archive/line-harness-tests-20261006 にある。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "..", "..");
const CREATE_CSS = readFileSync(resolve(SRC, "v8/webhooks/create.module.css"), "utf-8");
const GLOBALS = readFileSync(resolve(SRC, "app/globals.css"), "utf-8");

/** globals.css の変数の値。見つからなければ空。 */
function token(name: string): string {
  const match = GLOBALS.match(new RegExp(`${name.replace(/[-]/g, "\\-")}:\\s*([^;]+);`));
  return match?.[1]?.trim() ?? "";
}

describe("外部連携の板の数字", () => {
  it("作るの段カードは余白20（四方）", () => {
    expect(CREATE_CSS).toMatch(/\.card \{[^}]*padding: var\(--tpl-wh-card-pad\);/s);
    expect(token("--tpl-wh-card-pad")).toBe("20px");
  });

  it("作るの入力の枠は h36 (NGh7b 枠)", () => {
    expect(CREATE_CSS).toMatch(/\.input \{[^}]*height: var\(--tpl-chip-h\)/s);
    expect(token("--tpl-chip-h")).toBe("36px");
  });
});
