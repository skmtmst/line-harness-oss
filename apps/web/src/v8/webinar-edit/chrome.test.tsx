// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DetailHead } from './chrome'

vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
afterEach(cleanup)

it('詳細のタブは共通の選択とキー移動を使い、人数と切り替え先を保つ', () => {
  const select = vi.fn()
  render(<DetailHead title="セミナー" subtitle="説明" current="participants" participantsCount={0} onSelect={select} />)
  const selected = screen.getByRole('tab', { name: '参加者 0', selected: true })
  expect(selected.tabIndex).toBe(0)
  expect(screen.getAllByRole('tab')).toHaveLength(4)
  selected.focus()
  fireEvent.keyDown(selected, { key: 'ArrowRight' })
  const analytics = screen.getByRole('tab', { name: '分析' })
  expect(document.activeElement).toBe(analytics)
  expect(select).not.toHaveBeenCalled()
  fireEvent.click(analytics)
  expect(select).toHaveBeenCalledWith('analytics')
})
