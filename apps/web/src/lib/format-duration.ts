/*
 * このファイルの関数の使い分け（名前が似ているので先に書く）:
 * - formatTimeSpan        …時間の長さ。1時間未満は分、48時間未満は時間、それより先は日。
 * - formatElapsedMinutes  …経過時間。1分未満は「たった今」、以降は共通の単位。
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

export function formatTimeSpan(minutes: number, { gap = false }: { gap?: boolean } = {}): string {
  const total = Number.isFinite(minutes) ? Math.max(0, Math.floor(minutes)) : 0
  const join = (value: number, unit: string) => gap ? `${value} ${unit}` : `${value}${unit}`
  if (total < 60) return join(total, '分')
  if (total < 48 * 60) return join(Math.floor(total / 60), '時間')
  return join(Math.floor(total / (24 * 60)), '日')
}

export function formatElapsedMinutes(minutes: number): string {
  if (!Number.isFinite(minutes)) return '—'
  return minutes < 1 ? 'たった今' : `${formatTimeSpan(minutes)}前`
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
  return formatElapsedMinutes(minutes)
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
  return formatTimeSpan(minutes)
}

/**
 * 長さ（「〜前」を付けない分）の読み替え（監査6 #710）。
 *
 * 仮押さえの保持時間のように「1440分」のままだと読めない入力の横に出す。
 * 60分未満は分のままが一番読みやすいので読み替えを返さない。
 * 言い方は `formatDurationMinutes` に寄せる（例: 1440 → 1日）。
 */
export function formatMinutesLengthHint(minutes: number): string | null {
  if (!Number.isFinite(minutes) || minutes < 60) return null
  return formatDurationMinutes(minutes)
}

/**
 * 時間前の読み替え（監査6 #710）。
 *
 * 当日のお知らせのように「72時間前」のままだと日数が読めない入力の
 * 横に出す。24時間の倍数のときだけ「N日前」に読み替える。
 */
export function formatHoursBeforeHint(hours: number): string | null {
  if (!Number.isFinite(hours) || hours < 24 || hours % 24 !== 0) return null
  return `${hours / 24}日前`
}
