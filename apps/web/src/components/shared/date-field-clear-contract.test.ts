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
 * （40px）と高さがずれていた。原因は素のボタン扱い（globals の
 * min-height:32px）で 24px の消すボタンが伸ばされること。
 * 消すボタンは欄の右端・欄と同じ高さ帯に収めることが約束。
 */
describe('日時の消すボタンは欄の中に収まる（m22a）', () => {
  it('欄の高さは 40px', () => {
    expect(block('.field')).toMatch(/height:\s*40px/)
  })

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
