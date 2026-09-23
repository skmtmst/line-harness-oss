/*
 * このファイルの3関数の使い分け（名前が似ているので先に書く）:
 * - formatDurationMinutes …「残り時間」。受信箱など、あと何分かが効く面で精密表示。
 * - formatWaitRough       …「経過時間」。最長◯日前・最も古い未対応◯日前の粗い表示。
 * - formatMinutesRough    …「長さ」。平均◯時間・約◯ヶ月のように単位を替えた概数。
 */

/** 分数を、長い待ち時間でも読みやすい「日・時間・分」に直す。 */
export function formatDurationMinutes(minutes: number): string {
  const total = Math.max(0, Math.floor(minutes))
  const days = Math.floor(total / 1_440)
  const hours = Math.floor((total % 1_440) / 60)
  const restMinutes = total % 60

  if (days > 0) {
    return `${days}日${hours > 0 ? `${hours}時間` : ''}${restMinutes > 0 ? `${restMinutes}分` : ''}`
  }
  if (hours > 0) {
    return `${hours}時間${restMinutes > 0 ? `${restMinutes}分` : ''}`
  }
  return `${restMinutes}分`
}

/**
 * 待ち時間を、ひと目で分かる粗さで言う。
 *
 * `formatDurationMinutes` は「6日7時間50分」まで出す。**受信箱ではそれでいい**
 * ——そこは実際に返す面なので、あと何分かが効く。
 *
 * けれどダッシュボードは眺める面で、設計 `vUXKb` は同じ値を
 * 「最長 6日前」「最も古い未対応：6日前」と粗く書く。
 * 細かいほうを出すと、何日前かを運用者が暗算することになる（横断レビュー §7 48番）。
 *
 * **同じ画面で同じ値が2通りに書かれないよう、粗いほうもここに置く。**
 * 以前はダッシュボードの中だけで別の関数を書いていて、
 * 1枚の中に「6日前」と「6日7時間50分」が並んでいた。
 */
export function formatWaitRough(minutes: number): string {
  const total = Math.max(0, Math.floor(minutes))
  if (total < 60) return `${total}分前`
  if (total < 60 * 24) return `${Math.floor(total / 60)}時間前`
  return `${Math.floor(total / (60 * 24))}日前`
}

/**
 * 分を、人が眺めて読める一番粗い単位へ直す（Issue #666）。
 *
 * 「平均 55975分」（約38.8日）のように分のまま出すと読めない。
 * 60分以上は「約○時間」、24時間以上は「約○日」、30日以上は「約○ヶ月」。
 * 25 オートメーションの「およそ 0時間」と同じく、単位を替えて概数で出す。
 * 経過時間の「〜前」は `formatWaitRough`、残り時間の「6日7時間50分」は
 * `formatDurationMinutes` と役割が違うので、ここは長さの表現だけを返す。
 */
export function formatMinutesRough(minutes: number): string {
  const total = Math.max(0, Math.round(minutes))
  if (total < 60) return `${total}分`
  if (total < 60 * 24) return `約${Math.round(total / 60)}時間`
  if (total <= 60 * 24 * 30) return `約${Math.round(total / (60 * 24))}日`
  return `約${Math.round(total / (60 * 24 * 30))}ヶ月`
}
