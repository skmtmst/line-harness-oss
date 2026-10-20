// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { CardHeader } from './card'
afterEach(cleanup)
it('題と任意の札を分け、補足の言葉を残す', () => {
  render(<CardHeader title="ひな形から作る" optional size="stacked" meta="選ぶと条件と返信が入ります" />)
  const heading = screen.getByRole('heading', { name: 'ひな形から作る' })
  expect(within(heading).getAllByText('任意')).toHaveLength(1)
  expect(heading.textContent).not.toContain('（任意）')
  expect(screen.getByText('選ぶと条件と返信が入ります')).toBeTruthy()
})
it('指定のない題は札を足さない', () => {
  render(<CardHeader title="基本" />)
  expect(screen.queryByText('任意')).toBeNull()
})
it('作成の題に括弧付きの任意を戻さない（共通Fieldの欄名は別に検証）', () => {
  for (const file of ['src/v8/auto-replies/edit/wizard.tsx', 'src/v8/reminders/basics-form.tsx', 'src/v8/friend-add/editor.tsx', 'src/v8/rich-menus/new/create.tsx']) {
    const source = readFileSync(file, 'utf8')
    expect(source).not.toMatch(/(?:title=["'][^"']*|>[^<>\n]*)[（(]任意[）)]/)
  }
})
