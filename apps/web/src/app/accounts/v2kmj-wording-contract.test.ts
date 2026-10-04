import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const VIEW = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'connection-check-view.ts'), 'utf8')

/** 接続確認の5段の札（板 `v2KMj`）の言葉を絵に合わせる歯止め。 */
describe('v2KMj 接続確認の札', () => {
  it('通った／止まった／まだ', () => {
    expect(VIEW).toContain("passed: '通った'")
    expect(VIEW).toContain("failed: '止まった'")
    expect(VIEW).toContain("skipped: 'まだ'")
  })
})
