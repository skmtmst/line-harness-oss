import type { Webinar } from '@/lib/api'

/**
 * LINEプレビューに出す中身（設計 `PV1Vh` `d3rFGD` `Ho8z4`）。
 *
 * **各段の入力から組み立てる。** 口を増やさない。
 * **入力がまだ無いときに、それらしい文を作らない**——見本を置くと、
 * 保存すればそれが届くと読めてしまう。
 */

export type PreviewContent = {
  body: string | null
  buttonLabel: string | null
  empty: string
}

/** STEP 2 動画。友だちの画面で何が起きるかを書く。 */
export function videoPreview(webinar: Webinar): PreviewContent {
  return {
    body: webinar.videoPrefix
      ? '動画を再生すると、視聴状況が友だちごとに記録されます。'
      : null,
    buttonLabel: null,
    empty: '動画を設定すると、友だちの画面での見え方がここに出ます。',
  }
}

/** STEP 3 CTA。動画の下に出すボタンの文言をそのまま見せる。 */
export function ctaPreview(webinar: Webinar): PreviewContent {
  const label = webinar.cta?.label?.trim() || ''
  return {
    body: label ? '動画の下にボタンが出ます。' : null,
    buttonLabel: label || null,
    empty: 'ボタンの文言を入れると、ここに出ます。',
  }
}

/** STEP 4 通知。実際に送る文をそのまま見せる。 */
export function notificationPreview(message: string | null | undefined): PreviewContent {
  const text = (message ?? '').trim()
  return {
    body: text || null,
    buttonLabel: null,
    empty: '通知の本文を入れると、ここに出ます。',
  }
}
