// @vitest-environment happy-dom
/*
 * 同時編集の見比べ（板 ）。行の組み立てと帯の比べ口だけを確かめる。
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SaveConflictBand } from '@/components/shared/save-conflict'
import { buildCompareRows, describeCard } from '@/v8/webinar-edit/cta-compare'
import type { WebinarCtaCard } from '@/lib/api'

// globals: false のため Testing Library の自動 cleanup は登録されない。
afterEach(async () => {
  await act(async () => cleanup())
})

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
  it('onCompare があるときだけ「違いを比べる」を出す', () => {
    const onCompare = vi.fn()
    const { rerender } = render(
      <SaveConflictBand title="競合" compareBusy={false} onReload={() => {}} onCompare={onCompare} />,
    )
    const button = screen.getByRole('button', { name: '違いを比べる' })
    button.click()
    expect(onCompare).toHaveBeenCalledTimes(1)
    rerender(<SaveConflictBand title="競合" compareBusy={false} onReload={() => {}} />)
    expect(screen.queryByRole('button', { name: '違いを比べる' })).toBeNull()
  })
})
