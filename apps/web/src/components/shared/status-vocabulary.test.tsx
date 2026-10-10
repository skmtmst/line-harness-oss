import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import StatusBadge from './status-badge'
import { STATUS_LABELS, statusLabel } from '@/lib/status-labels'

describe('B-158 決まり1 状態の言葉', () => {
  it('APIの状態を表から描き、予約済みという古い語に戻ると落ちる', () => {
    expect(STATUS_LABELS).toEqual({ draft: '下書き', scheduled: '予約中', sent: '送信済み', published: '公開中', active: '有効', stopped: '停止中', archived: 'アーカイブ' })
    expect(renderToStaticMarkup(<StatusBadge status="scheduled" />)).toContain('予約中')
    expect(renderToStaticMarkup(<StatusBadge>稼働中</StatusBadge>)).toContain('有効')
    expect(statusLabel('審査中')).toBe('審査中')
  })
})
