import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import StatusBadge from './status-badge'
import { STATUS_LABELS, statusLabel } from '@/lib/status-labels'

describe('決まり1 状態の言葉', () => {
  it('用途の札は自動処理の状態へ読み替えず、別の意味なら両方を残す', () => {
    expect(statusLabel('使用中')).toBe('使用中')
    expect(statusLabel('使っている')).toBe('使っている')
    const html = renderToStaticMarkup(<StatusBadge distinctFrom="active">使用中</StatusBadge>)
    expect(html).toContain('使用中')
    expect(renderToStaticMarkup(<StatusBadge distinctFrom="有効">稼働中</StatusBadge>)).toBe('')
    expect(renderToStaticMarkup(<StatusBadge distinctFrom="使用中" status="active" />)).toContain('有効')
  })

  it.each(['審査中', '承認待ち', '未払い', '確認中', 'unknown', 'function Object() { [native code] }', 'function toString() { [native code] }', '[object Object]'])('別の状態や未知値 %s はそのまま描く', (label) => {
    expect(statusLabel(label)).toBe(label)
    expect(renderToStaticMarkup(<StatusBadge>{label}</StatusBadge>)).toContain(label)
  })

  it('文字以外の中身と説明の読み上げ名を保つ', () => {
    expect(renderToStaticMarkup(<StatusBadge><strong>使用中</strong></StatusBadge>)).toContain('<strong>使用中</strong>')
    const html = renderToStaticMarkup(<StatusBadge help="停止するまで自動で動きます" helpLabel="稼働中" status="active" />)
    expect(html).toContain('有効の説明')
  })

  it('APIの状態を表から描き、予約済みという古い語に戻ると落ちる', () => {
    expect(STATUS_LABELS).toEqual({ draft: '下書き', scheduled: '予約中', sent: '送信済み', published: '公開中', active: '有効', stopped: '停止中', archived: 'アーカイブ' })
    expect(renderToStaticMarkup(<StatusBadge status="scheduled" />)).toContain('予約中')
    expect(renderToStaticMarkup(<StatusBadge>稼働中</StatusBadge>)).toContain('有効')
    expect(statusLabel('審査中')).toBe('審査中')
  })
})
