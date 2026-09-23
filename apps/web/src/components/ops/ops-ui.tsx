'use client'

import type { ReactNode } from 'react'
import Chip, { type ChipTone } from '@/components/shared/chip'
import { ApiError } from '@/lib/api'

/**
 * 運営コンソール（★V6 37）だけで使う小さな部品と表記の決まり。
 *
 * 札は共通の `Chip`、数値カードは共通の `SummaryCard`、表は共通の `DataTable`
 * を使う。ここには「状態をどの札で出すか」と「日付・プランの表記」だけを置く。
 */

export function tenantStatusChip(status: string, planStatus?: string): ReactNode {
  if (status === 'suspended') return <Chip tone="danger">停止</Chip>
  if (status === 'archived') return <Chip tone="neutral">解約</Chip>
  if (planStatus === 'trialing') return <Chip tone="warn">トライアル</Chip>
  if (planStatus === 'past_due') return <Chip tone="danger">決済失敗</Chip>
  return <Chip tone="ok">契約中</Chip>
}

export const PLAN_LABEL: Record<string, string> = { light: 'ライト', standard: 'スタンダード', pro: 'プロ' }

export function planLabel(planKey: string | null): string {
  if (!planKey) return '—'
  return PLAN_LABEL[planKey] ?? planKey
}

export const PLAN_STATUS_LABEL: Record<string, string> = {
  exempt: '課金対象外',
  trialing: 'トライアル中',
  active: '契約中',
  past_due: '決済失敗',
  canceled: '解約',
}

export const ROLE_LABEL: Record<string, string> = { owner: 'オーナー', admin: '管理者', staff: '担当者' }

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatDate(value: string | null | undefined): string {
  return formatDateTime(value).slice(0, 10)
}

export const AUDIT_ACTION_LABEL: Record<string, { label: string; tone: ChipTone }> = {
  'tenant.create': { label: '契約先を作成', tone: 'info' },
  'tenant.status.change': { label: '契約先の状態を変更', tone: 'warn' },
  'tenant.feature_packs.change': { label: '機能パックを変更', tone: 'info' },
  'impersonation.start': { label: '代理ログイン（閲覧）', tone: 'neutral' },
  'impersonation.write': { label: '代理ログイン（書き込み）', tone: 'danger' },
  'impersonation.end': { label: '代理ログインを終了', tone: 'neutral' },
  'pii.reveal': { label: '個人情報を表示', tone: 'danger' },
  'ticket.view': { label: 'チケットを閲覧', tone: 'neutral' },
  'member.invite': { label: '運営メンバーを追加', tone: 'info' },
  'member.deactivate': { label: '運営メンバーを停止', tone: 'warn' },
  'member.activate': { label: '運営メンバーを再開', tone: 'info' },
}

export function auditActionChip(action: string): ReactNode {
  const meta = AUDIT_ACTION_LABEL[action]
  if (!meta) return <Chip tone="neutral">{action}</Chip>
  return <Chip tone={meta.tone}>{meta.label}</Chip>
}

/** 契約先詳細へのリンク。静的書き出しのため動的セグメントは使わず `?id=` で渡す。 */
export function tenantDetailHref(id: string): string {
  return `/ops/tenants/detail?id=${encodeURIComponent(id)}`
}

/**
 * `fetchApi` は 2xx 以外を例外（ApiError）にして投げる。運営コンソールの画面は
 * `res.success` で分岐する書き方なので、例外を `{ success: false, error }` に直して返す。
 * これが無いと、API が 4xx/5xx を返したときに busy が戻らず画面が固まる（2026-09-17 の
 * 「AIで下書きを作る」が作成中のまま止まった件）。
 */
/** 5xx は本文の文言が画面へ渡らない（`extractApiErrorMessage`）ので、状態コードから言い換える。 */
export function opsErrorMessage(error: ApiError): string {
  if (error.message && !error.message.startsWith('API error:')) return error.message
  if (error.status === 503) return 'この機能はいまの環境では使えません（設定が未完了です）'
  if (error.status === 504) return '処理が時間内に終わりませんでした。手で進めるか、少し待ってからもう一度お試しください'
  if (error.status === 502) return '外部の処理に失敗しました。少し待ってからもう一度お試しください'
  if (error.status === 403) return 'この操作をする権限がありません'
  if (error.status === 404) return '対象が見つかりません。画面を読み直してください'
  if (error.status >= 500) return 'サーバーでエラーが起きました。少し待ってからもう一度お試しください'
  return '処理に失敗しました。通信を確かめて、もう一度お試しください。'
}

export async function opsCall<T>(call: Promise<T>): Promise<T | { success: false; error: string }> {
  try {
    return await call
  } catch (error) {
    if (error instanceof ApiError) return { success: false, error: opsErrorMessage(error) }
    if (error instanceof TypeError) return { success: false, error: '通信できませんでした。ネットワークを確認してもう一度お試しください' }
    return { success: false, error: error instanceof Error && error.message ? error.message : '処理に失敗しました。通信を確かめて、もう一度お試しください。' }
  }
}
