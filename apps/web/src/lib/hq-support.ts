/**
 * 統括から運営へのお問い合わせ（★V6 36-3）の型と小さな計算。
 * API の形は `apps/worker/src/routes/hq-support.ts` が正本。
 */

export type HqSupportKind = 'usage' | 'bug' | 'billing' | 'feature' | 'other'
export type HqSupportStatus = 'open' | 'answered' | 'closed'

export interface HqSupportRequest {
  id: string
  kind: HqSupportKind
  kindLabel: string
  subject: string
  body: string
  lineAccountId: string | null
  attachments: Array<{ key: string; url: string }>
  status: HqSupportStatus
  staffName: string
  notified: boolean
  createdAt: string
}

export const SUPPORT_SUBJECT_MAX = 100
export const SUPPORT_BODY_MAX = 4000
export const SUPPORT_ATTACHMENT_MAX = 3
export const SUPPORT_ATTACHMENT_BYTES_MAX = 5 * 1024 * 1024
export const SUPPORT_ATTACHMENT_TYPES = ['image/png', 'image/jpeg'] as const

export const SUPPORT_STATUS_LABELS: Record<HqSupportStatus, string> = {
  open: '受付済み',
  answered: '回答済み',
  closed: '解決',
}

export interface HqSupportInput {
  kind: HqSupportKind | ''
  subject: string
  body: string
  lineAccountId: string
}

export const EMPTY_SUPPORT_INPUT: HqSupportInput = { kind: '', subject: '', body: '', lineAccountId: '' }

/** 送れるかを手元で確かめる。通れば null、だめならその理由（API と同じ言い方）。 */
export function validateSupportInput(input: HqSupportInput): string | null {
  if (!input.kind) return '種類を選んでください'
  const subject = input.subject.trim()
  if (!subject) return '件名を入力してください'
  if (subject.length > SUPPORT_SUBJECT_MAX) return `件名は${SUPPORT_SUBJECT_MAX}文字以内で入力してください`
  const body = input.body.trim()
  if (!body) return '本文を入力してください'
  if (body.length > SUPPORT_BODY_MAX) return `本文は${SUPPORT_BODY_MAX}文字以内で入力してください`
  return null
}

/** 添付できるファイルか。だめなら理由。 */
export function validateSupportAttachment(file: { type: string; size: number }, currentCount: number): string | null {
  if (currentCount >= SUPPORT_ATTACHMENT_MAX) return `画像は${SUPPORT_ATTACHMENT_MAX}枚までです`
  if (!(SUPPORT_ATTACHMENT_TYPES as readonly string[]).includes(file.type)) return '画像は PNG・JPEG のみ添付できます'
  if (file.size > SUPPORT_ATTACHMENT_BYTES_MAX) return '画像が大きすぎます（1枚 5MB まで）'
  return null
}
