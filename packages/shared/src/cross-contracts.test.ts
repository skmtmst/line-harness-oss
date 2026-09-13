import { describe, expect, it } from "vitest";
import {
  AUTOMATION_ACTION_LABELS,
  AUTOMATION_TRIGGER_LABELS,
  RICH_MENU_ACTION_TYPE_BY_INTENT,
  RICH_MENU_DIMENSIONS,
  automationActionLabel,
  automationTriggerLabel,
} from "./index";

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
});
