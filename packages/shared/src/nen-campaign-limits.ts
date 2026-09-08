/*
 * NEN配信の本文の上限。画面・保存・送信が同じ値を使う。
 *
 * 根拠: LINEのテキストは1吹き出し5000字まで送れる（送信口は紹介文を
 * `slice(0, 5000)` で抑えている）。差し込み（ペットの名前など）が展開後に
 * 膨らむ分を見込んで500字の余裕を残し、4500字を採用上限とする。
 * 保存側だけにあった1500字制限は画面（4500字入力可）と矛盾していた。
 */

import { countTemplateTextCharacters } from './template-message';

/** 画面と保存で使う採用上限。 */
export const NEN_CAMPAIGN_BODY_MAX_LENGTH = 4500;

/** LINE側の1吹き出しの上限。採用上限の根拠として公開する。 */
export const NEN_CAMPAIGN_BODY_SEND_LIMIT = 5000;

/**
 * 本文の数え方。画面の残数表示と保存の検証で同じ関数を使う。
 *
 * テンプレート文と同じく見た目の1文字を1と数える（絵文字は1、改行は1）。
 * `String.length` だと絵文字が2と数えられ、画面の残数と保存の判定がずれる。
 */
export function countNenCampaignBodyLength(value: string): number {
  return countTemplateTextCharacters(value);
}

/**
 * 差し込みを置き換えたあとの本文の見積もり。
 *
 * 置換の種類は送信側（`nen-engagement.ts` の `renderCampaignCopy`）と同じ
 * 3つ。保存の時点では相手が決まらないので、置き換え値は利用者が確かめる
 * ための見本で数える。
 */
export function expandNenCampaignBodyPlaceholders(
  value: string,
  samples: { petName?: string; couponCode?: string; couponExpiry?: string } = {},
): string {
  const petName = samples.petName ?? "大切なご家族";
  const couponCode = samples.couponCode ?? "";
  const couponExpiry = samples.couponExpiry ?? "";
  return value
    .replaceAll("{{pet_name}}", petName)
    .replaceAll("{{coupon_code}}", couponCode)
    .replaceAll("{{coupon_expiry}}", couponExpiry.slice(0, 10));
}

export type NenCampaignBodyLengthCheck = {
  /** 差し込み前の長さ。 */
  length: number;
  /** 差し込み展開後の見積もりの長さ。同じ数え方で測る。 */
  expandedLength: number;
  /** 差し込み前が採用上限に収まるか。収まらないと保存できない。 */
  fits: boolean;
  /** 展開後の見積もりが採用上限に収まるか。外れると送信時に切れる恐れがある。 */
  expandedFits: boolean;
};

/**
 * 保存前の長さ判定。画面（残数・注意文・保存可否）と保存（拒否判定）が
 * 同じ結果になるようにする。
 */
export function checkNenCampaignBodyLength(
  value: string,
  samples?: { petName?: string; couponCode?: string; couponExpiry?: string },
): NenCampaignBodyLengthCheck {
  const length = countNenCampaignBodyLength(value);
  const expandedLength = countNenCampaignBodyLength(expandNenCampaignBodyPlaceholders(value, samples));
  return {
    length,
    expandedLength,
    fits: length <= NEN_CAMPAIGN_BODY_MAX_LENGTH,
    expandedFits: expandedLength <= NEN_CAMPAIGN_BODY_MAX_LENGTH,
  };
}
