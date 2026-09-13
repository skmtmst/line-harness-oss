import { describe, expect, it } from "vitest";

import {
  checkNenCampaignBodyLength,
  countNenCampaignBodyLength,
  expandNenCampaignBodyPlaceholders,
  NEN_CAMPAIGN_BODY_MAX_LENGTH,
  NEN_CAMPAIGN_BODY_SEND_LIMIT,
  NEN_PET_NAME_MAX_LENGTH,
} from "./nen-campaign-limits";

describe("NEN本文の上限（#659）", () => {
  it("採用上限は4500字で、LINEの5000字（UTF-16 code unit）より500字の余裕がある", () => {
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

  it("差し込みは送信側と同じ3つを置き換える", () => {
    expect(
      expandNenCampaignBodyPlaceholders("{{pet_name}}ちゃん、{{coupon_code}}（{{coupon_expiry}}）", {
        petName: "もも",
        couponCode: "NEN-1",
        couponExpiry: "2026-09-30T00:00:00",
      }),
    ).toBe("ももちゃん、NEN-1（2026-09-30）");
  });

  it("差し込み展開後に上限を超える例を見つけられる（明示した見本）", () => {
    // 差し込み前は4500字ちょうどで収まるが、長い名前で展開すると超える。
    // （`{{pet_name}}` 自体が12字なことに注意）
    const raw = `${"あ".repeat(4488)}{{pet_name}}`;
    const check = checkNenCampaignBodyLength(raw, { petName: "あ".repeat(20) });
    expect(check.length).toBe(4500);
    expect(check.fits).toBe(true);
    expect(check.expandedFits).toBe(false);
    expect(check.expandedLength).toBe(4508);
  });

  it("見本を渡さなくても、既定値がペット名の実際の上限いっぱいなので展開後の超過を見つけられる（#659: 到達不能だった注意文の修正）", () => {
    // {{pet_name}} を並べただけの本文。差し込み前はゆとりがある（fits）が、
    // 既定のペット名見本（NEN_PET_NAME_MAX_LENGTH いっぱい）で展開すると
    // 明確に超える。以前は既定の見本が「大切なご家族」（6字）という
    // 置換元より短い固定文言だったため、この分岐へは絶対に到達しなかった。
    const raw = "{{pet_name}}".repeat(300);
    const check = checkNenCampaignBodyLength(raw);
    expect(check.length).toBe(3600);
    expect(check.fits).toBe(true);
    expect(check.expandedLength).toBe(300 * NEN_PET_NAME_MAX_LENGTH);
    expect(check.expandedFits).toBe(false);
  });
});

describe("文字数の数え方はUTF-16 code unit（#659 差し戻し3点目: 単位の混同）", () => {
  it("LINEと同じくUTF-16 code unitで数える。単純な絵文字は2字", () => {
    // 🌿はサロゲートペア（2 code unit）。コードポイントでは1だが、
    // LINE自身がUTF-16で数えるため、こちらも2として扱う必要がある。
    expect(countNenCampaignBodyLength("🌿")).toBe(2);
    expect(countNenCampaignBodyLength("あ\nい")).toBe(3);
    expect(countNenCampaignBodyLength("ももちゃん🌿")).toBe(7);
  });

  it("家族の絵文字（ZWJ結合）は見た目1字でも11字と数える", () => {
    // 👨‍👩‍👧‍👦 = 👨(2) + ZWJ(1) + 👩(2) + ZWJ(1) + 👧(2) + ZWJ(1) + 👦(2) = 11
    const family = "\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}";
    expect(countNenCampaignBodyLength(family)).toBe(11);
  });

  it("肌色付き絵文字・国旗はどちらも4字と数える", () => {
    // 👍🏽 = 👍(2) + 肌色モディファイア(2)
    const skinToned = "\u{1F44D}\u{1F3FD}";
    expect(countNenCampaignBodyLength(skinToned)).toBe(4);
    // 🇯🇵 = 地域指示記号2つ、それぞれサロゲートペア（2+2）
    const flag = "\u{1F1EF}\u{1F1F5}";
    expect(countNenCampaignBodyLength(flag)).toBe(4);
  });

  it("結合文字（濁点の分解形）は2字、前結合形は1字と別々に数える", () => {
    // 見た目はどちらも「が」だが、正規化していないため別の文字列として扱う。
    const decomposed = "が"; // か + 濁点結合文字
    const precomposed = "が"; // が（単一コードポイント）
    expect(countNenCampaignBodyLength(decomposed)).toBe(2);
    expect(countNenCampaignBodyLength(precomposed)).toBe(1);
  });

  it("CRLFはCRとLFをそれぞれ1字ずつ数える", () => {
    expect(countNenCampaignBodyLength("あ\r\nい")).toBe(4);
  });

  it("見た目643個の家族絵文字は643字ではなく7073字なので、以前の実装（コードポイント数）とは違って上限超過になる", () => {
    // 家族絵文字は見た目1字・コードポイント7・UTF-16は11。旧実装
    // （コードポイント）だと 643 * 7 = 4501 で「見た目643字」を誤って拒否
    // していたが、その誤りとは別に、UTF-16換算の643 * 11 = 7073も
    // 明確に上限超過であることを確かめる。
    const family = "\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}";
    const check = checkNenCampaignBodyLength(family.repeat(643));
    expect(check.length).toBe(643 * 11);
    expect(check.fits).toBe(false);
  });

  it("🌿を4500個はコードポイントでは4500だがUTF-16では9000になり、保存できない（#659差し戻し前は誤って保存できた）", () => {
    const raw = "🌿".repeat(4500);
    const check = checkNenCampaignBodyLength(raw);
    expect(check.length).toBe(9000);
    expect(check.fits).toBe(false);
  });

  it("展開後の見積もりも同じくUTF-16 code unitで測る", () => {
    const check = checkNenCampaignBodyLength("{{pet_name}}🌿", { petName: "もも" });
    expect(check.expandedLength).toBe(4); // もも(2) + 🌿(2)
    expect(check.expandedFits).toBe(true);
  });
});
