'use client'

import { ChevronLeft, ChevronRight, Link as LinkIcon } from 'lucide-react'
import Button from '@/components/shared/button'
import CopyTextButton from '@/components/shared/copy-text-button'
import IconButton from '@/components/shared/icon-button'
import { ListToolbarEnd, ListToolbarFrame, ListToolbarRow } from '@/components/shared/list-toolbar'

export function monthKey(offset: number, anchor?: string): string {
  const parsed = anchor ? new Date(`${anchor}T00:00:00+09:00`) : new Date(Date.now())
  const now = Number.isNaN(parsed.getTime()) ? new Date(Date.now()) : parsed
  const jst = new Date(now.getTime() + 9 * 3600_000)
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth() + offset, 1)).toISOString().slice(0, 7)
}

export function monthLabel(key: string): string {
  const [year, month] = key.split('-').map(Number)
  return `${year}年${month}月`
}

export default function LedgerMonthNavigation({ anchor, onChange, shareUrl, historyUrl }: {
  anchor: string
  onChange: (date: string) => void
  shareUrl: string
  historyUrl: string
}) {
  return <ListToolbarFrame>
    <ListToolbarRow>
      <IconButton size="small" aria-label="前の月" onClick={() => onChange(`${monthKey(-1, anchor)}-01`)}><ChevronLeft aria-hidden="true" /></IconButton>
      <IconButton size="small" aria-label="次の月" onClick={() => onChange(`${monthKey(1, anchor)}-01`)}><ChevronRight aria-hidden="true" /></IconButton>
      <strong aria-live="polite">{monthLabel(monthKey(0, anchor))}</strong>
      <Button onClick={() => onChange(new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10))}>今日</Button>
      <ListToolbarEnd>
        {shareUrl ? <CopyTextButton variant="secondary" value={shareUrl} icon={<LinkIcon size={14} aria-hidden="true" />} label="友だち予約URL　コピーする" aria-label="友だち予約URLをコピーする" /> : null}
        {historyUrl ? <CopyTextButton variant="secondary" value={historyUrl} icon={<LinkIcon size={14} aria-hidden="true" />} label="予約履歴URL　コピーする" aria-label="予約履歴URLをコピーする" /> : null}
      </ListToolbarEnd>
    </ListToolbarRow>
  </ListToolbarFrame>
}
