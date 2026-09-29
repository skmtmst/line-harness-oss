/**
 * CSVの式注入を防ぎ、改行・カンマ・引用符があっても1セルに保つ。
 *
 * 先頭が `= + - @` やタブの文字列は表計算ソフトが式として実行し得るので、
 * `'` を付けて無効化する（OWASP CSV Injection。`=cmd|'/C1 calc'!A0` 系）。
 * サーバ生成CSVは packages/db の protectCsvCell が同じ方針で守る。
 */
export function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

/** APIの日時を管理画面で使うJST表記へそろえる。 */
export function formatJstDateTime(value: string | null | undefined, fallback = '—'): string {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

/** datetime-localへ入れられる端末時刻へ変換する。 */
export function localDateTime(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

/** datetime-localの入力をAPIへ送るUTC日時へ変換する。 */
export function utcDateTime(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/*
 * データ由来の色（タグのフォルダ色など）を「文字」として読める濃さにする。
 *
 * API が返す色は自由な値で、薄い灰色（#8b938d は白地で 2.78:1）のまま
 * 文字に使うと読めない。札の地は薄いまま、文字だけ黒と混ぜて濃くし、
 * 実際の札の下地との比で WCAG AA の 4.5:1 以上になる最初の濃さを返す。
 * 白地との比では足りない。下地自体が同じ色を 13% 載せた薄色なので、
 * 白で 4.5 を満たす濃さでも札の上では 4.1 前後まで落ちる（2026-09-25・
 * /inflow-links の axe 指摘）。色あい（色相）は変えない。
 * 書けない値はそのまま返す（描けないよりは出す）。
 */
function tagLuminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
}

/** 札の下地。呼び出し側の最濃（同じ色 13% 載せ・白の上）にそろえる。 */
const TAG_BADGE_TINT_ALPHA = 0x22 / 255

/** 札の下地の色（白の上に同じ色を載せたもの）。 */
export function tagBadgeBackground(color: string): string {
  const clean = color.startsWith('#') ? color.slice(1) : color
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return '#ffffff'
  const mixed = [0, 2, 4].map((i) => {
    const v = parseInt(clean.slice(i, i + 2), 16)
    return Math.round(v * TAG_BADGE_TINT_ALPHA + 255 * (1 - TAG_BADGE_TINT_ALPHA))
  })
  return `#${mixed.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

export function tagTextColor(color: string): string {
  const clean = color.startsWith('#') ? color.slice(1) : color
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return color
  const rgb = [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16))
  const background = tagLuminance(tagBadgeBackground(color).slice(1))
  for (let k = 0; k <= 1.0001; k += 0.05) {
    const mixed = rgb.map((v) => Math.round(v * (1 - k)))
    const hex = mixed.map((v) => v.toString(16).padStart(2, '0')).join('')
    const foreground = tagLuminance(hex)
    const lighter = Math.max(foreground, background)
    const darker = Math.min(foreground, background)
    if ((lighter + 0.05) / (darker + 0.05) >= 4.5) {
      return `#${hex}`
    }
  }
  return '#1d1d1f'
}
