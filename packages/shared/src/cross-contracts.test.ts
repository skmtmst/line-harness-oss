import { describe, expect, it } from "vitest";
import {
  AUTOMATION_ACTION_LABELS,
  AUTOMATION_TRIGGER_LABELS,
  RICH_MENU_ACTION_TYPE_BY_INTENT,
  RICH_MENU_DIMENSIONS,
  automationActionLabel,
  automationTriggerLabel,
} from "./index";
// @ts-expect-error 画面確認用のスクリプトは素のJS。型定義は持たない。
import { AUTOMATION_RUNS } from "../../../scripts/visual-qa/fixtures.mjs";

describe("横断契約の正本", () => {
  it("リッチメニューの2寸法と全intent変換を固定する", () => {
    expect(RICH_MENU_DIMENSIONS).toEqual({
      large: { width: 2500, height: 1686 },
      compact: { width: 2500, height: 843 },
    });
    expect(RICH_MENU_ACTION_TYPE_BY_INTENT).toEqual({
      url: "uri", tel: "uri", form: "uri", text: "message",
      template: "postback", switch: "richmenuswitch", postback: "postback",
    });
  });

  it("オートメーションの表示名を同じ表から解決する", () => {
    expect(automationTriggerLabel("tag_change")).toBe(AUTOMATION_TRIGGER_LABELS.tag_change);
    expect(automationActionLabel("send_message")).toBe(AUTOMATION_ACTION_LABELS.send_message);
    expect(automationTriggerLabel("future_event")).toBe("登録したきっかけ");
    expect(automationActionLabel("future_action")).toBe("登録した処理");
  });

  /*
   * 画面確認の見本が、実口の返す形からずれていないか(#735)。
   *
   * 実行記録の `triggerLabel` は、実口が
   * `automationTriggerLabel(row.trigger_type)` で**正本から引く**。
   * つまり本物では**正本に載っている文言しか出ない**。見本だけが
   * 「タグ「体験申込」が付いたとき」のような手書きを持っていると、
   * 見本で確かめた人が本番と違う文言を見ることになる。
   *
   * 見本テンプレート(`AUTOMATION_TEMPLATES`)の `triggerLabel` は、
   * きっかけの種類名ではなく説明文なので**ここでは見張らない**。
   * 理由は fixtures.mjs 側にも書いてある。
   */
  it("画面確認の実行記録の見本は、正本にあるきっかけ名だけを使う", () => {
    const allowed = new Set(Object.values(AUTOMATION_TRIGGER_LABELS));
    const used = (AUTOMATION_RUNS.items as Array<{ triggerLabel: string }>)
      .map((run) => run.triggerLabel);
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((label) => !allowed.has(label))).toEqual([]);
  });

  /*
   * 「いちばん動いた」はオートメーション名(`SELECT d.name AS most_run_name`)。
   * 見本はきっかけ名を入れていたので、本物では出ない値になっていた。
   */
  it("画面確認の「いちばん動いた」は、見本に実在するオートメーション名を指す", () => {
    const names = new Set(
      (AUTOMATION_RUNS.items as Array<{ automationName: string }>).map((run) => run.automationName),
    );
    const most = (AUTOMATION_RUNS.summary as { mostRunName: string | null }).mostRunName;
    expect(most).not.toBeNull();
    expect(names.has(most as string)).toBe(true);
    // きっかけ名を取り違えて入れていないこと。
    expect(Object.values(AUTOMATION_TRIGGER_LABELS)).not.toContain(most);
  });
});
