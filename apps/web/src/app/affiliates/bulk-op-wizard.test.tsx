// @vitest-environment happy-dom
/*
 * 成果をまとめて操作（★V8-B `hadfk`：手順1/3「操作を選ぶ」）。
 * 対象の確認と操作の選択だけを見る。実行は既存の確かめ窓へ渡す。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'

import BulkOpWizard from './bulk-op-wizard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const TARGETS = [
  { id: 'e-1', displayName: '田中明・合同会社ノース', amountYen: 2000 },
  { id: 'e-2', displayName: '佐藤花子・株式会社サウス', amountYen: 1280 },
]

afterEach(cleanup)

describe('まとめて操作の手順窓 V8', () => {
  it('hadfk の印で対象と操作の札を出す', () => {
    render(
      <BulkOpWizard open targets={TARGETS} onReselect={() => {}} onClose={() => {}} onChoose={() => {}} />,
    )
    expect(document.querySelector('[data-design-node="hadfk"]')).toBeTruthy()
    expect(screen.getByText('成果をまとめて操作')).toBeTruthy()
    expect(screen.getByText(/選択した成果2件/)).toBeTruthy()
    expect(screen.getByText(/報酬¥3,280/)).toBeTruthy()
    expect(screen.getByRole('radio', { name: /認める/ })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /認めない/ })).toBeTruthy()
  })

  it('認めないを選んで進むと rejected を渡す', () => {
    const onChoose = vi.fn()
    render(
      <BulkOpWizard open targets={TARGETS} onReselect={() => {}} onClose={() => {}} onChoose={onChoose} />,
    )
    fireEvent.click(screen.getByRole('radio', { name: /認めない/ }))
    fireEvent.click(screen.getByRole('button', { name: '実行内容を確認' }))
    expect(onChoose).toHaveBeenCalledWith('rejected')
  })

  it('選び直すと一覧へ戻す', () => {
    const onReselect = vi.fn()
    render(
      <BulkOpWizard open targets={TARGETS} onReselect={onReselect} onClose={() => {}} onChoose={() => {}} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '選び直す' }))
    expect(onReselect).toHaveBeenCalled()
  })
})
