import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import ReadOnlyNotice from './read-only-notice'

it('閲覧のみの帯は知らせの組の青い「i」で、目の印を使わない', () => {
  const html = renderToStaticMarkup(<ReadOnlyNotice />)
  expect(html).toContain('lucide-info')
  expect(html).not.toContain('lucide-eye')
})
