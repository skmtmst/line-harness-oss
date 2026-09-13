/*
 * NEN配信の本文の上限。画面・保存・送信が同じ値・同じ単位で数える。
 *
 * 根拠（#659 差し戻し3点目: 単位の混同を修正）。`body_text` は素のテキスト
 * メッセージではなく、`nen-engagement.ts` の `flexMessage()` でFlexの
 * bubble内textコンポーネントに入る。LINEはFlexの個々のtextコンポーネント
 * には文字数上限を公開しておらず、公開されているのはFlexメッセージ全体の
 * JSONサイズ上限（50,000バイト）だけ。画像URL・ボタンなど可変要素が多く
 * これを直接の閾値にするのは複雑すぎるため、同リポジトリの
 * `apps/worker/src/routes/chats.ts` が既に使っているLINEのプレーンテキスト
 * 上限（5000字）を安全側の目安として借用し、差し込み展開の膨らみ分の
 * 余裕として500字を引いて4500字を採用上限とする。
 *
 * LINEはテキストの文字数を **UTF-16 code unit**（JS文字列の `.length`）で
 * 数える（絵文字🍎は2 code unit = 2字。LINE Developers「Character
 * counting in a text」）。`chats.ts` も同じ単位で5000をチェックしている。
 * 5000から500を引いて4500にする、という引き算を成立させるには、
 * こちらも同じ単位（UTF-16 code unit）で数える必要がある。
 *
 * この目安が安全であるためには、差し込み値（ペット名など）の最悪の長さが
 * 有限でなければならない。クーポンコード・有効期限はサーバ側で固定長だが、
 * ペット名は `NEN_PET_NAME_MAX_LENGTH` で新たに上限を設けている
 * （`apps/worker/src/routes/nen-campaigns.ts` の pets 作成・更新）。
 * さらに多重防御として、送信直前（実際に差し込んだ後）の本文も
 * `NEN_CAMPAIGN_BODY_MAX_LENGTH` で truncate する（`nen-engagement.ts`）。
 *
 * 保存側だけにあった1500字制限は画面（4500字入力可）と矛盾していた。
 */

/** 画面と保存で使う採用上限（UTF-16 code unit）。 */
export const NEN_CAMPAIGN_BODY_MAX_LENGTH = 4500;

/** LINEのプレーンテキスト上限（UTF-16 code unit）。採用上限の根拠として公開する。 */
export const NEN_CAMPAIGN_BODY_SEND_LIMIT = 5000;

/**
 * 差し込み値（ペットの名前）のサーバ側上限（UTF-16 code unit）。保存時の
 * 最悪の展開長を有限にする。
 *
 * この40という数値に根拠はない。既存の類似フィールド（他機能の「お名前」
 * 系の項目）に参照できる前例が無く、常識的な範囲で決めた。動かす前提が
 * 出てきたら、この数値そのものを見直すこと。
 */
export const NEN_PET_NAME_MAX_LENGTH = 40;

/**
 * 本文の数え方。画面の残数表示と保存の検証で同じ関数を使う。
 *
 * LINEのMessaging APIと同じ **UTF-16 code unit**（`String.length`）で数える。
 * 見た目の1文字（書記素）とは一致しない。たとえば家族の絵文字
 * （ZWJで結合された複数の絵文字）は見た目1文字でも11 code unitになる。
 * これはLINE自身の数え方に合わせるためで、見た目の文字数を優先すると
 * LINEの実際の上限（UTF-16単位）との整合が取れなくなる。
 */
export function countNenCampaignBodyLength(value: string): number {
  return value.length;
}

/**
 * 差し込みを置き換えたあとの本文の見積もり。
 *
 * 置換の種類は送信側（`nen-engagement.ts` の `renderCampaignCopy`）と同じ
 * 3つ。保存の時点では相手が決まらないので、既定では「送信されうる
 * いちばん長い値」（ペット名は `NEN_PET_NAME_MAX_LENGTH` いっぱい）で
 * 見積もる。既定を短い見本のままにすると、展開後に上限を超える入力が
 * 実際には1つも作れず、超過の注意文が画面に一生出ない穴になる（#659）。
 */
export function expandNenCampaignBodyPlaceholders(
  value: string,
  samples: { petName?: string; couponCode?: string; couponExpiry?: string } = {},
): string {
  const petName = samples.petName ?? "あ".repeat(NEN_PET_NAME_MAX_LENGTH);
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
