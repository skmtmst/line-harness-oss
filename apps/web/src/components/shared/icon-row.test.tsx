import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import IconRow from './icon-row'

it('印・文字・右を行の上下の真ん中にそろえる（実寸の見張りが読む印つき）', () => {
  const html = renderToStaticMarkup(<IconRow icon={<svg />} title="題" sub="補足" end="9月15日" />)
  expect(html).toContain('data-center-row=""')
  for (const part of ['icon', 'text', 'end']) expect(html).toContain(`data-center-row-part="${part}"`)
})

it('行の高さを取るための空の段を文字の下に置かない', () => {
  const html = renderToStaticMarkup(<IconRow icon={<svg />} title="題" />)
  expect(html).not.toContain('aria-hidden="true"></span></span>')
  expect(renderToStaticMarkup(<IconRow icon={<svg />} title="題" connect />)).toContain('data-connect="true"')
})
