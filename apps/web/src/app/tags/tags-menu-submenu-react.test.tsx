// @vitest-environment happy-dom
/*
 * タグ一覧V8の行メニュー。「フォルダへ移す」を選ぶと、閉じずに
 * 同じメニューの中で宛先（未分類・フォルダ）へ切り替わる。
 * （一斉配信の一覧と同じ直しの横展開。選んだ直後に閉じていた）
 */
import React, { act } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tag, TagGroup } from '@line-crm/shared'

vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/tags',
}))

import TagsTabV8 from './tags-tab-v8'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

const tag = (id: string, name: string): Tag => ({ id, name, status: 'active', groupId: null }) as Tag
const group = (id: string, name: string): TagGroup => ({ id, name }) as TagGroup

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

describe('タグ一覧V8のフォルダへ移す', () => {
  it('選ぶと閉じずに宛先へ切り替わる', async () => {
    render(
      <TagsTabV8
        accountId="acc-1"
        fixture={{ items: [tag('t1', 'VIP')], groups: [group('g1', '販促')] }}
        canEdit
        csvOpen={false}
        onCsvClose={() => {}}
      />,
    )
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'タグ「VIP」の操作' }))
    await flush()
    expect(screen.queryByRole('menu'), 'メニューが開く').toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'フォルダへ移す' }))
    await flush()
    /* 閉じずに2段目（← 操作にもどる・未分類・販促）になる。 */
    expect(screen.queryByRole('menu'), 'メニューは閉じない').toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '未分類' }), '未分類がある').toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '販促' }), 'フォルダがある').toBeTruthy()
  })
})
