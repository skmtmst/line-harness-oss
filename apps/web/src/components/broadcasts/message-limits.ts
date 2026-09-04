/**
 * 一斉配信の本文の上限（設計 `XQfMD` 6-1-C）。
 *
 * 設計は「1通5,000字・合計22,500字・最大5通、4,500字を超えると自動分割」。
 * このうち**1通5,000字だけを入れている**。
 *
 * **最大5通と自動分割は画面だけでは入れられない。** Workerが
 * `messageBubbles.length > 3` を400で弾く
 * （`apps/worker/src/routes/broadcasts.ts:494,679`）。画面の上限だけ5通に
 * 上げると、書けるのに保存で失敗する形になる。
 *
 * 5,000 は LINE のテキストメッセージそのものの上限でもある。
 * 前は500字で、設計どおりの配信がそもそも書けなかった。
 */
export const MAX_TEXT_LENGTH = 5_000

/** Workerが受け取れる吹き出しの数。 */
export const MAX_BUBBLES = 3

/** これを超えたら、読み手の画面で切れる恐れがあるので分けるよう促す。 */
export const SPLIT_HINT_LENGTH = 4_500

export type MessageLengthNotice = {
  tone: 'ok' | 'hint' | 'error'
  title: string
  description: string
}

/**
 * 本文の長さについて、いま何が起きるかを言う。
 *
 * 「問題ありません／上限を超えています」の2つだけだと、**分けたほうが
 * よい長さ**が伝わらない。4,500字は送れるが読みにくい。
 */
export function messageLengthNotice(input: {
  /** いちばん長い吹き出しの文字数。 */
  longest: number
  /** すべての吹き出しの合計。 */
  total: number
  bubbles: number
}): MessageLengthNotice {
  if (input.longest > MAX_TEXT_LENGTH) {
    return {
      tone: 'error',
      title: '本文が長すぎます',
      description: `1通は${MAX_TEXT_LENGTH.toLocaleString('ja-JP')}文字までです。`
        + `いまいちばん長い通は${input.longest.toLocaleString('ja-JP')}文字あります。`,
    }
  }
  if (input.longest > SPLIT_HINT_LENGTH) {
    return {
      tone: 'hint',
      title: '長いので、通を分けることをおすすめします',
      description: `${SPLIT_HINT_LENGTH.toLocaleString('ja-JP')}文字を超えると読みにくくなります。`
        + `「＋ 吹き出しを追加」で分けられます（${MAX_BUBBLES}通まで）。`,
    }
  }
  return {
    tone: 'ok',
    title: '本文の長さは問題ありません',
    description: `合計${input.total.toLocaleString('ja-JP')}文字・${input.bubbles}通で届きます。`,
  }
}

/** 帯に出す「238 / 5,000」。取得できた0文字は0のまま出す。 */
export function messageLengthLabel(longest: number): string {
  return `${longest.toLocaleString('ja-JP')} / ${MAX_TEXT_LENGTH.toLocaleString('ja-JP')}`
}
