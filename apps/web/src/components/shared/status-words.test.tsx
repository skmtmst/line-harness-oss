// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import StatusBadge from './status-badge'
import StatusPill from './status-pill'
import { normalizeStatusWord, STATUS_WORDS } from './status-words'

describe('B-158 status words', () => {
  it('keeps the approved state vocabulary in one shared table', () => {
    expect(STATUS_WORDS).toEqual({
      sending: ['下書き', '予約中', '送信済み'],
      publishable: ['公開中', '停止中'],
      automatic: ['有効', '停止中'],
      webinar: ['予定', '開催中', '終了'],
      archived: ['アーカイブ'],
    })
  })

  it.each([
    ['稼働中', '有効'],
    ['一時停止', '停止中'],
    ['一時停止中', '停止中'],
    ['停止', '停止中'],
    ['送信待ち', '予約中'],
    ['配信待ち', '予約中'],
    ['配信予約中', '予約中'],
    ['送信予約中', '予約中'],
    ['予約済み', '予約中'],
    ['送信完了', '送信済み'],
    ['アーカイブ済み', 'アーカイブ'],
    ['保管', 'アーカイブ'],
    ['保管済み', 'アーカイブ'],
  ])('normalizes the legacy status word %s', (legacy, approved) => {
    expect(normalizeStatusWord(legacy)).toBe(approved)
  })

  it('leaves words outside a status badge unchanged', () => {
    expect(normalizeStatusWord('使用中')).toBe('使用中')
    expect(normalizeStatusWord('確認中')).toBe('確認中')
  })

  it('applies the shared table to both shared status components', () => {
    render(<><StatusBadge>予約済み</StatusBadge><StatusPill>稼働中</StatusPill></>)
    expect(screen.getByText('予約中')).toBeTruthy()
    expect(screen.getByText('有効')).toBeTruthy()
    expect(screen.queryByText('予約済み')).toBeNull()
    expect(screen.queryByText('稼働中')).toBeNull()
  })
})
