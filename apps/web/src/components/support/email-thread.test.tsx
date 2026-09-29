import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EmailThreadBackButton } from './email-thread'

describe('メール詳細のスマホ用戻るボタン', () => {
  it('LINE詳細と同じくスマホだけに表示する戻る操作を描く', () => {
    const html = renderToStaticMarkup(<EmailThreadBackButton onBack={() => undefined} />)

    expect(html).toContain('aria-label="戻る"')
    expect(html).toContain('lg:hidden')
    expect(html).toContain('M15 19l-7-7 7-7')
  })
})
