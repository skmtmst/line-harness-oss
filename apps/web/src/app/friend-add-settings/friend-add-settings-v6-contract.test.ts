import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('V6 友だち追加時配信の契約', () => {
  it('不完全な設定でも保存操作から理由を表示できる', () => {
    expect(PAGE).toContain('const problem = routingError()')
    expect(PAGE).toContain('setError(problem)')
    expect(PAGE).toContain('disabled={saving}')
    expect(PAGE).not.toContain("disabled={saving || routingError() !== ''}")
  })
})
