// @vitest-environment happy-dom
/*
 * シナリオ編集の入口（page.tsx）：URL の id で画面を開き、始めた直後（started=1）のときだけ
 * 開始完了の知らせを出すよう V8 の画面へ渡す。id が無いときは選び直しを案内する。
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const url = vi.hoisted(() => ({ search: '' }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(url.search) }))
vi.mock('@/components/shared/target-missing', () => ({
  default: ({ title }: { title: string }) => <p>{title}</p>,
}))
vi.mock('@/v8/scenario-detail/detail', () => ({
  default: ({ scenarioId, showStarted }: { scenarioId: string; showStarted: boolean }) => (
    <p>{`画面:${scenarioId}:${showStarted ? '始めた直後' : 'ふだん'}`}</p>
  ),
}))

import ScenarioDetailPage from './page'

afterEach(cleanup)

describe('シナリオ編集の入口', () => {
  it('started=1 のときだけ始めた直後として開く', () => {
    for (const [search, shown] of [
      ['id=sc-1&started=1', '画面:sc-1:始めた直後'],
      ['id=sc-1', '画面:sc-1:ふだん'],
      ['id=sc-1&started=0', '画面:sc-1:ふだん'],
    ] as const) {
      url.search = search
      render(<ScenarioDetailPage />)
      expect(screen.getByText(shown), search).toBeTruthy()
      cleanup()
    }
  })

  it('id が無いときは画面を開かず、選び直しを案内する', () => {
    url.search = 'started=1'
    render(<ScenarioDetailPage />)
    expect(screen.getByText('見るシナリオが指定されていません')).toBeTruthy()
    expect(screen.queryByText(/^画面:/)).toBeNull()
  })
})
