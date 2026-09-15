'use client'

import type { ReactNode } from 'react'
import Chip, { type ChipTone } from '@/components/shared/chip'

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
