'use client'
import { useUpdateNotification } from '@/hooks/use-update-notification'

export default function UpdateBanner() {
  const { release, dismiss } = useUpdateNotification()
  if (!release) return null

  return (
    <div className="bg-status-info-soft border-b border-hairline px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-2 min-w-0 flex-wrap">
                <span className="text-status-info">
          新バージョン <strong>{release.tag}</strong> がリリースされました
        </span>
        <a
          href={release.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-action underline hover:text-action-hover"
        >
          詳細を見る
        </a>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="このアップデート通知を閉じる"
        className="shrink-0 text-action hover:text-action-hover px-2 -mr-2"
      >
        ✕
      </button>
    </div>
  )
}
