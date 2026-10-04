import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const DIR = dirname(fileURLToPath(import.meta.url))
const APPROVALS = readFileSync(join(DIR, 'v8-approvals-tab.tsx'), 'utf8')
const REPORT = readFileSync(join(DIR, 'v8-report-tab.tsx'), 'utf8')

/** アフィリエイトのタブごとの空の言い方（板 `rRk0C`）の歯止め。 */
describe('rRk0C タブごとの空の言い方', () => {
  it('成果承認は承認待ちの成果が無いと言う', () => {
    expect(APPROVALS).toContain('承認待ちの成果はありません')
    expect(APPROVALS).toContain('新しい成果が来るとここに出ます')
  })

  it('レポートは期間の成果が無いと言い、期間を変える口を添える', () => {
    expect(REPORT).toContain('この期間の成果はありません')
    expect(REPORT).toContain('期間を変える')
  })
})
