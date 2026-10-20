// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/shell/page-chrome', () => ({ usePageCrumbs: () => {},
  usePageTitle: () => {},
}))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : ''}>{children}</a>
  ),
}))
vi.mock('@/v8/hq-templates/console', () => ({
  default: ({ type }: { type: string }) => <div data-testid="v8-console">{type}</div>,
}))

vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
import HqFormPage from './form-submissions/page'
import HqTagsPage from './friend-attributes/page'
import HqRichMenusPage from './rich-menus/page'
import HqTemplatesPage from './templates/page'

/**
 * m13k: 直接URLを開いたとき、4画面とも「まだ使えません」の案内と
 * 「アカウントを選ぶ」（/hq/open?target=…）を出す。壊さないための描画試験。
 */
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const CASES = [
  { type: 'form', label: '回答フォーム', Page: HqFormPage },
  { type: 'tag', label: 'タグ', Page: HqTagsPage },
  { type: 'rich_menu', label: 'リッチメニュー', Page: HqRichMenusPage },
  { type: 'template', label: 'テンプレート', Page: HqTemplatesPage },
]

describe('統括V8の直接URL', () => {
  for (const { type, label, Page } of CASES) {
    it(`${label}はV8のひな形画面を出す`, async () => {
      await act(async () => {
        root.render(<Page />)
      })
      expect(host.querySelector('[data-testid="v8-console"]')?.textContent).toBe(type)
    })
  }
})
