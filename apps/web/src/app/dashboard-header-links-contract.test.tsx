// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { SideCard } from '@/components/dashboard/side-cards'

afterEach(cleanup)

it.each([
  { label: '配信設定へ →', name: '配信設定へ', href: '/settings/sending' },
  { label: '運用状態を見る →', name: '運用状態を見る', href: '/updates' },
  { label: 'アクセス解析へ', name: 'アクセス解析へ', href: '/analytics?tab=reactions' },
])('見出しの後・本文の前に行き先を1つ保つ: $label', ({ label, name, href }) => {
  render(
    <SideCard title="今月の状況" action={{ label, href }} freshness={<span>確認した時刻</span>}>
      <p>取得済みの内容</p>
    </SideCard>,
  )
  const heading = screen.getByRole('heading', { name: '今月の状況' })
  const link = screen.getByRole('link', { name })
  const content = screen.getByText('取得済みの内容')
  const freshness = screen.getByText('確認した時刻')
  expect(screen.getAllByRole('link')).toHaveLength(1)
  expect(link.getAttribute('href')).toBe(href)
  expect(link.textContent).toBe(name)
  expect(link.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1)
  expect(heading.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(link.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(content.compareDocumentPosition(freshness) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it('行き先がないカードは内容と確認時刻だけを保つ', () => {
  render(
    <SideCard title="今月の状況" freshness={<span>確認した時刻</span>}>
      取得済みの内容
    </SideCard>,
  )
  expect(screen.queryByRole('link')).toBeNull()
  expect(screen.getByText('取得済みの内容')).toBeTruthy()
  expect(screen.getByText('確認した時刻')).toBeTruthy()
})
