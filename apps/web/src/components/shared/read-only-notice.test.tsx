import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import ReadOnlyNotice from './read-only-notice'

it('閲覧のみの帯は知らせの組の青い点で、iと目の印を使わない', () => {
  const html = renderToStaticMarkup(<ReadOnlyNotice />)
  expect(html).toContain('data-read-only-notice="true"')
  expect(html).toContain('閲覧のみで見ています。変える操作はオーナーか管理者に頼んでください。')
  expect(html).toContain('role="status"')
  expect(html).toContain('data-tone="info"')
  expect(html).toContain('data-notice-dot="true"')
  expect(html).not.toContain('lucide-info')
  expect(html).not.toContain('lucide-eye')
})
