// @vitest-environment happy-dom
/*
 * 同時編集の見比べ（板 `pvimJ`）。行の組み立てと帯の比べ口だけを確かめる。
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import WebinarEditConflictBand from './webinar-edit-conflict-band'
import { buildCompareRows, describeCard } from './webinar-edit-compare-dialog'
import type { WebinarCtaCard } from '@/lib/api'

const card = (over: Partial<WebinarCtaCard> = {}): WebinarCtaCard => ({
  atSeconds: 180,
  kind: 'form',
  title: '見出し',
  body: null,
  buttonLabel: '申し込む',
  autoOpen: false,
  formId: null,
  url: null,
  ...over,
})

describe('describeCard', () => {
  it('無い側は「（なし）」', () => {
    expect(describeCard(undefined)).toBe('（なし）')
  })

  it('見出し・ボタンの言葉・分:秒を1行にする', () => {
    expect(describeCard(card({ atSeconds: 754 }))).toBe('「見出し」／ボタン「申し込む」／12:34から')
  })
})

describe('buildCompareRows', () => {
  it('先頭は申込フォーム、続いて多い方の枚数までカードを並べる', () => {
    const rows = buildCompareRows(
      { formId: 'a', formName: '自分フォーム', cards: [card(), card({ title: '二枚目' })] },
      '相手フォーム',
      [card({ title: '相手一枚目' })],
    )
    expect(rows.map((row) => row.label)).toEqual(['申込フォーム', 'カード1', 'カード2'])
    expect(rows[0]).toMatchObject({ mine: '自分フォーム', theirs: '相手フォーム' })
    expect(rows[2]?.mine).toContain('二枚目')
    expect(rows[2]?.theirs).toBe('（なし）')
  })
})

describe('WebinarEditConflictBand の比べ口', () => {
  it('onCompare があるときだけ「比べてから保存」を出す', () => {
    const onCompare = vi.fn()
    const { rerender } = render(
      <WebinarEditConflictBand message="競合" reloading={false} onReload={() => {}} onCompare={onCompare} onClose={() => {}} />,
    )
    const button = screen.getByRole('button', { name: '比べてから保存' })
    button.click()
    expect(onCompare).toHaveBeenCalledTimes(1)
    rerender(<WebinarEditConflictBand message="競合" reloading={false} onReload={() => {}} onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: '比べてから保存' })).toBeNull()
  })
})
