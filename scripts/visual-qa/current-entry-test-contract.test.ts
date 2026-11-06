import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('引継ぎ6 試験は実際の入口を使う', () => {
  it.each(['v8-affiliates-pagination.react.test.tsx', 'affiliates-v8-design.test.tsx'])('%sが旧コピーを描かない', file => {
    const source = readFileSync(`apps/web/src/app/affiliates/${file}`, 'utf8')
    expect(source).not.toMatch(/(?:from|import\()\s*['"]\.\/v8-affiliates-tab/)
    expect(source).toMatch(/from ['"]\.\/page['"]/)
  })
})
