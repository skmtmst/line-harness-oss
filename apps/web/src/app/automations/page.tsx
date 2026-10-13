'use client'
import { useMergedTab } from '@/components/layout/merged-tabs'
import AutomationListV8 from '@/v8/automations/list'
import AutomationTemplatesV8 from '@/v8/automations/templates'


const MERGED_TABS = [
  { key: 'active', label: '動いているもの' },
  { key: 'stopped', label: '止めているもの' },
  { key: 'runs', label: '動いた記録', href: '/automations/runs' },
  { key: 'templates', label: '見本' },
  { key: 'common-actions', label: '共通アクション', href: '/common-actions' },
]

/* 現役の一覧と見本へ直接渡し、別の画面の取得を重ねない（WEB-117）。 */
export default function AutomationsPage() {
  const tab = useMergedTab(MERGED_TABS)
  return tab === 'templates' ? <AutomationTemplatesV8 /> : <AutomationListV8 />
}
