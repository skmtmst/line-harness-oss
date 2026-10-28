'use client'

import { useEffect, useId, useState } from 'react'
import { loadAdminVersionDetail, type AdminVersionDetail } from '@/lib/admin-version-cache'
import { deployEnvLabel, formatDeployInfo } from '@/lib/deploy-info'
import { MANUAL_UPDATE_GUIDE_URL, useUpdateStatus } from '@/components/update/use-update-status'
import Button from '@/components/shared/button'
import { FilterPopover } from '@/components/shared/filter-popover'
import TextLink from '@/components/shared/text-link'

/** 版と環境を1行で出し、配備の詳細と更新の案内は共通の浮く面で開く。 */
export default function SidebarVersion() {
  const [detail, setDetail] = useState<AdminVersionDetail | null>(null)
  const [ready, setReady] = useState(false)
  const [open, setOpen] = useState(false)
  const detailId = useId()
  const update = useUpdateStatus()

  useEffect(() => {
    let cancelled = false
    loadAdminVersionDetail().then(
      (value) => {
        if (cancelled) return
        setDetail(value)
        setReady(true)
      },
      () => { if (!cancelled) setReady(true) },
    )
    return () => { cancelled = true }
  }, [])

  const lines = formatDeployInfo(detail)
  const environment = deployEnvLabel(detail?.deploy_env)
  const summary = lines && detail
    ? `v${detail.version.trim()}${environment ? `・${environment}` : ''}`
    : ready ? '版の情報なし' : '版の情報を取得中'

  return (
    <div className="border-t border-hairline px-4 pb-3 pt-2.5" data-sidebar-version aria-busy={!ready}>
      <FilterPopover
        open={open}
        onClose={() => setOpen(false)}
        label="版の情報"
        trigger={(
          <Button variant="text" size="compact" textTone="quiet" className="max-w-full"
            aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? detailId : undefined}
            title={summary} onClick={() => setOpen(value => !value)}>
            <span className="min-w-0 truncate">{summary}</span>
          </Button>
        )}
        actions={<Button onClick={() => setOpen(false)}>閉じる</Button>}
      >
        <div id={detailId} className="flex flex-col gap-2 text-caption text-ink-secondary">
          {lines ? <>
            <p>{lines.line1}</p>
            <p>{lines.line2 || '配備日時・環境の情報なし'}</p>
          </> : <p role="status">{summary}</p>}
          {update.kind === 'upgrade' ? <TextLink href="/updates">更新あり</TextLink> : null}
          {update.kind === 'fork' ? <TextLink href="/updates">更新履歴</TextLink> : null}
          <TextLink href={MANUAL_UPDATE_GUIDE_URL} external>手動で更新</TextLink>
        </div>
      </FilterPopover>
    </div>
  )
}
