'use client'

import { accountHandle } from './account-dialogs'
import { formatNumber } from '@/lib/format'

import { CircleDot, Star } from 'lucide-react';
import { type AccountWithStats } from '@/contexts/account-context';
import { PAGE_SIZES as STANDARD_PAGE_SIZES } from '@/components/shared/page-size-select';

/* ★V8 統括のアカウント。読み書き・権限は既存の口を保つ。 */
type StatusFilter = 'all' | 'ok' | 'warn' | 'archived'

type View = 'cards' | 'table'

/** 「未分類」を表す印。空文字は「すべて」なので別の値にする。 */
const UNFILED = '__none__'

const ALL = '__all__'

const STATUS_FILTERS: { value: StatusFilter; label: string; icon: React.ReactNode }[] = [
  { value: 'all', label: 'すべて', icon: <CircleDot size={14} aria-hidden="true" /> },
  { value: 'ok', label: '正常', icon: <Star size={14} aria-hidden="true" /> },
  { value: 'warn', label: '要確認', icon: <Star size={14} aria-hidden="true" /> },
  { value: 'archived', label: 'アーカイブ', icon: <Star size={14} aria-hidden="true" /> },
]


const SORT_OPTIONS = [
  { value: 'friends', label: '友だち順' },
  { value: 'name', label: '名前順' },
  { value: 'display', label: '登録順' },
]


const PAGE_SIZES = STANDARD_PAGE_SIZES


function isArchived(account: AccountWithStats) {
  return Boolean(account.archivedAt)
}


function matchesStatus(account: AccountWithStats, filter: StatusFilter) {
  if (filter === 'all') return true
  if (filter === 'archived') return isArchived(account)
  if (isArchived(account)) return false
  if (filter === 'ok') return account.isActive && account.connection?.status === 'ok'
  return account.isActive && account.connection?.status !== 'ok'
}


function statusOf(account: AccountWithStats): { label: string; tone: 'ok' | 'warn' | 'idle' } {
  if (isArchived(account)) return { label: 'アーカイブ', tone: 'idle' }
  if (!account.isActive) return { label: '停止中', tone: 'idle' }
  if (account.connection?.status === 'ok') return { label: '正常', tone: 'ok' }
  if (account.connection?.status === 'warn') return { label: '要確認', tone: 'warn' }
  return { label: '未確認', tone: 'idle' }
}
export { type StatusFilter, type View, UNFILED, ALL, STATUS_FILTERS, SORT_OPTIONS, PAGE_SIZES, isArchived, matchesStatus, statusOf }

export function accountMeta(account: AccountWithStats, parent: string | null) {
  return [accountHandle(account), parent ? `親：${parent}` : null, `権限者 ${formatNumber(account.stats?.staffCount ?? 0)} 人`].filter(Boolean).join(' ・ ')
}
