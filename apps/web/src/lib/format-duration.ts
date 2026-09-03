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
