// @vitest-environment happy-dom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import DateField from './date-field'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const DIR = dirname(fileURLToPath(import.meta.url))
const styles = readFileSync(join(DIR, 'date-field.module.css'), 'utf8')

const block = (selector: string) => {
  const match = styles.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`))
  if (!match) throw new Error(`${selector} が date-field.module.css にありません`)
  return match[1]
}

/**
 * 日時欄の横の「時刻を消す」「日付を消す」が 32px になり、隣の欄
 * （36px）と高さがずれていた。原因は素のボタン扱い（globals の
 * min-height:32px）で 24px の消すボタンが伸ばされること。
 * 消すボタンは欄の右端・欄と同じ高さ帯に収めることが約束。
 */
describe('日時の消すボタンは欄の中に収まる（m22a）', () => {

  it('消すボタンは欄の上下いっぱい（top:1px・bottom:1px）で固定の高さを持たない', () => {
    const clear = block('.clear')
    expect(clear).toMatch(/top:\s*1px/)
    expect(clear).toMatch(/bottom:\s*1px/)
    expect(clear).not.toMatch(/height:\s*24px/)
    expect(clear).not.toMatch(/top:\s*8px/)
  })

  it('消すボタンは globals の min-height:32px に伸ばされない', () => {
    expect(block('.clear')).toMatch(/min-height:\s*0/)
  })
})


it('日付を消す操作は欄を開かず空の値を返す', () => {
  let next = '2026-10-15'
  render(createElement(DateField, { value: next, onChange: (value: string) => { next = value }, 'aria-label': '日付' }))
  fireEvent.click(screen.getByRole('button', { name: '日付を消す' }))
  expect(next).toBe('')
  expect(screen.queryByRole('dialog')).toBeNull()
  cleanup()
})
