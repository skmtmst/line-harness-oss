import type { OpsAnnouncementChannel, OpsAudiencePreview } from '@/lib/api'

/**
 * ★V6 37-7 お知らせ配信の表記の決まり。page.tsx から名前付き export すると Next.js の
 * Page 型検査（本番ビルド）で落ちるため、こちらに置いてページとテストの両方から使う。
 */
/** datetime-local の値（日本時間）を +09:00 付きの ISO に。空なら null。 */
export function toPublishAt(local: string): string | null {
  const v = local.trim()
  if (!v) return null
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? `${v.slice(0, 16)}:00+09:00` : v
}
export function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  return iso.slice(0, 16)
}

export function previewLabel(p: OpsAudiencePreview | null, channels: OpsAnnouncementChannel[]): string {
  if (!p) return '宛先を数えています…'
  const parts = [`${p.tenants}件の契約先・${p.staff}人の権限者`]
  if (channels.includes('line')) parts.push(`うち契約者専用LINEに登録済みの${p.lineLinked}人へ届きます`)
  if (channels.includes('email')) parts.push(`メールは${p.withEmail}人に届きます`)
  return parts.join('。')
}
