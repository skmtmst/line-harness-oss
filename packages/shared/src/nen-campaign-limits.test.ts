import { describe, expect, it } from "vitest";

import {
  checkNenCampaignBodyLength,
  countNenCampaignBodyLength,
  expandNenCampaignBodyPlaceholders,
  NEN_CAMPAIGN_BODY_MAX_LENGTH,
  NEN_CAMPAIGN_BODY_SEND_LIMIT,
} from "./nen-campaign-limits";

describe("NEN本文の上限（#659）", () => {
  it("採用上限は4500字で、LINEの5000字より500字の余裕がある", () => {
    expect(NEN_CAMPAIGN_BODY_MAX_LENGTH).toBe(4500);
    expect(NEN_CAMPAIGN_BODY_SEND_LIMIT).toBe(5000);
    expect(NEN_CAMPAIGN_BODY_SEND_LIMIT - NEN_CAMPAIGN_BODY_MAX_LENGTH).toBe(500);
  });

  it("旧保存上限の前後（1499/1500/1501字）は今はすべて保存できる", () => {
    for (const length of [1499, 1500, 1501]) {
      expect(checkNenCampaignBodyLength("あ".repeat(length)).fits).toBe(true);
    }
  });

  it("採用上限の前後（4499字は通り4501字は保存できない）", () => {
    expect(checkNenCampaignBodyLength("あ".repeat(4499)).fits).toBe(true);
    expect(checkNenCampaignBodyLength("あ".repeat(4500)).fits).toBe(true);
    const over = checkNenCampaignBodyLength("あ".repeat(4501));
    expect(over.fits).toBe(false);
    expect(over.length).toBe(4501);
  });

  it("絵文字は1字、改行は1字と数える", () => {
    expect(countNenCampaignBodyLength("🌿")).toBe(1);
    expect(countNenCampaignBodyLength("あ\nい")).toBe(3);
    expect(countNenCampaignBodyLength("ももちゃん🌿")).toBe(6);
  });

  it("差し込みは送信側と同じ3つを置き換える", () => {
    expect(
      expandNenCampaignBodyPlaceholders("{{pet_name}}ちゃん、{{coupon_code}}（{{coupon_expiry}}）", {
        petName: "もも",
        couponCode: "NEN-1",
        couponExpiry: "2026-09-30T00:00:00",
      }),
    ).toBe("ももちゃん、NEN-1（2026-09-30）");
  });

  it("差し込み展開後に上限を超える例を見つけられる", () => {
    // 差し込み前は4500字ちょうどで収まるが、長い名前で展開すると超える。
    // （`{{pet_name}}` 自体が12字なことに注意）
    const raw = `${"あ".repeat(4488)}{{pet_name}}`;
    const check = checkNenCampaignBodyLength(raw, { petName: "あ".repeat(20) });
    expect(check.length).toBe(4500);
    expect(check.fits).toBe(true);
    expect(check.expandedFits).toBe(false);
    expect(check.expandedLength).toBe(4508);
  });

  it("展開後の見積もりも同じ数え方（絵文字は1字）で測る", () => {
    const check = checkNenCampaignBodyLength("{{pet_name}}🌿", { petName: "もも" });
    expect(check.expandedLength).toBe(3);
    expect(check.expandedFits).toBe(true);
  });
});
