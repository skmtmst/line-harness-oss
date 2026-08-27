import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

describe('旧ヘルス画面も取得不能を正常扱いしない', () => {
  it('古い結果・空・通信失敗を未確認へ寄せる', () => {
    expect(source).toContain("unknown: { label: '未確認'")
    expect(source).toContain('if (payload.isStale)')
    expect(source).toContain("risks[account.id] = 'unknown'")
    expect(source).not.toContain("risks[account.id] = 'normal'")
    expect(source).toContain("latestRisk[account.id] || 'unknown'")
  })
})
