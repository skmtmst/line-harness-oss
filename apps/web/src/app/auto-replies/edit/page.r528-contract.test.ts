import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const page = readFileSync(join(HERE, 'page.tsx'), 'utf8')

describe('R528 auto-replies/edit 下書き取得失敗', () => {
  it('取得失敗はTargetMissingのerrorで出し、同じidで取り直せる', () => {
    expect(page).toContain('TargetMissing')
    expect(page).toContain('kind="error"')
    // 捕まえた失敗をそのまま渡す（403で再試行を隠す・429で待ち案内）
    expect(page).toContain('error={')
    expect(page).toContain('onRetry')
    // 同じidを取り直す（別idや一覧の取り直しでは直らない）
    expect(page).toContain('getDraft(id)')
  })
})
