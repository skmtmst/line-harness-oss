import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

describe('V6 シナリオの読了率の母数', () => {
  it('現在配信中と読了済みの合計を母数にする', () => {
    expect(PAGE).toContain('const enrolled = active + completed')
    expect(PAGE).toContain('Math.round((completed / enrolled) * 100)')
    expect(PAGE).toContain('`\u767b\u9332\u5408\u8a08 ${enrolled.toLocaleString(\'ja-JP\')}\u4eba\u306e\u3046\u3061 ${rate}%`')
  })

  it('購読中は現在配信中の人数だと明記する', () => {
    expect(PAGE).toContain("detail: '現在配信中・重複を含む'")
  })

  it('登録実績が無いときは0%ではなく未取得表示にする', () => {
    expect(PAGE).toContain("if (enrolled === 0) return '—'")
  })
})
