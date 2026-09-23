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
 * 平均・合計など「だいたいの長さ」を、人が暗算なしに読める単位で言う。
 *
 * 監査6（#674）の規則。#666 が指摘した「平均 55975分」のように、
 * 分の生値を大きな指標カードへ置くと読めない。単位はここで切り替える:
 *
 * - 60分未満       → `○分`
 * - 60分以上       → `約○時間`
 * - 24時間以上     → `約○日`
 * - 30日（31日）超 → `約○ヶ月`
 *
 * `formatDurationMinutes`（「6日7時間50分」まで出す細かいほう）は
 * 残り時間を実際に数える面で使う。平均値・節約量のように
 * 大まかさが効く指標カードはこちらを使う（25オートメーションの
 * 「およそ ○時間」と同じ考え方）。
 */
export function formatApproxDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes))
  if (total < 60) return `${total}分`
  if (total < 60 * 24) return `約${Math.round(total / 60)}時間`
  if (total <= 60 * 24 * 30) return `約${Math.round(total / (60 * 24))}日`
  return `約${Math.round(total / (60 * 24 * 30))}ヶ月`
}
