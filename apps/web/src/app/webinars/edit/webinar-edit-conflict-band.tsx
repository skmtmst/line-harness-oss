'use client'

/*
 * ★V8-B ウェビナーの同時編集の帯（板 `pvimJ`）。
 *
 * 保存の口に読んだときの更新日時を付けて送り（`expectedUpdatedAt`）、
 * ほかの人が先に保存していたら 409 で止まる。帯を出して最新を
 * 読み込めるようにする（このまま保存すると相手の変更が消える）。
 */
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import { ApiError, type WebinarEditor } from '@/lib/api'

/** 409 の同時編集を見分け、最新の中身があれば取り出す。 */
export function extractEditConflict(cause: unknown): { latest: WebinarEditor | null } | null {
  if (!(cause instanceof ApiError)) return null
  if (cause.status !== 409 || cause.code !== 'VERSION_CONFLICT') return null
  const data = cause.data as { latest?: unknown } | null | undefined
  const latest = data && typeof data === 'object' && 'latest' in data ? data.latest : null
  return { latest: isWebinarEditorLike(latest) ? (latest as WebinarEditor) : null }
}

function isWebinarEditorLike(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { version?: unknown }
  return typeof candidate.version === 'number'
}

export default function WebinarEditConflictBand({
  message,
  reloading,
  onReload,
  onCompare,
  onClose,
}: {
  message: string
  reloading: boolean
  onReload: () => void
  onCompare?: () => void
  onClose: () => void
}) {
  return (
    <div data-design-node="pvimJ">
      <Notice
        tone="warn"
        onClose={onClose}
        action={(
          <>
            {onCompare ? (
              <Button type="button" onClick={onCompare} disabled={reloading}>
                比べてから保存
              </Button>
            ) : null}
            <Button type="button" onClick={onReload} disabled={reloading}>
              {reloading ? '読み込んでいます…' : '最新を読み込む'}
            </Button>
          </>
        )}
      >
        {message}
      </Notice>
    </div>
  )
}
