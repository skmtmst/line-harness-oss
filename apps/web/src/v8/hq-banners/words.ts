/*
 * ★V8 バナー生成の言葉と小さな計算（画面から写した。src/app は import しない）。
 */
import { describeApiFailure, japaneseDetailOf } from '@/components/shared/api-error-message'
import { parseJstDateTime, type BannerImage, type BannerPreset } from '@/lib/hq-banners'

/** 権限が無いときの案内（v7 と同じ文）。 */
export const BANNER_FORBIDDEN = 'この操作はオーナーか管理者だけができます。必要なときはオーナーか管理者の方に操作してもらってください。'

/** M022：原文のまま出さず、共通の状態別案内へ渡す（v7 と同じ）。 */
export function bannerFailureMessage(caught: unknown, action: string): string {
  return japaneseDetailOf(caught) || describeApiFailure(caught, action, { forbidden: BANNER_FORBIDDEN })
}

/** 「9/30」。カードの「更新」に使う（絵 B9ZAr の「8 枚 ・ 9/30 更新」）。 */
export function monthDay(iso: string): string {
  const date = parseJstDateTime(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', month: 'numeric', day: '2-digit' }).formatToParts(date)
  const month = parts.find((p) => p.type === 'month')?.value ?? ''
  const day = parts.find((p) => p.type === 'day')?.value ?? ''
  return `${month}/${day}`
}

/** 「9/30 10:12」。画像の詳細の「作成」に使う。 */
export function monthDayTime(iso: string): string {
  const date = parseJstDateTime(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const parts = f.formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`
}

/**
 * 画像の用途の短い名前（絵の「リッチメッセージ」「リッチメニュー」「Instagram 4:5」「ストーリー 9:16」「カード 3:2」）。
 * 用途が分からない画像は縦横比だけ。
 */
export function shortPresetLabel(preset: BannerPreset | null | undefined, image?: Pick<BannerImage, 'generation'>): string {
  const ratio = image?.generation?.aspectRatio ?? preset?.aspectRatio ?? ''
  if (!preset) return ratio || '—'
  if (preset.key.startsWith('line_rich_menu')) return 'リッチメニュー'
  if (preset.key === 'line_rich_message') return 'リッチメッセージ'
  if (preset.key === 'line_card') return `カード ${ratio}`
  if (preset.key.startsWith('sns_instagram')) return `Instagram ${ratio}`
  if (preset.key === 'sns_story') return `ストーリー ${ratio}`
  return preset.label
}

/** プロジェクトの中の画像の札（絵 iMnph の「リッチメッセージ・1:1」「カード・3:2」）。 */
export function tileLabel(preset: BannerPreset | null | undefined, image: Pick<BannerImage, 'generation' | 'source'>): string {
  if (image.source === 'upload') return '取り込み'
  const ratio = image.generation?.aspectRatio ?? preset?.aspectRatio ?? ''
  const name = !preset ? '' : preset.key === 'line_card' ? 'カード' : preset.key.startsWith('line_rich_menu') ? 'リッチメニュー' : preset.key === 'line_rich_message' ? 'リッチメッセージ' : preset.label
  return [name, ratio].filter(Boolean).join('・') || '—'
}
