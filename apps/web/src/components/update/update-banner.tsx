'use client'

import { MANUAL_UPDATE_GUIDE_URL, useUpdateStatus } from './use-update-status'
import { UpdateButton } from './update-button'

export { MANUAL_UPDATE_GUIDE_URL }

export function UpdateBanner() {
  const status = useUpdateStatus()

  if (status.kind === 'loading') return null

  if (status.kind === 'latest') {
    return (
      <div className="text-xs text-ink-faint px-4 py-2 border-b bg-surface-pearl">
        v{status.version} (最新)
      </div>
    )
  }

  if (status.kind === 'fork') {
    // 「改造検知」のような警告調は使わない: カスタマイズ運用は正当な使い方で、
    // ここで伝えるべきは「自動更新の対象外」という事実だけ (詳細 reason は title に)。
    return (
      <div
        className="bg-status-warn-soft text-status-warn-deep px-4 py-2 border-b text-sm"
        title={status.reason}
      >
        カスタマイズ版で動作中です（v{status.version}）。そのままお使いいただけます。
        更新したい場合は{' '}
        <a
          className="underline"
          href={MANUAL_UPDATE_GUIDE_URL}
          target="_blank"
          rel="noreferrer"
        >
          手動アップデートガイド
        </a>{' '}
        をご覧ください。
      </div>
    )
  }

  return (
    <div className="bg-status-info-soft text-status-info px-4 py-2 border-b flex items-center gap-3 text-sm">
      <div>
        <strong>v{status.target.version}</strong> が利用可能（現 v
        {status.current}）
      </div>
      {status.target.changelog_url ? (
        <a
          className="text-xs underline"
          href={status.target.changelog_url}
          target="_blank"
          rel="noreferrer"
        >
          変更内容
        </a>
      ) : null}
      <div className="ml-auto">
        <UpdateButton targetVersion={status.target.version} />
      </div>
    </div>
  )
}
