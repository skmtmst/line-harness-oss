import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./column-new-v8.tsx', import.meta.url), 'utf8')

// V7のスマホでの並べ替えは廃止。V8でも保存の入口を残す。
describe('NENコラム作成の保存', () => {
  it('保存は下部追従バーに置いたまま', () => {
    expect(PAGE).toContain('<StickyBar')
    expect(PAGE).toContain('下書きを保存')
  })
})
