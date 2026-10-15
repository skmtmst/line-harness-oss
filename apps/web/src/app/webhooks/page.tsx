'use client'
import { Suspense } from 'react'
import { useMergedTab } from '@/components/layout/merged-tabs'
import { usePageTitle } from '@/components/shell/page-chrome'
import OutgoingV8Page from '@/v8/webhooks/outgoing'
import InteractionsV8Page from '@/v8/webhooks/interactions'
import IncomingV8Page from '@/v8/webhooks/incoming'
import ApiTokensV8Page from '@/v8/webhooks/api-tokens'
import SheetsV8Page from '@/v8/webhooks/sheets'
import SamplesV8Page from '@/v8/webhooks/samples'

const MERGED_TABS = [
  { key: 'outgoing', label: 'こちらから送る' },
  { key: 'incoming', label: 'こちらで受け取る' },
  { key: 'interactions', label: 'やり取りの記録' },
  // #838 第2段: Sheets連携のOAuth戻り先もこのタブ（?tab=sheets&sheets=…）。
  { key: 'sheets', label: 'Google Sheets' },
  // R434: 公開APIの鍵の発行・棚卸し・停止。口は前からあり、画面が無かった。
  { key: 'api-tokens', label: 'API接続' },
  { key: 'notify', label: '見本' },
]

function WebhooksPageHost() {
  const tab = useMergedTab(MERGED_TABS)
  usePageTitle('外部連携')
  if (tab === 'outgoing') return <OutgoingV8Page />
  if (tab === 'interactions') return <InteractionsV8Page />
  if (tab === 'incoming') return <IncomingV8Page />
  if (tab === 'api-tokens') return <ApiTokensV8Page />
  if (tab === 'sheets') return <SheetsV8Page />
  return <SamplesV8Page />
}

export default function WebhooksPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <WebhooksPageHost />
    </Suspense>
  )
}
