// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
}))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : ''}>{children}</a>
  ),
}))
vi.mock('@/lib/hq-template-availability', () => ({
  HQ_TEMPLATE_DISTRIBUTION_ENABLED: false,
}))
vi.mock('./templates/template-console', () => ({
  default: () => null,
}))

import HqTemplatePage from './hq-template-page'

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
  { type: 'form' as const, label: '回答フォーム', target: 'form-submissions' as const },
  { type: 'tag' as const, label: '友だち属性', target: 'tags' as const },
  { type: 'rich_menu' as const, label: 'リッチメニュー', target: 'rich-menus' as const },
  { type: 'template' as const, label: 'テンプレート', target: 'templates' as const },
]

describe('統括の未配布ページの案内表示', () => {
  for (const { type, label, target } of CASES) {
    it(`${label}は「まだ使えません」と「アカウントを選ぶ」を出す`, async () => {
      await act(async () => {
        root.render(<HqTemplatePage type={type} label={label} target={target} />)
      })
      expect(host.textContent).toContain(`統括からの${label}の作成・配布はまだ使えません`)
      const link = host.querySelector('a')
      expect(link?.textContent).toContain('アカウントを選ぶ')
      expect(link?.getAttribute('href')).toBe(`/hq/open?target=${target}`)
    })
  }
})
